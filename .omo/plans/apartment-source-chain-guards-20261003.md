# Apartment source chain guards — approved Sol contract

Planning route: gpt-5.6-sol / high. Status: approved separate Lane B pass; implementation waits until calibrated-guide Lane A has a frozen source and completed replay. Never mutate files concurrently with the Lane A owner. Preserve all previous evidence and user-managed 3002/3008 runtimes.

## Proven source failures

p07 current 298/330 baseline misses four probes. The upper boundary is an exact raw endpoint chain w2 → w24 → w20 with different thicknesses and slight direction changes, not exact collinearity. Same-run gap merge connects the two outer members across retained w24 while leaving the thinner member separate, producing contained physical wall overlap. The right boundary has exact cap/flank contacts w21 → w26 and w27 → w13 around window o5. After the window host union, near-parallel endpoint snapping extends the thin host to the far endpoints of already touching caps, producing 503.9/534.7 mm overlap.

Do not hide authored walls only from the derived detection graph. Fix import normalization so emitted physical geometry itself is correct. Do not use dropped w37/w39 as emitted contributors; those raw fragments fail the existing 120 mm minimum.

## Smallest implementation

Owner: installed luna-max, confirmed gpt-5.6-luna / max. Scope: apps/editor/lib/apt-vector-scene.ts and its tests, canonical modeling manual and existing exposure tests. No core rewrite, raster/input/annotation changes, dependency additions or reactive saved-scene mutation.

1. Before same-run gap union, reject directly bridging two outer segments when a retained source segment exactly connects the proposed gap endpoints. Preserve that source segment and its original line. Use an endpoint-pair index rather than an O(W³) scan. Ambiguous competing chains fail closed.
2. During near-parallel endpoint snap, if the endpoint already exactly touches the other segment centerline, do not extend it to that segment's distant endpoint. Use numerical equality tolerance only; do not broaden this to approximate proximity or footprint contact.

Keep existing real door/opening host creation, source opening type/width/world interval/host relationships, normal fragmented-run merging, flips/transforms and atomic import history. Existing manual nodes and stored scenes remain untouched until explicit auto-model/reimport. Wall IDs may change when physical wall membership changes; source centerlines and opening meaning/position must remain evidenced.

## Fail-first and validation

Fixtures: thick A → thin diagonal B → thick C exact endpoint chain with B preserved and zero contained duplicate span; thick cap → thin flank → window → thin flank → thick cap with source opening preserved and zero contained duplicate span; actual door/opening gap still creates its continuous host; offset parallel, merely adjacent and crossing walls stay distinct; normal same-thickness fragment merge unchanged; competing chains fail closed. Normal L/T/X junction construction envelopes may retain legitimate local contact; general wall polygon intersection area is not the duplicate-wall metric.

Sol/high acceptance clarification: measure `containedDuplicateSpan` for emitted physical wall pairs. Select shorter S and longer L; count S.length only if both S endpoints project inside L's closed longitudinal interval within 1e-6 m and both endpoints lie within L's construction half-thickness plus 1e-6 m of L's centerline. Report pair count and summed contained length. Frozen p07 expects three pairs totaling approximately 1.284401 m before, zero pairs/zero length after. Other 43 accepted cases require no new pair and no per-case increase. Normal L, T, X and parallel corridor negative controls must score zero while preserving their topology. For source window o5, preserve type `window`, width 3.275 m, source ID/type metadata, host child/parent integrity, and reconstructed world interval endpoints within 1e-6 m of the transformed raw source interval. IDs may change with wall membership.

Use the same frozen 50 raw V15 documents and all 330 probes. Baseline is Lane A completed automatic replay, expected 44 import/6 rejects/298 hits. Require p07 all four misses recovered, at least 302/330 hits overall, zero per-case losses, and exact stored Slab/Ceiling overlap zero. Five semantic/open-passage review-only probes remain misses in the denominator because their aggregate floor is still required. Preserve source images, raw documents, semantic labels/classes and calibration.

Run focused tests, editor types, changed-file Biome/diff/static checks, relevant regressions and a separate final production build. Verify p07 via actual visible auto-model/reimport in an owned QA runtime, 2D/3D physical walls/floors, exact opening position, one-step Undo/Redo, autosave/reload and console. Save source-freeze, BUILD_ID, input guards, before/after outputs and readable HTML evidence under a new evidence root. No commit, push or deployment requested.

## Stop condition

Stop this safe branch when both guards and their negative controls pass, p07 source-backed four-probe recovery and zero physical contained duplicate span are proven, same50 has no floor-probe losses, new contained duplicate spans, or surface overlaps, and actual UI/history/save/reload pass. Unsupported other contacts stay explicit review-only; do not add micro-gap snapping or inferred boundaries to this pass.
