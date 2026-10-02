# Door/window classification and source-backed apartment spaces

Planning profile: verified gpt-5.6-sol/high, missing_wall_review. Root approved this bounded contract from the planner's analysis on 2026-09-30. Implementation profile: gpt-5.6-luna/max.

## Current evidence

Source: `.omo/evidence/missing-walls/source-plan.jpg`, 1242 x 828. Current vector: `.omo/evidence/openings-spaces/api-vector-before.json`, docVersion 10. Scene baseline: `.omo/evidence/openings-spaces/scene-before.json`. Browser bedroom selection: `.omo/evidence/openings-spaces/browser-before-bedroom.jpg`.

The vector has 14 openings and 10 rooms. Interior fixtures o1/o3 and balcony swing o8 become windows. r5 combines two left bedrooms and dress areas; r0 includes the small upper-right dress room. Both already leak in initial connected components. The left balcony component (0.71 m²) is absorbed into r9's right balcony (2.07 m²), producing a combined area 2.78 m²; the polygon writer then drops its disconnected smaller contour, leaving only the right balcony geometry. Room OCR greedily picks one label per component and hides the remaining labels. Room sliver absorption crosses barriers other than the morphology wall mask.

## Smallest repair

1. Separate semantic opening classification from source-backed room barriers. Only bounded, source-supported flank/fixture/arc gaps may form barriers. Preserve unclear internal fixtures as `opening`, not guessed glazing. Door requires local swing evidence; exterior/repeated glazing evidence may support window. No blanket interior-window-to-door conversion.
2. Audit source targets (source-image pixels): o1 (590.5,321.6)-(605.5,321.9) and o3 (578,409)-(600.1,409.2) become uncertain openings; o4 entrance/dress fixture and o8 balcony partition (779,589.6)-(779,614) are door candidates requiring measured arc evidence. o6 kitchen/living and o11 dress/bedroom fixtures remain uncertain internal openings when door operation is unsupported. Remove the unhosted o10 false vertical window and detect the horizontal top-dress fixture near y174, x913..958 using source evidence. Recover missing bedroom door/barrier spans near (464,344) and (486,368) with source-symbol support.
3. Keep the entire room barrier in sliver geodesic merges. Components containing room OCR must not be absorbed or dropped solely for area. Multiple distinct labels in one component require source-backed re-splitting; do not choose one label and silently discard the rest. If separation remains unsupported, fail closed with a room diagnostic rather than emit a falsely named combined room. Never use Euclidean Voronoi, label-derived walls, or arbitrary polygon closure.
4. Reuse existing DoorNode, WindowNode/openingKind and ZoneNode schemas. Preserve extraction opening id/type/hinge/radius provenance in node metadata. Keep units, opening host links, and measured width. Change the public importer only when necessary for the output contract.
5. Bump extractor and API docVersion together; preserve existing no-store browser fetches. Update the canonical modeling manual and both exposure tests in the same change. Save a narrow upstream extractor patch; no external deployment or git publication.

## Acceptance and verification

- Write failing-first runnable source-image regressions. Validate 15 independently identified source-space probes: 3 bedrooms, 2 baths, 5 dress rooms, entrance, living, kitchen, and 2 balconies. Each probe belongs to exactly one polygon and distinct physical spaces have distinct zones. All 14 recognized OCR labels map one-to-one by containment; the unlabeled upper-left bedroom remains a color fallback. Do not satisfy this by hardcoded geometry/counts.
- Positive door arcs, uncertain internal opening, exterior glazing and negative floor/grout/blank-symbol fixtures. Validate no overlaps, finite/simple polygons, host relationships, and no room barriers invented from labels.
- Preserve earlier 3 missing-wall spans, old bathroom door, entrance door, genuine kitchen passage, short structural piers, symbol rejection and drift cases. Preserve existing T/X and merge/split behavior.
- Run focused Python/importer/manual tests, editor typecheck, changed-file Biome, related regression tests, and feature-sized production build. Record failures and material unsupported cases rather than mask them.
- Root owns API/browser/scene artifacts; implementation agent must not overwrite them. Root regenerates through visible 231DH UI, reads actual saved graph, checks opening classifications/space probes and unrelated-node preservation, one undo exact baseline, one redo exact result, real 2D/3D and console errors. Leave the useful corrected result visible.

## Ownership

Luna implementation owns configured ignored extractor, route version, importer and relevant tests, manual/exposure tests, and its isolated regression/patch/log artifacts. Preserve every unrelated dirty edit. Root owns integration approval and real-browser proof. If source evidence invalidates the planned separation/classification, return the concrete case to Sol before broadening the architecture.

## Approved source-backed barrier refinement

Sol/high read-only review of source hash 636d952f confirmed semantic classification is still coupled to room connectivity. Preserve independently validated room-gap tuples separately from semantic openings. Compute evidence from the same raw Hough candidates through the relaxed thickness pass; do not export those short candidates as structural walls. Pass deduplicated `(a,b,width)` tuples only into room detection, with no new serialized schema.

Common evidence: physical width 0.4–1.8m, profile contrast at least25, thin coverage at least0.25, wall coverage at most0.30. Local gap separation suffices for a room barrier even when the source frame is gray rather than bright white. Valid fixture-split halves use their independent two-run/hinge/topology proof. A non-separating ray additionally requires bright profile, swing score at least0.8 and clutter at most0.38. These gates apply to the new room-only evidence; they must not globally weaken semantic door classification or delete existing smaller measured openings.

The reviewer validated 15 source components with zero OCR conflicts using these bounded barriers while retaining 51 structural walls. This supersedes promoting short jambs merely to recover room connectivity. Source-supported fixture-split candidates may still produce semantic doors when their separate arc proof passes. Root owns final imported-node hosting and saved-scene verification.
