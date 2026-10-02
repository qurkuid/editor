#!/usr/bin/env python3
"""OCR-gated regression for the recovered entrance doorway gap."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
VECTORIZE_PATH = ROOT / ".omx/recovery-20260929/data/vectorize.py"
IMAGE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/wall-missing-plan.jpg")
EVIDENCE_PATH = Path(__file__).with_name("entrance-gap-evidence.json")


def load_vectorize():
    spec = importlib.util.spec_from_file_location("entrance_gap_regression", VECTORIZE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_real(vectorize):
    image = cv2.imread(str(IMAGE_PATH))
    assert image is not None, f"cannot read {IMAGE_PATH}"
    image = cv2.resize(image, None, fx=vectorize.UP, fy=vectorize.UP,
                       interpolation=cv2.INTER_LINEAR)
    masks = vectorize.build_masks(image)
    skeleton = vectorize.zhang_suen(masks["wall"])
    raw = vectorize.extract_segments(skeleton, masks["dist_wall"])
    kept = vectorize.assign_thickness(raw, masks["dist_wall"], masks["wall"])
    kept = vectorize.snap_junctions(kept)
    kept = vectorize.classify_exterior(kept, masks["dist_to_out"])
    entrance_points = [np.array([592.0, 249.0]) * vectorize.UP]
    return masks, raw, kept, entrance_points


def synthetic_open_floor(vectorize):
    """Parallel jamb-like walls with uniform open floor must stay rejected."""
    shape = (360, 420)
    wall = np.zeros(shape, np.uint8)
    wall[100:260, 98:106] = 1
    wall[100:260, 298:306] = 1
    masks = {
        "wall": wall,
        "v": np.full(shape, 255, np.uint8),
        "white": np.zeros(shape, np.uint8),
        "stroke": np.zeros(shape, np.uint8),
        "sil": np.ones(shape, np.uint8),
    }
    left = vectorize.Seg(np.array([102.0, 100.0]), np.array([102.0, 260.0]), th=8.0)
    right = vectorize.Seg(np.array([302.0, 100.0]), np.array([302.0, 260.0]), th=8.0)
    return masks, [left, right], [np.array([200.0, 95.0])]


def main():
    vectorize = load_vectorize()
    masks, raw, kept, entrance_points = build_real(vectorize)
    candidate = vectorize.find_entrance_gap_candidate(
        masks, kept, entrance_points, None
    )
    assert candidate is not None, "real entrance candidate was not recovered"
    a, b, width, source = candidate
    points = np.stack([a, b]) / vectorize.UP
    expected = np.array([[557.5, 220.2], [624.7, 222.5]])
    endpoint_error = np.max(np.min(
        np.linalg.norm(points[:, None] - expected[None, :], axis=2), axis=1
    ))
    assert endpoint_error < 4.0, f"candidate endpoints drifted: {points.tolist()}"
    profile = vectorize.gap_cross_profile(masks["v"], a, b, width)
    arc = vectorize.door_hypothesis(
        masks["stroke"], a, b, float(np.linalg.norm(b - a)), None
    )
    white_strip = vectorize.strip_mask(
        masks["wall"].shape, a, b, width + 3 * vectorize.UP
    )
    white_fraction = float((white_strip & masks["white"]).sum()) / max(int(white_strip.sum()), 1)
    separates = vectorize.gap_separates(masks, a, b, width)
    assert arc is not None and arc[0] >= 0.62, f"weak swing score {arc}"
    assert max(profile) - min(profile) >= 25.0, "weak entrance sill profile"
    assert white_fraction >= 0.10, f"missing entrance sill fraction {white_fraction}"
    assert separates, "entrance gap does not separate the two sides"
    openings = vectorize.classify_openings(
        [candidate], masks, kept, None, entrance_points
    )
    assert len(openings) == 1 and openings[0].kind == "door"
    assert openings[0].hinge is not None

    assert vectorize.find_entrance_gap_candidate(masks, kept, [], None) is None
    assert vectorize.find_entrance_gap_candidate(
        masks, kept, [np.array([0.0, 0.0])], None
    ) is None
    negative_masks, negative_segs, negative_ocr = synthetic_open_floor(vectorize)
    assert vectorize.find_entrance_gap_candidate(
        negative_masks, negative_segs, negative_ocr, None
    ) is None

    summary = {
        "image": str(IMAGE_PATH),
        "rawSegments": len(raw),
        "assignedSegments": len(kept),
        "candidate": {
            "startSourcePx": np.round(a / vectorize.UP, 2).tolist(),
            "endSourcePx": np.round(b / vectorize.UP, 2).tolist(),
            "widthAnalysisPx": round(float(width), 3),
            "source": source,
            "endpointErrorPx": round(float(endpoint_error), 3),
            "arcScore": round(float(arc[0]), 3),
            "profileRange": round(float(max(profile) - min(profile)), 3),
            "whiteFraction": round(white_fraction, 3),
            "separates": bool(separates),
            "classifiedAs": openings[0].kind,
        },
        "negativeChecks": ["no-ocr", "non-entrance-ocr", "parallel-open-floor"],
    }
    EVIDENCE_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("PASS entrance-gap regression: positive + 3 negative gates")


if __name__ == "__main__":
    main()
