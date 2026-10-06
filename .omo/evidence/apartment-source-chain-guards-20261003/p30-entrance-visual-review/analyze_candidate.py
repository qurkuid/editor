#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
SOURCE = REPO / ".omo/evidence/apartment-next-residual-20261003/replay/paired-lane-a-final/p30_3FO3TOWE773J/source.jpg"
RAW = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15/3FO3TOWE773J.json"
OPENING_IDS = ("o2", "o21", "o28")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return str(path.relative_to(REPO))


def distance(a: list[float], b: list[float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


raw: dict[str, Any] = json.loads(RAW.read_text())
openings = {opening["id"]: opening for opening in raw["openings"] if opening["id"] in OPENING_IDS}
assert set(openings) == set(OPENING_IDS)
assert raw["imageSize"] == [2484, 1656]
assert raw["mmPerPx"] == 9.452211127015419

source_scale_mm_per_px = raw["mmPerPx"] * 2


def source_point(point_mm: list[float]) -> list[float]:
    return [point_mm[0] / source_scale_mm_per_px, point_mm[1] / source_scale_mm_per_px]


mapped: dict[str, Any] = {}
for opening_id in OPENING_IDS:
    opening = openings[opening_id]
    a_source = source_point(opening["a"])
    b_source = source_point(opening["b"])
    mapped[opening_id] = {
        "type": opening["type"],
        "src": opening["src"],
        "aMm": opening["a"],
        "bMm": opening["b"],
        "aSourcePx": a_source,
        "bSourcePx": b_source,
        "segmentLengthMm": distance(opening["a"], opening["b"]),
        "segmentLengthSourcePx": distance(a_source, b_source),
        "wallThicknessMm": opening["wallThickness"],
        "radiusMm": opening.get("radius"),
    }
    if "barrierA" in opening:
        mapped[opening_id]["barrierAMm"] = opening["barrierA"]
        mapped[opening_id]["barrierBMm"] = opening["barrierB"]
        mapped[opening_id]["barrierASourcePx"] = source_point(opening["barrierA"])
        mapped[opening_id]["barrierBSourcePx"] = source_point(opening["barrierB"])
        mapped[opening_id]["barrierLengthMm"] = distance(opening["barrierA"], opening["barrierB"])

with Image.open(SOURCE).convert("RGB") as source_image:
    assert source_image.size == (1242, 828)

    def brightness(x: int, y: int) -> float:
        red, green, blue = source_image.getpixel((x, y))
        return (red + green + blue) / 3

    full_gap_row = 229
    full_gap_inside = [brightness(x, full_gap_row) for x in range(536, 605)]
    full_gap_left = [brightness(x, full_gap_row) for x in range(520, 536)]
    full_gap_right = [brightness(x, full_gap_row) for x in range(605, 614)]
    frame_row = 220
    frame_inside = [brightness(x, frame_row) for x in range(539, 574)]
    frame_left = [brightness(x, frame_row) for x in range(526, 538)]
    frame_right = [brightness(x, frame_row) for x in range(575, 605)]

    pixel_evidence = {
        "fullPassage": {
            "rowY": full_gap_row,
            "continuousLightRunInclusiveX": [536, 604],
            "runWidthSourcePx": 69,
            "runWidthAtScaleMm": 69 * source_scale_mm_per_px,
            "insideMeanBrightness": sum(full_gap_inside) / len(full_gap_inside),
            "insideMinimumBrightness": min(full_gap_inside),
            "leftWallMeanBrightness": sum(full_gap_left) / len(full_gap_left),
            "rightWallMeanBrightness": sum(full_gap_right) / len(full_gap_right),
            "insidePixelsBelow180": sum(value < 180 for value in full_gap_inside),
        },
        "leafOrFrame": {
            "rowY": frame_row,
            "brightRunInclusiveX": [539, 573],
            "brightRunWidthSourcePx": 35,
            "outerEdgeApproxInclusiveX": [538, 574],
            "outerWidthSourcePx": 37,
            "outerWidthAtScaleMm": 37 * source_scale_mm_per_px,
            "insideMeanBrightness": sum(frame_inside) / len(frame_inside),
            "leftWallMeanBrightness": sum(frame_left) / len(frame_left),
            "rightWallMeanBrightness": sum(frame_right) / len(frame_right),
        },
    }

    crop_box = (500, 185, 630, 290)
    overlay = source_image.crop(crop_box)
    draw = ImageDraw.Draw(overlay)
    colors = {"o2": (220, 45, 45), "o21": (30, 90, 230), "o28": (20, 160, 55)}
    label_y = {"o2": 5, "o21": 17, "o28": 29}
    for opening_id in OPENING_IDS:
        a = mapped[opening_id]["aSourcePx"]
        b = mapped[opening_id]["bSourcePx"]
        local_a = (a[0] - crop_box[0], a[1] - crop_box[1])
        local_b = (b[0] - crop_box[0], b[1] - crop_box[1])
        draw.line([local_a, local_b], fill=colors[opening_id], width=2)
        draw.ellipse((local_a[0] - 2, local_a[1] - 2, local_a[0] + 2, local_a[1] + 2), fill=colors[opening_id])
        draw.ellipse((local_b[0] - 2, local_b[1] - 2, local_b[0] + 2, local_b[1] + 2), fill=colors[opening_id])
        draw.text((3, label_y[opening_id]), opening_id, fill=colors[opening_id], font=ImageFont.load_default())
    overlay_path = ROOT / "entrance-opening-candidate-overlay-x500-630-y185-290.png"
    overlay.save(overlay_path)
    overlay.resize((1040, 840), Image.Resampling.NEAREST).save(
        ROOT / "entrance-opening-candidate-overlay-x500-630-y185-290-8x.png"
    )

o2 = mapped["o2"]
o21 = mapped["o21"]
o28 = mapped["o28"]
comparison = {
    "o2ToO21": {
        "leftEndpointDistanceSourcePx": distance(o2["aSourcePx"], o21["aSourcePx"]),
        "rightEndpointDistanceSourcePx": distance(o2["bSourcePx"], o21["bSourcePx"]),
        "lengthDifferenceMm": abs(o2["segmentLengthMm"] - o21["segmentLengthMm"]),
        "interpretation": "Same left-half leaf/frame component detected by pair and frame paths.",
    },
    "o21WithinO28": {
        "sharedLeftEdgeDeltaSourcePx": abs(o21["aSourcePx"][0] - o28["aSourcePx"][0]),
        "extraRightwardSpanSourcePx": o28["bSourcePx"][0] - o21["bSourcePx"][0],
        "interpretation": "The 0.691 m component occupies the left part of the 1.2867 m jamb-to-jamb passage; it is not a second adjacent wall interruption.",
    },
}

result = {
    "schemaVersion": "p30-entrance-source-visual-review-v1",
    "scope": "Blind source-image review followed by geometry mapping of candidate15 o2/o21/o28; read-only derived evidence.",
    "inputs": {
        "sourceImage": {"path": rel(SOURCE), "sha256": sha256(SOURCE), "sizePx": [1242, 828]},
        "candidate15": {"path": rel(RAW), "sha256": sha256(RAW)},
        "rawImageSizePx": raw["imageSize"],
        "rawMmPerPx": raw["mmPerPx"],
        "sourceMmPerPx": source_scale_mm_per_px,
    },
    "blindVisualFinding": {
        "observation": "One continuous upper-center exterior-wall interruption is visible between two jambs. A shorter rectangular leaf/frame component occupies its left part. No internal jamb, wall pier, or second independently bounded passage is visible inside the full interruption.",
        "physicalPassageApproxSourcePx": {"leftJambX": [535.5, 537.0], "rightJambX": [604.0, 606.0], "inspectionY": [226, 236]},
        "leafFrameApproxSourcePx": {"leftX": [538, 539], "rightX": [573, 575], "inspectionY": [212, 224]},
        "widthAssessment": {
            "sourceResolutionMmPerPx": source_scale_mm_per_px,
            "physicalOpenPassageVisualM": {"estimate": 1.30, "uncertainty": 0.04},
            "leafOrFrameVisualM": {"estimate": 0.70, "uncertainty": 0.04},
            "interpretation": "The raster resolves one approximately 1.30 m wall gap and one approximately 0.70 m leaf/frame component. It does not independently separate leaf width from frame width within that component.",
        },
    },
    "mappedOpenings": mapped,
    "comparison": comparison,
    "pixelEvidence": pixel_evidence,
    "assessment": {
        "samePhysicalOpening": {
            "finding": True,
            "confidence": "high",
            "probabilityBound": [0.90, 0.97],
            "basis": "o2 and o21 coincide on the same left component; o28 shares its left jamb and extends across the same undivided wall interruption.",
        },
        "full1286_7mmSpanHasIndependentVisibleSupport": {
            "finding": True,
            "confidence": "high",
            "probabilityBound": [0.85, 0.95],
            "basis": "At source row 229, x536..604 is one continuous light run bracketed by darker wall/jamb pixels, matching o28 x536.499..604.562.",
        },
        "frame691mmSpanHasVisibleComponentSupport": {
            "finding": True,
            "confidence": "high",
            "probabilityBound": [0.90, 0.98],
            "basis": "The visible left rectangular leaf/frame has outer edges around x538..574, matching o21 x538.001..574.500 and o2 x537.879..574.146.",
        },
        "frame691mmSpanIsIndependentPhysicalOpening": {
            "finding": False,
            "confidence": "high",
            "probabilityBoundForTrue": [0.03, 0.20],
            "basis": "There is no second jamb pair or intervening wall pier; the full passage remains continuous to x604 and the short detections overlap one component within it.",
        },
    },
    "recommendation": {
        "contract": "Treat o2/o21/o28 as detections of one physical entrance opening. Preserve source-backed leaf/frame evidence as attributes of that opening; do not count the 0.691 m component as a second opening based on labels.",
        "reviewCrop": {"sourcePixelBox": [510, 190, 635, 285], "reason": "Includes both jambs, the full threshold/passage, and the complete shorter leaf/frame rectangle without relying on room labels."},
    },
}

report_path = ROOT / "p30-entrance-source-visual-review.json"
report_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")

markdown = f"""# p30 entrance source visual review

## Blind visual finding

The upper-center entrance shows one continuous exterior-wall interruption between two jambs. A shorter rectangular door-leaf/frame component occupies its left portion. I do not see an internal jamb, wall pier, or independently bounded second passage inside the full opening.

At 18.904 mm per source pixel, the raster supports a physical passage width of approximately 1.30 +/- 0.04 m and a leaf/frame component width of approximately 0.70 +/- 0.04 m. The source does not resolve separate leaf and frame widths inside that shorter component; o2 and o21 are two detections of it.

## Candidate geometry mapped to the 1242 x 828 source

| Record | Detector | Source endpoints | Physical segment | Visual interpretation |
| --- | --- | --- | ---: | --- |
| o2 | pair | ({o2['aSourcePx'][0]:.3f}, {o2['aSourcePx'][1]:.3f}) to ({o2['bSourcePx'][0]:.3f}, {o2['bSourcePx'][1]:.3f}) | {o2['segmentLengthMm']:.3f} mm | Diagonal/lower edge detection of the left leaf/frame component |
| o21 | frame | ({o21['aSourcePx'][0]:.3f}, {o21['aSourcePx'][1]:.3f}) to ({o21['bSourcePx'][0]:.3f}, {o21['bSourcePx'][1]:.3f}) | {o21['segmentLengthMm']:.3f} mm | Same left leaf/frame component |
| o28 | ray | ({o28['aSourcePx'][0]:.3f}, {o28['aSourcePx'][1]:.3f}) to ({o28['bSourcePx'][0]:.3f}, {o28['bSourcePx'][1]:.3f}) | {o28['segmentLengthMm']:.3f} mm | Full jamb-to-jamb wall interruption |

o2 and o21 differ by only {comparison['o2ToO21']['leftEndpointDistanceSourcePx']:.3f} source px at the left endpoint and {comparison['o2ToO21']['rightEndpointDistanceSourcePx']:.3f} px at the right. o28 shares the left edge within {comparison['o21WithinO28']['sharedLeftEdgeDeltaSourcePx']:.3f} px and extends {comparison['o21WithinO28']['extraRightwardSpanSourcePx']:.3f} px farther right.

## Pixel support

- Full passage: source row 229 has a continuous light run x536..604, 69 px wide, with no pixel below brightness 180. Mean brightness is {pixel_evidence['fullPassage']['insideMeanBrightness']:.1f}, versus {pixel_evidence['fullPassage']['leftWallMeanBrightness']:.1f} and {pixel_evidence['fullPassage']['rightWallMeanBrightness']:.1f} in the adjacent wall bands. o28 maps to x536.499..604.562 at y228.502.
- Leaf/frame: source row 220 has a bright run x539..573 with outer edges around x538..574. Its mean brightness is {pixel_evidence['leafOrFrame']['insideMeanBrightness']:.1f}, versus {pixel_evidence['leafOrFrame']['leftWallMeanBrightness']:.1f} and {pixel_evidence['leafOrFrame']['rightWallMeanBrightness']:.1f} beside it. This matches o21/o2, but it is a component inside the full opening.

## Assessment

- Same physical opening: high confidence, 0.90-0.97.
- Independent visible support for the full 1286.7 mm passage: high confidence, 0.85-0.95.
- Visible support for the approximately 691 mm leaf/frame component: high confidence, 0.90-0.98.
- Probability that the 691 mm component is a separate physical opening: 0.03-0.20. No second jamb pair or wall pier is visible.

Treat o2/o21/o28 as detections of one physical entrance opening. Keep the leaf/frame measurement as source evidence attached to that opening; do not count it as another opening from semantic labels. For review use the exact source crop x510..635, y190..285, which includes both jambs, the full passage, and the complete leaf/frame rectangle.

## Evidence identity

- Source image SHA-256: `{sha256(SOURCE)}`
- Candidate15 SHA-256: `{sha256(RAW)}`
- Unannotated focused crop: `entrance-opening-x510-635-y190-285.png`
- Annotated geometry overlay: `entrance-opening-candidate-overlay-x500-630-y185-290.png`
"""
(ROOT / "p30-entrance-source-visual-review.md").write_text(markdown)

print(json.dumps({
    "report": {"path": rel(report_path), "sha256": sha256(report_path)},
    "markdown": {"path": rel(ROOT / "p30-entrance-source-visual-review.md"), "sha256": sha256(ROOT / "p30-entrance-source-visual-review.md")},
    "overlay": {"path": rel(overlay_path), "sha256": sha256(overlay_path)},
}, indent=2))
