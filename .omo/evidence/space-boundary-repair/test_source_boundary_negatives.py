#!/usr/bin/env python3
"""Direct recovery-lane negatives for source boundary repair."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
VECTORIZE = ROOT / ".omx/recovery-20260929/data/vectorize.py"
SCALE = 10.0


def load_vectorizer():
    hough = cv2.HoughLinesP

    def compatible_hough(*args, **kwargs):
        lines = hough(*args, **kwargs)
        if lines is not None and lines.ndim == 2:
            lines = lines[:, None, :]
        return lines

    cv2.HoughLinesP = compatible_hough
    spec = importlib.util.spec_from_file_location("source_boundary_vectorizer", VECTORIZE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def seg(vectorizer, start, end, thickness=8.0):
    return vectorizer.Seg(
        np.asarray(start, dtype=float), np.asarray(end, dtype=float), thickness
    )


def line(wall, values, start, end, thickness=8, value=153):
    points = tuple(int(round(item)) for item in start), tuple(
        int(round(item)) for item in end
    )
    cv2.line(wall, *points, 1, thickness)
    cv2.line(values, *points, value, thickness)


def masks_for(vectorizer, wall_lines, thin_lines=(), capsule=None):
    del vectorizer
    shape = (180, 240)
    wall_raw = np.zeros(shape, dtype=np.uint8)
    values = np.full(shape, 220, dtype=np.uint8)
    thin = np.zeros(shape, dtype=np.uint8)
    sil = np.ones(shape, dtype=np.uint8)
    for start, end, thickness in wall_lines:
        line(wall_raw, values, start, end, thickness)
    for start, end, thickness in thin_lines:
        cv2.line(
            thin,
            tuple(int(round(item)) for item in start),
            tuple(int(round(item)) for item in end),
            1,
            thickness,
        )
    if capsule is not None:
        x0, x1, y = capsule
        values[y - 5 : y + 6, x0:x1 + 1] = 160
        values[y - 3 : y + 4, x0 + 8 : x1 - 7] = 245
        thin[y - 5 : y + 6, x0 + 5 : x1 - 4] = 1
    masks = dict(wall_raw=wall_raw, wall=wall_raw.copy(), thin=thin, v=values, sil=sil)
    assert np.count_nonzero(wall_raw), "fixture must contain measured gray wall body"
    assert np.count_nonzero(thin), "fixture must contain measured thin evidence"
    assert int(values.max()) > int(values.min()), "fixture must contain V evidence"
    return masks


def recover(
    vectorizer,
    masks,
    base_segs,
    relaxed_segs,
    semantic_spans=(),
    accepted_flanks=None,
):
    return vectorizer.recover_source_boundary_segments(
        masks,
        base_segs,
        relaxed_segs,
        semantic_spans=list(semantic_spans),
        scale=SCALE,
        accepted_flanks=accepted_flanks,
    )


def recover_with_hough_proposals(
    vectorizer,
    masks,
    base_segs,
    relaxed_segs,
    proposals,
    semantic_spans=(),
    accepted_flanks=None,
):
    """Run recovery with measured masks and a deterministic Hough proposal set."""
    extract_segments = vectorizer.extract_segments

    def proposal_extract(*args, **kwargs):
        del args, kwargs
        return [seg(vectorizer, item.p1, item.p2, item.th) for item in proposals]

    vectorizer.extract_segments = proposal_extract
    try:
        return recover(
            vectorizer,
            masks,
            base_segs,
            relaxed_segs,
            semantic_spans,
            accepted_flanks,
        )
    finally:
        vectorizer.extract_segments = extract_segments


def capsule_span(start=95.0, end=125.0, y=100.0):
    return (np.array([start, y]), np.array([end, y]), 8.0)


def positive_pair_fixture(vectorizer):
    wall_lines = (
        ((50, 60), (50, 100), 8),
        ((170, 100), (170, 60), 8),
        ((50, 100), (95, 100), 8),
        ((125, 100), (170, 100), 8),
    )
    masks = masks_for(vectorizer, wall_lines, capsule=(95, 125, 100))
    base = [
        seg(vectorizer, (50, 60), (50, 100)),
        seg(vectorizer, (170, 100), (170, 60)),
    ]
    relaxed = [
        seg(vectorizer, (50, 100), (95, 100)),
        seg(vectorizer, (125, 100), (170, 100)),
    ]
    return masks, base, relaxed


def bent_source_fixture(vectorizer):
    """Measured two-segment L body with duplicate Hough hypotheses only."""
    wall_lines = (
        ((35, 70), (35, 100), 8),
        ((35, 100), (50, 100), 8),
        ((50, 100), (75, 100), 20),
        ((75, 100), (75, 125), 20),
        ((75, 125), (75, 140), 8),
        ((75, 140), (105, 140), 8),
    )
    masks = masks_for(
        vectorizer,
        wall_lines,
        thin_lines=(((35, 100), (75, 100), 2), ((75, 100), (75, 140), 2)),
    )
    base = [
        seg(vectorizer, (35, 70), (35, 100), 8),
        seg(vectorizer, (75, 140), (105, 140), 8),
    ]
    # The mask has one L-shaped body. These are overlapping Hough hypotheses:
    # one offset horizontal duplicate and one reversed vertical duplicate.
    proposals = [
        seg(vectorizer, (35, 100), (75, 100), 8),
        seg(vectorizer, (50, 106), (75, 110), 8),
        seg(vectorizer, (75, 100), (75, 140), 8),
        seg(vectorizer, (75, 140), (75, 100), 8),
    ]
    return masks, base, proposals


def assert_bent_source_positive(result, base):
    recovered, apertures = result
    assert not apertures, f"measured bent source produced apertures={len(apertures)}"
    assert len(recovered) == 2, (
        "duplicate Hough hypotheses must normalize to the two measured body runs: "
        f"walls={len(recovered)}"
    )
    for item in recovered:
        assert np.isfinite(item.p1).all() and np.isfinite(item.p2).all()
        assert np.isfinite(item.th) and item.length >= 8.0

    def nearest_endpoint(point):
        return min(
            float(np.linalg.norm(point - endpoint))
            for item in recovered
            for endpoint in (item.p1, item.p2)
        )

    assert nearest_endpoint(np.array([35.0, 100.0])) <= 8.0
    assert nearest_endpoint(np.array([75.0, 140.0])) <= 8.0

    def point_segment_distance(point, item):
        vec = item.p2 - item.p1
        denominator = float(np.dot(vec, vec))
        if denominator <= 1e-9:
            return float(np.linalg.norm(point - item.p1))
        fraction = np.clip(float(np.dot(point - item.p1, vec) / denominator), 0.0, 1.0)
        return float(np.linalg.norm(point - (item.p1 + fraction * vec)))

    for point in (
        np.array([45.0, 100.0]),
        np.array([70.0, 100.0]),
        np.array([75.0, 110.0]),
        np.array([75.0, 135.0]),
    ):
        assert min(point_segment_distance(point, item) for item in recovered) <= 4.0

    horizontal = [item for item in recovered if abs(item.vec[0]) > abs(item.vec[1])]
    vertical = [item for item in recovered if abs(item.vec[1]) > abs(item.vec[0])]
    assert len(horizontal) == len(vertical) == 1
    assert all(
        np.allclose(before, after)
        for before, after in zip(
            ((np.array([35.0, 70.0]), np.array([35.0, 100.0])),
             (np.array([75.0, 140.0]), np.array([105.0, 140.0]))),
            ((base[0].p1, base[0].p2), (base[1].p1, base[1].p2)),
        )
    )


def semantic_gap_fixture(vectorizer):
    """Two short semantic gaps interrupt one measured, bent gray body."""
    wall_lines = (
        ((40, 40), (40, 80), 8),
        ((40, 80), (100, 80), 8),
        ((100, 80), (100, 90), 8),
        ((100, 98), (100, 116), 8),
        ((100, 124), (100, 150), 8),
        ((100, 150), (140, 150), 8),
    )
    masks = masks_for(
        vectorizer,
        wall_lines,
        thin_lines=tuple((start, end, 2) for start, end, _ in wall_lines),
    )
    # The bright profiles make these accepted semantic openings, while the
    # wall mask retains short source-scale jumps that can cross each gap.
    for start, end in ((90, 98), (116, 124)):
        masks["v"][start - 2 : end + 3, 95:106] = 160
        masks["v"][start + 1 : end - 1, 98:103] = 245

    base = [
        seg(vectorizer, (40, 40), (40, 80), 8),
        seg(vectorizer, (100, 150), (140, 150), 8),
    ]
    proposals = [
        seg(vectorizer, (40, 80), (100, 80), 8),
        seg(vectorizer, (100, 80), (100, 90), 8),
        seg(vectorizer, (100, 98), (100, 116), 8),
        seg(vectorizer, (100, 124), (100, 150), 8),
    ]
    semantic_gaps = (
        (np.array([100.0, 90.0]), np.array([100.0, 98.0]), 8.0),
        (np.array([100.0, 116.0]), np.array([100.0, 124.0]), 8.0),
    )
    # This accepted flank owns the first gap. Its path to the retained lower
    # anchor must not borrow the second gap's short skeleton bridge.
    accepted_flanks = [
        dict(
            point=np.array([100.0, 106.0]),
            blocked=((semantic_gaps[0][0], semantic_gaps[0][1]),),
            key=("opening", 0, 0),
            width=8.0,
            tangent=np.array([0.0, 1.0]),
        )
    ]
    return masks, base, proposals, semantic_gaps, accepted_flanks


def assert_semantic_gap_hard_block(result, semantic_gaps):
    recovered, apertures = result

    def point_segment_distance(point, item):
        vec = item.p2 - item.p1
        denominator = float(np.dot(vec, vec))
        if denominator <= 1e-9:
            return float(np.linalg.norm(point - item.p1))
        fraction = np.clip(float(np.dot(point - item.p1, vec) / denominator), 0.0, 1.0)
        return float(np.linalg.norm(point - (item.p1 + fraction * vec)))

    covered = []
    for first, second, width in semantic_gaps:
        midpoint = (first + second) / 2.0
        covered.append(
            any(point_segment_distance(midpoint, item) <= max(2.0, width / 2.0)
                for item in recovered)
        )
    assert not recovered and not apertures, (
        "semantic gaps must remain hard blockers through base/base and flank traces: "
        f"walls={len(recovered)} apertures={len(apertures)} gap_coverage={covered}"
    )


def assert_same_direction_behavior(forward, reverse):
    forward_segs, forward_apertures = forward
    reverse_segs, reverse_apertures = reverse
    assert len(forward_segs) == len(reverse_segs) > 0
    assert len(forward_apertures) == len(reverse_apertures) == 1

    def segment_endpoints(item):
        points = sorted((item.p1, item.p2), key=lambda point: (point[0], point[1]))
        return points

    for first, second in zip(
        sorted(forward_segs, key=lambda item: tuple(segment_endpoints(item)[0])),
        sorted(reverse_segs, key=lambda item: tuple(segment_endpoints(item)[0])),
    ):
        first_points = segment_endpoints(first)
        second_points = segment_endpoints(second)
        assert all(
            np.linalg.norm(a - b) <= 1e-6
            for a, b in zip(first_points, second_points)
        )
        assert abs(first.th - second.th) <= 1e-6
    first_a, first_b, first_width = forward_apertures[0]
    second_a, second_b, second_width = reverse_apertures[0]
    assert min(
        max(np.linalg.norm(first_a - second_a), np.linalg.norm(first_b - second_b)),
        max(np.linalg.norm(first_a - second_b), np.linalg.norm(first_b - second_a)),
    ) <= 1e-6
    assert abs(first_width - second_width) <= 1e-6


def require_rejection(vectorizer, name, masks, base, relaxed, semantic_spans=()):
    recovered, apertures = recover(vectorizer, masks, base, relaxed, semantic_spans)
    assert not recovered and not apertures, (
        f"{name} authorized source geometry: "
        f"walls={len(recovered)} apertures={len(apertures)}"
    )


def run():
    vectorizer = load_vectorizer()

    masks, base, relaxed = positive_pair_fixture(vectorizer)
    forward = recover(vectorizer, masks, base, relaxed)
    reverse = recover(
        vectorizer,
        masks,
        base,
        [seg(vectorizer, item.p2, item.p1, item.th) for item in relaxed],
        [],
    )
    assert_same_direction_behavior(forward, reverse)

    outlined_text_walls = (
        ((30, 100), (60, 100), 8),
        ((180, 100), (210, 100), 8),
        ((95, 80), (125, 80), 6),
        ((95, 80), (95, 120), 6),
        ((125, 80), (125, 120), 6),
        ((95, 120), (125, 120), 6),
        ((110, 80), (110, 120), 5),
    )
    outlined_text = masks_for(
        vectorizer,
        outlined_text_walls,
        thin_lines=(((95, 80), (125, 80), 2), ((95, 120), (125, 120), 2)),
    )
    require_rejection(
        vectorizer,
        "outlined gray text between retained anchors",
        outlined_text,
        [seg(vectorizer, (30, 100), (60, 100)), seg(vectorizer, (180, 100), (210, 100))],
        [
            seg(vectorizer, (95, 80), (125, 80), 6),
            seg(vectorizer, (95, 80), (95, 120), 6),
            seg(vectorizer, (125, 80), (125, 120), 6),
            seg(vectorizer, (95, 120), (125, 120), 6),
            seg(vectorizer, (110, 80), (110, 120), 5),
        ],
        [],
    )

    one_flank_walls = (
        ((50, 60), (50, 100), 8),
        ((170, 100), (170, 60), 8),
        ((50, 100), (95, 100), 8),
    )
    one_flank = masks_for(vectorizer, one_flank_walls, capsule=(95, 125, 100))
    require_rejection(
        vectorizer,
        "one-flank capsule",
        one_flank,
        [seg(vectorizer, (50, 60), (50, 100)), seg(vectorizer, (170, 100), (170, 60))],
        [seg(vectorizer, (50, 100), (95, 100))],
        [],
    )

    unattached_walls = (
        ((50, 60), (50, 100), 8),
        ((170, 100), (170, 60), 8),
        ((75, 100), (95, 100), 8),
        ((125, 100), (145, 100), 8),
    )
    unattached = masks_for(vectorizer, unattached_walls, capsule=(95, 125, 100))
    require_rejection(
        vectorizer,
        "unattached two-stroke capsule",
        unattached,
        [seg(vectorizer, (50, 60), (50, 100)), seg(vectorizer, (170, 100), (170, 60))],
        [seg(vectorizer, (75, 100), (95, 100)), seg(vectorizer, (125, 100), (145, 100))],
        [],
    )

    inconclusive_walls = (
        ((30, 90), (30, 100), 8),
        ((210, 100), (210, 110), 8),
        ((30, 100), (80, 100), 8),
        ((180, 100), (210, 100), 8),
    )
    inconclusive = masks_for(vectorizer, inconclusive_walls, capsule=(80, 180, 100))
    require_rejection(
        vectorizer,
        "inconclusive separation",
        inconclusive,
        [seg(vectorizer, (30, 90), (30, 100)), seg(vectorizer, (210, 100), (210, 110))],
        [seg(vectorizer, (30, 100), (80, 100)), seg(vectorizer, (180, 100), (210, 100))],
        [],
    )

    t_branch_walls = (
        ((30, 100), (60, 100), 8),
        ((60, 100), (110, 100), 8),
        ((110, 100), (110, 130), 8),
        ((85, 100), (85, 125), 8),
    )
    t_branch = masks_for(
        vectorizer,
        t_branch_walls,
        thin_lines=(((85, 100), (85, 125), 2),),
    )
    # The branch endpoint lands on the main segment's interior, not its node.
    require_rejection(
        vectorizer,
        "endpoint-to-interior T branch",
        t_branch,
        [seg(vectorizer, (30, 100), (60, 100)), seg(vectorizer, (110, 100), (110, 130))],
        [seg(vectorizer, (60, 100), (110, 100)), seg(vectorizer, (85, 100), (85, 125))],
    )

    ownerless_masks, _, ownerless_relaxed = positive_pair_fixture(vectorizer)
    require_rejection(
        vectorizer,
        "ownerless paired fallback",
        ownerless_masks,
        [],
        ownerless_relaxed,
        [capsule_span()],
    )

    bent_masks, bent_base, bent_proposals = bent_source_fixture(vectorizer)
    bent_result = recover_with_hough_proposals(
        vectorizer, bent_masks, bent_base, [], bent_proposals
    )
    assert_bent_source_positive(bent_result, bent_base)

    (
        semantic_masks,
        semantic_base,
        semantic_proposals,
        semantic_gaps,
        accepted_flanks,
    ) = semantic_gap_fixture(vectorizer)
    semantic_result = recover_with_hough_proposals(
        vectorizer,
        semantic_masks,
        semantic_base,
        [],
        semantic_proposals,
        semantic_gaps,
        accepted_flanks,
    )
    assert_semantic_gap_hard_block(semantic_result, semantic_gaps)
    print(
        "PASS recovery-negative-fixtures=6 reversed-owner=1 "
        "positive-pair=1 bent-source=1 semantic-gap-block=1"
    )


if __name__ == "__main__":
    run()
