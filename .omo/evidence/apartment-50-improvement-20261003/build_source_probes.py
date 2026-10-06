#!/usr/bin/env python3
"""Materialize source-supported room, outside-floor, and wall probes.

The reviewer JSON is the authority for source-image coordinates.  This file
keeps those coordinates and their provenance together so the baseline and
candidate floor evaluators can use the same probes without treating semantic
zones as floor truth.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REVIEW_FILES = ("visual-review-01-25.json", "visual-review-26-50.json")


def read(path: Path):
    return json.loads(path.read_text())


def expected_for(kind: str) -> str:
    if kind == "outsideFloor":
        return "outside-floor"
    if kind in {"missingDetectedFloor", "roomMerge"}:
        return "room-interior"
    return "ungraded"


cases: dict[int, dict] = {}
review_hashes: dict[str, str] = {}
for filename in REVIEW_FILES:
    path = ROOT / filename
    review_hashes[filename] = hashlib.sha256(path.read_bytes()).hexdigest()
    review = read(path)
    for case in review.get("cases") or review.get("plans") or []:
        cases[int(case["ordinal"])] = case


room_seeds: list[dict] = []
defect_probes: list[dict] = []
wall_evidence: list[dict] = []
for ordinal, case in sorted(cases.items()):
    key = case["key"]
    source_size = case.get("sourceSize")
    for seed_index, seed in enumerate(case.get("roomProbes") or case.get("roomSeeds") or [], 1):
        xy = seed.get("xy")
        if not xy:
            continue
        room_seeds.append(
            {
                "id": f"{key}-room-{seed_index:02d}",
                "ordinal": ordinal,
                "key": key,
                "kind": "room-interior",
                "expected": seed.get("label") or seed.get("expected") or "room-interior",
                "xy": xy,
                "sourceSize": source_size,
                "source": "visual-review-room-probe",
            }
        )
    overlay = case.get("overlayComparison") or {}
    for defect_index, defect in enumerate(overlay.get("defects") or [], 1):
        kind = str(defect.get("kind") or "")
        expected = expected_for(kind)
        for probe_index, xy in enumerate(defect.get("sourceProbes") or [], 1):
            defect_probes.append(
                {
                    "id": f"{key}-defect-{defect_index:02d}-{probe_index:02d}",
                    "ordinal": ordinal,
                    "key": key,
                    "kind": kind,
                    "expected": expected,
                    "xy": xy,
                    "sourceSize": source_size,
                    "detail": defect.get("detail"),
                    "source": "visual-review-overlay-defect",
                }
            )
        if defect.get("sourceSegment"):
            wall_evidence.append(
                {
                    "id": f"{key}-wall-{defect_index:02d}",
                    "ordinal": ordinal,
                    "key": key,
                    "kind": kind,
                    "sourceSegment": defect["sourceSegment"],
                    "detail": defect.get("detail"),
                    "source": "visual-review-overlay-defect",
                }
            )


structural_probes: list[dict] = []
for filename in REVIEW_FILES:
    review = read(ROOT / filename)
    for candidate_index, candidate in enumerate(review.get("commonStructuralFixCandidates") or [], 1):
        candidate_name = candidate.get("candidate")
        for probe_index, probe in enumerate(candidate.get("sourceProbes") or [], 1):
            ordinal = int(probe["ordinal"])
            case = cases.get(ordinal) or {}
            xy = probe.get("xy")
            if not xy:
                continue
            structural_probes.append(
                {
                    "id": f"{case.get('key', ordinal)}-structural-{candidate_index:02d}-{probe_index:02d}",
                    "ordinal": ordinal,
                    "key": case.get("key"),
                    "kind": "structural",
                    "expected": probe.get("expect") or "ungraded",
                    "xy": xy,
                    "sourceSize": case.get("sourceSize"),
                    "candidate": candidate_name,
                    "source": "visual-review-common-structural-fix",
                }
            )


# These p03 coordinates are preserved from the immutable source review.  The
# flat top and bevel fragments are retained as line evidence; the evaluator
# reports exact nearest distances and does not turn them into a broad pixel
# tolerance.  The p12 wedge probes are the two explicit source-supported
# outside points from the reviewer, not an assertion about every balcony.
immutable_source_evidence = [
    {
        "id": "p03-source-flat-top-and-forbidden-peak",
        "ordinal": 3,
        "key": "p03_3FO3YJE3RM5X",
        "kind": "wall-and-floor-boundary",
        "expected": "straight-span-no-peak",
        "sourceSize": [1242, 828],
        "sourceFlatTop": [[329, 164], [397, 164]],
        "forbiddenPeak": [363, 129],
        "bevelFragments": [
            [[315.01, 177.25], [328.38, 163.87]],
            [[397.99, 164.0], [411.44, 177.45]],
        ],
        "source": "immutable-parent-verified-p03-source-annotation",
        "note": "The source shows a straight media-room top. A peak at [363,129] is outside that source span; nearest-distance output is evidence, not a loose pass/fail tolerance.",
    },
    {
        "id": "p12-source-outside-wedge",
        "ordinal": 12,
        "key": "p12_3FO3YVRRG2Q4",
        "kind": "outside-floor",
        "expected": "outside-floor",
        "sourceSize": [1242, 828],
        "xy": [768, 584],
        "sourceSegment": [[695, 571], [850, 594]],
        "source": "visual-review-overlay-defect",
        "note": "Reviewer identified the lower central balcony wedge beyond the source boundary.",
    },
    {
        "id": "p12-source-outside-wedge-02",
        "ordinal": 12,
        "key": "p12_3FO3YVRRG2Q4",
        "kind": "outside-floor",
        "expected": "outside-floor",
        "sourceSize": [1242, 828],
        "xy": [830, 590],
        "sourceSegment": [[695, 571], [850, 594]],
        "source": "visual-review-overlay-defect",
        "note": "Reviewer identified the lower central balcony wedge beyond the source boundary.",
    },
]

# Deduplicate the explicit defect probes by case/coordinate while retaining
# all structural probes separately for the report.
defect_by_key = {(p["key"], tuple(p["xy"]), p["expected"]): p for p in defect_probes}
for p in immutable_source_evidence[1:]:
    defect_by_key.setdefault((p["key"], tuple(p["xy"]), p["expected"]), p)

result = {
    "schemaVersion": 2,
    "coordinateSystem": "source-image pixels, origin at top-left",
    "reviewFiles": review_hashes,
    "roomSeeds": room_seeds,
    "outsideFloorProbes": [],
    "reviewerDefectOutsideFloorProbes": [p for p in defect_by_key.values() if p.get("expected") == "outside-floor"],
    "defectProbes": list(defect_by_key.values()),
    "structuralProbes": structural_probes,
    "wallEvidence": wall_evidence,
    "immutableSourceEvidence": immutable_source_evidence,
    "notes": [
        "Room and outside probes come from blind source-image review annotations.",
        "Actual floor checks use slabPlan.create polygons; imported semantic zones are not substituted.",
        "Outside-floor counts are limited to explicit probes and must not be generalized to unprobed source regions.",
        "p03 nearest-wall distance is reported against the forbidden source point/straight span without a broad stroke tolerance.",
    ],
}
outside_by_key: dict[tuple, dict] = {}
for probe in result["reviewerDefectOutsideFloorProbes"] + [p for p in structural_probes if p.get("expected") == "outside-floor"]:
    outside_by_key[(probe.get("key"), tuple(probe.get("xy") or []), probe.get("expected"))] = probe
result["outsideFloorProbes"] = list(outside_by_key.values())
(ROOT / "source-probes.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(
    json.dumps(
        {
            "roomSeeds": len(room_seeds),
            "defectProbes": len(result["defectProbes"]),
            "outsideFloorProbes": len(result["outsideFloorProbes"]),
            "structuralProbes": len(structural_probes),
            "wallEvidence": len(wall_evidence),
        },
        ensure_ascii=False,
    )
)
