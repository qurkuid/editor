#!/usr/bin/env python3
"""Focused regression for the v15 centered dimension-line matcher.

This test intentionally lives beside the private vectorizer evidence rather
than in the public package. The v13 plan vectors remain the comparison
baseline; this script only reads them and writes no batch artifacts.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
VECTORIZE_PATH = ROOT / ".omx/recovery-20260929/data/vectorize.py"
EVIDENCE = ROOT / ".omo/evidence/apartment-scale-fix-20261003"
BATCH = ROOT / ".omo/evidence/apartment-50-improvement-20261003"
OCR_CACHE = ROOT / ".omx/recovery-20260929/data/.build/ocr-cache"


def load_vectorize():
    spec = importlib.util.spec_from_file_location("scale_vectorize_regression", VECTORIZE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def masks(vectorize):
    shape = (360, 360)
    return {
        "sil": np.zeros(shape, np.uint8),
        "chroma": np.zeros(shape, np.uint8),
        "v": np.zeros(shape, np.uint8),
    }


def item(text, center_x, center_y, horizontal=True):
    width, height = (12, 6) if horizontal else (6, 12)
    return {
        "text": str(text),
        "x": center_x - width / 2,
        "y": center_y - height / 2,
        "w": width,
        "h": height,
    }


def hough_lines(lines):
    return np.asarray([[list(line) for line in lines]], dtype=np.int32).reshape(-1, 1, 4)


def dimension(vectorize, lines, items, *, ext_th_px=None):
    with patch.object(vectorize.cv2, "HoughLinesP", return_value=hough_lines(lines)):
        return vectorize.dimension_scale(
            items, masks(vectorize), ext_th_px, with_evidence=True
        )


def test_shared_line_three_numbers_is_one_vote(vectorize):
    result = dimension(
        vectorize,
        [(20, 40, 220, 40), (20, 100, 220, 100)],
        [
            item(2500, 80, 40),
            item(2600, 118, 40),
            item(2400, 122, 40),
            item(2600, 120, 100),
        ],
    )
    assert result == (None, True), result


def test_edge_center_is_rejected(vectorize):
    result = dimension(vectorize, [(20, 40, 220, 40)], [item(2600, 60, 40)])
    assert result == (None, False), result


def test_three_unique_centered_intervals_are_accepted(vectorize):
    result = dimension(
        vectorize,
        [(20, 40, 220, 40), (20, 100, 220, 100), (20, 160, 220, 160)],
        [item(2600, 120, y) for y in (40, 100, 160)],
    )
    assert result[1] is True
    assert abs(result[0] - 13.0) < 1e-6, result


def test_no_centered_evidence_fails_closed(vectorize):
    sil = np.zeros((300, 300), np.uint8)
    sil[50:250, 50:250] = 1
    items = [item(2600, 60, 40)]
    with patch.object(vectorize.cv2, "HoughLinesP", return_value=hough_lines([(20, 40, 220, 40)])):
        assert vectorize.dimension_scale(
            items, masks(vectorize), None, with_evidence=True
        ) == (None, False)
        assert vectorize.estimate_scale(items, sil, None, masks(vectorize)) is None
    assert vectorize.estimate_scale(items, sil, None) is None


def test_centered_conflict_fails_closed(vectorize):
    result = dimension(
        vectorize,
        [(20, 40, 220, 40), (20, 100, 220, 100)],
        [item(2600, 120, 40), item(1800, 120, 100)],
    )
    assert result == (None, True), result


def actual_dimension(vectorize, plan_key, *, source_root=BATCH, source_folder=None, ocr_stem=None):
    plan_id = plan_key.rsplit("/", 1)[-1]
    if "_" in plan_id:
        plan_id = plan_id.split("_", 1)[1]
    source = source_root / (source_folder or plan_key) / "source.jpg"
    image = cv2.imread(str(source))
    assert image is not None, source
    image = cv2.resize(image, None, fx=vectorize.UP, fy=vectorize.UP,
                       interpolation=cv2.INTER_LINEAR)
    plan_masks = vectorize.build_masks(image)
    raw = json.loads((OCR_CACHE / f"{ocr_stem or plan_id}.json").read_text())
    ocr = [
        {**it, "x": it["x"] * vectorize.UP, "y": it["y"] * vectorize.UP,
         "w": it["w"] * vectorize.UP, "h": it["h"] * vectorize.UP}
        for it in raw
    ]
    return vectorize.estimate_scale(ocr, plan_masks["sil"], None, plan_masks)


def test_p42_and_three_v13_scale_matches(vectorize):
    p42 = actual_dimension(vectorize, "p42_3FO3YWCYEPV9")
    expected_p42 = np.median([19773 / 1481, 18492 / 1385, 8148 / 611])
    assert p42 is not None and abs(p42 - expected_p42) < 0.02, p42
    assert abs(p42 - 2.258601553842073) > 5

    expected = {
        "jangjeon/3FO3YBET8M3M": 8.74822190616642,
        "haeundae/3FO3Y8VP946W": 10.395252838020207,
        "hwmyeong/3FO3YD1THDWY": 12.421140917535126,
    }
    for plan_key, baseline in expected.items():
        name, plan_id = plan_key.split("/", 1)
        scale = actual_dimension(
            vectorize,
            plan_key,
            source_root=ROOT / ".omo/evidence/apartment-zone-real-20261003",
            source_folder=name,
            ocr_stem=f"apt-vector-{plan_id}",
        )
        assert scale is not None and abs(scale - baseline) < 0.01, (plan_key, scale)


def test_unproven_batch_scales_fail_closed(vectorize):
    expected_null = {
        "p13_3FO40LLCKMND",
        "p17_3FO40PYWOTXL",
        "p34_3FO40JX41VTX",
        "p36_3FO40JS9H9I2",
        "p44_3FO40OD9LASF",
        "p49_3FO40KTV0FVE",
    }
    for plan_key in sorted(expected_null):
        scale = actual_dimension(vectorize, plan_key)
        assert scale is None, (plan_key, scale)


def test_doc_and_route_versions(vectorize):
    seg = vectorize.Seg(np.array([0.0, 0.0]), np.array([10.0, 0.0]))
    doc = vectorize.build_doc("/tmp/plan.jpg", (20, 30, 3), [seg], [], [], None)
    assert doc["docVersion"] == 15
    route = (ROOT / "apps/editor/app/api/apartments/[id]/plans/[planId]/vector/route.ts").read_text()
    assert "const DOC_VERSION = 15" in route


def main():
    vectorize = load_vectorize()
    tests = [
        test_shared_line_three_numbers_is_one_vote,
        test_edge_center_is_rejected,
        test_three_unique_centered_intervals_are_accepted,
        test_no_centered_evidence_fails_closed,
        test_centered_conflict_fails_closed,
        test_p42_and_three_v13_scale_matches,
        test_unproven_batch_scales_fail_closed,
        test_doc_and_route_versions,
    ]
    for test in tests:
        test(vectorize)
        print(f"PASS {test.__name__}")


if __name__ == "__main__":
    main()
