#!/usr/bin/env python3
"""Verify the guarded replay manifest before a candidate run.

``--phase prepare`` verifies the immutable 50-document/current-0b926 inputs
and the 24 source snapshots.  ``--phase candidate`` additionally requires an
explicit source-freeze JSON and exact current SHA matches; without that record
it exits non-zero and the evaluator must not run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence/apartment-residual-closure-20261003"
NEW_ROOT = EVIDENCE / "replay"
DEFAULT_MANIFEST = NEW_ROOT / "replay-manifest.json"
PARENT_VERIFY = EVIDENCE / "verify_inputs.py"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def resolve_repo(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else REPO / p


def check_file(path: Path, expected: str, label: str, errors: list[str]) -> None:
    if not path.is_file():
        errors.append(f"missing {label}: {path}")
        return
    actual = sha256(path)
    if actual != expected:
        errors.append(f"SHA mismatch {label}: expected {expected}, got {actual}")


def extract_source_hashes(record: dict[str, Any]) -> dict[str, str]:
    """Accept the source-freeze shapes used by the evidence lanes."""
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


def verify_source_freeze(path: Path, errors: list[str]) -> dict[str, Any]:
    if not path.is_file():
        errors.append(f"missing source-freeze record: {path}")
        return {"path": str(path), "verified": False, "hashes": {}}
    try:
        record = json.loads(path.read_text())
    except Exception as exc:
        errors.append(f"invalid source-freeze JSON: {path}: {exc}")
        return {"path": rel(path), "verified": False, "hashes": {}}
    hashes = extract_source_hashes(record)
    required = {
        "packages/core/src/lib/space-detection.ts",
        "packages/core/src/lib/room-boundary.ts",
        "apps/editor/lib/apt-vector-scene.ts",
    }
    missing = sorted(required - set(hashes))
    if missing:
        errors.append(f"source-freeze missing required SHA entries: {', '.join(missing)}")
    status = str(record.get("status", "")).lower()
    explicit_hash_freeze = isinstance(record.get("coreSha256"), str) and isinstance(record.get("approvedPlan"), str) and isinstance(record.get("immutableInputs"), dict)
    if not any(token in status for token in ("freeze", "frozen", "approved", "final")) and not explicit_hash_freeze:
        errors.append("source-freeze record status is not an explicit frozen/approved state")
    if explicit_hash_freeze and record.get("coreSha256") != hashes.get("packages/core/src/lib/space-detection.ts"):
        errors.append("source-freeze coreSha256 does not match sourceHashes.space-detection.ts")
    for source_path in sorted(required & set(hashes)):
        actual_path = resolve_repo(source_path)
        if not actual_path.is_file():
            errors.append(f"source-freeze source missing: {source_path}")
            continue
        actual = sha256(actual_path)
        if actual != hashes[source_path]:
            errors.append(f"source-freeze current SHA mismatch {source_path}: expected {hashes[source_path]}, got {actual}")
    return {"path": rel(path), "verified": not errors, "hashes": hashes, "recordStatus": record.get("status") or ("explicit-hash-freeze" if explicit_hash_freeze else None)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--phase", choices=("prepare", "candidate"), default="prepare")
    parser.add_argument("--source-freeze", type=Path)
    parser.add_argument("--output", type=Path, default=NEW_ROOT / "verification-preflight.json")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    errors: list[str] = []
    if NEW_ROOT.resolve() not in manifest_path.parents:
        errors.append(f"manifest outside new replay root: {manifest_path}")
    if NEW_ROOT.resolve() not in output_path.parents:
        errors.append(f"output outside new replay root: {output_path}")
    if not manifest_path.is_file():
        errors.append(f"missing replay manifest: {manifest_path}")
        payload = {"verified": False, "phase": args.phase, "errors": errors}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2) + "\n")
        print(json.dumps(payload, indent=2))
        return 1

    manifest = json.loads(manifest_path.read_text())
    if manifest.get("status") != "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE":
        errors.append(f"unexpected preparation status: {manifest.get('status')}")
    if manifest.get("candidateRunExecuted") is not False:
        errors.append("prepared manifest already claims a candidate execution")
    if manifest.get("resolvedRoute") != {"model": "gpt-5.6-luna", "reasoningEffort": "max"}:
        errors.append("resolved route mismatch: expected gpt-5.6-luna/max")
    scope = manifest.get("scope", {})
    if scope.get("oldV15FloorBaselineForbidden") is not True:
        errors.append("old v15-floor baseline is not explicitly forbidden")
    if scope.get("sameSourceProbesAndAnnotations") is not True:
        errors.append("same source probes/annotations guard missing")

    for entry in manifest.get("frozenFiles", []):
        path = resolve_repo(entry["path"])
        check_file(path, entry["sha256"], entry["path"], errors)
    for set_name, entry in manifest.get("fileSets", {}).items():
        root = resolve_repo(entry["path"])
        expected_paths = {item["path"]: item for item in entry.get("files", [])}
        actual_files = sorted(p for p in root.iterdir() if p.is_file() and p.suffix == ".json") if root.is_dir() else []
        if len(actual_files) != entry.get("fileCount"):
            errors.append(f"file count mismatch {set_name}: expected {entry.get('fileCount')}, got {len(actual_files)}")
        for actual in actual_files:
            try:
                expected = expected_paths[rel(actual)]
            except KeyError:
                errors.append(f"unexpected file in {set_name}: {rel(actual)}")
                continue
            check_file(actual, expected["sha256"], rel(actual), errors)
        expected_tree = hashlib.sha256("".join(f"{p}\t{expected_paths[p]['sha256']}\n" for p in sorted(expected_paths)).encode()).hexdigest()
        if expected_tree != entry.get("treeSha256"):
            errors.append(f"stored tree hash malformed for {set_name}")

    source_snapshot_records = manifest.get("sourceSnapshots", {}).get("records", [])
    if len(source_snapshot_records) != 24:
        errors.append(f"expected 24 source snapshots, found {len(source_snapshot_records)}")
    for entry in source_snapshot_records:
        check_file(resolve_repo(entry["snapshotPath"]), entry["sha256"], entry["snapshotPath"], errors)

    annotation_freeze = manifest.get("baseline", {}).get("annotationImageFreeze", {})
    annotation_files = annotation_freeze.get("files", [])
    if annotation_freeze.get("count") != 52 or len(annotation_files) != 52:
        errors.append(f"expected 52 frozen annotation files, found {len(annotation_files)}")
    for entry in annotation_files:
        check_file(resolve_repo(entry["path"]), entry["sha256"], entry["path"], errors)

    parent_guard_path = NEW_ROOT / f"parent-input-guard-{args.phase}.json"
    if PARENT_VERIFY.is_file():
        result = subprocess.run(
            [sys.executable, str(PARENT_VERIFY), str(parent_guard_path)],
            cwd=REPO,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            errors.append(f"parent verify_inputs.py failed: {result.stdout.strip() or result.stderr.strip()}")
        try:
            parent_guard = json.loads(parent_guard_path.read_text())
            if parent_guard.get("verified") is not True or parent_guard.get("filesChecked") != 168:
                errors.append(f"parent guard did not verify 168 files: {parent_guard}")
        except Exception as exc:
            errors.append(f"parent guard output unreadable: {exc}")
    else:
        errors.append(f"missing parent input verifier: {PARENT_VERIFY}")

    source_freeze_result: dict[str, Any] = {"required": args.phase == "candidate", "verified": False}
    if args.phase == "candidate":
        if args.source_freeze is None:
            errors.append("candidate phase requires explicit --source-freeze")
        else:
            source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors)
    elif args.source_freeze is not None:
        source_freeze_result = verify_source_freeze(args.source_freeze.resolve(), errors)

    payload = {
        "schemaVersion": "apartment-residual-closure-replay-verification-v1",
        "phase": args.phase,
        "manifest": rel(manifest_path),
        "verified": not errors,
        "errors": errors,
        "resolvedRoute": manifest.get("resolvedRoute"),
        "candidateExecutionAllowed": not errors and args.phase == "candidate",
        "sourceFreeze": source_freeze_result,
        "checked": {
            "sameRawDocuments": True,
            "same330ProbeContract": manifest.get("scope", {}).get("acceptedRoomSeedCountExpected") == 330,
            "beforeCurrent0b926Paths": manifest.get("baseline", {}).get("machineMetricsCurrent0b926") is not None,
            "oldV15FloorForbidden": manifest.get("scope", {}).get("oldV15FloorBaselineForbidden") is True,
            "outputRoot": rel(NEW_ROOT),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
