#!/usr/bin/env python3
"""Render paired source/baseline/candidate overlays and measure floor probes.

The baseline scene files are read from their frozen case directories.  All
rendered outputs are written to versioned ``baseline-final-*``,
``candidate-*``, and ``paired-*`` directories, so rerunning this harness does
not rewrite the frozen baseline importer/evaluation artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[4]
EVIDENCE_ROOT = Path(__file__).resolve().parents[1]
ROOT = EVIDENCE_ROOT / "replay"


def read(path: Path):
    return json.loads(path.read_text())


def source_to_actual(point: list[float], source_size: list[int], actual_size: tuple[int, int]) -> tuple[float, float]:
    return (float(point[0]) * actual_size[0] / float(source_size[0]), float(point[1]) * actual_size[1] / float(source_size[1]))


def level_mapper(doc: dict, actual_size: tuple[int, int]):
    doc_w, doc_h = doc["imageSize"]
    width, height = actual_size
    mm = float(doc["mmPerPx"])

    def to_px(point: list[float] | tuple[float, float]) -> tuple[int, int]:
        # buildVectorNodes uses toLevel([x,y])=[(x-cx)/1000,(y-cy)/1000].
        x_m, y_m = float(point[0]), float(point[1])
        doc_x = x_m * 1000.0 / mm + doc_w / 2.0
        doc_y = doc_h / 2.0 + y_m * 1000.0 / mm
        return (int(round(doc_x * width / doc_w)), int(round(doc_y * height / doc_h)))

    return to_px


def source_px_to_level(point: tuple[float, float], doc: dict, actual_size: tuple[int, int]) -> tuple[float, float]:
    width, height = actual_size
    doc_w, doc_h = doc["imageSize"]
    source_x = float(point[0]) * doc_w / width
    source_y = float(point[1]) * doc_h / height
    mm = float(doc["mmPerPx"])
    return ((source_x - doc_w / 2.0) * mm / 1000.0, (source_y - doc_h / 2.0) * mm / 1000.0)


def point_in_polygon(point: tuple[float, float], polygon: list[list[float]]) -> bool:
    inside = False
    x, y = point
    for index, current in enumerate(polygon):
        previous = polygon[index - 1]
        x1, y1 = float(previous[0]), float(previous[1])
        x2, y2 = float(current[0]), float(current[1])
        if (y1 > y) != (y2 > y):
            crossing = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
            if x < crossing:
                inside = not inside
    return inside


def polygon_area(polygon: list[list[float]]) -> float:
    return abs(sum(float(polygon[i][0]) * float(polygon[(i + 1) % len(polygon)][1]) - float(polygon[(i + 1) % len(polygon)][0]) * float(polygon[i][1]) for i in range(len(polygon))) / 2.0)


def orientation(a, b, c) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a, b, p, eps=1e-9) -> bool:
    return min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps


def segments_intersect(a, b, c, d, eps=1e-9) -> bool:
    o1, o2, o3, o4 = orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)
    if ((o1 > eps and o2 < -eps) or (o1 < -eps and o2 > eps)) and ((o3 > eps and o4 < -eps) or (o3 < -eps and o4 > eps)):
        return True
    return (abs(o1) <= eps and on_segment(a, b, c)) or (abs(o2) <= eps and on_segment(a, b, d)) or (abs(o3) <= eps and on_segment(c, d, a)) or (abs(o4) <= eps and on_segment(c, d, b))


def self_intersection_count(polygon: list[list[float]]) -> int:
    points = [(float(p[0]), float(p[1])) for p in polygon]
    n = len(points)
    count = 0
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        for j in range(i + 1, n):
            # Adjacent edges meet at their shared endpoint by construction.
            if j in (i, (i + 1) % n) or i == (j + 1) % n:
                continue
            c, d = points[j], points[(j + 1) % n]
            if segments_intersect(a, b, c, d):
                count += 1
    return count


def marker(image: np.ndarray, xy: tuple[float, float], color: tuple[int, int, int], label: str):
    point = (int(round(xy[0])), int(round(xy[1])))
    cv2.circle(image, point, 8, color, -1, cv2.LINE_AA)
    cv2.circle(image, point, 10, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(image, label, (point[0] + 11, point[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 2, cv2.LINE_AA)


def label(image: np.ndarray, text: str):
    cv2.rectangle(image, (0, 0), (min(image.shape[1] - 1, 620), 25), (28, 28, 28), -1)
    cv2.putText(image, text.encode("ascii", "replace").decode("ascii"), (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)


def wall_point_distance(point, a, b) -> float:
    ax, ay, bx, by = float(a[0]), float(a[1]), float(b[0]), float(b[1])
    dx, dy = bx - ax, by - ay
    if dx * dx + dy * dy <= 1e-12:
        return math.hypot(point[0] - ax, point[1] - ay)
    t = max(0.0, min(1.0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy))


def floor_metrics(
    doc: dict,
    imported: dict | None,
    probes: dict,
    ordinal: int,
    actual_size: tuple[int, int],
    surface_source: str = "planned",
) -> tuple[dict, np.ndarray]:
    width, height = actual_size
    blank = np.zeros((height, width), dtype=np.uint8)
    result: dict = {
        "status": "IMPORTED" if imported else "IMPORT_REJECTED",
        "roomInteriorSeeds": {"total": 0, "insideSlab": 0, "outsideSlab": 0, "caseWeightedHit": None},
        "outsideFloorProbes": {"total": 0, "correctlyOutside": 0, "falseFloorPositive": 0},
        "surfaceSource": surface_source,
        "slabPolygons": 0,
        "selfIntersectionPolygons": 0,
        "selfIntersectionCount": 0,
        "overlapPairs": 0,
        "overlapPixels": 0,
        "overlapAreaM2": 0.0,
        "unionAreaM2": 0.0,
        "polygons": [],
        "roomSeedResults": [],
        "outsideProbeResults": [],
        "rejectedCaseExcludedFromProbeDenominators": not bool(imported),
    }
    if not imported or not doc.get("mmPerPx"):
        return result, blank
    to_px = level_mapper(doc, actual_size)
    if surface_source == "persisted":
        slab_nodes = imported.get("slabs") or []
    else:
        slab_nodes = (imported.get("slabPlan") or {}).get("create", [])
    polygons = [node.get("polygon") for node in slab_nodes if len(node.get("polygon") or []) >= 3]
    result["slabPolygons"] = len(polygons)
    scale_x_mm = float(doc["mmPerPx"]) * float(doc["imageSize"][0]) / width
    scale_y_mm = float(doc["mmPerPx"]) * float(doc["imageSize"][1]) / height
    pixel_area_m2 = scale_x_mm * scale_y_mm / 1_000_000.0
    masks: list[np.ndarray] = []
    floor_preview = np.zeros((height, width, 3), dtype=np.uint8)
    for index, polygon in enumerate(polygons):
        image_polygon = np.array([to_px(point) for point in polygon], dtype=np.int32)
        mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(mask, [image_polygon], 255)
        masks.append(mask)
        fill = (74, 138, 214) if surface_source == "persisted" else (148, 148, 148)
        edge = (70, 235, 255) if surface_source == "persisted" else (255, 220, 0)
        cv2.fillPoly(floor_preview, [image_polygon], fill)
        cv2.polylines(floor_preview, [image_polygon], True, edge, 2, cv2.LINE_AA)
        intersections = self_intersection_count(polygon)
        result["polygons"].append({"index": index, "points": polygon, "areaM2": polygon_area(polygon), "selfIntersectionCount": intersections, "imagePixels": int(cv2.countNonZero(mask))})
        if intersections:
            result["selfIntersectionPolygons"] += 1
            result["selfIntersectionCount"] += intersections
    if masks:
        union = np.zeros((height, width), dtype=np.uint8)
        for mask in masks:
            union = cv2.bitwise_or(union, mask)
        result["unionAreaM2"] = cv2.countNonZero(union) * pixel_area_m2
    for i in range(len(masks)):
        for j in range(i + 1, len(masks)):
            overlap = cv2.bitwise_and(masks[i], masks[j])
            pixels = cv2.countNonZero(overlap)
            if pixels:
                result["overlapPairs"] += 1
                result["overlapPixels"] += int(pixels)
                result["overlapAreaM2"] += pixels * pixel_area_m2

    case_room = [probe for probe in probes["roomSeeds"] if int(probe["ordinal"]) == ordinal]
    for index, probe in enumerate(case_room, 1):
        source_xy = source_to_actual(probe["xy"], probe.get("sourceSize") or [width, height], actual_size)
        level_point = source_px_to_level(source_xy, doc, actual_size)
        inside = any(point_in_polygon(level_point, polygon) for polygon in polygons)
        result["roomInteriorSeeds"]["total"] += 1
        result["roomInteriorSeeds"]["insideSlab" if inside else "outsideSlab"] += 1
        result["roomSeedResults"].append({"id": probe["id"], "xy": [source_xy[0], source_xy[1]], "expected": probe.get("expected"), "insideSlab": inside, "source": probe.get("source")})
        marker(floor_preview, source_xy, (40, 210, 40) if inside else (40, 40, 240), f"r{index}")
    total_room = result["roomInteriorSeeds"]["total"]
    result["roomInteriorSeeds"]["caseWeightedHit"] = (result["roomInteriorSeeds"]["insideSlab"] / total_room) if total_room else None

    case_outside = [probe for probe in probes["outsideFloorProbes"] if int(probe["ordinal"]) == ordinal]
    for index, probe in enumerate(case_outside, 1):
        source_xy = source_to_actual(probe["xy"], probe.get("sourceSize") or [width, height], actual_size)
        level_point = source_px_to_level(source_xy, doc, actual_size)
        inside = any(point_in_polygon(level_point, polygon) for polygon in polygons)
        result["outsideFloorProbes"]["total"] += 1
        result["outsideFloorProbes"]["falseFloorPositive" if inside else "correctlyOutside"] += 1
        result["outsideProbeResults"].append({"id": probe["id"], "xy": [source_xy[0], source_xy[1]], "expected": probe.get("expected"), "insideSlab": inside, "source": probe.get("source"), "detail": probe.get("detail")})
        marker(floor_preview, source_xy, (40, 40, 240) if inside else (0, 210, 220), f"o{index}")
    return result, floor_preview


def render_wall(doc: dict, imported: dict | None, source: np.ndarray, probes: dict, ordinal: int, model_label: str) -> tuple[np.ndarray, dict]:
    height, width = source.shape[:2]
    image = source.copy()
    evidence: dict = {"model": model_label, "p03": None, "p12": None}
    if imported and doc.get("mmPerPx"):
        to_px = level_mapper(doc, (width, height))
        for wall in imported.get("walls", []):
            a, b = to_px(wall["start"]), to_px(wall["end"])
            cv2.line(image, a, b, (0, 55, 235), 3, cv2.LINE_AA)
        for opening in imported.get("openings", []):
            wall = next((candidate for candidate in imported.get("walls", []) if candidate.get("id") == opening.get("wallId")), None)
            if not wall:
                continue
            start, end = np.array(wall["start"], dtype=float), np.array(wall["end"], dtype=float)
            direction = end - start
            wall_length = float(np.linalg.norm(direction))
            if wall_length <= 1e-9:
                continue
            direction /= wall_length
            center = start + direction * float((opening.get("position") or [0])[0])
            half = direction * float(opening.get("width", 0)) / 2.0
            cv2.line(image, to_px(center - half), to_px(center + half), (225, 0, 225), 4, cv2.LINE_AA)

        def wall_nearest(source_point: list[float]):
            point = (float(source_point[0]), float(source_point[1]))
            candidates = []
            for wall in imported.get("walls", []):
                candidates.append((wall_point_distance(point, to_px(wall["start"]), to_px(wall["end"])), wall.get("id"), to_px(wall["start"]), to_px(wall["end"])))
            return min(candidates, key=lambda item: item[0]) if candidates else None

        immutable = next((x for x in probes.get("immutableSourceEvidence", []) if x.get("ordinal") == ordinal), None)
        if ordinal == 3 and immutable:
            forbidden = immutable["forbiddenPeak"]
            nearest = wall_nearest(forbidden)
            floor_point = source_px_to_level(source_to_actual(forbidden, immutable["sourceSize"], (width, height)), doc, (width, height))
            slab_nodes = (imported.get("slabPlan") or {}).get("create", [])
            floor_hits = sum(1 for slab in slab_nodes if point_in_polygon(floor_point, slab.get("polygon") or []))
            evidence["p03"] = {
                "sourceFlatTop": immutable["sourceFlatTop"],
                "forbiddenPeak": forbidden,
                "nearestWallDistancePx": nearest[0] if nearest else None,
                "nearestWallId": nearest[1] if nearest else None,
                "exactPointGatePx": 2.0,
                "nearestWithinExactPointGate": bool(nearest and nearest[0] <= 2.0),
                "forbiddenPointInsideSlabCount": floor_hits,
                "note": "Exact source point/straight-span evidence; the old broad stroke-width tolerance is not used as a pass gate.",
            }
            marker(image, source_to_actual(forbidden, immutable["sourceSize"], (width, height)), (0, 0, 255), "p03")
            flat_a = source_to_actual(immutable["sourceFlatTop"][0], immutable["sourceSize"], (width, height))
            flat_b = source_to_actual(immutable["sourceFlatTop"][1], immutable["sourceSize"], (width, height))
            cv2.line(image, (int(round(flat_a[0])), int(round(flat_a[1]))), (int(round(flat_b[0])), int(round(flat_b[1]))), (0, 220, 255), 2, cv2.LINE_AA)
        if ordinal == 12:
            for probe in probes.get("outsideFloorProbes", []):
                if int(probe["ordinal"]) == 12:
                    marker(image, source_to_actual(probe["xy"], probe.get("sourceSize") or [width, height], (width, height)), (0, 210, 220), "p12")
    label(image, f"{ordinal:02d} {model_label} | red imported walls | cyan source probes")
    return image, evidence


def resize_panel(image: np.ndarray, width: int = 360) -> np.ndarray:
    scale = width / image.shape[1]
    return cv2.resize(image, (width, max(1, int(round(image.shape[0] * scale)))), interpolation=cv2.INTER_AREA)


def contact_sheet(paths: list[Path], output: Path, columns: int = 5, tile_width: int = 480, labels: list[str] | None = None):
    tiles = []
    for index, path in enumerate(paths):
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            continue
        image = resize_panel(image, tile_width)
        text = (labels[index] if labels and index < len(labels) else path.stem)[:72]
        tiles.append((image, text))
    rows = math.ceil(len(tiles) / columns)
    label_height = 26
    row_heights = [
        label_height + max((tiles[index][0].shape[0] for index in range(row * columns, min((row + 1) * columns, len(tiles)))), default=1)
        for row in range(rows)
    ]
    sheet = np.full((sum(row_heights), columns * tile_width, 3), (24, 16, 16), dtype=np.uint8)
    y_offset = 0
    for row, row_height in enumerate(row_heights):
        for column in range(columns):
            index = row * columns + column
            if index >= len(tiles):
                continue
            image, text = tiles[index]
            cv2.putText(sheet, text, (column * tile_width + 8, y_offset + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
            y = y_offset + label_height
            sheet[y : y + image.shape[0], column * tile_width : column * tile_width + image.shape[1]] = image
        y_offset += row_height
    output.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output), sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])


parser = argparse.ArgumentParser()
parser.add_argument("--candidate-label", default="candidate")
parser.add_argument("--manifest", type=Path, default=ROOT / "replay-manifest.json")
parser.add_argument("--probes", type=Path, default=None)
parser.add_argument("--source-root", type=Path, default=Path(".omo/evidence/apartment-topology-refinement-20261003"))
parser.add_argument("--annotation-freeze", type=Path, default=EVIDENCE_ROOT / "annotation-image-freeze.json")
parser.add_argument("--candidate-dir", type=Path, default=Path("../apartment-scale-fix-20261003/candidate"))
parser.add_argument("--run-id", required=True)
parser.add_argument("--baseline-doc-root", type=Path, default=None)
parser.add_argument("--baseline-imported-root", type=Path, default=None)
parser.add_argument("--baseline-evaluation-root", type=Path, default=None)
parser.add_argument("--candidate-evaluation-root", type=Path, default=ROOT / "candidate-evaluation")
parser.add_argument("--candidate-imported-root", type=Path, default=ROOT / "candidate-imported")
parser.add_argument("--baseline-label", default="before-current-0b926")
parser.add_argument("--baseline-output", type=Path, default=None)
parser.add_argument("--candidate-output", type=Path, default=None)
parser.add_argument("--paired-output", type=Path, default=None)
parser.add_argument("--baseline-metrics", type=Path, default=None)
parser.add_argument("--candidate-metrics", type=Path, default=None)
parser.add_argument("--paired-metrics", type=Path, default=None)
args = parser.parse_args()

for path_name in (
    "manifest",
    "probes",
    "source_root",
    "annotation_freeze",
    "candidate_dir",
    "baseline_doc_root",
    "baseline_imported_root",
    "baseline_evaluation_root",
    "candidate_evaluation_root",
    "candidate_imported_root",
    "baseline_output",
    "candidate_output",
    "paired_output",
    "baseline_metrics",
    "candidate_metrics",
    "paired_metrics",
):
    path_value = getattr(args, path_name)
    if path_value is not None:
        setattr(args, path_name, path_value.resolve())

if args.probes is None:
    args.probes = EVIDENCE_ROOT.parent / "apartment-50-improvement-20261003" / "source-probes.json"
args.probes = args.probes.resolve()
replay_manifest = read(args.manifest)
plan_manifest_path = REPO_ROOT / replay_manifest["baseline"]["planManifest"]["path"]
manifest = read(plan_manifest_path)
probes = read(args.probes)
probe_hash = hashlib.sha256(args.probes.read_bytes()).hexdigest()
if not args.baseline_doc_root or not args.baseline_imported_root or not args.baseline_evaluation_root:
    raise SystemExit("explicit before doc/imported/evaluation roots are required; old defaults are forbidden")
if not args.candidate_dir or not args.candidate_imported_root or not args.candidate_evaluation_root:
    raise SystemExit("explicit candidate doc/imported/evaluation roots are required")
if not args.annotation_freeze.is_file():
    raise SystemExit(f"missing annotation image freeze: {args.annotation_freeze}")
annotation_freeze = read(args.annotation_freeze)
for frozen in annotation_freeze.get("files", []):
    frozen_path = Path(frozen["path"])
    if not frozen_path.is_absolute():
        frozen_path = EVIDENCE_ROOT.parents[2] / frozen_path
    if frozen_path.name == "source.jpg" and (not frozen_path.is_file() or hashlib.sha256(frozen_path.read_bytes()).hexdigest() != frozen["sha256"]):
        raise SystemExit(f"frozen source image changed or missing: {frozen_path}")
baseline_out = args.baseline_output or (ROOT / "baseline-final-v13")
candidate_out = args.candidate_output or (ROOT / f"candidate-{args.run_id}")
paired_out = args.paired_output or (ROOT / f"paired-{args.run_id}")
baseline_metrics_path = args.baseline_metrics or (ROOT / ("baseline-final-v13-metrics.json" if baseline_out.name == "baseline-final-v13" else f"{baseline_out.name}-metrics.json"))
candidate_metrics_path = args.candidate_metrics or (ROOT / f"candidate-{args.run_id}-metrics.json")
paired_metrics_path = args.paired_metrics or (ROOT / f"paired-{args.run_id}-metrics.json")
for output_path in (baseline_out, candidate_out, paired_out, baseline_metrics_path, candidate_metrics_path, paired_metrics_path):
    output_path = output_path.resolve()
    if output_path != ROOT.resolve() and ROOT.resolve() not in output_path.parents:
        raise SystemExit(f"render output must stay under new replay root: {output_path}")
for path in (baseline_out, candidate_out, paired_out):
    path.mkdir(parents=True, exist_ok=True)

baseline_model_name = args.baseline_label
candidate_model_name = f"candidate-{args.candidate_label}"
model_case_metrics: dict[str, list[dict]] = {baseline_model_name: [], candidate_model_name: []}
pair_paths: list[Path] = []
for item in manifest["plans"]:
    key, ordinal, plan_id = item["key"], int(item["ordinal"]), item["planId"]
    source_path = args.source_root / key / "source.jpg"
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if source is None:
        raise RuntimeError(f"cannot read {source_path}")
    height, width = source.shape[:2]
    baseline_doc_path = (args.baseline_doc_root / f"{plan_id}.json") if args.baseline_doc_root else (ROOT / key / "vector.json")
    baseline_eval_path = (args.baseline_evaluation_root / f"{plan_id}.json") if args.baseline_evaluation_root else (ROOT / key / "evaluation.json")
    baseline_imported_path = (args.baseline_imported_root / f"{plan_id}.json") if args.baseline_imported_root else (ROOT / key / "imported.json")
    baseline_doc = read(baseline_doc_path)
    baseline_eval = read(baseline_eval_path)
    baseline_imported = read(baseline_imported_path) if baseline_imported_path.exists() else None
    candidate_doc_path = args.candidate_dir / f"{plan_id}.json"
    candidate_doc = read(candidate_doc_path)
    candidate_eval = read(args.candidate_evaluation_root / f"{plan_id}.json")
    candidate_imported_path = args.candidate_imported_root / f"{plan_id}.json"
    candidate_imported = read(candidate_imported_path) if candidate_imported_path.exists() else None

    model_panels: dict[str, dict] = {}
    for model_name, doc, imported, evaluation, output_root in (
        (baseline_model_name, baseline_doc, baseline_imported, baseline_eval, baseline_out),
        (candidate_model_name, candidate_doc, candidate_imported, candidate_eval, candidate_out),
    ):
        model_dir = output_root / key
        model_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, model_dir / "source.jpg")
        if imported and doc.get("mmPerPx"):
            floor, floor_image = floor_metrics(doc, imported, probes, ordinal, (width, height), "planned")
            persisted_floor, persisted_floor_image = floor_metrics(doc, imported, probes, ordinal, (width, height), "persisted")
        else:
            floor, floor_image = floor_metrics(doc, None, probes, ordinal, (width, height), "planned")
            persisted_floor, persisted_floor_image = floor_metrics(doc, None, probes, ordinal, (width, height), "persisted")
        floor["persisted"] = persisted_floor
        wall_image, wall_evidence = render_wall(doc, imported, source, probes, ordinal, model_name)
        if floor_image.ndim == 2:
            floor_image = cv2.cvtColor(floor_image, cv2.COLOR_GRAY2BGR)
        if persisted_floor_image.ndim == 2:
            persisted_floor_image = cv2.cvtColor(persisted_floor_image, cv2.COLOR_GRAY2BGR)
        floor_overlay = cv2.addWeighted(source, 0.66, floor_image, 0.34, 0)
        persisted_overlay = cv2.addWeighted(source, 0.66, persisted_floor_image, 0.34, 0)
        label(floor_overlay, f"{ordinal:02d} {model_name} | gray planned slabPlan.create | probes")
        label(persisted_overlay, f"{ordinal:02d} {model_name} | blue persisted imported slabs | probes")
        wall_path = model_dir / "wall-overlay.jpg"
        floor_path = model_dir / "wall-floor-overlay.jpg"
        persisted_floor_path = model_dir / "stored-floor-overlay.jpg"
        cv2.imwrite(str(wall_path), wall_image, [cv2.IMWRITE_JPEG_QUALITY, 94])
        cv2.imwrite(str(floor_path), floor_overlay, [cv2.IMWRITE_JPEG_QUALITY, 94])
        cv2.imwrite(str(persisted_floor_path), persisted_overlay, [cv2.IMWRITE_JPEG_QUALITY, 94])
        model_metrics = {
            "ordinal": ordinal,
            "key": key,
            "planId": plan_id,
            "name": item["name"],
            "model": model_name,
            "status": evaluation.get("status"),
            "docVersion": doc.get("docVersion"),
            "vectorizerMetrics": doc.get("metrics"),
            "importedCounts": {
                "walls": len((imported or {}).get("walls", [])),
                "openings": len((imported or {}).get("openings", [])),
                "zones": len((imported or {}).get("zones", [])),
                "detectedSpaces": len((imported or {}).get("spaces", [])),
                "slabs": len((imported or {}).get("slabs", [])),
                "ceilings": len((imported or {}).get("ceilings", [])),
            },
            "boundary": (evaluation.get("importer") or {}).get("boundary"),
            "planners": (evaluation.get("importer") or {}).get("planners"),
            "floor": floor,
            "wallEvidence": wall_evidence,
            "persistedSurfaces": (evaluation.get("importer") or {}).get("persistedSurfaces"),
            "files": {"source": str((model_dir / "source.jpg").relative_to(ROOT)), "wallOverlay": str(wall_path.relative_to(ROOT)), "wallFloorOverlay": str(floor_path.relative_to(ROOT)), "storedFloorOverlay": str(persisted_floor_path.relative_to(ROOT))},
        }
        (model_dir / "metrics.json").write_text(json.dumps(model_metrics, ensure_ascii=False, indent=2) + "\n")
        model_panels[model_name] = {"wall": wall_image, "floor": floor_overlay, "persisted": persisted_overlay, "metrics": model_metrics}
        model_case_metrics[model_name].append(model_metrics)

    pair_dir = paired_out / key
    pair_dir.mkdir(parents=True, exist_ok=True)
    source_panel = source.copy()
    label(source_panel, f"{ordinal:02d} source JPG")
    panels = [source_panel, model_panels[baseline_model_name]["wall"], model_panels[candidate_model_name]["wall"], model_panels[baseline_model_name]["floor"], model_panels[candidate_model_name]["floor"], model_panels[baseline_model_name]["persisted"], model_panels[candidate_model_name]["persisted"]]
    panels = [resize_panel(panel, 360) for panel in panels]
    panel_height = max(panel.shape[0] for panel in panels)
    panels = [cv2.copyMakeBorder(panel, 0, panel_height - panel.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(24, 16, 16)) for panel in panels]
    paired = np.concatenate(panels, axis=1)
    paired_path = pair_dir / "paired.jpg"
    cv2.imwrite(str(paired_path), paired, [cv2.IMWRITE_JPEG_QUALITY, 91])
    shutil.copyfile(source_path, pair_dir / "source.jpg")
    for source_file, target_name in ((baseline_out / key / "wall-overlay.jpg", "baseline-wall-overlay.jpg"), (baseline_out / key / "wall-floor-overlay.jpg", "baseline-wall-floor-overlay.jpg"), (candidate_out / key / "wall-overlay.jpg", "candidate-wall-overlay.jpg"), (candidate_out / key / "wall-floor-overlay.jpg", "candidate-wall-floor-overlay.jpg"), (baseline_out / key / "stored-floor-overlay.jpg", "baseline-stored-floor-overlay.jpg"), (candidate_out / key / "stored-floor-overlay.jpg", "candidate-stored-floor-overlay.jpg")):
        shutil.copyfile(source_file, pair_dir / target_name)
    pair_paths.append(paired_path)

for model_name, rows in model_case_metrics.items():
    imported = [row for row in rows if row["status"] == "IMPORTED"]
    rejected = [row for row in rows if row["status"] != "IMPORTED"]
    room_total = sum(row["floor"]["roomInteriorSeeds"]["total"] for row in imported)
    room_inside = sum(row["floor"]["roomInteriorSeeds"]["insideSlab"] for row in imported)
    outside_total = sum(row["floor"]["outsideFloorProbes"]["total"] for row in imported)
    outside_false = sum(row["floor"]["outsideFloorProbes"]["falseFloorPositive"] for row in imported)
    cases_with_room = [row for row in imported if row["floor"]["roomInteriorSeeds"]["total"]]
    case_room_rates = [row["floor"]["roomInteriorSeeds"]["insideSlab"] / row["floor"]["roomInteriorSeeds"]["total"] for row in cases_with_room]
    outside_cases = [row for row in imported if row["floor"]["outsideFloorProbes"]["total"]]
    case_outside_rates = [row["floor"]["outsideFloorProbes"]["falseFloorPositive"] / row["floor"]["outsideFloorProbes"]["total"] for row in outside_cases]
    summary = {
        "model": model_name,
        "totalPlans": len(rows),
        "importedCases": len(imported),
        "rejectedCases": len(rejected),
        "rejectedPlanIds": [row["planId"] for row in rejected],
        "roomSeeds": {
            "probeWeighted": {"inside": room_inside, "total": room_total, "hitRate": room_inside / room_total if room_total else None},
            "caseWeighted": {"meanCaseHitRate": sum(case_room_rates) / len(case_room_rates) if case_room_rates else None, "denominator": len(case_room_rates)},
            "reviewerAnnotationRevision": "current review JSON room probes (228 first-half + 150 second-half = 378); frozen prior floor-metrics.json was 354",
        },
        "outsideFloorProbes": {
            "probeWeighted": {"falsePositive": outside_false, "total": outside_total, "falsePositiveRate": outside_false / outside_total if outside_total else None},
            "caseWeighted": {"meanCaseFalsePositiveRate": sum(case_outside_rates) / len(case_outside_rates) if case_outside_rates else None, "denominator": len(case_outside_rates)},
            "rejectedCasesExcluded": len(rejected),
            "note": "Only six explicit source-supported outside probes are scored; this is not a universal outside-floor recall claim.",
        },
        "slabGeometry": {
            "selfIntersectionCases": sum(1 for row in imported if row["floor"]["selfIntersectionCount"]),
            "selfIntersectionPolygonCount": sum(row["floor"]["selfIntersectionPolygons"] for row in imported),
            "selfIntersectionCount": sum(row["floor"]["selfIntersectionCount"] for row in imported),
            "overlapCases": sum(1 for row in imported if row["floor"]["overlapPairs"]),
            "overlapPairs": sum(row["floor"]["overlapPairs"] for row in imported),
            "overlapAreaM2": sum(row["floor"]["overlapAreaM2"] for row in imported),
        },
        "sourceWallIoU": {"note": "vectorizer self-diagnostic, not independent wall accuracy", "mean": float(np.mean([row["vectorizerMetrics"]["wallIoU"] for row in imported if (row.get("vectorizerMetrics") or {}).get("wallIoU") is not None])) if any((row.get("vectorizerMetrics") or {}).get("wallIoU") is not None for row in imported) else None},
        "initialPersistedSurfaces": {
            "casesWithStoredSlabs": sum(1 for row in imported if (row["importedCounts"]["slabs"] or 0) > 0),
            "casesWithStoredCeilings": sum(1 for row in imported if (row["importedCounts"]["ceilings"] or 0) > 0),
            "storedSlabs": sum(row["importedCounts"]["slabs"] for row in imported),
            "storedCeilings": sum(row["importedCounts"]["ceilings"] for row in imported),
            "exactSlabPlanMatches": sum(1 for row in imported if (row.get("persistedSurfaces") or {}).get("slabs", {}).get("exactGeometryMatch")),
            "exactCeilingPlanMatches": sum(1 for row in imported if (row.get("persistedSurfaces") or {}).get("ceilings", {}).get("exactGeometryMatch")),
            "note": "stored counts come from buildVectorNodes output; slabGeometry above remains the computed slabPlan.create diagnostic.",
        },
        "persistedFloorProbes": {
            "probeWeighted": {
                "inside": sum(row["floor"]["persisted"]["roomInteriorSeeds"]["insideSlab"] for row in imported),
                "total": sum(row["floor"]["persisted"]["roomInteriorSeeds"]["total"] for row in imported),
            },
            "note": "computed separately from stored slabs; baseline files predate persisted slab output and therefore have zero stored probes.",
        },
        "cases": rows,
    }
    summary["persistedFloorProbes"]["probeWeighted"]["hitRate"] = (
        summary["persistedFloorProbes"]["probeWeighted"]["inside"] / summary["persistedFloorProbes"]["probeWeighted"]["total"]
        if summary["persistedFloorProbes"]["probeWeighted"]["total"] else None
    )
    (baseline_metrics_path if model_name == baseline_model_name else candidate_metrics_path).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")

pair_metrics = {
    "schemaVersion": 2,
    "candidateLabel": args.candidate_label,
    "sourceProbeManifestSha256": probe_hash,
    "baseline": read(baseline_metrics_path),
    "candidate": read(candidate_metrics_path),
    "pairedArtifacts": {"directory": str(paired_out.relative_to(ROOT)), "count": len(pair_paths)},
}
(paired_metrics_path).write_text(json.dumps(pair_metrics, ensure_ascii=False, indent=2) + "\n")
case_labels = [f"{item['ordinal']:02d} {item['key']}" for item in manifest["plans"]]
contact_sheet([baseline_out / item["key"] / "wall-floor-overlay.jpg" for item in manifest["plans"]], baseline_out / "contact-sheet-planned-50.jpg", labels=case_labels)
contact_sheet([candidate_out / item["key"] / "wall-floor-overlay.jpg" for item in manifest["plans"]], candidate_out / "contact-sheet-planned-50.jpg", labels=case_labels)
contact_sheet([baseline_out / item["key"] / "stored-floor-overlay.jpg" for item in manifest["plans"]], baseline_out / "contact-sheet-persisted-50.jpg", labels=case_labels)
contact_sheet([candidate_out / item["key"] / "stored-floor-overlay.jpg" for item in manifest["plans"]], candidate_out / "contact-sheet-persisted-50.jpg", labels=case_labels)
# Paired strips are wide (source + baseline/candidate wall/floor panels). Two
# columns keep each strip readable instead of shrinking it into a letterbox.
contact_sheet(pair_paths, paired_out / "contact-sheet-all-50.jpg", columns=2, tile_width=900, labels=case_labels)
print(json.dumps({"baseline": len(model_case_metrics[baseline_model_name]), "candidate": len(model_case_metrics[candidate_model_name]), "paired": len(pair_paths), "output": str(paired_out)}))
