#!/usr/bin/env python3
"""Render source-image / imported-geometry comparisons for the frozen baseline.

The imported geometry is drawn in source-image pixel coordinates using the
vector document's imageSize and mmPerPx. The script reports those dimensions
as extractor-derived evidence; it does not claim OCR labels are ground truth.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "manifest.json").read_text())
metrics = json.loads((ROOT / "machine-metrics.json").read_text())
metric_by_key = {entry["key"]: entry for entry in metrics["results"]}

reviewer_room_probes: dict[int, list[dict]] = {}
reviewer_structural_probes: dict[int, list[dict]] = {}
for review_name in ("visual-review-01-25.json", "visual-review-26-50.json"):
    review_path = ROOT / review_name
    if not review_path.exists():
        continue
    review = json.loads(review_path.read_text())
    for case in (review.get("cases") or review.get("plans") or []):
        ordinal = int(case["ordinal"])
        room_probes = case.get("roomProbes") or case.get("roomSeeds") or []
        reviewer_room_probes[ordinal] = room_probes
    for candidate in review.get("commonStructuralFixCandidates") or []:
        for probe in candidate.get("sourceProbes") or []:
            reviewer_structural_probes.setdefault(int(probe["ordinal"]), []).append(
                {"xy": probe["xy"], "expected": probe.get("expect"), "candidate": candidate.get("candidate")}
            )


def source_size(path: Path) -> tuple[int, int]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot read {path}")
    return image.shape[1], image.shape[0]


def mapper(doc: dict, actual: tuple[int, int]):
    doc_w, doc_h = doc["imageSize"]
    mm_per_px = float(doc["mmPerPx"])
    actual_w, actual_h = actual

    def to_px(point: tuple[float, float]) -> tuple[int, int]:
        x_m, z_m = point
        doc_x = x_m * 1000.0 / mm_per_px + doc_w / 2.0
        # buildVectorNodes keeps the source image's top-left Y direction:
        # toLevel([x,y]) = [(x-cx)/1000, (y-cy)/1000].
        doc_y = doc_h / 2.0 + z_m * 1000.0 / mm_per_px
        return (
            int(round(doc_x * actual_w / doc_w)),
            int(round(doc_y * actual_h / doc_h)),
        )

    return to_px


def clip_point(point: tuple[int, int], size: tuple[int, int]) -> tuple[int, int]:
    width, height = size
    return max(0, min(width - 1, point[0])), max(0, min(height - 1, point[1]))


def source_px_to_level(point: tuple[float, float], doc: dict, actual: tuple[int, int]) -> tuple[float, float]:
    """Inverse of mapper() and buildVectorNodes' image-origin level transform."""
    source_w, source_h = actual
    doc_w, doc_h = doc["imageSize"]
    doc_x = float(point[0]) * doc_w / source_w
    doc_y = float(point[1]) * doc_h / source_h
    mm_per_px = float(doc["mmPerPx"])
    return ((doc_x - doc_w / 2.0) * mm_per_px / 1000.0, (doc_y - doc_h / 2.0) * mm_per_px / 1000.0)


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


def color_for(index: int) -> tuple[int, int, int]:
    # BGR colors chosen to remain visible over grayscale and orange source art.
    palette = (
        (255, 80, 40),
        (80, 190, 255),
        (130, 70, 230),
        (60, 210, 120),
        (220, 130, 50),
        (200, 70, 190),
    )
    return palette[index % len(palette)]


def put_text(image: np.ndarray, text: str, xy: tuple[int, int], color=(255, 255, 255), small=False):
    # The bundled vectorizer runtime has OpenCV but no Pillow. Keep the
    # overlay labels ASCII-safe; source room labels remain in vector.json.
    cv2.putText(
        image,
        text.encode("ascii", "replace").decode("ascii"),
        xy,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42 if small else 0.55,
        color,
        1,
        cv2.LINE_AA,
    )


