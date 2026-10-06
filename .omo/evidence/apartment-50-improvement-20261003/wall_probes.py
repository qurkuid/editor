#!/usr/bin/env python3
"""Measure explicit visual wall probes against the frozen imported wall geometry.

These are source-review probes, not an automatic wall truth classifier. The
reported nearest distance and imported stroke tolerance let reviewers inspect
the exact evidence without turning a point probe into a global accuracy claim.
"""

from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "manifest.json").read_text())


def source_to_level(point: tuple[float, float], doc: dict, source_size: tuple[int, int]) -> tuple[float, float]:
    doc_w, doc_h = doc["imageSize"]
    source_w, source_h = source_size
    doc_x = point[0] * doc_w / source_w
    doc_y = point[1] * doc_h / source_h
    mm_per_px = float(doc["mmPerPx"])
    return ((doc_x - doc_w / 2) * mm_per_px / 1000, (doc_y - doc_h / 2) * mm_per_px / 1000)


def distance_to_segment(point: tuple[float, float], start: list[float], end: list[float]) -> float:
    px, py = point
    ax, ay = float(start[0]), float(start[1])
    bx, by = float(end[0]), float(end[1])
    dx, dy = bx - ax, by - ay
    denominator = dx * dx + dy * dy
    if denominator <= 1e-12:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denominator))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


probes = [
    {
        "ordinal": 3,
        "key": "p03_3FO3YJE3RM5X",
        "xy": [363, 140],
        "expected": "no-wall-peak",
        "sourceEvidence": "manual source review identified the top media-room window as a straight span; this point is inside the source gap rather than a wall peak",
    }
]

# Include the visual reviewer's structural probes as labeled measurements.
for review_name in ("visual-review-01-25.json", "visual-review-26-50.json"):
    review_path = ROOT / review_name
    if not review_path.exists():
        continue
    review = json.loads(review_path.read_text())
    for candidate in review.get("commonStructuralFixCandidates") or []:
        for probe in candidate.get("sourceProbes") or []:
            probes.append({
                "ordinal": int(probe["ordinal"]),
                "xy": probe["xy"],
                "expected": probe.get("expect"),
                "sourceEvidence": "visual-review structural probe; inspect label and overlay together",
                "candidate": candidate.get("candidate"),
            })

by_ordinal = {item["ordinal"]: item for item in manifest["plans"]}
results = []
for probe in probes:
    item = by_ordinal.get(probe["ordinal"])
    if not item:
        continue
    folder = ROOT / item["key"]
    doc = json.loads((folder / "vector.json").read_text())
    imported_path = folder / "imported.json"
    imported = json.loads(imported_path.read_text()) if imported_path.exists() else None
    source_w, source_h = item.get("sourceSize", [0, 0])
    # Actual source dimensions avoid trusting a reviewer's nominal size when
    # legacy renders were resized during collection.
    from PIL import Image

    with Image.open(folder / "source.jpg") as image:
        source_w, source_h = image.size
    entry = {**probe, "key": item["key"], "planId": item["planId"], "sourceImagePixels": [source_w, source_h]}
    if not imported or not doc.get("mmPerPx"):
        entry.update({"status": "not-imported", "nearestWallDistancePx": None, "withinImportedStroke": None})
        results.append(entry)
        continue
    level_point = source_to_level(tuple(probe["xy"]), doc, (source_w, source_h))
    candidates = []
    for wall in imported.get("walls", []):
        distance_m = distance_to_segment(level_point, wall["start"], wall["end"])
        distance_px = distance_m * 1000 * source_w / doc["imageSize"][0] / float(doc["mmPerPx"])
        thickness_px = float(wall.get("thickness", 0)) * 1000 * source_w / doc["imageSize"][0] / float(doc["mmPerPx"])
        candidates.append({"wallId": wall["id"], "distancePx": distance_px, "thicknessPx": thickness_px})
    candidates.sort(key=lambda row: row["distancePx"])
    nearest = candidates[0] if candidates else None
    tolerance = max(8.0, (nearest["thicknessPx"] / 2 if nearest else 0) + 8)
    entry.update({
        "status": "imported",
        "levelPointM": level_point,
        "nearestWall": nearest,
        "nearestWallDistancePx": nearest["distancePx"] if nearest else None,
        "strokeTolerancePx": tolerance,
        "withinImportedStroke": bool(nearest and nearest["distancePx"] <= tolerance),
        "falseWallCandidate": bool(probe.get("expected") == "no-wall-peak" and nearest and nearest["distancePx"] <= tolerance),
        "sourceTruthLabel": probe.get("expected"),
        "note": "withinImportedStroke is a geometry proximity measurement using max(8 px, half imported wall thickness + 8 px); it is not a visual segmentation score.",
    })
    results.append(entry)

out = {"total": len(results), "falseWallCandidateCount": sum(1 for row in results if row.get("falseWallCandidate")), "p03PeakProbe": next((row for row in results if row["ordinal"] == 3 and row.get("expected") == "no-wall-peak"), None), "probes": results}
(ROOT / "wall-probe-metrics.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"total": len(results), "p03PeakProbe": out["p03PeakProbe"]["nearestWallDistancePx"] if out["p03PeakProbe"] else None}))
