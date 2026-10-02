#!/usr/bin/env python3
"""Room-component regressions for the source-backed apartment vectorizer."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
IMAGE = ROOT / ".omo/evidence/missing-walls/source-plan.jpg"
OCR = ROOT / ".omx/recovery-20260929/data/.build/ocr-cache/apt-vector-3FO40HSDCOM4.json"
VECTORIZE = ROOT / ".omx/recovery-20260929/data/vectorize.py"
UP = 2


def load_vectorizer():
    # OpenCV 5 returns Hough lines as (n, 4); the recovery script also runs
    # with OpenCV 4, whose shape is (n, 1, 4).
    hough = cv2.HoughLinesP

    def compatible_hough(*args, **kwargs):
        lines = hough(*args, **kwargs)
        if lines is not None and lines.ndim == 2:
            lines = lines[:, None, :]
        return lines

    cv2.HoughLinesP = compatible_hough
    spec = importlib.util.spec_from_file_location("rooms_vectorizer", VECTORIZE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    fixture = json.loads(OCR.read_text())
    module.run_ocr = lambda _image, _cache: fixture
    return module


def source_point(point):
    return np.asarray(point, dtype=float) * UP


def label_owners(vectorizer, analysis):
    owners = {}
    for item in analysis["ocr"]:
        text = item["text"].strip()
        if not any(word in text for words in vectorizer.ROOM_WORDS.values() for word in words):
            continue
        point = source_point((item["x"] / UP + item["w"] / (2 * UP),
                              item["y"] / UP + item["h"] / (2 * UP)))
        owners[text + f"@{point[0]:.1f}"] = [
            index for index, room in enumerate(analysis["rooms"])
            if cv2.pointPolygonTest(room["poly"].astype(np.float32), tuple(point), True) >= -3 * UP
        ]
    return owners


def synthetic_masks(vectorizer, scale, small_width, ocr_items=None):
    height, width = 100, 140
    sil = np.ones((height, width), np.uint8)
    wall = np.zeros_like(sil)
    dark = np.zeros_like(sil)
    dark[:, small_width:small_width + 5] = 1
    img = np.full((height, width, 3), 210, np.uint8)
    masks = {
        "sil": sil,
        "wall": wall,
        "dark": dark,
    }
    return vectorizer.detect_rooms(img, masks, [], [], scale=scale, ocr_items=ocr_items)


def malformed_blank_barrier(vectorizer):
    shape = (120, 160)
    masks = {
        "sil": np.ones(shape, np.uint8),
        "wall": np.zeros(shape, np.uint8),
        "thin": np.zeros(shape, np.uint8),
        "v": np.full(shape, 210, np.uint8),
        "stroke": np.zeros(shape, np.uint8),
    }
    segs = [
        vectorizer.Seg(np.array([10.0, 60.0]), np.array([50.0, 60.0]), th=8.0),
        vectorizer.Seg(np.array([90.0, 60.0]), np.array([140.0, 60.0]), th=8.0),
    ]
    return vectorizer.source_room_barriers(segs, masks, scale=10.0)


def run():
    vectorizer = load_vectorizer()
    analysis = vectorizer.analyze(str(IMAGE), ocr_dir="/tmp/openings-rooms-ocr")
    owners = label_owners(vectorizer, analysis)
    assert len(owners) == 14, owners
    assert len(analysis["rooms"]) == 15, analysis["metrics"]
    assert all(len(matches) == 1 for matches in owners.values()), owners
    assert len({matches[0] for matches in owners.values()}) == 14, owners
    assert analysis["room_diagnostics"] == [], analysis["room_diagnostics"]

    # The top-dress label and two balcony probes must each resolve to their
    # own source component. Their measured areas are evidence, not geometry.
    def probe_owner(point):
        point = source_point(point)
        matches = [
            index for index, room in enumerate(analysis["rooms"])
            if cv2.pointPolygonTest(room["poly"].astype(np.float32), tuple(point), True) >= -3 * UP
        ]
        assert len(matches) == 1, (point, matches)
        return matches[0]

    top_dress = analysis["rooms"][probe_owner((935.0, 158.0))]
    left_balcony_index = probe_owner((752.0, 608.0))
    right_balcony_index = probe_owner((845.0, 608.0))
    left_balcony = analysis["rooms"][left_balcony_index]
    right_balcony = analysis["rooms"][right_balcony_index]
    assert 0.2 < top_dress["area_px"] * analysis["scale"] ** 2 / 1e6 < 1.0
    assert left_balcony_index != right_balcony_index
    assert left_balcony["area_px"] > vectorizer.MIN_ROOM_AREA_PX
    assert right_balcony["area_px"] > vectorizer.MIN_ROOM_AREA_PX

    # A label-protected component below the 0.6 m² drop threshold survives.
    protected = synthetic_masks(
        vectorizer,
        scale=10.0,
        small_width=35,
        ocr_items=[{"text": "방", "x": 10, "y": 10, "w": 8, "h": 8}],
    )
    assert len(protected) == 2, [room["area_px"] for room in protected]

    # Geodesic sliver absorption must stop at a dark room barrier instead of
    # crossing it through the old wall-only free mask.
    barrier = synthetic_masks(vectorizer, scale=20.0, small_width=35)
    assert len(barrier) == 2, [room["area_px"] for room in barrier]

    # A gap with no thin/profile evidence must not become a room barrier.
    assert malformed_blank_barrier(vectorizer) == []
    print("PASS rooms=15 labels=14 protected-small=2 barrier-separated=2 blank-barrier=0")


if __name__ == "__main__":
    run()
