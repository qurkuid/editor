#!/usr/bin/env python3
"""Verify next-replay inputs and gate candidate execution.

Preparation checks only frozen snapshots/raw documents and the historical eba
comparison artifacts.  Candidate phase additionally requires a parent source
freeze and checks the three runtime source hashes against that record.  This
file never edits product/source files and never permits a candidate run before
that freeze.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence/apartment-next-residual-20261003"
NEW_ROOT = EVIDENCE / "replay"
DEFAULT_MANIFEST = NEW_ROOT / "replay-manifest.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def resolve_repo(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def check_file(path: Path, expected: str, label: str, errors: list[str], checked: list[dict[str, Any]]) -> None:
    if not path.is_file():
        errors.append(f"missing {label}: {path}")
        return
    actual = sha256(path)
    checked.append({"path": rel(path), "expectedSha256": expected, "actualSha256": actual, "match": actual == expected})
    if actual != expected:
        errors.append(f"SHA mismatch {label}: expected {expected}, got {actual}")


def extract_source_hashes(record: dict[str, Any]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for key in ("sourceHashes", "currentSourceHashes", "files"):
        value = record.get(key)
        if isinstance(value, dict):
            for path, item in value.items():
                if isinstance(item, str) and len(item) == 64:
                    hashes[str(path)] = item
                elif isinstance(item, dict) and isinstance(item.get("sha256"), str):
                    hashes[str(path)] = item["sha256"]
        elif isinstance(value, list):
            for item in value:
                if not isinstance(item, dict):
                    continue
                path = item.get("path") or item.get("sourcePath")
                digest = item.get("sha256") or item.get("sha256Hex")
                if isinstance(path, str) and isinstance(digest, str):
                    hashes[path] = digest
    return hashes


def verify_source_freeze(path: Path, errors: list[str], checked: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {"path": rel(path) if path.is_absolute() and path.exists() else str(path), "verified": False, "hashes": {}}
    if not path.is_file():
        errors.append(f"missing source-freeze record: {path}")
        return result
    try:
        record = json.loads(path.read_text())
    except Exception as exc:
        errors.append(f"invalid source-freeze JSON: {path}: {exc}")
        return result
    hashes = extract_source_hashes(record)
    result.update({"hashes": hashes, "recordStatus": record.get("status")})
    required = {"packages/core/src/lib/space-detection.ts", "packages/core/src/lib/room-boundary.ts", "apps/editor/lib/apt-vector-scene.ts"}
    missing = sorted(required - set(hashes))
    if missing:
        errors.append(f"source-freeze missing required hashes: {', '.join(missing)}")
    status = str(record.get("status", "")).lower()
    if not any(token in status for token in ("freeze", "frozen", "approved", "final")):
        errors.append("source-freeze status is not explicit frozen/approved/final")
    for source_path in sorted(required & set(hashes)):
        current = REPO / source_path
        check_file(current, hashes[source_path], source_path, errors, checked)
    result["verified"] = not any(item.startswith(("missing source-freeze", "invalid source-freeze", "source-freeze", "SHA mismatch packages/core", "SHA mismatch apps/editor")) for item in errors)
    return result


def verify_manifest(manifest_path: Path, errors: list[str], checked: list[dict[str, Any]]) -> dict[str, Any]:
    if not manifest_path.is_file():
        errors.append(f"missing replay manifest: {manifest_path}")
        return {}
    try:
        manifest = json.loads(manifest_path.read_text())
    except Exception as exc:
        errors.append(f"invalid replay manifest: {exc}")
        return {}
    if manifest.get("status") != "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE":
        errors.append(f"unexpected preparation status: {manifest.get('status')}")
    if manifest.get("candidateRunExecuted") is not False:
        errors.append("manifest claims candidate execution already happened")
    if manifest.get("resolvedRoute") != {"model": "gpt-5.6-luna", "reasoningEffort": "max"}:
        errors.append("resolved route mismatch: expected gpt-5.6-luna/max")
    scope = manifest.get("scope", {})
    for name in ("sameRawDocuments", "sameSourceProbesAndAnnotations"):
        if scope.get(name) is not True:
            errors.append(f"scope guard missing: {name}")
    if scope.get("manualGuideInjection") is not False:
        errors.append("manual guide injection must be explicitly false")
    if scope.get("beforeComparisonIdentity") != "eba42adc-candidate" or scope.get("beforeUsesEba42adcCandidateImportedEvaluation") is not True:
        errors.append("before comparison must be explicitly the eba42adc candidate")
    if "beforeUsesCurrent0b926ImportedEvaluation" in scope:
        errors.append("stale current-0b926 before comparison key is forbidden")
    if scope.get("oldV15FloorBaselineForbidden") is not True:
        errors.append("old v15-floor baseline is not explicitly forbidden")
    if scope.get("acceptedRoomSeedCountExpected") != 330:
        errors.append("same 330 probe contract missing")
    baseline_section = manifest.get("baseline") or {}
    if any(key in baseline_section for key in ("importedRootCurrent0b926", "evaluationRootCurrent0b926", "machineMetricsCurrent0b926")):
        errors.append("stale current-0b926 before paths are forbidden")
    reference = manifest.get("comparisonReference") or {}
    if reference.get("identity") != "eba42adc-candidate" or reference.get("probeWeightedInside") != 298 or reference.get("probeWeightedTotal") != 330:
        errors.append("eba42adc comparison reference is incomplete")
    metrics_record = baseline_section.get("metricsEba42adc") or {}
    metrics_path = resolve_repo(metrics_record.get("path", ""))
    if not metrics_path.is_file():
        errors.append("missing eba42adc before metrics path")
    else:
        try:
            before_metrics = json.loads(metrics_path.read_text())
            before_seeds = before_metrics.get("roomSeeds", {}).get("probeWeighted", {})
            if {
                "totalPlans": before_metrics.get("totalPlans"),
                "importedCases": before_metrics.get("importedCases"),
                "rejectedCases": before_metrics.get("rejectedCases"),
                "inside": before_seeds.get("inside"),
                "probeTotal": before_seeds.get("total"),
            } != {"totalPlans": 50, "importedCases": 44, "rejectedCases": 6, "inside": 298, "probeTotal": 330}:
                errors.append("eba42adc before metrics content is not 50/44/6 and 298/330")
        except Exception as exc:
            errors.append(f"invalid eba42adc before metrics: {exc}")
    manual = manifest.get("manualRecovery") or {}
    if manual.get("targetCases") != 6 or manual.get("separateCasesMeaning") != "TARGET_CASE_COUNT" or manual.get("actualVerifiedCases") is not None:
        errors.append("manual recovery must state six target cases with no verified-count claim")
    if manual.get("historicalEvidenceRoot") is not None or manual.get("verificationStatus") != "UNVERIFIED_SEPARATE_UI_EVIDENCE":
        errors.append("manual recovery historical artifacts must not be presented as success proof")
    baseline_manifest_record = manifest.get("baselineManifest") or {}
    baseline_path = resolve_repo(baseline_manifest_record.get("path", ""))
    if not baseline_path.is_file():
        errors.append(f"missing next baseline manifest: {baseline_path}")
    elif baseline_manifest_record.get("sha256"):
        check_file(baseline_path, baseline_manifest_record["sha256"], "next baseline manifest", errors, checked)
    baseline = json.loads(baseline_path.read_text()) if baseline_path.is_file() else {}
    source_entries = baseline.get("sourceFiles") or []
    raw_entries = baseline.get("rawDocuments") or []
    if len(source_entries) != 24:
        errors.append(f"next baseline manifest source count is {len(source_entries)}, expected 24")
    if len(raw_entries) != 50:
        errors.append(f"next baseline manifest raw count is {len(raw_entries)}, expected 50")
    current_drift = []
    for entry in source_entries:
        current = resolve_repo(entry["path"])
        snapshot = resolve_repo(entry["snapshotPath"])
        if not snapshot.is_file():
            errors.append(f"missing frozen source snapshot: {snapshot}")
        else:
            check_file(snapshot, entry["sha256"], entry["snapshotPath"], errors, checked)
        if not current.is_file():
            errors.append(f"missing current source path: {current}")
        else:
            actual = sha256(current)
            if actual != entry["sha256"]:
                current_drift.append({"path": entry["path"], "manifestSha256": entry["sha256"], "currentSha256": actual})
    for entry in raw_entries:
        check_file(resolve_repo(entry["path"]), entry["sha256"], entry["path"], errors, checked)
    if manifest.get("baseline", {}).get("counts") != {"imported": 44, "rejected": 6, "floorProbeHits": 298, "floorProbeTotal": 330, "exactStoredOverlapPairs": 0}:
        errors.append("baseline counts do not remain 44/6 and 298/330 with exact overlap 0")
    return {"manifest": manifest, "baseline": baseline, "currentSourceDrift": current_drift}


def verify_file_sets(manifest: dict[str, Any], errors: list[str], checked: list[dict[str, Any]]) -> None:
    for name, record in (manifest.get("fileSets") or {}).items():
        root = resolve_repo(record.get("path", ""))
        expected = {item["path"]: item for item in record.get("files", [])}
        actual = sorted(p for p in root.iterdir() if p.is_file() and p.suffix == ".json") if root.is_dir() else []
        if len(actual) != record.get("fileCount"):
            errors.append(f"file count mismatch {name}: expected {record.get('fileCount')}, got {len(actual)}")
        for path in actual:
            key = rel(path)
            if key not in expected:
                errors.append(f"unexpected file in {name}: {key}")
            else:
                check_file(path, expected[key]["sha256"], key, errors, checked)
        tree = hashlib.sha256("".join(f"{key}\t{expected[key]['sha256']}\n" for key in sorted(expected)).encode()).hexdigest()
        if tree != record.get("treeSha256"):
            errors.append(f"tree hash malformed for {name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--phase", choices=("prepare", "candidate"), default="prepare")
    parser.add_argument("--source-freeze", type=Path)
    parser.add_argument("--output", type=Path, default=EVIDENCE / "verification/input-guard-prepared.json")
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    errors: list[str] = []
    checked: list[dict[str, Any]] = []
    if NEW_ROOT.resolve() not in manifest_path.parents:
        errors.append(f"manifest outside next replay root: {manifest_path}")
    if NEW_ROOT.resolve() not in output_path.parents and EVIDENCE.resolve() not in output_path.parents:
        errors.append(f"output outside next evidence root: {output_path}")
    state = verify_manifest(manifest_path, errors, checked)
    manifest = state.get("manifest", {})
    if manifest:
        verify_file_sets(manifest, errors, checked)
        for entry in manifest.get("frozenFiles", []):
            check_file(resolve_repo(entry["path"]), entry["sha256"], entry["path"], errors, checked)
        for entry in manifest.get("sourceSnapshots", {}).get("records", []):
            check_file(resolve_repo(entry["snapshotPath"]), entry["sha256"], entry["snapshotPath"], errors, checked)
        render = manifest.get("baseline", {}).get("renderReuse", {}).get("root", {})
        if render.get("manifest"):
            record = render["manifest"]
            check_file(resolve_repo(record["path"]), record["sha256"], record["path"], errors, checked)
        # Validate the historical artifacts that establish the 44/6, 298/330,
        # exact-overlap-zero and authored-preservation baseline contracts.
        hist = manifest.get("baseline", {}).get("historicalEba42adc", {})
        if hist.get("plans") != 50 or hist.get("imported") != 44 or hist.get("rejected") != 6 or hist.get("floorProbeHits") != 298 or hist.get("floorProbeTotal") != 330 or hist.get("exactStoredOverlapPairs") != 0:
            errors.append("historical eba42adc baseline contract changed")
    source_freeze_result = {"required": args.phase == "candidate", "verified": False}
    if args.phase == "candidate":
        if args.source_freeze is None:
            errors.append("candidate phase requires --source-freeze")
        else:
            source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors, checked)
    elif args.source_freeze is not None:
        source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors, checked)
    output = {
        "schemaVersion": "apartment-next-residual-replay-verification-v1",
        "phase": args.phase,
        "manifest": rel(manifest_path),
        "verified": not errors,
        "candidateExecutionAllowed": args.phase == "candidate" and not errors,
        "errors": errors,
        "resolvedRoute": manifest.get("resolvedRoute"),
        "sourceFreeze": source_freeze_result,
        "checked": {"files": len(checked), "sourceSnapshots": len(manifest.get("sourceSnapshots", {}).get("records", [])), "rawDocuments": len((state.get("baseline") or {}).get("rawDocuments", [])), "same330ProbeContract": manifest.get("scope", {}).get("acceptedRoomSeedCountExpected") == 330, "eba42adcComparisonReference": manifest.get("scope", {}).get("beforeComparisonIdentity") == "eba42adc-candidate", "oldV15FloorForbidden": manifest.get("scope", {}).get("oldV15FloorBaselineForbidden") is True, "manualGuideInjectionForbidden": manifest.get("scope", {}).get("manualGuideInjection") is False},
        "currentSourceDriftAtVerification": state.get("currentSourceDrift", []),
        "candidateRunExecuted": manifest.get("candidateRunExecuted"),
        "writesRestrictedTo": manifest.get("scope", {}).get("writesAllowedOnlyUnder"),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
