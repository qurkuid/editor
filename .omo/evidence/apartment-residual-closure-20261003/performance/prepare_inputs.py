#!/usr/bin/env python3
"""Materialize the immutable 44-case wall graph input set for benchmarking.

The benchmark deliberately times the detector against these normalized graphs.
Importer execution is verified separately by the TypeScript runner so a future
variant can be passed through the same source-copy import rewrite without
changing the timed input set.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence"
BASELINE = EVIDENCE / "apartment-residual-closure-20261003/baseline-parent"
RAW_ROOT = EVIDENCE / "apartment-scale-fix-20261003/candidate15"
IMPORTED_ROOT = EVIDENCE / "apartment-topology-refinement-20261003/candidate-imported-topology-final-0b926754"
EVAL_ROOT = EVIDENCE / "apartment-topology-refinement-20261003/candidate-evaluation-topology-final-0b926754"
OUT_ROOT = REPO / ".omo/evidence/apartment-residual-closure-20261003/performance"
WALL_ROOT = OUT_ROOT / "inputs/current-normalized-walls"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 8)
    return value


def point(value: Any) -> Any:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return [number(value[0]), number(value[1])]
    return value


def wall_sort_key(wall: dict[str, Any]) -> tuple[str, ...]:
    start = point(wall.get("start")) or [None, None]
    end = point(wall.get("end")) or [None, None]
    return (
        str(start[0]),
        str(start[1]),
        str(end[0]),
        str(end[1]),
        str(number(wall.get("thickness"))),
        str(number(wall.get("height"))),
        str(wall.get("kind", "")),
    )


def normalize_wall(wall: dict[str, Any], index: int, level_id: str) -> dict[str, Any]:
    # Preserve the fields consumed by detectSpacesForLevel, including children
    # (door markers are part of its opening-aware topology decisions). Generated
    # scene IDs are replaced with ordinal IDs so this input has no random-ID
    # timing or geometry variance.
    result = dict(wall)
    result["id"] = f"benchmark-wall-{index:04d}"
    result["parentId"] = level_id
    result["type"] = result.get("type", "wall")
    result["start"] = point(result.get("start"))
    result["end"] = point(result.get("end"))
    result["thickness"] = number(result.get("thickness"))
    if "height" in result:
        result["height"] = number(result.get("height"))
    if "curve" in result and isinstance(result["curve"], dict):
        result["curve"] = {
            key: number(value) if isinstance(value, (int, float)) else value
            for key, value in result["curve"].items()
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    manifest_path = BASELINE / "baseline-manifest.json"
    baseline_manifest = json.loads(manifest_path.read_text())
    source_entries = {
        entry["path"]: entry["sha256"]
        for entry in baseline_manifest["files"]
        if entry.get("kind") == "source"
    }
    expected_core_sha = source_entries.get("packages/core/src/lib/space-detection.ts")
    expected_importer_sha = source_entries.get("apps/editor/lib/apt-vector-scene.ts")
    if not expected_core_sha or not expected_importer_sha:
        raise SystemExit("baseline manifest has no canonical core/importer hashes")

    eval_rows: list[dict[str, Any]] = []
    for path in sorted(EVAL_ROOT.glob("*.json")):
        doc = json.loads(path.read_text())
        if doc.get("status") != "IMPORTED":
            continue
        plan_id = str(doc.get("planId") or path.stem)
        imported_path = IMPORTED_ROOT / f"{plan_id}.json"
        raw_path = RAW_ROOT / f"{plan_id}.json"
        if not imported_path.exists() or not raw_path.exists():
            raise SystemExit(f"missing source for imported case {plan_id}")
        eval_rows.append(
            {
                "ordinal": int(doc.get("ordinal", len(eval_rows) + 1)),
                "key": doc.get("key") or doc.get("name") or plan_id,
                "planId": plan_id,
                "evaluationPath": str(path.relative_to(REPO)),
                "evaluationSha256": sha256(path),
                "importedPath": str(imported_path.relative_to(REPO)),
                "importedSha256": sha256(imported_path),
                "rawPath": str(raw_path.relative_to(REPO)),
                "rawSha256": sha256(raw_path),
            }
        )
    eval_rows.sort(key=lambda row: (row["ordinal"], row["planId"]))
    if len(eval_rows) != 44:
        raise SystemExit(f"expected 44 imported cases, found {len(eval_rows)}")

    WALL_ROOT.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, Any]] = []
    for ordinal, row in enumerate(eval_rows, start=1):
        out_path = WALL_ROOT / f"{row['planId']}.json"
        if out_path.exists() and not args.overwrite:
            raise SystemExit(f"refusing to overwrite existing snapshot: {out_path}")
        imported = json.loads((REPO / row["importedPath"]).read_text())
        level_id = f"benchmark-level-{row['planId']}"
        walls = sorted(imported.get("walls") or [], key=wall_sort_key)
        normalized = [normalize_wall(wall, index, level_id) for index, wall in enumerate(walls)]
        snapshot = {
            "schemaVersion": "apartment-current-normalized-wall-snapshot-v1",
            "source": {
                "planId": row["planId"],
                "key": row["key"],
                "ordinal": row["ordinal"],
                "importedPath": row["importedPath"],
                "importedSha256": row["importedSha256"],
                "rawPath": row["rawPath"],
                "rawSha256": row["rawSha256"],
            },
            "normalization": {
                "coordinates": "rounded to 8 decimals",
                "wallOrder": "start,end,thickness,height,kind",
                "generatedIds": "replaced by benchmark-wall ordinal IDs",
                "parentId": level_id,
            },
            "levelId": level_id,
            "walls": normalized,
        }
        out_path.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
        row = dict(row)
        row["snapshotPath"] = str(out_path.relative_to(REPO))
        row["snapshotSha256"] = sha256(out_path)
        row["wallCount"] = len(normalized)
        cases.append(row)

    manifest = {
        "schemaVersion": "apartment-residual-performance-inputs-v1",
        "recordedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "scope": "44 current imported V15 wall graphs; generated IDs normalized; no vectorizer rerun",
        "baselineParentManifest": str(manifest_path.relative_to(REPO)),
        "sourceSnapshots": {
            "core": {
                "path": str((BASELINE / "source-snapshots/packages/core/src/lib/space-detection.ts").relative_to(REPO)),
                "sha256": expected_core_sha,
            },
            "importer": {
                "path": str((BASELINE / "source-snapshots/apps/editor/lib/apt-vector-scene.ts").relative_to(REPO)),
                "sha256": expected_importer_sha,
            },
        },
        "inputRoots": {
            "raw": str(RAW_ROOT.relative_to(REPO)),
            "imported": str(IMPORTED_ROOT.relative_to(REPO)),
            "evaluation": str(EVAL_ROOT.relative_to(REPO)),
            "normalizedWalls": str(WALL_ROOT.relative_to(REPO)),
        },
        "protocol": {"warmupRounds": 2, "timedRoundsPerCase": 12},
        "cases": cases,
    }
    manifest_path_out = OUT_ROOT / "inputs/manifest-current-normalized-walls.json"
    manifest_path_out.parent.mkdir(parents=True, exist_ok=True)
    manifest_path_out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "manifest": str(manifest_path_out.relative_to(REPO)),
                "cases": len(cases),
                "walls": sum(row["wallCount"] for row in cases),
                "coreSha256": expected_core_sha,
                "importerSha256": expected_importer_sha,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
