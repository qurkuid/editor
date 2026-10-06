#!/usr/bin/env python3
"""Evidence-only contained duplicate span audit for frozen Lane A imports.

This intentionally mirrors the small test helper used by the apartment importer.
It never imports product code and never writes outside the caller-selected evidence
directory.  The metric is about contained physical wall centerline spans; it is
not a polygon-intersection or raster shared-edge metric.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from typing import Any


EPSILON_M = 1e-6
PARALLEL_DOT_MIN = 0.99
P07_PLAN_ID = "3FO40C71IWG4"
P07_EXPECTED_COUNT = 3
P07_EXPECTED_LENGTH_M = 1.284401


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def segment_length(wall: dict[str, Any]) -> float:
    start = wall["start"]
    end = wall["end"]
    return math.hypot(end[0] - start[0], end[1] - start[1])


def direction(wall: dict[str, Any], length: float) -> tuple[float, float]:
    return (
        (wall["end"][0] - wall["start"][0]) / length,
        (wall["end"][1] - wall["start"][1]) / length,
    )


def endpoint_projection_and_distance(
    point: list[float], longer: dict[str, Any], longer_direction: tuple[float, float]
) -> tuple[float, float]:
    dx = point[0] - longer["start"][0]
    dy = point[1] - longer["start"][1]
    projection = dx * longer_direction[0] + dy * longer_direction[1]
    distance = abs(dx * longer_direction[1] - dy * longer_direction[0])
    return projection, distance


def contained_duplicate_spans(walls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return one match per shorter emitted wall, preserving the product helper.

    A shorter S is counted once when a longer L satisfies all of these conditions:
    both S endpoints project into L's closed interval (with 1e-6 m tolerance),
    both endpoints lie within L's construction half-thickness (with the same
    tolerance), and the centerlines are parallel enough for a duplicate-span
    interpretation (absolute direction dot product >= .99).  The latter is the
    guard that keeps ordinary L/T/X junctions out of this metric.
    """

    matches: list[dict[str, Any]] = []
    for short_index, shorter in enumerate(walls):
        short_length = segment_length(shorter)
        if short_length <= EPSILON_M:
            continue
        short_direction = direction(shorter, short_length)
        for long_index, longer in enumerate(walls):
            if short_index == long_index:
                continue
            long_length = segment_length(longer)
            if short_length > long_length + EPSILON_M or long_length <= EPSILON_M:
                continue
            long_direction = direction(longer, long_length)
            direction_dot = abs(
                short_direction[0] * long_direction[0]
                + short_direction[1] * long_direction[1]
            )
            if direction_dot < PARALLEL_DOT_MIN:
                continue
            endpoint_checks = [
                endpoint_projection_and_distance(point, longer, long_direction)
                for point in (shorter["start"], shorter["end"])
            ]
            half_thickness = (longer.get("thickness") or 0.1) / 2 + EPSILON_M
            if not all(
                -EPSILON_M <= projection <= long_length + EPSILON_M
                and distance <= half_thickness
                for projection, distance in endpoint_checks
            ):
                continue
            angle_deg = math.degrees(math.acos(min(1.0, max(-1.0, direction_dot))))
            matches.append(
                {
                    "shortIndex": short_index,
                    "longIndex": long_index,
                    "shortId": shorter.get("id"),
                    "longId": longer.get("id"),
                    "shortLengthM": short_length,
                    "longLengthM": long_length,
                    "shortThicknessM": shorter.get("thickness"),
                    "longThicknessM": longer.get("thickness"),
                    "directionDot": direction_dot,
                    "angleDeg": angle_deg,
                    "endpointChecks": [
                        {"projectionM": projection, "distanceM": distance}
                        for projection, distance in endpoint_checks
                    ],
                    "longIntervalM": [0.0, long_length],
                    "longHalfThicknessWithToleranceM": half_thickness,
                }
            )
            # The matching product helper counts each short wall once.
            break
    return matches


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def status_by_plan(evaluation_root: Path) -> dict[str, dict[str, Any]]:
    statuses: dict[str, dict[str, Any]] = {}
    for path in sorted(evaluation_root.glob("*.json")):
        document = load_json(path)
        statuses[path.stem] = {
            "path": str(path),
            "status": document.get("status"),
            "importerBuilt": document.get("importer", {}).get("built"),
            "sha256": sha256_file(path),
        }
    return statuses


def synthetic_negative_controls() -> dict[str, Any]:
    """Exercise the metric contract without product code or source fixtures."""

    def wall(identifier: str, start: list[float], end: list[float], thickness: float = 0.2) -> dict[str, Any]:
        return {"id": identifier, "start": start, "end": end, "thickness": thickness}

    cases = {
        "offsetParallel": [wall("a", [0, 0], [2, 0]), wall("b", [0, 0.3], [2, 0.3])],
        "merelyAdjacent": [wall("a", [0, 0], [1, 0]), wall("b", [1.25, 0], [2.25, 0])],
        "crossing": [wall("a", [0, 0], [2, 0]), wall("b", [1, -1], [1, 1], 0.1)],
        "Tjunction": [wall("a", [0, 0], [2, 0]), wall("b", [1, 0], [1, 0.5], 0.1)],
        "containedParallelPositive": [wall("long", [0, 0], [3, 0]), wall("short", [1, 0.05], [2, 0.05], 0.1)],
    }
    results: dict[str, Any] = {}
    for name, walls in cases.items():
        matches = contained_duplicate_spans(walls)
        expected_count = 1 if name == "containedParallelPositive" else 0
        results[name] = {
            "expectedPairCount": expected_count,
            "observedPairCount": len(matches),
            "observedContainedLengthM": sum(item["shortLengthM"] for item in matches),
            "passed": len(matches) == expected_count,
            "pairs": matches,
        }
    return results


