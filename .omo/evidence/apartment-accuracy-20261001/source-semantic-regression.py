#!/usr/bin/env python3
"""Source-backed 231DH regression for opening semantics and room spaces.

The image and OCR fixture are inputs; the assertions deliberately inspect
source-space probes and polygon containment instead of accepting node counts
as proof of a correct extraction.
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_IMAGE = ROOT / ".omo/evidence/missing-walls/source-plan.jpg"
# Keep the complete OCR cache for this source image.  The label-only fixture
# is useful for room-owner checks, but omitting the dimension labels makes the
# extractor run in its unscaled fallback and hides measured-width regressions.
OCR_FIXTURE = ROOT / ".omx/recovery-20260929/data/.build/ocr-cache/apt-vector-3FO40HSDCOM4.json"
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
    spec = importlib.util.spec_from_file_location("opening_vectorizer", VECTORIZE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    fixture = json.loads(OCR_FIXTURE.read_text())
    module.run_ocr = lambda _image, _cache: fixture
    return module


def source_point(point):
    return np.asarray(point, dtype=float) * UP


def source_opening(opening):
    return (np.asarray(opening.a, dtype=float) / UP,
            np.asarray(opening.b, dtype=float) / UP)


def nearest_opening(openings, point, radius=10.0):
    point = np.asarray(point, dtype=float)

    def point_segment_distance(start, end):
        direction = end - start
        length_sq = float(np.dot(direction, direction))
        if length_sq <= 1e-9:
            return float(np.linalg.norm(start - point))
        fraction = float(np.dot(point - start, direction) / length_sq)
        fraction = min(1.0, max(0.0, fraction))
        return float(np.linalg.norm(start + fraction * direction - point))

    ranked = sorted(
        (
            point_segment_distance(a, b),
            opening,
        )
        for opening in openings
        for a, b in [source_opening(opening)]
    )
    if not ranked or ranked[0][0] > radius:
        return None
    return ranked[0][1]


def label_room_owners(vectorizer, analysis):
    owners = {}
    for item in analysis["ocr"]:
        text = item["text"].strip()
        if not any(word in text for words in vectorizer.ROOM_WORDS.values() for word in words):
            continue
        point = (item["x"] + item["w"] / 2, item["y"] + item["h"] / 2)
        matches = []
        for index, room in enumerate(analysis["rooms"]):
            distance = cv2.pointPolygonTest(room["poly"].astype(np.float32), point, True)
            if distance >= -3 * UP:
                matches.append(index)
        owners[text + f"@{round(point[0] / UP, 1)}"] = matches
    return owners


def assert_simple_polygons(analysis):
    for room in analysis["rooms"]:
        poly = np.asarray(room["poly"], dtype=float)
        assert len(poly) >= 3, "room polygon has fewer than three vertices"
        assert np.isfinite(poly).all(), "room polygon contains non-finite coordinates"
        area = 0.5 * abs(float(np.sum(poly[:, 0] * np.roll(poly[:, 1], -1)
                                     - np.roll(poly[:, 0], -1) * poly[:, 1])))
        assert area > 100 * UP * UP, "room polygon collapsed"


def assert_source_negative_cases(vectorizer, analysis):
    masks = analysis["masks"]
    shape = masks["wall"].shape
    flat = {key: value.copy() for key, value in masks.items()}
    flat["wall"][:] = 0
    flat["thin"][:] = 0
    flat["outside"][:] = 0
    flat["sil"][:] = 1
    flat["white"][:] = 0
    flat["v"][:] = 220
    # A straight grout-like stroke on flat floor is not a door swing.
    flat["stroke"][:] = 0
    cv2.line(flat["stroke"], (40, 120), (180, 120), 1, 2)
    rejected = vectorizer.classify_openings(
        [(np.array([60, 120.0]), np.array([150, 120.0]), 8.0, "pair")],
        flat,
        [],
        scale=None,
        entrance_pts=[],
    )
    assert not rejected, "flat grout line became an opening"

    # A blank bright symbol has no wall flank or separating barrier.
    flat["v"][:] = 255
    blank = vectorizer.classify_openings(
        [(np.array([60, 80.0]), np.array([100, 80.0]), 8.0, "ray")],
        flat,
        [],
        scale=None,
        entrance_pts=[],
    )
    assert not blank, "unhosted blank symbol became an opening"

    # A bright, featureless strip must not satisfy the low-score fixture door
    # branch.  The capsule gate requires measured ridge contrast in addition
    # to a bright run.
    white_capsule = np.full((64, 180), 255, dtype=np.uint8)
    assert not vectorizer._bright_parallel_capsule(
        white_capsule, np.array([20.0, 32.0]), np.array([160.0, 32.0]), 8.0
    ), "all-white capsule became fixture evidence"


def run(image: Path):
    vectorizer = load_vectorizer()
    analysis = vectorizer.analyze(str(image), ocr_dir=str(Path("/tmp/openings-regression-ocr")))
    metrics = analysis["metrics"]
    print("metrics", json.dumps(metrics, ensure_ascii=False, sort_keys=True))

    assert_source_negative_cases(vectorizer, analysis)
    assert_simple_polygons(analysis)

    owners = label_room_owners(vectorizer, analysis)
    assert len(owners) == 14, f"expected 14 recognized room labels, got {len(owners)}"
    assert all(len(matches) == 1 for matches in owners.values()), owners
    assert len({matches[0] for matches in owners.values()}) == len(owners), owners

    # Fourteen OCR labels plus the deliberately unlabeled upper-left bedroom.
    probes = [
        ("bedroom-unlabeled", (380.0, 370.0)),
        ("bedroom-labeled-upper-right", (857.0, 290.0)),
        ("bedroom-labeled-lower-left", (471.0, 452.0)),
        ("bath-upper-right", (712.0, 224.0)),
        ("bath-left", (477.0, 244.0)),
        ("dress-top-right", (935.0, 158.0)),
        ("dress-left-upper", (530.0, 272.0)),
        ("dress-left-middle", (505.0, 340.0)),
        ("dress-right-middle", (699.0, 340.0)),
        ("dress-entrance-side", (585.0, 360.0)),
        ("entrance", (594.0, 265.0)),
        ("living", (784.0, 485.0)),
        ("kitchen", (585.0, 553.0)),
        ("balcony-left", (752.0, 608.0)),
        ("balcony-right", (845.0, 608.0)),
    ]
    probe_owners = []
    for name, point in probes:
        matches = [
            index
            for index, room in enumerate(analysis["rooms"])
            if cv2.pointPolygonTest(room["poly"].astype(np.float32), source_point(point), True) >= -3 * UP
        ]
        assert len(matches) == 1, (name, point, matches)
        probe_owners.append(matches[0])
    assert len(set(probe_owners)) == len(probes), probe_owners

    def expect_opening(point, kind):
        opening = nearest_opening(analysis["openings"], point)
        assert opening is not None, f"missing {kind} near {point}"
        assert opening.kind == kind, (point, opening.kind, kind)
        return opening

    expect_opening((591.0, 221.0), "door")  # entrance
    top_dress = expect_opening((936.0, 174.0), "door")
    assert top_dress.barrier_a is not None and top_dress.barrier_b is not None
    barrier_a = np.asarray(top_dress.barrier_a, dtype=float) / UP
    barrier_b = np.asarray(top_dress.barrier_b, dtype=float) / UP
    assert min(np.linalg.norm(barrier_a - (906.0, 174.5)),
               np.linalg.norm(barrier_b - (906.0, 174.5))) <= 6.0
    assert min(np.linalg.norm(barrier_a - (960.0, 174.5)),
               np.linalg.norm(barrier_b - (960.0, 174.5))) <= 6.0
    expect_opening((779.0, 602.0), "door")  # balcony partition
    expect_opening((471.7, 294.4), "door")  # old left-bath door
    expect_opening((470.0, 349.0), "door")  # recovered bedroom swing
    expect_opening((500.0, 379.0), "door")  # recovered bedroom swing
    for point in ((598.0, 322.0), (589.0, 409.0), (674.0, 535.0), (774.0, 312.0)):
        expect_opening(point, "opening")
    expect_opening((844.0, 584.6), "window")  # living/balcony glazing rails
    assert nearest_opening(analysis["openings"], (650.0, 322.0), radius=10.0) is None
    for point in ((960.0, 157.0),):
        assert nearest_opening(analysis["openings"], point, radius=8.0) is None

    print("PASS source probes=15 labels=14 openings=%d rooms=%d" % (
        len(analysis["openings"]), len(analysis["rooms"])))


if __name__ == "__main__":
    run(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IMAGE)
