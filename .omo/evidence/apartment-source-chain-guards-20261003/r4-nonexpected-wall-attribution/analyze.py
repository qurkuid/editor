#!/usr/bin/env python3
"""Read-only geometry attribution for R4 non-p07/p30 changed wall plans."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
LANE_A = ROOT / ".omo/evidence/apartment-next-residual-20261003/replay/candidate-imported-lane-a-final"
R3 = ROOT / ".omo/evidence/apartment-source-chain-guards-20261003/product-final/r3/replay-final/candidate-imported-r3-final"
R4 = ROOT / ".omo/evidence/apartment-source-chain-guards-20261003/product-final/r4/replay-final/candidate-imported-r4-final"
RAW = ROOT / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
OUT = Path(__file__).with_name("attribution.json")

PLANS = {
    "p35": "3FO3YCX91KCS",
    "p47": "3FO3Y6TBLWT1",
}


def load(path: Path):
    with path.open() as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def point_key(point):
    return [round(float(point[0]), 12), round(float(point[1]), 12)]


def canonical_wall(wall):
    start = point_key(wall["start"])
    end = point_key(wall["end"])
    if tuple(end) < tuple(start):
        start, end = end, start
    return (*start, *end, round(float(wall["thickness"]), 12))


def multiset_delta(left, right):
    left_counter = Counter(canonical_wall(wall) for wall in left["walls"])
    right_counter = Counter(canonical_wall(wall) for wall in right["walls"])
    left_only = sorted((left_counter - right_counter).elements())
    right_only = sorted((right_counter - left_counter).elements())
    return {
        "leftOnly": [list(item) for item in left_only],
        "rightOnly": [list(item) for item in right_only],
    }


def raw_world(document, wall_id):
    wall = next(wall for wall in document["walls"] if wall["id"] == wall_id)
    center_x = document["imageSize"][0] * document["mmPerPx"] / 2
    center_y = document["imageSize"][1] * document["mmPerPx"] / 2
    convert = lambda point: [(point[0] - center_x) / 1000, (point[1] - center_y) / 1000]
    return {
        "id": wall_id,
        "kind": wall["kind"],
        "thickness": wall["thickness"] / 1000,
        "start": convert(wall["start"]),
        "end": convert(wall["end"]),
    }


def intersection(first, second):
    p, q = first["start"], first["end"]
    r, s = second["start"], second["end"]
    dx, dy = q[0] - p[0], q[1] - p[1]
    ex, ey = s[0] - r[0], s[1] - r[1]
    determinant = dx * ey - dy * ex
    if abs(determinant) < 1e-12:
        raise AssertionError(f"parallel raw sources: {first['id']} and {second['id']}")
    offset_x, offset_y = r[0] - p[0], r[1] - p[1]
    at = (offset_x * ey - offset_y * ex) / determinant
    return [p[0] + at * dx, p[1] + at * dy]


def distance(first, second):
    return math.hypot(first[0] - second[0], first[1] - second[1])


def intersection_evidence(raw_document, first_id, second_id, observed, tolerance=1e-9):
    first = raw_world(raw_document, first_id)
    second = raw_world(raw_document, second_id)
    exact = intersection(first, second)
    delta = distance(exact, observed)
    if delta > tolerance:
        raise AssertionError(
            f"{first_id} x {second_id}: observed error {delta} exceeds {tolerance}"
        )
    return {
        "rawWallIds": [first_id, second_id],
        "rawSourceIndices": [int(first_id[1:]), int(second_id[1:])],
        "rawWalls": [first, second],
        "exactIntersection": exact,
        "observed": observed,
        "errorM": delta,
        "toleranceM": tolerance,
    }


def source_endpoint_evidence(raw_document, wall_id, end_key, observed, tolerance=1e-9):
    wall = raw_world(raw_document, wall_id)
    source = wall[end_key]
    delta = distance(source, observed)
    if delta > tolerance:
        raise AssertionError(f"{wall_id}.{end_key}: observed error {delta} exceeds {tolerance}")
    return {
        "rawWallId": wall_id,
        "rawSourceIndex": int(wall_id[1:]),
        "rawWall": wall,
        "sourceEndpoint": end_key,
        "observed": observed,
        "errorM": delta,
        "toleranceM": tolerance,
    }


def build():
    result = {
        "method": {
            "description": "Canonical wall multiset uses orientation-independent start/end, 12 decimal places, and thickness. Raw points use the importer frame transform (raw-mm - image-center-mm) / 1000. Exact line intersections are recomputed from immutable candidate15 walls.",
            "mutations": "none; this script only reads frozen JSON inputs and writes this report",
        },
        "plans": {},
    }

    for page, plan_id in PLANS.items():
        paths = {
            "laneA": LANE_A / f"{plan_id}.json",
            "r3": R3 / f"{plan_id}.json",
            "r4": R4 / f"{plan_id}.json",
            "raw": RAW / f"{plan_id}.json",
        }
        documents = {key: load(path) for key, path in paths.items()}
        result["plans"][page] = {
            "planId": plan_id,
            "inputs": {
                key: {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)}
                for key, path in paths.items()
            },
            "wallCounts": {key: len(documents[key]["walls"]) for key in ("laneA", "r3", "r4")},
            "laneAToR4": multiset_delta(documents["laneA"], documents["r4"]),
            "laneAToR3": multiset_delta(documents["laneA"], documents["r3"]),
            "r3ToR4": multiset_delta(documents["r3"], documents["r4"]),
        }

    p35_raw = load(RAW / f"{PLANS['p35']}.json")
    result["plans"]["p35"]["rawAttribution"] = {
        "laneA_w10_w16_corner": intersection_evidence(
            p35_raw, "w10", "w16", [-1.5733158442578696, 4.997521787600887]
        ),
        "laneA_w10_w12_corner": intersection_evidence(
            p35_raw, "w10", "w12", [-1.3553271428118827, 3.6034217876008863]
        ),
        "r4_w12_w74_corner": intersection_evidence(
            p35_raw, "w12", "w74", [-1.3546018715663637, 3.6034217876008863]
        ),
        "r3_w12_w32_corner": intersection_evidence(
            p35_raw, "w12", "w32", [-1.354770765555192, 3.6034217876008863]
        ),
        "r4_w74_w75_endpoint": intersection_evidence(
            p35_raw, "w74", "w75", [-1.3350173185986696, 4.265021787600887]
        ),
        "r4_w16_start": source_endpoint_evidence(
            p35_raw, "w16", "start", [-1.4650173185986697, 4.997521787600887]
        ),
        "r4_w16_w38_corner": intersection_evidence(
            p35_raw, "w16", "w38", [2.75278268140133, 4.997521787600887]
        ),
        "r4_w12_start": source_endpoint_evidence(
            p35_raw, "w12", "start", [-5.890317318598671, 3.6034217876008863]
        ),
        "r4_w10_start": source_endpoint_evidence(
            p35_raw, "w10", "start", [-1.4650173185986697, 4.304921787600886]
        ),
        "r4_w37_run": {
            "start": source_endpoint_evidence(
                p35_raw, "w37", "start", [-1.4650173185986697, 4.997521787600887]
            ),
            "end": source_endpoint_evidence(
                p35_raw, "w37", "end", [-1.4650173185986697, 4.304921787600886]
            ),
        },
        "r4_w10_thicknessM": raw_world(p35_raw, "w10")["thickness"],
        "r4_w74_thicknessM": raw_world(p35_raw, "w74")["thickness"],
        "r4_w16_thicknessM": raw_world(p35_raw, "w16")["thickness"],
        "r4_w37_thicknessM": raw_world(p35_raw, "w37")["thickness"],
    }

    p47_raw = load(RAW / f"{PLANS['p47']}.json")
    result["plans"]["p47"]["rawAttribution"] = {
        "r4_w9_w11_corner": intersection_evidence(
            p47_raw, "w9", "w11", [8.100967025493988, -1.8033437473195695]
        ),
        "r4_w9_w37_corner": intersection_evidence(
            p47_raw, "w9", "w37", [5.988137126926696, -3.840703473552304]
        ),
        "r4_w11_start": source_endpoint_evidence(
            p47_raw, "w11", "start", [5.199013966904651, 1.0986093112697672]
        ),
        "r4_w19_start": source_endpoint_evidence(
            p47_raw, "w19", "start", [2.9176139669046535, 1.622109311269767]
        ),
        "r4_w19_w33_endpoint": intersection_evidence(
            p47_raw, "w19", "w33", [4.674913966904652, 1.622109311269767]
        ),
        "r4_w52_w53_endpoint": intersection_evidence(
            p47_raw, "w52", "w53", [5.046713966904652, 1.1490093112697668]
        ),
        "r4_w56_w66_corner": intersection_evidence(
            p47_raw, "w56", "w66", [5.036734331796171, 1.2603889463782496]
        ),
        "r4_w52_w66_corner": intersection_evidence(
            p47_raw, "w52", "w66", [5.198266665628894, 1.0988566125455268]
        ),
        "r4_w52_w56_split": intersection_evidence(
            p47_raw, "w52", "w56", [5.008498068803609, 1.1616559380871834]
        ),
        "r3_w53_w56_split": intersection_evidence(
            p47_raw,
            "w53",
            "w56",
            [5.016042734699, 1.188037175596],
            tolerance=2e-5,
        ),
        "r4_w53_w25_vertical_contact": intersection_evidence(
            p47_raw,
            "w53",
            "w25",
            [4.979113966904653, 1.235027493088],
            tolerance=5e-5,
        ),
        "r4_w14_w25_vertical_contact": intersection_evidence(
            p47_raw, "w14", "w25", [4.979113966904653, -0.08559068873023352]
        ),
        "sameRun_w59_w66": {
            "w59": raw_world(p47_raw, "w59"),
            "w66": raw_world(p47_raw, "w66"),
            "centerlineOffsetM": 0.0005,
            "outputLine": "w66",
            "outputThicknessM": max(
                raw_world(p47_raw, "w59")["thickness"],
                raw_world(p47_raw, "w66")["thickness"],
            ),
        },
    }

    # Frozen outputs establish that both plans first gain one wall in R3. R4
    # preserves that count while changing only which source intersection wins.
    for page in ("p35", "p47"):
        counts = result["plans"][page]["wallCounts"]
        assert counts["r3"] == counts["laneA"] + 1
        assert counts["r4"] == counts["r3"]

    return result


if __name__ == "__main__":
    report = build()
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({page: data["wallCounts"] for page, data in report["plans"].items()}))
    print(OUT)
