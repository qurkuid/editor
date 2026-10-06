# Apartment next residual improvement — approved Sol contract

Resolved planning route: gpt-5.6-sol / high. Sol approved Lane A on 2026-10-03; parent saved the returned contract. Lane B needs source-backed evidence before any product mutation.

## Baseline and ownership

Current frozen core is eba42adc. The previous 50-document replay imported 44, rejected 6, passed 298/330 floor probes, and had zero exact stored Slab/Ceiling overlap pairs. Current source and all raw V15 input hashes are frozen in `.omo/evidence/apartment-next-residual-20261003/baseline-manifest.json`. Preserve all previous evidence, dirty work, and the user-managed port 3002. Keep the previous 3008 deliverable available; use an isolated production build and owned QA database on 3009 for this pass.

The six rejected cases p13/p17/p34/p36/p44/p49 all have vectorization success but `unit: px` and `mmPerPx: null`. They fail at the importer calibration guard. Past p13/p17 automatic scales differed from printed dimensions by approximately -39%/+90%; do not relax automatic calibration or infer scale from a bounding box, area, or a single automatic OCR interval.

Implementation owner: installed luna-max, resolved gpt-5.6-luna / max. Source scope: `apps/editor/lib/apt-vector-scene.ts` and tests, `apps/editor/components/apt-search-panel.tsx`, canonical modeling manual and its existing contract tests. No dependency additions. Other file edits require an evidence-backed boundary handoff to parent.

## Lane A — implement explicit calibrated-guide recovery

Add a pure normalization helper in apt-vector-scene. A valid existing `mm` document with finite positive mmPerPx returns the same object and keeps its existing route unchanged. Only `px` plus null mmPerPx is eligible for recovery. Reject `mm/null` and ambiguous `px/non-null` combinations.

Recovery requires the existing Guide to belong to the same level/apartmentId/planId and a synchronized explicit scaleReference. Strict identity is required for this new path; do not alter legacy plan-only matching for other paths. Guide transformation must pass the existing planar transform validator. A numeric guide.scale alone is insufficient.

Every reference coordinate and numeric field must be finite, and realLengthMeters, measuredLengthUnits, metersPerUnit, guide.scale and image dimensions must be positive. Within a documented small numerical tolerance, require:

- distance(start,end) equals measuredLengthUnits;
- realLengthMeters / measuredLengthUnits equals metersPerUnit;
- realLengthMeters equals measuredLengthUnits;
- metersPerUnit equals 1.

The last two checks reject references made stale by subsequent arbitrary resizing. Invalid references must leave the graph unchanged and explain that the user should set the scale again.

Compute `mmPerPx = guide.scale * 10000 / imageWidth`. Clone the pixel document, converting every source length field to mm: wall start/end/thickness; opening a/b/wallThickness and optional hinge/radius/barrierA/barrierB/barrierThickness; room polygon. Set unit to mm and calculated mmPerPx. Keep source IDs, names, classes, areaM2 and metrics unchanged. Never rewrite the raw document or vector cache.

Use the existing guide import frame. Derived guideScale equals guide.scale, so the downstream frame scale ratio equals one; position, yaw and flips apply once. Do not double-scale.

In the apartment search panel, call this helper only for a strict same-plan guide. If absent, explain `현재 씬에 깔기 → 밑그림 선택 → Set Scale → 자동 모델링 재시도`. If an existing guide is uncalibrated or stale, select it and provide the same actionable guidance. Keep unrelated vector/runtime/quality failures distinct from missing calibration. Recovered nodes alone carry scaleSource `guide-reference` and the calculated calibration provenance.

Sol/high draft review refinement: prefer the current selectedReferenceId only when it strictly matches level/apartment/plan. Otherwise use an exact guide only when there is exactly one match. Multiple exact guides without an explicit matching selection fail with a select-guide-and-retry message. If no exact guide exists, do not select a legacy plan-only guide for calibration; explain that the current plan guide must be added. Preserve baseline general metadata tagging for valid-mm outputs; add calibration provenance only to recovered outputs and preserve auto surface lifecycle metadata.

Keep the existing one-step auto-model transaction. Manual calibration and auto-modeling are separate gestures: import Undo returns the calibrated guide-only graph, and Redo restores the same full IDs. Save and reload preserve both calibration and generated geometry.

Update the shared modeling manual once: automatic calibration still requires two independent centered dimension intervals; explicit synchronized same-guide Set Scale can supply physical calibration for a pixel document. Update manual exposure tests without duplicating the manual.

## Required verification

Fail-first tests cover exact conversion of every required/optional length, raw-input immutability, no double scale, ID/name/class/area/metrics preservation, valid mm object passthrough, and calibration provenance. Negative controls cover reference absence, legacy plan-only or wrong identity/level, NaN/Infinity, inconsistent or stale reference, arbitrary guide resize, ambiguous units, and invalid transforms.

Rerun the same 50 raw documents with no fabricated calibration: automatic counts stay separately reported. Existing 44 outputs preserve geometry/metadata/IDs where deterministic; per-case floor probe loss must be zero and exact surface overlap must remain zero. Manual recovery is a separate metric and must not be advertised as 50/50 automatic recognition.

Run focused tests, appropriate package compiles, app/editor types, changed-file Biome/diff/static checks, relevant integration regressions, and a production build. Preserve build-input files exactly. Bind all evidence to final source hashes and BUILD_ID.

Actual browser representative: new isolated p13 fixture (복현서한타운2차 78㎡), raw source `.omo/evidence/apartment-50-improvement-20261003/p13_3FO40LLCKMND/source.jpg`. Its left printed overall dimension is 6760 mm. Use the existing visible Set Scale tool on those actual dimension endpoints, enter 6760 mm, then retry auto-modeling. Verify resulting physical dimension/guide alignment, closed-space versus semantic-review zone counts, 2D/3D visibility, atomic Undo/Redo, autosave/reload, current read-only console errors and actual screenshots. No API/DB scene mutation substitutes for the UI gate.

## Lane B — diagnostic only until a source-backed cause is proven

The remaining 32 missed floor probes need classification against the current 298/330 baseline. Dropped 95–105 mm segments violate the existing 120 mm minimum; their existence alone does not prove the missing-room cause. Do not lower minimum length, broaden closure tolerance, synthesize a wall/floor from semantic room polygons, or automatically close a door passage.

Classify each miss: Space exists but stored Slab misses it; source-visible physical boundary/junction agrees with an open diagnostic; semantic subdivision/open passage has no physical closure; or the original annotation itself is invalid. Annotation corrections are separate and do not count as product improvements. Before an automatic topology fix, require a common source-backed cause, a failing focused fixture, and passage/parallel/door negative controls. The existing p03/p07 2D diagnostics and safe quick repair remain the available direct path; unsupported gaps remain review-only.

## Stop condition and reporting

Lane A is complete when pure gates and actual p13 manual calibration/import/history/reload/visibility pass and the unchanged 50-input replay shows no losses. Report actual manual-recovery coverage separately, unchanged automatic counts, the remaining 32 probe limitations, and any unverified runtime path. No commit, push or deployment is requested.