def run(imported_root: Path, evaluation_root: Path, output: Path) -> dict[str, Any]:
    imported_paths = sorted(imported_root.glob("*.json"))
    status_map = status_by_plan(evaluation_root)
    per_plan: list[dict[str, Any]] = []
    for path in imported_paths:
        document = load_json(path)
        matches = contained_duplicate_spans(document.get("walls", []))
        plan_id = path.stem
        per_plan.append(
            {
                "planId": plan_id,
                "status": status_map.get(plan_id, {}).get("status", "IMPORTED_ROOT_ONLY"),
                "imported": True,
                "wallCount": len(document.get("walls", [])),
                "pairCount": len(matches),
                "containedLengthM": sum(item["shortLengthM"] for item in matches),
                "pairs": matches,
                "importedFile": {
                    "path": str(path),
                    "sha256": sha256_file(path),
                },
            }
        )

    imported_ids = {item["planId"] for item in per_plan}
    rejected = [
        {
            "planId": plan_id,
            "status": info.get("status"),
            "importerBuilt": info.get("importerBuilt"),
            "imported": False,
            "pairCount": None,
            "containedLengthM": None,
            "evaluationFile": {
                "path": info["path"],
                "sha256": info["sha256"],
            },
        }
        for plan_id, info in sorted(status_map.items())
        if plan_id not in imported_ids
    ]
    all_plans = per_plan + rejected
    p07 = next((item for item in per_plan if item["planId"] == P07_PLAN_ID), None)
    result = {
        "schemaVersion": "apartment-source-chain-contained-duplicate-span-v1",
        "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "scope": "Frozen Lane A imported physical wall geometry only; evidence preparation, no candidate execution.",
        "metric": {
            "name": "containedDuplicateSpan",
            "definition": {
                "shorterWall": "S is the shorter emitted physical wall; each short wall is counted at most once.",
                "projection": "Both S endpoints project inside L's closed longitudinal interval with tolerance 1e-6 m.",
                "centerlineDistance": "Both S endpoints are within L construction half-thickness + 1e-6 m.",
                "parallelGuard": "Absolute direction dot product >= 0.99, matching the existing helper and excluding ordinary L/T/X contacts.",
                "reportedLength": "S centerline length in metres; no generic polygon overlap or raster shared-edge area.",
            },
            "tolerances": {"endpointIntervalM": EPSILON_M, "centerlineDistanceM": EPSILON_M, "parallelDirectionDot": PARALLEL_DOT_MIN},
        },
        "inputs": {
            "importedRoot": str(imported_root),
            "evaluationRoot": str(evaluation_root),
            "importedFileCount": len(per_plan),
            "evaluationFileCount": len(status_map),
            "rejectedFileCount": len(rejected),
        },
        "summary": {
            "acceptedImportedCases": len(per_plan),
            "rejectedCases": len(rejected),
            "pairCount": sum(item["pairCount"] for item in per_plan),
            "containedLengthM": sum(item["containedLengthM"] for item in per_plan),
            "casesWithPairs": sum(1 for item in per_plan if item["pairCount"]),
            "other43": {
                "definition": "All imported cases except p07; counts are baseline observations, not post-fix acceptance claims.",
                "pairCount": sum(item["pairCount"] for item in per_plan if item["planId"] != P07_PLAN_ID),
                "containedLengthM": sum(item["containedLengthM"] for item in per_plan if item["planId"] != P07_PLAN_ID),
                "casesWithPairs": sum(1 for item in per_plan if item["planId"] != P07_PLAN_ID and item["pairCount"]),
            },
        },
        "p07Expectation": {
            "planId": P07_PLAN_ID,
            "expectedPairCount": P07_EXPECTED_COUNT,
            "expectedContainedLengthM": P07_EXPECTED_LENGTH_M,
            "observedPairCount": p07["pairCount"] if p07 else None,
            "observedContainedLengthM": p07["containedLengthM"] if p07 else None,
            "pairCountMatches": bool(p07 and p07["pairCount"] == P07_EXPECTED_COUNT),
            "lengthMatchesWithin1e6M": bool(p07 and abs(p07["containedLengthM"] - P07_EXPECTED_LENGTH_M) <= EPSILON_M),
            "status": "PASS" if p07 and p07["pairCount"] == P07_EXPECTED_COUNT and abs(p07["containedLengthM"] - P07_EXPECTED_LENGTH_M) <= EPSILON_M else "MISMATCH",
        },
        "perPlan": sorted(all_plans, key=lambda item: item["planId"]),
        "candidateExecution": {"allowed": False, "executed": False, "reason": "Lane B source freeze/candidate run is not approved in this preparation task."},
        "syntheticControls": synthetic_negative_controls(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--imported-root", type=Path, required=True)
    parser.add_argument("--evaluation-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.imported_root, args.evaluation_root, args.output)
    summary = result["summary"]
    p07 = result["p07Expectation"]
    print(
        json.dumps(
            {
                "accepted": summary["acceptedImportedCases"],
                "rejected": summary["rejectedCases"],
                "pairCount": summary["pairCount"],
                "containedLengthM": summary["containedLengthM"],
                "p07": p07,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