def render_case(item: dict) -> tuple[dict, Path]:
    key = item["key"]
    folder = ROOT / key
    source_path = folder / "source.jpg"
    image = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot read {source_path}")
    height, width = image.shape[:2]
    doc = json.loads((folder / "vector.json").read_text())
    evaluation = metric_by_key[key]
    status = evaluation["status"]
    overlay = image.copy()
    imported_path = folder / "imported.json"
    imported = json.loads(imported_path.read_text()) if imported_path.exists() else None
    to_px = mapper(doc, (width, height)) if doc.get("mmPerPx") else None

    wall_count = opening_count = zone_count = space_count = 0
    if imported and to_px:
        walls = {wall["id"]: wall for wall in imported.get("walls", [])}
        for wall in imported.get("walls", []):
            a = clip_point(to_px(tuple(wall["start"])), (width, height))
            b = clip_point(to_px(tuple(wall["end"])), (width, height))
            thickness_px = max(2, int(round(float(wall.get("thickness", 0.08)) * 1000 / float(doc["mmPerPx"]) * width / doc["imageSize"][0])))
            cv2.line(overlay, a, b, (0, 60, 255), max(2, min(10, thickness_px)), cv2.LINE_AA)
            wall_count += 1

        # Draw detected floor loops in gray first, then source-room zones in
        # colors. The two layers make outside-floor and zone coverage visible.
        floor_layer = overlay.copy()
        for space in imported.get("spaces", []):
            polygon = np.array([clip_point(to_px(tuple(point)), (width, height)) for point in space.get("polygon", [])], dtype=np.int32)
            if len(polygon) >= 3:
                cv2.fillPoly(floor_layer, [polygon], (150, 150, 150))
                cv2.polylines(overlay, [polygon], True, (230, 230, 230), 2, cv2.LINE_AA)
        overlay = cv2.addWeighted(floor_layer, 0.18, overlay, 0.82, 0)

        # Fill source-room polygons with transparent colors, then outline them.
        fill_layer = overlay.copy()
        for index, zone in enumerate(imported.get("zones", [])):
            polygon = np.array([clip_point(to_px(tuple(point)), (width, height)) for point in zone.get("polygon", [])], dtype=np.int32)
            if len(polygon) < 3:
                continue
            color = color_for(index)
            cv2.fillPoly(fill_layer, [polygon], color)
            cv2.polylines(overlay, [polygon], True, color, 2, cv2.LINE_AA)
            centroid = tuple(np.mean(polygon, axis=0).astype(int))
            name = str(zone.get("name") or zone.get("metadata", {}).get("sourceRoomId") or f"zone {index + 1}")
            put_text(overlay, name[:18], (int(centroid[0]), int(centroid[1])), color=(255, 255, 255), small=True)
            zone_count += 1
        overlay = cv2.addWeighted(fill_layer, 0.23, overlay, 0.77, 0)

        for opening in imported.get("openings", []):
            wall = walls.get(opening.get("wallId"))
            if not wall:
                continue
            start = np.array(wall["start"], dtype=float)
            end = np.array(wall["end"], dtype=float)
            vector = end - start
            length = float(np.linalg.norm(vector))
            if length <= 1e-9:
                continue
            direction = vector / length
            center = start + direction * float(opening.get("position", [0])[0])
            half = direction * float(opening.get("width", 0)) / 2.0
            a = clip_point(to_px(tuple(center - half)), (width, height))
            b = clip_point(to_px(tuple(center + half)), (width, height))
            cv2.line(overlay, a, b, (255, 0, 255), 4, cv2.LINE_AA)
            opening_count += 1

        space_count = len(imported.get("spaces", []))

    # Render actual slab planner polygons separately from source-room zone
    # fills. Zones describe labelled source rooms; slab polygons are the
    # generated floor surface and must be measured independently.
    floor_overlay = image.copy()
    floor_seed_metrics = {
        "roomInteriorSeeds": {"total": 0, "insideSlab": 0, "outsideSlab": 0},
        "outsideFloorProbes": {"total": 0, "correctlyOutside": 0, "falseFloorPositive": 0},
        "otherStructuralProbes": {"total": 0, "insideSlab": 0, "outsideSlab": 0},
        "slabPolygons": 0,
        "probeResults": [],
        "note": "Reviewer seed/probe coordinates are source-image evidence. Slab containment is evaluated against slabPlan.create polygons; zone fills are excluded.",
    }
    if imported and to_px:
        slab_nodes = (imported.get("slabPlan") or {}).get("create", [])
        floor_layer = floor_overlay.copy()
        slab_polygons: list[list[list[float]]] = []
        for slab in slab_nodes:
            polygon = slab.get("polygon") or []
            if len(polygon) < 3:
                continue
            slab_polygons.append(polygon)
            image_polygon = np.array([clip_point(to_px(tuple(point)), (width, height)) for point in polygon], dtype=np.int32)
            cv2.fillPoly(floor_layer, [image_polygon], (160, 160, 160))
            cv2.polylines(floor_overlay, [image_polygon], True, (255, 220, 0), 3, cv2.LINE_AA)
        floor_overlay = cv2.addWeighted(floor_layer, 0.34, floor_overlay, 0.66, 0)
        floor_seed_metrics["slabPolygons"] = len(slab_polygons)

        probes = []
        for probe in reviewer_room_probes.get(item["ordinal"], []):
            probes.append({"kind": "room-interior", "xy": probe.get("xy"), "expected": probe.get("label") or probe.get("expected"), "candidate": None})
        probes.extend({"kind": "structural", **probe} for probe in reviewer_structural_probes.get(item["ordinal"], []))
        review_size = None
        for review_name in ("visual-review-01-25.json", "visual-review-26-50.json"):
            review_path = ROOT / review_name
            if not review_path.exists():
                continue
            review = json.loads(review_path.read_text())
            for case in (review.get("cases") or review.get("plans") or []):
                if int(case.get("ordinal", -1)) == item["ordinal"]:
                    review_size = case.get("sourceSize")
                    break
            if review_size:
                break
        for probe_index, probe in enumerate(probes):
            if not probe.get("xy"):
                continue
            point = probe["xy"]
            source_x = float(point[0]) * width / float(review_size[0]) if review_size else float(point[0])
            source_y = float(point[1]) * height / float(review_size[1]) if review_size else float(point[1])
            level_point = source_px_to_level((source_x, source_y), doc, (width, height))
            inside = any(point_in_polygon(level_point, polygon) for polygon in slab_polygons)
            expected = str(probe.get("expected") or "")
            expected_outside = expected == "outside-floor"
            if probe["kind"] == "room-interior":
                floor_seed_metrics["roomInteriorSeeds"]["total"] += 1
                floor_seed_metrics["roomInteriorSeeds"]["insideSlab" if inside else "outsideSlab"] += 1
            elif expected_outside:
                floor_seed_metrics["outsideFloorProbes"]["total"] += 1
                floor_seed_metrics["outsideFloorProbes"]["falseFloorPositive" if inside else "correctlyOutside"] += 1
            else:
                floor_seed_metrics["otherStructuralProbes"]["total"] += 1
                floor_seed_metrics["otherStructuralProbes"]["insideSlab" if inside else "outsideSlab"] += 1
            marker_color = (40, 220, 40) if (inside == (not expected_outside)) else (40, 40, 240)
            marker = clip_point((int(round(source_x)), int(round(source_y))), (width, height))
            cv2.circle(floor_overlay, marker, 9, marker_color, -1, cv2.LINE_AA)
            cv2.circle(floor_overlay, marker, 11, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(floor_overlay, str(probe_index + 1), (marker[0] + 12, marker[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.45, marker_color, 2, cv2.LINE_AA)
            floor_seed_metrics["probeResults"].append({"kind": probe["kind"], "xy": [source_x, source_y], "expected": expected, "insideSlab": inside, "candidate": probe.get("candidate")})
    put_text(floor_overlay, f"{item['ordinal']:02d} {item['planId']} | SLAB PLAN | slabs {floor_seed_metrics['slabPolygons']}", (10, 10), color=(255, 255, 255))
    floor_overlay_path = folder / "wall-floor-overlay.jpg"
    floor_comparison_path = folder / "wall-floor-comparison.jpg"
    floor_comparison = np.concatenate([image, floor_overlay], axis=1)
    cv2.imwrite(str(floor_overlay_path), floor_overlay, [cv2.IMWRITE_JPEG_QUALITY, 94])
    cv2.imwrite(str(floor_comparison_path), floor_comparison, [cv2.IMWRITE_JPEG_QUALITY, 92])
    shutil.copyfile(floor_overlay_path, ROOT / f"review-{item['ordinal']:02d}-floor.jpg")

    title = f"{item['ordinal']:02d} {item['planId']} | {status} | walls {wall_count} openings {opening_count} zones {zone_count} spaces {space_count}"
    put_text(overlay, title, (10, 10), color=(255, 255, 255))
    if status != "IMPORTED":
        put_text(overlay, f"Importer rejected: {evaluation.get('importer', {}).get('reason', 'unknown')}", (10, 34), color=(255, 230, 40), small=True)

    overlay_path = folder / "overlay.jpg"
    baseline_overlay_path = folder / "baseline-overlay.jpg"
    comparison = np.concatenate([image, overlay], axis=1)
    comparison_path = folder / "comparison.jpg"
    cv2.imwrite(str(overlay_path), overlay, [cv2.IMWRITE_JPEG_QUALITY, 94])
    shutil.copyfile(overlay_path, baseline_overlay_path)
    cv2.imwrite(str(comparison_path), comparison, [cv2.IMWRITE_JPEG_QUALITY, 92])
    shutil.copyfile(source_path, ROOT / f"review-{item['ordinal']:02d}-original.jpg")
    shutil.copyfile(overlay_path, ROOT / f"review-{item['ordinal']:02d}-overlay.jpg")
    shutil.copyfile(comparison_path, ROOT / f"review-{item['ordinal']:02d}-comparison.jpg")

    # Source document physical size and reviewer dimension probes are kept as
    # evidence fields; the latter is manually read source annotation evidence.
    source_doc_size = [int(doc["imageSize"][0]), int(doc["imageSize"][1])]
    vector_physical_m = [source_doc_size[0] * float(doc["mmPerPx"]) / 1000.0, source_doc_size[1] * float(doc["mmPerPx"]) / 1000.0] if doc.get("mmPerPx") else None
    dimension = None
    for filename in ("visual-review-01-25.json", "visual-review-26-50.json"):
        review_path = ROOT / filename
        if not review_path.exists():
            continue
        review = json.loads(review_path.read_text())
        for case in (review.get("cases") or review.get("plans") or []):
            if case.get("key") != key:
                continue
            dimension = case.get("dimensionEvidence") or case.get("printedDimension")
            break
        if dimension:
            break
    dimension_probe = None
    centroid_checks = []
    if imported and to_px:
        source_rooms = {room["id"]: room for room in doc.get("rooms", [])}
        for zone in imported.get("zones", []):
            source_room = source_rooms.get((zone.get("metadata") or {}).get("sourceRoomId"))
            if not source_room or not source_room.get("polygon") or not zone.get("polygon"):
                continue
            source_centroid = np.mean(np.asarray(source_room["polygon"], dtype=float), axis=0)
            source_centroid_px = np.array([
                source_centroid[0] / doc["imageSize"][0] * width,
                source_centroid[1] / doc["imageSize"][1] * height,
            ])
            roundtrip_centroid = np.asarray(to_px(source_px_to_level(tuple(source_centroid_px), doc, (width, height))), dtype=float)
            imported_centroid = np.mean(np.asarray([to_px(tuple(point)) for point in zone["polygon"]], dtype=float), axis=0)
            expected_centroid = np.mean(np.asarray([to_px(((point[0] - doc["imageSize"][0] * doc["mmPerPx"] / 2) / 1000, (point[1] - doc["imageSize"][1] * doc["mmPerPx"] / 2) / 1000)) for point in source_room["polygon"]], dtype=float), axis=0)
            centroid_checks.append({
                "sourceRoomId": source_room["id"],
                "expectedSourceCentroidPx": expected_centroid.tolist(),
                "importedZoneCentroidPx": imported_centroid.tolist(),
                "roundTripSourceCentroidDeltaPx": float(np.linalg.norm(roundtrip_centroid - source_centroid_px)),
                "deltaPx": float(np.linalg.norm(imported_centroid - expected_centroid)),
            })
    if dimension and dimension.get("endpoints"):
        a, b = dimension["endpoints"]
        pixel_span = math.hypot(float(b[0]) - float(a[0]), float(b[1]) - float(a[1]))
        dimension_probe = {
            "manuallyReadSourceAnnotation": dimension,
            "sourcePixelSpan": pixel_span,
            "vectorizerDerivedMmPerPx": doc.get("mmPerPx"),
            "vectorizerDerivedSpanMAtSourcePixels": pixel_span * float(doc["mmPerPx"]) / 1000.0 if doc.get("mmPerPx") else None,
            "vectorizerDerivedSpanMAtDocumentScale": pixel_span * float(doc["imageSize"][0]) / width * float(doc["mmPerPx"]) if doc.get("mmPerPx") else None,
            "endpointUncertaintyPx": 8,
            "endpointUncertaintyMmAtDocumentScale": 16 * float(doc["imageSize"][0]) / width * float(doc["mmPerPx"]) if doc.get("mmPerPx") else None,
            "relativeErrorVsManualAnnotation": (
                (pixel_span * float(doc["imageSize"][0]) / width * float(doc["mmPerPx"]) - float(dimension["value"])) / float(dimension["value"])
                if doc.get("mmPerPx") and dimension.get("value") else None
            ),
            "note": "Manual source annotation and vectorizer scale are reported separately; this is not an independent OCR truth claim.",
        }
    visual = {
        "ordinal": item["ordinal"],
        "key": key,
        "status": status,
        "sourceImagePixels": [width, height],
        "vectorDocumentImagePixels": source_doc_size,
        "imageSizeRatio": [source_doc_size[0] / width, source_doc_size[1] / height],
        "vectorizerPhysicalImageM": vector_physical_m,
        "mmPerPx": doc.get("mmPerPx"),
        "importedCounts": {"walls": wall_count, "openings": opening_count, "zones": zone_count, "spaces": space_count},
        "floorMetrics": floor_seed_metrics,
        "dimensionEvidence": dimension_probe,
        "coordinateMapCheck": {"roomsCompared": len(centroid_checks), "roundTripMaxDeltaPx": max((row["roundTripSourceCentroidDeltaPx"] for row in centroid_checks), default=None), "importedZoneMaxCentroidDeltaPx": max((row["deltaPx"] for row in centroid_checks), default=None), "samples": centroid_checks[:8], "formula": "source pixels use buildVectorNodes toLevel Y-positive direction; imported-zone deltas include wall-space reconciliation"},
        "overlayFiles": {"source": str(source_path.relative_to(ROOT)), "overlay": str(overlay_path.relative_to(ROOT)), "baselineOverlay": str(baseline_overlay_path.relative_to(ROOT)), "comparison": str(comparison_path.relative_to(ROOT)), "wallFloorOverlay": str(floor_overlay_path.relative_to(ROOT)), "wallFloorComparison": str(floor_comparison_path.relative_to(ROOT))},
        "note": "Imported geometry is a model overlay in source pixels. Source annotations and visual review remain the visual truth boundary.",
    }
    (folder / "visual-metrics.json").write_text(json.dumps(visual, ensure_ascii=False, indent=2) + "\n")
    return visual, comparison_path


def contact_sheet(entries: list[tuple[dict, Path]], name: str, columns: int = 5):
    tiles = []
    for visual, path in entries:
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            continue
        scale = min(440 / image.shape[1], 300 / image.shape[0])
        image = cv2.resize(image, (max(1, int(round(image.shape[1] * scale))), max(1, int(round(image.shape[0] * scale)))), interpolation=cv2.INTER_AREA)
        tile = np.full((332, 440, 3), (24, 16, 16), dtype=np.uint8)
        y = 24 + (300 - image.shape[0]) // 2
        x = (440 - image.shape[1]) // 2
        tile[y:y + image.shape[0], x:x + image.shape[1]] = image
        cv2.putText(tile, f"{visual['ordinal']:02d} {visual['key']}", (8, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)
    rows = math.ceil(len(tiles) / columns)
    sheet = np.full((rows * 332, columns * 440, 3), (24, 16, 16), dtype=np.uint8)
    for index, tile in enumerate(tiles):
        x = (index % columns) * 440
        y = (index // columns) * 332
        sheet[y:y + 332, x:x + 440] = tile
    cv2.imwrite(str(ROOT / name), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])


visuals: list[tuple[dict, Path]] = []
for item in manifest["plans"]:
    visuals.append(render_case(item))

contact_sheet(visuals[:25], "baseline-comparison-01-25.jpg")
contact_sheet(visuals[25:], "baseline-comparison-26-50.jpg")
contact_sheet(visuals, "baseline-comparison-all-50.jpg", columns=5)
(ROOT / "visual-metrics.json").write_text(
    json.dumps({"total": len(visuals), "cases": [entry for entry, _ in visuals]}, ensure_ascii=False, indent=2) + "\n"
)
(ROOT / "floor-metrics.json").write_text(
    json.dumps(
        {
            "total": len(visuals),
            "roomInteriorSeeds": sum((entry.get("floorMetrics") or {}).get("roomInteriorSeeds", {}).get("total", 0) for entry, _ in visuals),
            "roomInteriorSeedsInsideSlab": sum((entry.get("floorMetrics") or {}).get("roomInteriorSeeds", {}).get("insideSlab", 0) for entry, _ in visuals),
            "outsideFloorProbes": sum((entry.get("floorMetrics") or {}).get("outsideFloorProbes", {}).get("total", 0) for entry, _ in visuals),
            "outsideFloorFalsePositives": sum((entry.get("floorMetrics") or {}).get("outsideFloorProbes", {}).get("falseFloorPositive", 0) for entry, _ in visuals),
            "cases": [{"ordinal": entry["ordinal"], "key": entry["key"], **(entry.get("floorMetrics") or {})} for entry, _ in visuals],
            "note": "Floor evidence uses slabPlan.create polygons and reviewer-provided source probes. It does not infer floor truth from zone fills.",
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n"
)
print(json.dumps({"total": len(visuals), "contactSheets": ["baseline-comparison-01-25.jpg", "baseline-comparison-26-50.jpg", "baseline-comparison-all-50.jpg"]}))
