#!/usr/bin/env python3
"""Guard Lane B preparation and, only with a supplied freeze, candidate inputs.

Preparation is read-only.  Candidate execution is intentionally a separate
phase and requires an explicit source-freeze path; this verifier never runs
the evaluator or imports product code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
DEFAULT_MANIFEST = ROOT / "preparation-manifest-lane-b-final-frozen-core-baseline-measured.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repo_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def check_file(record: dict[str, Any], errors: list[str], checked: list[dict[str, Any]]) -> None:
    path = repo_path(str(record.get("path", "")))
    expected = record.get("sha256")
    if not path.is_file():
        errors.append(f"missing {record.get('kind', 'file')}: {path}")
        return
    actual = sha256(path)
    matched = actual == expected
    checked.append({"path": rel(path), "expectedSha256": expected, "actualSha256": actual, "match": matched})
    if not matched:
        errors.append(f"SHA mismatch {path}: expected {expected}, got {actual}")


def verify_tree(record: dict[str, Any], errors: list[str], checked: list[dict[str, Any]]) -> None:
    root = repo_path(str(record.get("path", "")))
    if not root.is_dir():
        errors.append(f"missing evidence tree: {root}")
        return
    files = record.get("files") or []
    actual = sorted(path for path in root.glob("*.json") if path.is_file())
    if len(actual) != int(record.get("fileCount", -1)):
        errors.append(f"tree count mismatch {root}: expected {record.get('fileCount')}, got {len(actual)}")
    expected_by_path = {str(item.get("path")): item for item in files}
    for path in actual:
        key = rel(path)
        if key not in expected_by_path:
            errors.append(f"unexpected file in evidence tree: {key}")
        else:
            check_file(expected_by_path[key], errors, checked)
    tree_sha = hashlib.sha256("".join(f"{key}\t{expected_by_path[key].get('sha256')}\n" for key in sorted(expected_by_path)).encode()).hexdigest()
    if tree_sha != record.get("treeSha256"):
        errors.append(f"tree hash mismatch {root}")


def source_hashes(record: dict[str, Any]) -> dict[str, str]:
    value = record.get("sourceHashes") or {}
    if isinstance(value, dict):
        return {str(path): str(item) for path, item in value.items() if isinstance(item, str)}
    return {}


def verify_source_freeze(path: Path, errors: list[str], checked: list[dict[str, Any]]) -> dict[str, Any]:
    if not path.is_file():
        errors.append(f"missing explicit source freeze: {path}")
        return {"path": str(path), "verified": False}
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"invalid source freeze JSON: {path}: {exc}")
        return {"path": str(path), "verified": False}
    status = str(record.get("status", "")).lower()
    if not any(token in status for token in ("freeze", "frozen", "approved", "final")):
        errors.append(f"source freeze status is not explicit: {record.get('status')}")
    hashes = source_hashes(record)
    required = ["packages/core/src/lib/space-detection.ts", "packages/core/src/lib/room-boundary.ts", "apps/editor/lib/apt-vector-scene.ts"]
    missing = [path for path in required if path not in hashes]
    if missing:
        errors.append(f"source freeze missing required hashes: {missing}")
    for source_path in required:
        current = REPO / source_path
        if not current.is_file():
            errors.append(f"missing frozen current source: {current}")
        elif source_path in hashes:
            actual = sha256(current)
            checked.append({"path": source_path, "expectedSha256": hashes[source_path], "actualSha256": actual, "match": actual == hashes[source_path]})
            if actual != hashes[source_path]:
                errors.append(f"source freeze SHA mismatch: {source_path}")
    return {"path": rel(path), "sha256": sha256(path), "status": record.get("status"), "verified": not any(f"source freeze" in error or "source freeze SHA" in error for error in errors), "sourceHashes": hashes}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--phase", choices=("prepare", "candidate"), default="prepare")
    parser.add_argument("--source-freeze", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "preparation-verification-final.json")
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    errors: list[str] = []
    checked: list[dict[str, Any]] = []
    if ROOT.resolve() not in manifest_path.parents:
        errors.append(f"manifest outside preparation root: {manifest_path}")
    if not manifest_path.is_file():
        errors.append(f"missing preparation manifest: {manifest_path}")
        manifest: dict[str, Any] = {}
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    allowed_statuses = {
        "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE",
        "PREPARED_WITH_LANE_A_BASELINE_TIMED_WAITING_FOR_FINAL_SOURCE_FREEZE",
        "PREPARED_WITH_LANE_A_FROZEN_CORE_BASELINE_TIMED_WAITING_FOR_FINAL_SOURCE_FREEZE",
    }
    if manifest.get("status") not in allowed_statuses:
        errors.append(f"unexpected preparation status: {manifest.get('status')}")
    if manifest.get("candidateRunExecuted") is not False:
        errors.append("manifest claims candidate execution")
    if manifest.get("resolvedRoute") != {"model": "gpt-5.6-luna", "reasoningEffort": "max"}:
        errors.append("resolved route mismatch; expected gpt-5.6-luna/max")
    scope = manifest.get("scope") or {}
    required_true = ("evidenceOnly", "sameRawDocuments", "sameSourceProbesAndAnnotations", "oldV15FloorBaselineForbidden", "candidateExecutionBlockedUntilExplicitSourceFreeze")
    for key in required_true:
        if scope.get(key) is not True:
            errors.append(f"scope guard missing/false: {key}")
    for key in ("productSourceMutation", "testBuildRuntimeBrowserMutation", "rawRasterRerun", "manualGuideInjection"):
        if scope.get(key) is not False:
            errors.append(f"scope must remain false: {key}")
    if scope.get("beforeComparisonIdentity") != "eba42adc-candidate" or scope.get("beforeUsesEba42adcCandidateImportedEvaluation") is not True:
        errors.append("before comparison is not explicitly Lane A eba42adc candidate")
    if "beforeUsesCurrent0b926ImportedEvaluation" in scope:
        errors.append("stale current-0b926 before key present")

    baseline = manifest.get("baseline") or {}
    if baseline.get("identity") != "lane-a-eba42adc-core-eb96fcb-imported-evaluation":
        errors.append("baseline identity is not Lane A eba42/eb96")
    counts = baseline.get("counts") or {}
    expected_counts = {"plans": 50, "imported": 44, "rejected": 6, "errors": 0, "floorProbeHits": 298, "floorProbeTotal": 330, "storedSlabs": 374, "storedCeilings": 374, "exactRawOverlapPairs": 0, "exactStoredSlabOverlapPairs": 0, "exactStoredCeilingOverlapPairs": 0, "perCaseFloorProbeLosses": 0}
    if counts != expected_counts:
        errors.append(f"baseline counts changed: {counts}")
    for key in ("raw", "imported", "evaluation"):
        if isinstance(baseline.get(key), dict):
            verify_tree(baseline[key], errors, checked)
        else:
            errors.append(f"missing baseline tree: {key}")
    for key in ("sourceFreeze", "parentAutomaticSourceGate", "metrics", "machine", "pairedMetrics", "exactAudit", "preservation", "rawSummary", "planManifest", "sourceProbes", "dimensionAnnotations", "annotationImageFreeze"):
        record = baseline.get(key)
        if not isinstance(record, dict):
            errors.append(f"missing baseline file record: {key}")
        else:
            check_file(record, errors, checked)

    comparison = manifest.get("comparisonReference") or {}
    if comparison.get("identity") != "eba42adc-candidate" or comparison.get("probeWeightedInside") != 298 or comparison.get("probeWeightedTotal") != 330:
        errors.append("comparison reference is not eba42adc 298/330")
    metric = manifest.get("containedDuplicateSpan") or {}
    if metric.get("baselinePairs") != 20 or abs(float(metric.get("baselineContainedLengthM", -1)) - 5.837984476195861) > 1e-9:
        errors.append("contained duplicate baseline metric changed")
    if (metric.get("p07") or {}).get("pairs") != 3 or abs(float((metric.get("p07") or {}).get("containedLengthM", -1)) - 1.2844009967433032) > 1e-9:
        errors.append("p07 baseline contained metric changed")

    exact_path = ROOT / "exact-surface-audit-lane-a-final.json"
    contained_path = ROOT / "contained-duplicate-span-lane-a-final.json"
    o5_path = ROOT / "o5-source-window-lane-a-final.json"
    for path in (exact_path, contained_path, o5_path):
        if not path.is_file():
            errors.append(f"missing derived audit: {path}")
    if exact_path.is_file():
        exact = json.loads(exact_path.read_text(encoding="utf-8"))
        candidate = exact.get("candidate") or {}
        if any((candidate.get(key) or {}).get("positiveOverlapPairs") != 0 for key in ("rawSpaces", "storedSlabs", "storedCeilings")):
            errors.append("exact audit has positive overlap")
        if exact.get("readiness", {}).get("sourceSnapshotHashesMatchFreeze") is not True:
            errors.append("exact audit source snapshot/freeze binding failed")
    if contained_path.is_file():
        contained = json.loads(contained_path.read_text(encoding="utf-8"))
        if contained.get("summary", {}).get("acceptedImportedCases") != 44 or contained.get("summary", {}).get("rejectedCases") != 6 or contained.get("summary", {}).get("pairCount") != 20:
            errors.append("contained duplicate audit counts changed")
        if not contained.get("p07Expectation", {}).get("pairCountMatches") or not contained.get("p07Expectation", {}).get("lengthMatchesWithin1e6M"):
            errors.append("p07 contained duplicate contract failed")
    if o5_path.is_file() and json.loads(o5_path.read_text(encoding="utf-8")).get("status") != "PASS":
        errors.append("o5 source window audit failed")

    performance = manifest.get("performance") or {}
    performance_manifest_path = repo_path(str(performance.get("inputManifest", "")))
    if not performance_manifest_path.is_file():
        errors.append("missing Lane A performance input manifest")
    else:
        performance_manifest = json.loads(performance_manifest_path.read_text(encoding="utf-8"))
        if performance_manifest.get("status") != "READY_LANE_A_BASELINE_ONLY":
            errors.append("performance input manifest is not baseline-only")
        if performance_manifest.get("rawInputCount") != 50 or len(performance_manifest.get("cases") or []) != 44:
            errors.append("performance input set is not 50 raw/44 accepted")
        if performance_manifest.get("protocol", {}).get("warmups") != 2 or performance_manifest.get("protocol", {}).get("rounds") != 12:
            errors.append("same-protocol warmup/round contract changed")
        if performance_manifest.get("candidateExecution", {}).get("executed") is not False:
            errors.append("performance manifest claims candidate execution")
    source_freeze_result = {"required": args.phase == "candidate", "verified": False}
    if args.phase == "candidate":
        if args.source_freeze is None:
            errors.append("candidate phase requires explicit --source-freeze")
        else:
            source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors, checked)
    elif args.source_freeze is not None:
        source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors, checked)

    result = {
        "schemaVersion": "apartment-source-chain-guards-lane-b-preparation-verification-v1",
        "phase": args.phase,
        "manifest": rel(manifest_path) if manifest_path.exists() else str(manifest_path),
        "verified": not errors,
        "candidateExecutionAllowed": args.phase == "candidate" and not errors,
        "candidateRunExecuted": manifest.get("candidateRunExecuted"),
        "resolvedRoute": manifest.get("resolvedRoute"),
        "sourceFreeze": source_freeze_result,
        "checked": {"files": len(checked), "same50": counts == expected_counts, "containedPairCount": (manifest.get("containedDuplicateSpan") or {}).get("baselinePairs"), "exactStoredSlabOverlapPairs": 0 if not errors else None, "exactStoredCeilingOverlapPairs": 0 if not errors else None},
        "errors": errors,
        "writesRestrictedTo": scope.get("writesAllowedOnlyUnder"),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS" if result["verified"] else "FAIL", "phase": args.phase, "errorCount": len(errors), "candidateExecutionAllowed": result["candidateExecutionAllowed"]}, ensure_ascii=False))
    return 0 if result["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
