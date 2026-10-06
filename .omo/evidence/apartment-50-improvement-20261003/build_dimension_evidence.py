#!/usr/bin/env python3
"""Compute independent printed-dimension probes for baseline and candidate docs.

The source endpoint coordinates are in source JPG pixels.  Vector documents
usually use a 2x analysis canvas, so the physical span is calculated from the
per-axis document/source ratios and ``mmPerPx``.  All output fields state
whether they are millimetres or metres to avoid the old unit ambiguity.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(path: Path):
    return json.loads(path.read_text())


def find_reviews() -> tuple[dict[str, dict], dict[str, str]]:
    by_key: dict[str, dict] = {}
    hashes: dict[str, str] = {}
    for filename in ("visual-review-01-25.json", "visual-review-26-50.json"):
        path = ROOT / filename
        hashes[filename] = hashlib.sha256(path.read_bytes()).hexdigest()
        review = read(path)
        for case in review.get("cases") or review.get("plans") or []:
            by_key[case["key"]] = {
                "case": case,
                "reviewFile": filename,
                "policyUncertaintyPx": (review.get("dimensionAnnotationPolicy") or {}).get("endpointUncertaintyPx"),
                "reviewCoordinateSystem": review.get("coordinateSystem"),
            }
    return by_key, hashes


def annotation_for(meta: dict) -> tuple[dict | None, float | None, bool, str | None]:
    case = meta["case"]
    annotation = case.get("dimensionEvidence") or case.get("printedDimension")
    if not annotation or not annotation.get("endpoints") or annotation.get("value") is None:
        return None, None, False, "missing-annotation"
    uncertainty = annotation.get("endpointUncertaintyPx")
    if uncertainty is None:
        uncertainty = meta.get("policyUncertaintyPx")
    # The second review explicitly marks local dimensions as ineligible.  The
    # first review's clear overall dimensions are eligible by construction.
    scale_probe = annotation.get("scaleProbe") or {}
    if scale_probe.get("gradeEligible") is False:
        return annotation, float(uncertainty or 0), False, str(scale_probe.get("reason") or "reviewer-marked-local-probe")
    if meta["reviewFile"] == "visual-review-01-25.json" and annotation.get("status") != "clear":
        return annotation, float(uncertainty or 0), False, "reviewer-status-not-clear"
    return annotation, float(uncertainty or 0), True, None


def evaluate_doc(doc: dict, meta: dict, source_size: tuple[int, int], doc_label: str) -> dict:
    annotation, endpoint_uncertainty_px, eligible, exclusion = annotation_for(meta)
    result: dict = {
        "model": doc_label,
        "docVersion": doc.get("docVersion"),
        "mmPerPx": doc.get("mmPerPx"),
        "documentImageSize": doc.get("imageSize"),
        "sourceImageSize": list(source_size),
        "eligible": eligible,
        "exclusionReason": exclusion,
        "reviewFile": meta["reviewFile"],
    }
    if annotation:
        result["annotation"] = annotation
    if not eligible:
        return result
    if not isinstance(doc.get("mmPerPx"), (int, float)) or float(doc["mmPerPx"]) <= 0:
        result["eligible"] = False
        result["exclusionReason"] = "missing-or-invalid-mmPerPx"
        return result
    doc_size = doc.get("imageSize") or [0, 0]
    if len(doc_size) != 2 or doc_size[0] <= 0 or doc_size[1] <= 0:
        result["eligible"] = False
        result["exclusionReason"] = "missing-or-invalid-imageSize"
        return result
    (x1, y1), (x2, y2) = annotation["endpoints"]
    dx = float(x2) - float(x1)
    dy = float(y2) - float(y1)
    source_span_px = math.hypot(dx, dy)
    scale_x_mm_per_source_px = float(doc["mmPerPx"]) * float(doc_size[0]) / float(source_size[0])
    scale_y_mm_per_source_px = float(doc["mmPerPx"]) * float(doc_size[1]) / float(source_size[1])
    derived_span_mm = math.hypot(dx * scale_x_mm_per_source_px, dy * scale_y_mm_per_source_px)
    derived_span_m = derived_span_mm / 1000.0
    printed_mm = float(annotation["value"])
    error_mm = derived_span_mm - printed_mm
    abs_error_mm = abs(error_mm)
    relative_error = error_mm / printed_mm if printed_mm else None
    direction_length = source_span_px or 1.0
    ux, uy = dx / direction_length, dy / direction_length
    endpoint_uncertainty_mm = 2.0 * float(endpoint_uncertainty_px or 0.0) * math.hypot(
        ux * scale_x_mm_per_source_px, uy * scale_y_mm_per_source_px
    )
    strict_tolerance_mm = max(50.0, printed_mm * 0.02)
    loose_tolerance_mm = printed_mm * 0.05
    if abs_error_mm <= strict_tolerance_mm:
        classification = "clear-pass"
    elif abs_error_mm <= strict_tolerance_mm + endpoint_uncertainty_mm:
        classification = "uncertain"
    else:
        classification = "clear-fail"
    result.update(
        {
            "sourceSpanPx": source_span_px,
            "sourceAxisSpanPx": {"x": abs(dx), "y": abs(dy)},
            "documentAxisScale": {"x": float(doc_size[0]) / float(source_size[0]), "y": float(doc_size[1]) / float(source_size[1])},
            "scaleMmPerSourcePx": {"x": scale_x_mm_per_source_px, "y": scale_y_mm_per_source_px},
            "printedValueMm": printed_mm,
            "derivedSpanMm": derived_span_mm,
            "derivedSpanM": derived_span_m,
            "errorMm": error_mm,
            "absoluteErrorMm": abs_error_mm,
            "relativeError": relative_error,
            "endpointUncertaintyPx": float(endpoint_uncertainty_px or 0.0),
            "endpointUncertaintyMm": endpoint_uncertainty_mm,
            "strictToleranceMmMax50Or2Pct": strict_tolerance_mm,
            "looseToleranceMm5Pct": loose_tolerance_mm,
            "withinEndpointUncertainty": abs_error_mm <= endpoint_uncertainty_mm,
            "withinStrictTolerance": abs_error_mm <= strict_tolerance_mm,
            "withinStrictPlusEndpointUncertainty": abs_error_mm <= strict_tolerance_mm + endpoint_uncertainty_mm,
            "withinLoose5Pct": abs_error_mm <= loose_tolerance_mm,
            "classificationMax50mmOr2Pct": classification,
            "formula": "sqrt((dx*docW/sourceW*mmPerPx)^2 + (dy*docH/sourceH*mmPerPx)^2), then /1000 for derivedSpanM",
        }
    )
    return result


def aggregate(rows: list[dict]) -> dict:
    eligible = [row for row in rows if row.get("eligible")]
    excluded = [row for row in rows if not row.get("eligible")]
    def mean(key: str):
        values = [float(row[key]) for row in eligible if isinstance(row.get(key), (int, float))]
        return sum(values) / len(values) if values else None
    def median(key: str):
        values = sorted(float(row[key]) for row in eligible if isinstance(row.get(key), (int, float)))
        if not values:
            return None
        middle = len(values) // 2
        return values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2
    def mean_abs_relative_pct():
        values = [abs(float(row["relativeError"])) * 100 for row in eligible if isinstance(row.get("relativeError"), (int, float))]
        return sum(values) / len(values) if values else None
    def pass_count(key: str):
        return sum(1 for row in eligible if row.get(key) is True)
    # There is one printed dimension probe per eligible case in this sample.
    # Keep both names explicit so later multi-probe samples cannot silently
    # collapse the denominator definition.
    probe_stats = {
        "denominator": len(eligible),
        "definition": "one independent printed-dimension endpoint probe per eligible plan",
        "strictMax50mmOr2Pct": {"passed": pass_count("withinStrictTolerance"), "rate": pass_count("withinStrictTolerance") / len(eligible) if eligible else None},
        "strictPlusEndpointUncertainty": {"passed": pass_count("withinStrictPlusEndpointUncertainty"), "rate": pass_count("withinStrictPlusEndpointUncertainty") / len(eligible) if eligible else None},
        "loose5Pct": {"passed": pass_count("withinLoose5Pct"), "rate": pass_count("withinLoose5Pct") / len(eligible) if eligible else None},
    }
    return {
        "caseWeighted": {
            "denominator": len(eligible),
            "excluded": len(excluded),
            "meanAbsoluteErrorMm": mean("absoluteErrorMm"),
            "medianAbsoluteErrorMm": median("absoluteErrorMm"),
            "meanAbsoluteRelativeErrorPct": mean_abs_relative_pct(),
            "strictMax50mmOr2Pct": {"passed": pass_count("withinStrictTolerance"), "rate": pass_count("withinStrictTolerance") / len(eligible) if eligible else None},
            "strictPlusEndpointUncertainty": {"passed": pass_count("withinStrictPlusEndpointUncertainty"), "rate": pass_count("withinStrictPlusEndpointUncertainty") / len(eligible) if eligible else None},
            "loose5Pct": {"passed": pass_count("withinLoose5Pct"), "rate": pass_count("withinLoose5Pct") / len(eligible) if eligible else None},
        },
        "probeWeighted": probe_stats,
        "excludedRows": [{"key": row.get("key"), "reason": row.get("exclusionReason")} for row in excluded],
    }


parser = argparse.ArgumentParser()
parser.add_argument("--candidate", type=Path, help="candidate raw directory")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()

manifest = read(ROOT / "manifest.json")
review_by_key, review_hashes = find_reviews()
baseline_rows: list[dict] = []
candidate_rows: list[dict] = []
for item in manifest["plans"]:
    key = item["key"]
    meta = review_by_key[key]
    source_size = tuple(meta["case"].get("sourceSize") or [0, 0])
    baseline_doc = read(ROOT / key / "vector.json")
    baseline_row = evaluate_doc(baseline_doc, meta, source_size, "baseline-v13")
    baseline_row.update({"ordinal": item["ordinal"], "key": key, "planId": item["planId"], "name": item["name"], "sourceSize": list(source_size)})
    baseline_rows.append(baseline_row)
    if args.candidate:
        candidate_doc = read(args.candidate / f"{item['planId']}.json")
        candidate_row = evaluate_doc(
            candidate_doc,
            meta,
            source_size,
            f"candidate-v{candidate_doc.get('docVersion', '?')}",
        )
        candidate_row.update({"ordinal": item["ordinal"], "key": key, "planId": item["planId"], "name": item["name"], "sourceSize": list(source_size)})
        candidate_rows.append(candidate_row)

output = {
    "schemaVersion": 2,
    "coordinateSystem": "source-image pixels, origin at top-left",
    "reviewFileSha256": review_hashes,
    "baseline": {"rows": baseline_rows, "summary": aggregate(baseline_rows)},
    "notes": [
        "The source annotation is an independent visual-reading probe, not OCR ground truth.",
        "Strict tolerance is max(50 mm, 2% of printed value); uncertainty-aware adds projected endpoint uncertainty.",
        "Loose 5% is reported for comparison only.",
        "Rejected or reviewer-marked local dimensions remain in excludedRows and are not silently scored.",
    ],
}
if args.candidate:
    output["candidate"] = {"rows": candidate_rows, "summary": aggregate(candidate_rows)}
    output["paired"] = []
    base_by_key = {row["key"]: row for row in baseline_rows}
    for row in candidate_rows:
        before = base_by_key[row["key"]]
        output["paired"].append(
            {
                "ordinal": row["ordinal"],
                "key": row["key"],
                "planId": row["planId"],
                "baseline": {k: before.get(k) for k in ("eligible", "exclusionReason", "derivedSpanMm", "printedValueMm", "absoluteErrorMm", "relativeError", "withinStrictTolerance", "withinStrictPlusEndpointUncertainty", "withinLoose5Pct")},
                "candidate": {k: row.get(k) for k in ("eligible", "exclusionReason", "derivedSpanMm", "printedValueMm", "absoluteErrorMm", "relativeError", "withinStrictTolerance", "withinStrictPlusEndpointUncertainty", "withinLoose5Pct")},
                "delta": {
                    "derivedSpanMm": row.get("derivedSpanMm") - before.get("derivedSpanMm") if row.get("derivedSpanMm") is not None and before.get("derivedSpanMm") is not None else None,
                    "absoluteErrorMm": row.get("absoluteErrorMm") - before.get("absoluteErrorMm") if row.get("absoluteErrorMm") is not None and before.get("absoluteErrorMm") is not None else None,
                },
            }
        )

args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"output": str(args.output), "baselineEligible": output["baseline"]["summary"]["caseWeighted"]["denominator"], "candidateEligible": output.get("candidate", {}).get("summary", {}).get("caseWeighted", {}).get("denominator")}))
