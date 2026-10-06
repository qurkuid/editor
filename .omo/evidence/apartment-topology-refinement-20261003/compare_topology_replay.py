#!/usr/bin/env python3
"""Compare topology replay geometry after ignoring generated IDs.

Evidence-only helper. It reads the frozen v13 baseline symlinks and one named
candidate importer root, then writes a normalized comparison JSON in the new
root. It does not mutate source or the frozen baseline.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent


def read(path: Path) -> Any:
    return json.loads(path.read_text())


def num(value: Any) -> float:
    return float(value or 0)


def point_key(point: Any) -> tuple[float, float]:
    return (round(num(point[0]), 8), round(num(point[1]), 8))


def source_point(point: Any, doc: dict[str, Any]) -> tuple[float, float]:
    """Map imported level metres back to the source document pixel frame."""
    image_size = doc.get("imageSize") or [0, 0]
    mm_per_px = doc.get("mmPerPx")
    if len(image_size) != 2 or not mm_per_px:
        return point_key(point)
    return (
        (num(point[0]) * 1000.0 / num(mm_per_px)) + num(image_size[0]) / 2.0,
        (num(point[1]) * 1000.0 / num(mm_per_px)) + num(image_size[1]) / 2.0,
    )


def wall_key(wall: dict[str, Any], doc: dict[str, Any]) -> tuple[Any, ...]:
    a, b = point_key(source_point(wall.get("start", [0, 0]), doc)), point_key(source_point(wall.get("end", [0, 0]), doc))
    ends = tuple(sorted((a, b)))
    return (ends, round(num(wall.get("thickness")), 8), round(num(wall.get("height")), 8), wall.get("kind"))


def wall_index(scene: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(wall.get("id")): wall for wall in scene.get("walls", []) if wall.get("id") is not None}


def canonical_wall_position(wall: dict[str, Any], position: Any, doc: dict[str, Any]) -> float:
    start = point_key(source_point(wall.get("start", [0, 0]), doc))
    end = point_key(source_point(wall.get("end", [0, 0]), doc))
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    pos = num(position)
    if start <= end:
        return round(pos, 8)
    return round(length - pos, 8)


def opening_key(opening: dict[str, Any], walls: dict[str, dict[str, Any]], doc: dict[str, Any]) -> tuple[Any, ...]:
    host = walls.get(str(opening.get("wallId")))
    host_key = wall_key(host, doc) if host else None
    pos = canonical_wall_position(host, (opening.get("position") or [0])[0], doc) if host else round(num((opening.get("position") or [0])[0]), 8)
    return (
        opening.get("type"),
        host_key,
        pos,
        round(num(opening.get("width")), 8),
        round(num(opening.get("height")), 8),
        opening.get("openingKind"),
    )


def metadata_ids(scene: dict[str, Any], collection: str, field: str) -> set[str]:
    values: set[str] = set()
    for item in scene.get(collection, []):
        value = (item.get("metadata") or {}).get(field)
        if value is not None:
            values.add(str(value))
    return values


def compare_case(base: dict[str, Any], candidate: dict[str, Any], base_doc: dict[str, Any], candidate_doc: dict[str, Any], base_eval: dict[str, Any], candidate_eval: dict[str, Any], key: str) -> dict[str, Any]:
    base_walls = base.get("walls", [])
    candidate_walls = candidate.get("walls", [])
    base_wall_keys = sorted(wall_key(wall, base_doc) for wall in base_walls)
    candidate_wall_keys = sorted(wall_key(wall, candidate_doc) for wall in candidate_walls)
    base_wall_index = wall_index(base)
    candidate_wall_index = wall_index(candidate)
    base_openings = sorted(opening_key(opening, base_wall_index, base_doc) for opening in base.get("openings", []))
    candidate_openings = sorted(opening_key(opening, candidate_wall_index, candidate_doc) for opening in candidate.get("openings", []))
    base_source_openings = metadata_ids(base, "openings", "sourceOpeningId")
    candidate_source_openings = metadata_ids(candidate, "openings", "sourceOpeningId")
    base_source_rooms = metadata_ids(base, "zones", "sourceRoomId")
    candidate_source_rooms = metadata_ids(candidate, "zones", "sourceRoomId")
    candidate_spaces = candidate.get("spaces", [])
    candidate_space_ids = [str(space.get("id")) for space in candidate_spaces]
    candidate_unique_space_ids = len(set(candidate_space_ids))
    return {
        "key": key,
        "status": {"baseline": base_eval.get("status"), "candidate": candidate_eval.get("status")},
        "walls": {
            "baseline": len(base_walls),
            "candidate": len(candidate_walls),
            "normalizedSignatureEqual": base_wall_keys == candidate_wall_keys,
            "baselineSignatureCount": len(base_wall_keys),
            "candidateSignatureCount": len(candidate_wall_keys),
        },
        "openings": {
            "baseline": len(base.get("openings", [])),
            "candidate": len(candidate.get("openings", [])),
            "normalizedSignatureEqual": base_openings == candidate_openings,
            "baselineSignatureCount": len(base_openings),
            "candidateSignatureCount": len(candidate_openings),
        },
        "metadata": {
            "sourceOpeningIds": {
                "baseline": len(base_source_openings),
                "candidate": len(candidate_source_openings),
                "candidateMissingFromBaseline": sorted(candidate_source_openings - base_source_openings),
                "baselineMissingFromCandidate": sorted(base_source_openings - candidate_source_openings),
            },
            "sourceRoomIds": {
                "baseline": len(base_source_rooms),
                "candidate": len(candidate_source_rooms),
                "candidateMissingFromBaseline": sorted(candidate_source_rooms - base_source_rooms),
                "baselineMissingFromCandidate": sorted(base_source_rooms - candidate_source_rooms),
            },
        },
        "spaces": {
            "candidateDetected": len(candidate_spaces),
            "candidateUniqueFullIds": candidate_unique_space_ids,
            "candidateFullIdCollision": candidate_unique_space_ids != len(candidate_space_ids),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-imported-root", type=Path, required=True)
    parser.add_argument("--candidate-evaluation-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = read(ROOT / "manifest.json")
    rows: list[dict[str, Any]] = []
    for item in manifest["plans"]:
        key, plan_id = item["key"], item["planId"]
        base_dir = ROOT / key
        base_eval = read(base_dir / "evaluation.json")
        candidate_eval = read(args.candidate_evaluation_root / f"{plan_id}.json")
        if base_eval.get("status") != "IMPORTED" or candidate_eval.get("status") != "IMPORTED":
            continue
        base = read(base_dir / "imported.json")
        base_doc = read(base_dir / "vector.json")
        candidate = read(args.candidate_imported_root / f"{plan_id}.json")
        candidate_doc = read(Path(".omo/evidence/apartment-scale-fix-20261003/candidate15") / f"{plan_id}.json")
        row = compare_case(base, candidate, base_doc, candidate_doc, base_eval, candidate_eval, key)
        row.update({"ordinal": item["ordinal"], "planId": plan_id, "name": item["name"]})
        rows.append(row)

    def count(path: tuple[str, ...], predicate) -> int:
        return sum(1 for row in rows if predicate(row, path))

    def at(row: dict[str, Any], path: tuple[str, ...]) -> Any:
        value: Any = row
        for part in path:
            value = value[part]
        return value

    wall_equal = sum(1 for row in rows if row["walls"]["normalizedSignatureEqual"])
    opening_equal = sum(1 for row in rows if row["openings"]["normalizedSignatureEqual"])
    opening_metadata_exact = sum(
        1
        for row in rows
        if not row["metadata"]["sourceOpeningIds"]["candidateMissingFromBaseline"]
        and not row["metadata"]["sourceOpeningIds"]["baselineMissingFromCandidate"]
    )
    source_room_metadata_exact = sum(
        1
        for row in rows
        if not row["metadata"]["sourceRoomIds"]["candidateMissingFromBaseline"]
        and not row["metadata"]["sourceRoomIds"]["baselineMissingFromCandidate"]
    )
    output = {
        "schemaVersion": "apartment-topology-normalized-comparison-v1",
        "runId": args.run_id,
        "resolvedModel": "gpt-5.6-luna",
        "reasoningEffort": "max",
        "scope": "common imported cases only; generated IDs ignored; geometry and metadata measured separately",
        "commonImportedCases": len(rows),
        "normalizedWallGeometry": {"equalCases": wall_equal, "denominator": len(rows), "allEqual": wall_equal == len(rows)},
        "normalizedOpeningGeometry": {"equalCases": opening_equal, "denominator": len(rows), "allEqual": opening_equal == len(rows)},
        "metadataPreservation": {
            "sourceOpeningIdExactCases": opening_metadata_exact,
            "sourceOpeningIdDenominator": len(rows),
            "sourceRoomIdExactCases": source_room_metadata_exact,
            "sourceRoomIdDenominator": len(rows),
            "definition": "set equality of sourceOpeningId/sourceRoomId metadata; empty sets are included",
        },
        "candidateFullSpaceIdStability": {
            "collisionCases": sum(1 for row in rows if row["spaces"]["candidateFullIdCollision"]),
            "detectedSpaces": sum(row["spaces"]["candidateDetected"] for row in rows),
            "uniqueFullIds": sum(row["spaces"]["candidateUniqueFullIds"] for row in rows),
        },
        "cases": rows,
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "commonImportedCases": len(rows),
        "wallEqual": f"{wall_equal}/{len(rows)}",
        "openingEqual": f"{opening_equal}/{len(rows)}",
        "openingMetadataExact": f"{opening_metadata_exact}/{len(rows)}",
        "sourceRoomMetadataExact": f"{source_room_metadata_exact}/{len(rows)}",
        "candidateFullIdCollisionCases": output["candidateFullSpaceIdStability"]["collisionCases"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
