#!/usr/bin/env python3
"""Compare a new topology import with the immutable V15-floor import.

This evidence-only comparator deliberately keeps three facts separate:

* physical wall/opening geometry is compared after mapping imported metres to
  the source-document pixel frame and ignoring generated node IDs;
* source-zone metadata is compared as its own exact signature; and
* ``frontSide``/``backSide`` are reported as derived wall classifications,
  without participating in the physical geometry signature.

The old V13 replay remains available through ``compare_topology_replay.py``.
This script is the direct V15 before/after path and never mutates either old
V15 directory or the new candidate outputs.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent


def read(path: Path) -> Any:
    return json.loads(path.read_text())


def number(value: Any) -> float:
    return float(value or 0)


def point_key(point: Any) -> tuple[float, float]:
    return (round(number(point[0]), 8), round(number(point[1]), 8))


def source_point(point: Any, doc: dict[str, Any]) -> tuple[float, float]:
    """Map an imported level-metre point back into source-document pixels."""

    image_size = doc.get("imageSize") or [0, 0]
    mm_per_px = doc.get("mmPerPx")
    if len(image_size) != 2 or not mm_per_px:
        return point_key(point)
    return (
        number(point[0]) * 1000.0 / number(mm_per_px) + number(image_size[0]) / 2.0,
        number(point[1]) * 1000.0 / number(mm_per_px) + number(image_size[1]) / 2.0,
    )


def physical_wall_key(wall: dict[str, Any], doc: dict[str, Any]) -> tuple[Any, ...]:
    """Return geometry only; generated IDs and front/back are intentionally omitted."""

    a = point_key(source_point(wall.get("start", [0, 0]), doc))
    b = point_key(source_point(wall.get("end", [0, 0]), doc))
    return (
        tuple(sorted((a, b))),
        round(number(wall.get("thickness")), 8),
        round(number(wall.get("height")), 8),
        wall.get("kind"),
    )


def derived_wall_classification(wall: dict[str, Any]) -> tuple[str, str]:
    """Read classification fields separately from physical geometry."""

    return (str(wall.get("frontSide", "unknown")), str(wall.get("backSide", "unknown")))


def opening_host_key(opening: dict[str, Any], walls: dict[str, dict[str, Any]], doc: dict[str, Any]) -> tuple[Any, ...] | None:
    host = walls.get(str(opening.get("wallId")))
    return physical_wall_key(host, doc) if host else None


def canonical_wall_position(wall: dict[str, Any], position: Any, doc: dict[str, Any]) -> float:
    start = point_key(source_point(wall.get("start", [0, 0]), doc))
    end = point_key(source_point(wall.get("end", [0, 0]), doc))
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    pos = number(position)
    return round(pos if start <= end else length - pos, 8)


def opening_key(opening: dict[str, Any], walls: dict[str, dict[str, Any]], doc: dict[str, Any]) -> tuple[Any, ...]:
    host = walls.get(str(opening.get("wallId")))
    host_key = opening_host_key(opening, walls, doc)
    position = (opening.get("position") or [0])[0]
    canonical_position = canonical_wall_position(host, position, doc) if host else round(number(position), 8)
    return (
        opening.get("type"),
        host_key,
        canonical_position,
        round(number(opening.get("width")), 8),
        round(number(opening.get("height")), 8),
        opening.get("openingKind"),
    )


def wall_physical_keys(scene: dict[str, Any], doc: dict[str, Any]) -> list[tuple[Any, ...]]:
    return sorted(physical_wall_key(wall, doc) for wall in scene.get("walls", []))


def wall_class_counts(scene: dict[str, Any]) -> dict[str, int]:
    counts = collections.Counter(derived_wall_classification(wall) for wall in scene.get("walls", []))
    return {f"{front}/{back}": count for (front, back), count in sorted(counts.items())}


def source_zone_metadata_signature(zone: dict[str, Any]) -> tuple[Any, ...] | None:
    metadata = zone.get("metadata") or {}
    source_room_id = metadata.get("sourceRoomId")
    if source_room_id is None:
        # buildVectorNodes may append generated detected-space zones. They are
        # derived topology output and must not count as source metadata loss.
        return None
    area = metadata.get("areaM2")
    return (
        source_room_id,
        metadata.get("source"),
        metadata.get("cls"),
        round(number(area), 8) if area is not None else None,
        zone.get("name"),
        zone.get("color"),
        metadata.get("documentId", zone.get("documentId")),
    )


def derived_zone_signature(zone: dict[str, Any]) -> tuple[Any, ...]:
    """Derived enclosure fields are reported separately from source metadata."""

    return (
        zone.get("spaceRole"),
        zone.get("enclosureStatus"),
        zone.get("autoFromWalls"),
    )


def zone_source_metadata(scene: dict[str, Any]) -> list[tuple[Any, ...]]:
    signatures = [
        signature
        for zone in scene.get("zones", [])
        if (signature := source_zone_metadata_signature(zone)) is not None
    ]
    return sorted(signatures, key=repr)


def zone_derived_signatures(scene: dict[str, Any]) -> list[tuple[Any, ...]]:
    signatures = [derived_zone_signature(zone) for zone in scene.get("zones", [])]
    return sorted(signatures, key=repr)


def source_id_counts(scene: dict[str, Any], collection: str, field: str) -> dict[str, int]:
    counts = collections.Counter()
    for item in scene.get(collection, []):
        value = (item.get("metadata") or {}).get(field)
        if value is not None:
            counts[str(value)] += 1
    return dict(sorted(counts.items()))


def compare_case(
    base: dict[str, Any],
    candidate: dict[str, Any],
    base_doc: dict[str, Any],
    candidate_doc: dict[str, Any],
    base_eval: dict[str, Any],
    candidate_eval: dict[str, Any],
    key: str,
) -> dict[str, Any]:
    base_walls = base.get("walls", [])
    candidate_walls = candidate.get("walls", [])
    base_wall_keys = wall_physical_keys(base, base_doc)
    candidate_wall_keys = wall_physical_keys(candidate, candidate_doc)
    base_wall_index = {str(wall.get("id")): wall for wall in base_walls if wall.get("id") is not None}
    candidate_wall_index = {str(wall.get("id")): wall for wall in candidate_walls if wall.get("id") is not None}
    base_openings = sorted(opening_key(opening, base_wall_index, base_doc) for opening in base.get("openings", []))
    candidate_openings = sorted(opening_key(opening, candidate_wall_index, candidate_doc) for opening in candidate.get("openings", []))
    base_zone_metadata = zone_source_metadata(base)
    candidate_zone_metadata = zone_source_metadata(candidate)
    base_zone_derived = zone_derived_signatures(base)
    candidate_zone_derived = zone_derived_signatures(candidate)
    base_source_rooms = source_id_counts(base, "zones", "sourceRoomId")
    candidate_source_rooms = source_id_counts(candidate, "zones", "sourceRoomId")
    base_source_openings = source_id_counts(base, "openings", "sourceOpeningId")
    candidate_source_openings = source_id_counts(candidate, "openings", "sourceOpeningId")
    candidate_spaces = candidate.get("spaces", [])
    candidate_space_ids = [str(space.get("id")) for space in candidate_spaces]
    candidate_unique_space_ids = len(set(candidate_space_ids))
    return {
        "key": key,
        "status": {"baselineV15": base_eval.get("status"), "candidate": candidate_eval.get("status")},
        "physicalGeometry": {
            "walls": {
                "baselineV15": len(base_walls),
                "candidate": len(candidate_walls),
                "normalizedSignatureEqual": base_wall_keys == candidate_wall_keys,
                "baselineSignatureCount": len(base_wall_keys),
                "candidateSignatureCount": len(candidate_wall_keys),
            },
            "openings": {
                "baselineV15": len(base.get("openings", [])),
                "candidate": len(candidate.get("openings", [])),
                "normalizedSignatureEqual": base_openings == candidate_openings,
                "baselineSignatureCount": len(base_openings),
                "candidateSignatureCount": len(candidate_openings),
            },
        },
        "wallDerivedClassifications": {
            "baselineV15": wall_class_counts(base),
            "candidate": wall_class_counts(candidate),
            "exactDistribution": wall_class_counts(base) == wall_class_counts(candidate),
            "definition": "frontSide/backSide counts are reported separately and are excluded from physical geometry keys",
        },
        "sourceZoneMetadata": {
            "baselineV15": {
                "signatureCount": len(base_zone_metadata),
                "sourceRoomIdCounts": base_source_rooms,
                "signature": base_zone_metadata,
            },
            "candidate": {
                "signatureCount": len(candidate_zone_metadata),
                "sourceRoomIdCounts": candidate_source_rooms,
                "signature": candidate_zone_metadata,
            },
            "exactNormalizedSignature": base_zone_metadata == candidate_zone_metadata,
            "definition": "sourceRoomId-present zones only; source/class/areaM2/name/color/documentId multiplicity; generated detected-space zones and derived enclosure fields omitted",
        },
        "metadataPreservation": {
            "sourceRoomIdExact": base_source_rooms == candidate_source_rooms,
            "sourceOpeningIdExact": base_source_openings == candidate_source_openings,
            "baselineV15": {"sourceRoomIdCounts": base_source_rooms, "sourceOpeningIdCounts": base_source_openings},
            "candidate": {"sourceRoomIdCounts": candidate_source_rooms, "sourceOpeningIdCounts": candidate_source_openings},
            "definition": "exact sorted sourceRoomId/sourceOpeningId multiplicity; generated IDs and derived classifications omitted",
        },
        "zoneDerivedClassification": {
            "baselineV15": base_zone_derived,
            "candidate": candidate_zone_derived,
            "exactNormalizedSignature": base_zone_derived == candidate_zone_derived,
            "definition": "spaceRole/enclosureStatus/autoFromWalls are reported separately from source metadata and physical geometry",
        },
        "spaces": {
            "baselineV15Detected": len(base.get("spaces", [])),
            "candidateDetected": len(candidate_spaces),
            "candidateUniqueFullIds": candidate_unique_space_ids,
            "candidateFullIdCollision": candidate_unique_space_ids != len(candidate_space_ids),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-doc-root", type=Path, required=True)
    parser.add_argument("--baseline-imported-root", type=Path, required=True)
    parser.add_argument("--baseline-evaluation-root", type=Path, required=True)
    parser.add_argument("--candidate-doc-root", type=Path, required=True)
    parser.add_argument("--candidate-imported-root", type=Path, required=True)
    parser.add_argument("--candidate-evaluation-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = read(ROOT / "manifest.json")
    rows: list[dict[str, Any]] = []
    for item in manifest["plans"]:
        key, plan_id = item["key"], item["planId"]
        base_eval = read(args.baseline_evaluation_root / f"{plan_id}.json")
        candidate_eval = read(args.candidate_evaluation_root / f"{plan_id}.json")
        if base_eval.get("status") != "IMPORTED" or candidate_eval.get("status") != "IMPORTED":
            continue
        row = compare_case(
            read(args.baseline_imported_root / f"{plan_id}.json"),
            read(args.candidate_imported_root / f"{plan_id}.json"),
            read(args.baseline_doc_root / f"{plan_id}.json"),
            read(args.candidate_doc_root / f"{plan_id}.json"),
            base_eval,
            candidate_eval,
            key,
        )
        row.update({"ordinal": item["ordinal"], "planId": plan_id, "name": item["name"]})
        rows.append(row)

    wall_equal = sum(1 for row in rows if row["physicalGeometry"]["walls"]["normalizedSignatureEqual"])
    opening_equal = sum(1 for row in rows if row["physicalGeometry"]["openings"]["normalizedSignatureEqual"])
    zone_metadata_exact = sum(1 for row in rows if row["sourceZoneMetadata"]["exactNormalizedSignature"])
    zone_derived_exact = sum(1 for row in rows if row["zoneDerivedClassification"]["exactNormalizedSignature"])
    source_room_id_exact = sum(1 for row in rows if row["metadataPreservation"]["sourceRoomIdExact"])
    source_opening_id_exact = sum(1 for row in rows if row["metadataPreservation"]["sourceOpeningIdExact"])
    wall_class_exact = sum(1 for row in rows if row["wallDerivedClassifications"]["exactDistribution"])
    output = {
        "schemaVersion": "apartment-topology-normalized-v15-comparison-v1",
        "runId": args.run_id,
        "resolvedModel": "gpt-5.6-luna",
        "reasoningEffort": "max",
        "scope": "direct V15-floor before versus current candidate; common imported cases only; generated IDs ignored",
        "baseline": {
            "label": "v15-floor-before",
            "rawDocumentRoot": str(args.baseline_doc_root),
            "importedRoot": str(args.baseline_imported_root),
            "evaluationRoot": str(args.baseline_evaluation_root),
        },
        "candidate": {
            "label": args.run_id,
            "rawDocumentRoot": str(args.candidate_doc_root),
            "importedRoot": str(args.candidate_imported_root),
            "evaluationRoot": str(args.candidate_evaluation_root),
        },
        "commonImportedCases": len(rows),
        "physicalGeometry": {
            "normalizedWallGeometry": {"equalCases": wall_equal, "denominator": len(rows), "allEqual": wall_equal == len(rows)},
            "normalizedOpeningGeometry": {"equalCases": opening_equal, "denominator": len(rows), "allEqual": opening_equal == len(rows)},
            "definition": "source-document pixel endpoints plus thickness/height/kind; frontSide/backSide and generated IDs excluded",
        },
        "sourceZoneMetadata": {
            "exactNormalizedCases": zone_metadata_exact,
            "denominator": len(rows),
            "allExact": zone_metadata_exact == len(rows),
            "definition": "sourceRoomId-present zones only; source/class/areaM2/name/color/documentId multiplicity; generated detected-space zones and derived enclosure fields omitted",
        },
        "metadataPreservation": {
            "sourceRoomIdExactCases": source_room_id_exact,
            "sourceRoomIdDenominator": len(rows),
            "sourceOpeningIdExactCases": source_opening_id_exact,
            "sourceOpeningIdDenominator": len(rows),
            "definition": "exact sorted sourceRoomId/sourceOpeningId multiplicity; generated IDs and derived classifications omitted",
        },
        "zoneDerivedClassification": {
            "exactNormalizedCases": zone_derived_exact,
            "denominator": len(rows),
            "allExact": zone_derived_exact == len(rows),
            "definition": "spaceRole/enclosureStatus/autoFromWalls reported separately from source metadata and physical geometry",
        },
        "wallDerivedClassifications": {
            "exactDistributionCases": wall_class_exact,
            "denominator": len(rows),
            "allExact": wall_class_exact == len(rows),
            "definition": "frontSide/backSide distributions are a separate derived classification metric, not geometry equality",
        },
        "candidateFullSpaceIdStability": {
            "collisionCases": sum(1 for row in rows if row["spaces"]["candidateFullIdCollision"]),
            "detectedSpaces": sum(row["spaces"]["candidateDetected"] for row in rows),
            "uniqueFullIds": sum(row["spaces"]["candidateUniqueFullIds"] for row in rows),
        },
        "cases": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "commonImportedCases": len(rows),
                "normalizedWallGeometry": f"{wall_equal}/{len(rows)}",
                "normalizedOpeningGeometry": f"{opening_equal}/{len(rows)}",
                "sourceZoneMetadata": f"{zone_metadata_exact}/{len(rows)}",
                "sourceRoomId": f"{source_room_id_exact}/{len(rows)}",
                "sourceOpeningId": f"{source_opening_id_exact}/{len(rows)}",
                "zoneDerivedClassification": f"{zone_derived_exact}/{len(rows)}",
                "wallDerivedClassifications": f"{wall_class_exact}/{len(rows)}",
                "candidateFullIdCollisionCases": output["candidateFullSpaceIdStability"]["collisionCases"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
