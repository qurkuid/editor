#!/usr/bin/env python3
"""Check the frozen p07 source window o5 transform and host relationship."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from typing import Any


EPSILON_M = 1e-6
PLAN_ID = "3FO40C71IWG4"
SOURCE_ID = "o5"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def length(a: list[float], b: list[float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def projection(point: list[float], start: list[float], end: list[float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    ll = math.hypot(dx, dy)
    return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / ll


def close(a: float, b: float) -> bool:
    return abs(a - b) <= EPSILON_M


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--imported", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with args.raw.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    with args.imported.open(encoding="utf-8") as handle:
        imported = json.load(handle)

    raw_openings = [item for item in raw.get("openings", []) if item.get("id") == SOURCE_ID]
    imported_openings = [item for item in imported.get("openings", []) if item.get("metadata", {}).get("sourceOpeningId") == SOURCE_ID]
    raw_opening = raw_openings[0] if len(raw_openings) == 1 else None
    imported_opening = imported_openings[0] if len(imported_openings) == 1 else None
    host = None
    if imported_opening:
        host = next((wall for wall in imported.get("walls", []) if wall.get("id") == imported_opening.get("wallId")), None)

    checks: dict[str, bool] = {}
    details: dict[str, Any] = {
        "planId": PLAN_ID,
        "sourceOpeningId": SOURCE_ID,
        "raw": {"path": str(args.raw), "sha256": sha256_file(args.raw)},
        "imported": {"path": str(args.imported), "sha256": sha256_file(args.imported)},
    }
    checks["rawUniqueO5"] = raw_opening is not None
    checks["importedUniqueO5"] = imported_opening is not None
    if raw_opening is None or imported_opening is None or host is None:
        checks["hostExists"] = host is not None
        details["reason"] = "Required raw/imported o5 records or host wall missing."
        result = {"schemaVersion": "apartment-source-chain-o5-window-v1", "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "MISMATCH", "checks": checks, "details": details}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(1)

    raw_a, raw_b = raw_opening["a"], raw_opening["b"]
    raw_width_m = length(raw_a, raw_b) / 1000.0
    # The source o5 boundary is the vertical x=13078.2 chain. Its complete raw
    # host span is the min/max y extent of source wall endpoints on that line.
    raw_x = (raw_a[0] + raw_b[0]) / 2
    same_line_points: list[list[float]] = []
    for wall in raw.get("walls", []):
        for point in (wall.get("start"), wall.get("end")):
            if point is not None and abs(point[0] - raw_x) <= EPSILON_M:
                same_line_points.append(point)
    raw_host_start_point = max(same_line_points, key=lambda point: point[1])
    raw_host_end_point = min(same_line_points, key=lambda point: point[1])
    raw_host_length_m = length(raw_host_start_point, raw_host_end_point) / 1000.0
    raw_interval_m = sorted(
        [
            projection(raw_a, raw_host_start_point, raw_host_end_point) / 1000.0,
            projection(raw_b, raw_host_start_point, raw_host_end_point) / 1000.0,
        ]
    )

    imported_host_length_m = length(host["start"], host["end"])
    imported_width_m = float(imported_opening.get("width", 0))
    imported_position_m = imported_opening.get("position", [None])[0]
    imported_interval_m = sorted([imported_position_m - imported_width_m / 2, imported_position_m + imported_width_m / 2]) if imported_position_m is not None else None
    world_axis_interval_m = None
    if imported_interval_m is not None:
        dx = (host["end"][0] - host["start"][0]) / imported_host_length_m
        dy = (host["end"][1] - host["start"][1]) / imported_host_length_m
        world_axis_interval_m = [
            [host["start"][0] + dx * value, host["start"][1] + dy * value]
            for value in imported_interval_m
        ]

    details.update(
        {
            "rawOpening": {"type": raw_opening.get("type"), "aMm": raw_a, "bMm": raw_b, "widthM": raw_width_m, "wallThicknessMm": raw_opening.get("wallThickness")},
            "importedOpening": {"id": imported_opening.get("id"), "type": imported_opening.get("type"), "widthM": imported_width_m, "position": imported_opening.get("position"), "wallId": imported_opening.get("wallId"), "parentId": imported_opening.get("parentId"), "metadata": imported_opening.get("metadata")},
            "host": {"id": host.get("id"), "start": host.get("start"), "end": host.get("end"), "lengthM": imported_host_length_m, "children": host.get("children", [])},
            "rawHost": {"startMm": raw_host_start_point, "endMm": raw_host_end_point, "lengthM": raw_host_length_m},
            "rawTransformedWorldIntervalM": {"axisFromHostStart": raw_interval_m, "worldEndpoints": world_axis_interval_m},
            "importedWorldIntervalM": {"axisFromHostStart": imported_interval_m},
            "differencesM": {"width": imported_width_m - raw_width_m, "hostLength": imported_host_length_m - raw_host_length_m, "intervalStart": imported_interval_m[0] - raw_interval_m[0] if imported_interval_m else None, "intervalEnd": imported_interval_m[1] - raw_interval_m[1] if imported_interval_m else None},
        }
    )
    checks.update(
        {
            "rawTypeWindow": raw_opening.get("type") == "window",
            "importedTypeWindow": imported_opening.get("type") == "window" and imported_opening.get("openingKind") == "window",
            "rawWidth3_275M": close(raw_width_m, 3.275),
            "importedWidth3_275M": close(imported_width_m, 3.275),
            "sourceWidthMetadata3275Mm": abs(float(imported_opening.get("metadata", {}).get("sourceWidthMm", -1)) - 3275.0) <= 1e-3,
            "hostLengthMatchesRawTransform": close(imported_host_length_m, raw_host_length_m),
            "intervalMatchesRawTransform": imported_interval_m is not None and all(close(a, b) for a, b in zip(imported_interval_m, raw_interval_m)),
            "hostChildParentIntegrity": imported_opening.get("parentId") == host.get("id") and imported_opening.get("id") in host.get("children", []),
        }
    )
    result = {"schemaVersion": "apartment-source-chain-o5-window-v1", "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "PASS" if all(checks.values()) else "MISMATCH", "toleranceM": EPSILON_M, "checks": checks, "details": details}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "checks": checks, "rawIntervalM": raw_interval_m, "importedIntervalM": imported_interval_m, "differencesM": details["differencesM"]}, ensure_ascii=False))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
