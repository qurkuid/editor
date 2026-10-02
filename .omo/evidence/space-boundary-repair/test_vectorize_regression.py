#!/usr/bin/env python3
"""Focused source-boundary and room-label regression for the 231DH plan."""

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
    hough = cv2.HoughLinesP

    def compatible_hough(*args, **kwargs):
        lines = hough(*args, **kwargs)
        if lines is not None and lines.ndim == 2:
            lines = lines[:, None, :]
        return lines

    cv2.HoughLinesP = compatible_hough
    spec = importlib.util.spec_from_file_location("boundary_vectorizer", VECTORIZE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    fixture = json.loads(OCR.read_text())
    crop_fixture = json.loads(
        (
            ROOT
            / ".omo/evidence/space-boundary-repair/ocr/upper-left-bedroom-2x.ocr.json"
        ).read_text()
    )

    def fake_run_ocr(image, _cache):
        # The real crop proof is the only source for the third bedroom label.
        # Keep the legacy whole-image fixture for scale/known labels and make
        # every other crop fail closed so a global OCR cache cannot fabricate
        # room names in unrelated polygons.
        if "-room-6-" in Path(image).name:
            return crop_fixture
        if "-room-" in Path(image).name:
            return []
        return fixture

    module.run_ocr = fake_run_ocr
    return module


def point_segment_distance(point, start, end):
    direction = end - start
    length_sq = float(np.dot(direction, direction))
    if length_sq <= 1e-9:
        return float(np.linalg.norm(point - start))
    fraction = float(np.dot(point - start, direction) / length_sq)
    fraction = min(1.0, max(0.0, fraction))
    return float(np.linalg.norm(point - (start + fraction * direction)))


def assert_source_spans(vectorizer, analysis):
    boundaries = [
        ("central-upper-diagonal", (532.0, 323.0), (548.0, 340.0)),
        ("central-upper-flank", (548.0, 340.0), (548.0, 350.0)),
        ("central-lower-flank", (548.0, 382.0), (548.0, 409.0)),
        ("left-bedroom-diagonal-jamb", (445.0, 323.0), (462.0, 340.0)),
        ("left-bedroom-retained-jamb", (459.0, 309.0), (445.0, 323.0)),
        ("top-dress-left-side", (913.0, 147.0), (913.0, 174.5)),
        ("top-dress-right-side", (960.0, 147.0), (960.0, 174.5)),
    ]
    for name, start, end in boundaries:
        start = np.asarray(start, dtype=float) * vectorizer.UP
        end = np.asarray(end, dtype=float) * vectorizer.UP
        samples = []
        for fraction in np.linspace(0.0, 1.0, 9):
            point = start + fraction * (end - start)
            samples.append(min(
                point_segment_distance(point, seg.p1, seg.p2)
                for seg in analysis["segs"]
            ))
        max_m = max(samples) * float(analysis["scale"]) / 1000.0
        assert max_m <= 0.13, f"{name}: max centerline error {max_m:.3f}m"

    aperture_start = np.asarray((548.0, 350.0), dtype=float) * vectorizer.UP
    aperture_end = np.asarray((548.0, 382.0), dtype=float) * vectorizer.UP
    recovered = [
        opening
        for opening in analysis["openings"]
        if opening.kind == "opening"
        and getattr(opening, "recovered_fixture", False)
    ]
    assert recovered, "central bright capsule must remain a semantic opening"
    assert min(
        max(
            point_segment_distance(point, opening.a, opening.b)
            for point in (aperture_start, aperture_end)
        )
        for opening in recovered
    ) <= 10.0 * vectorizer.UP, "central aperture is not covered"


def run():
    vectorizer = load_vectorizer()
    analysis = vectorizer.analyze(str(IMAGE), ocr_dir="/tmp/space-boundary-regression-ocr")
    print("metrics", json.dumps(analysis["metrics"], ensure_ascii=False, sort_keys=True))
    assert analysis["metrics"]["rooms"] == 15, analysis["metrics"]
    assert analysis["metrics"]["doors"] == 9, analysis["metrics"]
    assert analysis["metrics"]["windows"] == 3, analysis["metrics"]
    assert analysis["metrics"]["openings"] == 5, analysis["metrics"]
    bedroom_names = [
        room["label"] for room in analysis["rooms"] if room["cls"] == "bedroom"
    ]
    assert bedroom_names.count("안방") == 3, bedroom_names
    assert any(item.get("accepted") and item.get("label") == "안방"
               for item in analysis.get("room_retry", [])), analysis.get("room_retry")
    assert_source_spans(vectorizer, analysis)

    # A blank source-gray lane cannot authorize a wall chain, even when the
    # ordinary wall graph and semantic spans are present.
    blank_masks = dict(analysis["masks"])
    blank_masks["wall_raw"] = np.zeros_like(analysis["masks"]["wall_raw"])
    recovered, apertures = vectorizer.recover_source_boundary_segments(
        blank_masks, [], [], semantic_spans=[], scale=analysis["scale"]
    )
    assert not recovered and not apertures
    print("PASS boundaries=7 samples=63 bedrooms=3 openings=17 crop=1 negative=1")


if __name__ == "__main__":
    run()
