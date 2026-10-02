#!/usr/bin/env python3
"""Focused regression for the missing-wall apartment extraction."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
VECTORIZE_PATH = ROOT / ".omx/recovery-20260929/data/vectorize.py"
IMAGE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/wall-missing-plan.jpg")


def load_vectorize():
    spec = importlib.util.spec_from_file_location("vectorize_regression", VECTORIZE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def endpoint_error(seg, start, end):
    direct = max(np.linalg.norm(seg.p1 - start), np.linalg.norm(seg.p2 - end))
    reverse = max(np.linalg.norm(seg.p1 - end), np.linalg.norm(seg.p2 - start))
    return min(direct, reverse)


def require_segment(vectorize, segs, start, end, tolerance=5.0):
    candidates = [
        (endpoint_error(seg, np.array(start, float), np.array(end, float)), seg)
        for seg in segs
    ]
    error, seg = min(candidates, key=lambda item: item[0], default=(float("inf"), None))
    assert error <= tolerance, f"missing segment {start}->{end}; nearest error={error:.2f}px"
    return seg


def require_span(vectorize, segs, start, end, tolerance=5.0):
    """Require source-backed runs at both ends while preserving an opening."""
    a = np.array(start, float) * vectorize.UP
    b = np.array(end, float) * vectorize.UP
    target = b - a
    length = float(np.linalg.norm(target))
    direction = target / length
    normal = np.array([-direction[1], direction[0]])
    intervals = []
    for seg in segs:
        if vectorize.ang_diff(seg.angle, vectorize.Seg(a, b).angle) > 6:
            continue
        if max(vectorize.point_line_dist(seg.p1, a, direction),
               vectorize.point_line_dist(seg.p2, a, direction)) > tolerance * vectorize.UP:
            continue
        projections = sorted(float(np.dot(p - a, direction)) for p in (seg.p1, seg.p2))
        intervals.append((max(0.0, projections[0]), min(length, projections[1])))
    intervals = [interval for interval in intervals if interval[1] > interval[0]]
    assert intervals, f"missing span near {start}->{end}"
    intervals.sort()
    merged = []
    for lo, hi in intervals:
        if merged and lo <= merged[-1][1] + tolerance * vectorize.UP:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    assert merged[0][0] <= tolerance * vectorize.UP, merged
    assert merged[-1][1] >= length - tolerance * vectorize.UP, merged
    gaps = [next_lo - prev_hi for (_, prev_hi), (next_lo, _) in zip(merged, merged[1:])]
    assert any(gap >= vectorize.GAP_MIN for gap in gaps), (
        f"expected source-backed opening gap near {start}->{end}: {merged}"
    )
    return merged


def synthetic_wall(vectorize, length, thickness):
    margin = 32 * vectorize.UP
    width = int(round(length * vectorize.UP)) + 2 * margin
    height = 48 * vectorize.UP
    wall = np.zeros((height, width), np.uint8)
    y = height // 2
    x0 = margin
    x1 = x0 + int(round(length * vectorize.UP))
    # Match the source-scale body width after rasterization rather than
    # rounding up every requested thickness into the old thick-wall bucket.
    half = max(int(round(thickness * vectorize.UP / 2 - 0.5)), 1)
    cv2.rectangle(wall, (x0, y - half), (x1, y + half), 1, -1)
    dist = cv2.distanceTransform(wall, cv2.DIST_L2, 3)
    seg = vectorize.Seg(np.array([x0, y], float), np.array([x1, y], float))
    return seg, dist, wall


def shifted_synthetic_wall(vectorize, length, thickness, offset):
    """A long wall whose raster body is shifted along the segment normal."""
    margin = 32 * vectorize.UP
    width = int(round(length * vectorize.UP)) + 2 * margin
    height = 48 * vectorize.UP
    wall = np.zeros((height, width), np.uint8)
    y = height // 2
    x0 = margin
    x1 = x0 + int(round(length * vectorize.UP))
    half = max(int(round(thickness * vectorize.UP / 2 - 0.5)), 1)
    shift = int(round(offset * vectorize.UP))
    cv2.rectangle(wall, (x0, y - half + shift), (x1, y + half + shift), 1, -1)
    dist = cv2.distanceTransform(wall, cv2.DIST_L2, 3)
    # Leave a small body margin so the shifted centerline does not sample a
    # rounded rectangle corner at either endpoint.
    seg = vectorize.Seg(np.array([x0 + 4 * vectorize.UP, y], float),
                        np.array([x1 - 4 * vectorize.UP, y], float))
    return seg, dist, wall


def synthetic_local_drift(vectorize, gap=False):
    """Keep a continuous wall through a 3px drift, but split a true gap."""
    height, width = 80, 600
    wall = np.zeros((height, width), np.uint8)
    y, x0, x1, half = 40, 30, 530, 5
    if gap:
        cv2.rectangle(wall, (x0, y - half), (238, y + half), 1, -1)
        cv2.rectangle(wall, (324, y - half), (x1, y + half), 1, -1)
    else:
        cv2.rectangle(wall, (x0, y - half), (204, y + half), 1, -1)
        cv2.rectangle(wall, (196, y + 3 - half), (334, y + 3 + half), 1, -1)
        cv2.rectangle(wall, (326, y - half), (x1, y + half), 1, -1)
    dist = cv2.distanceTransform(wall, cv2.DIST_L2, 3)
    seg = vectorize.Seg(np.array([34.0, y]), np.array([526.0, y], float))
    return seg, dist, wall


def main():
    vectorize = load_vectorize()
    image = cv2.imread(str(IMAGE_PATH))
    assert image is not None, f"cannot read {IMAGE_PATH}"
    image = cv2.resize(image, None, fx=vectorize.UP, fy=vectorize.UP,
                       interpolation=cv2.INTER_LINEAR)
    masks = vectorize.build_masks(image)
    skeleton = vectorize.zhang_suen(masks["wall"])
    raw = vectorize.extract_segments(skeleton, masks["dist_wall"])
    kept = vectorize.assign_thickness(raw, masks["dist_wall"], masks["wall"])
    print(f"real segments: raw={len(raw)} kept={len(kept)}")

    source_targets = (
        ((366.6, 477.1), (481.9, 361.9), "left bedroom divider"),
        ((674.3, 584.0), (674.3, 463.0), "kitchen/living divider"),
        ((540.0, 322.3), (587.5, 321.5), "entrance/dress separator"),
    )
    require_segment(vectorize, kept, np.array(source_targets[0][0]) * vectorize.UP,
                    np.array(source_targets[0][1]) * vectorize.UP)
    print("kept: left bedroom divider")
    kitchen_intervals = require_span(
        vectorize, kept, source_targets[1][0], source_targets[1][1]
    )
    print(f"kept: kitchen/living divider runs={len(kitchen_intervals)}")
    require_segment(vectorize, kept, np.array(source_targets[2][0]) * vectorize.UP,
                    np.array(source_targets[2][1]) * vectorize.UP)
    print("kept: entrance/dress separator")

    # Thin but long walls survive; short gray fragments and corner symbols do not.
    cases = (
        (47.5, 2.9, True, "entrance separator"),
        (121.0, 4.0, True, "kitchen/living divider"),
        (163.0, 3.7, True, "left bedroom divider"),
        (26.5, 3.7, False, "short corner fragment"),
        (13.0, 3.49, False, "short thin symbol fragment"),
        (13.0, 4.8, True, "short thick pier"),
    )
    for length, thickness, expected, label in cases:
        seg, dist, wall = synthetic_wall(vectorize, length, thickness)
        result = vectorize.assign_thickness([seg], dist, wall)
        actual = bool(result)
        assert actual is expected, f"{label}: expected kept={expected}, got {actual}"
        print(f"synthetic: {label} kept={actual}")
    for offset in (1.5, 2.0):
        seg, dist, wall = shifted_synthetic_wall(vectorize, 120.0, 4.0, offset)
        result = vectorize.assign_thickness([seg], dist, wall)
        assert result, f"long wall shifted {offset}px along its normal was dropped"
        print(f"synthetic: shifted long wall offset={offset:g}px kept=True")
    seg, dist, wall = synthetic_local_drift(vectorize)
    result = vectorize.assign_thickness([seg], dist, wall)
    assert len(result) == 1 and result[0].length >= 480, (
        f"local 3px wall drift was split: {[(s.p1.tolist(), s.p2.tolist()) for s in result]}"
    )
    print("synthetic: local 3px drift kept as one continuous wall")
    seg, dist, wall = synthetic_local_drift(vectorize, gap=True)
    result = vectorize.assign_thickness([seg], dist, wall)
    spans = sorted((round(s.p1[0]), round(s.p2[0])) for s in result)
    assert (len(spans) == 2 and spans[0][0] <= 36 and spans[0][1] <= 240
            and spans[1][0] >= 322 and spans[1][1] >= 524), (
        f"true opening was not split: {spans}"
    )
    print("synthetic: true gap split into two supported runs")

    vectorize.snap_junctions(kept)
    vectorize.classify_exterior(kept, masks["dist_to_out"])
    gaps = vectorize.collinear_gaps(kept, masks["wall"])
    openings = vectorize.classify_openings(gaps, masks, kept, None, [])
    bath_start = np.array([479.8, 285.5]) * vectorize.UP
    bath_end = np.array([463.7, 303.2]) * vectorize.UP
    bath_doors = [
        opening for opening in openings
        if opening.kind == "door" and opening.src == "ray"
        and 450 * vectorize.UP <= (opening.a[0] + opening.b[0]) / 2 <= 500 * vectorize.UP
        and 270 * vectorize.UP <= (opening.a[1] + opening.b[1]) / 2 <= 320 * vectorize.UP
    ]
    assert bath_doors, "legacy left-bath ray doorway was lost"
    bath = min(bath_doors, key=lambda opening: min(
        max(np.linalg.norm(opening.a - bath_start), np.linalg.norm(opening.b - bath_end)),
        max(np.linalg.norm(opening.a - bath_end), np.linalg.norm(opening.b - bath_start)),
    ))
    bath_error = min(
        max(np.linalg.norm(bath.a - bath_start), np.linalg.norm(bath.b - bath_end)),
        max(np.linalg.norm(bath.a - bath_end), np.linalg.norm(bath.b - bath_start)),
    )
    assert bath_error <= 3 * vectorize.UP, (
        f"legacy left-bath doorway endpoints drifted: {bath_error / vectorize.UP:.2f}px"
    )
    assert bath.hinge is not None, "legacy left-bath ray doorway lost its swing hinge"
    print(f"legacy left-bath doorway preserved: endpoint_error={bath_error / vectorize.UP:.2f}px")
    assert vectorize.find_entrance_gap_candidate(masks, kept, [], None) is None
    print("entrance OCR gate: empty OCR rejected")


if __name__ == "__main__":
    main()
