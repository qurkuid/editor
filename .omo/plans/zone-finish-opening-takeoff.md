# Zone finish opening takeoff — implementation contract

## Decision

**Approved as a bounded renderer-parity repair, with a strict-area viewer boundary.** Door/window nodes carry the exact nominal cutout inputs used by the wall renderer (`position`, `width`, `height`, `openingShape`, radii and `archHeight`), so straight-wall finish deductions can be exact relative to the renderer's sampled face profile. The takeoff must not reimplement those shape formulas.

The current public surface is insufficient by itself: `buildOpeningCutoutShape` is internal and returns a Three.js shape, while the existing polygon union kernel has no rectangle-intersection or proven union-area export. A concrete frame-union experiment also disproved naive use of `unionPolygons`: `normalizeRing` makes both the 9 m² outer ring and 1 m² hole positive, so summing absolute ring areas reports 10 m² instead of the true 8 m². `assembleRings` may also discard an unclosed walk and return a non-empty partial result. Add the strict helpers below, then consume them from the app. If strict proof fails, retain gross quantity and mark it unsupported; do not clamp or approximate the result into looking valid.

Planning ran under the installed `code-reviewer` profile: `gpt-5.6-sol`, reasoning effort `high` (`~/.codex/agents/code-reviewer.toml`). This is planning only; implementation uses the repository's Luna/max lane in a clean worktree.

## Ownership

Own only:

- `packages/viewer/src/systems/wall/opening-cutout-geometry.ts`
- its existing focused test file
- `packages/viewer/src/lib/polygon-union.ts`
- `packages/viewer/src/lib/polygon-union.test.ts`
- `packages/viewer/src/index.ts`
- `apps/editor/lib/quantity-takeoff.ts`
- `apps/editor/lib/quantity-takeoff.test.ts`
- `apps/editor/components/stats-tab.tsx`
- `packages/editor/src/i18n/dictionary/furniture.ts`
- `apps/editor/lib/estimate-submit.ts` and its test only for carrying an unsupported/mixed basis note into the INTM item description

Do not edit apartment import/trace, guide, scene loader, core schema/index, Zone authoring, paint, modeling manual, persistence, history, retries, pricing, or INTM routes. Preserve the current wall construction takeoff and the existing gross `wall:face` measure; this task changes finish-material area only.

## Shared geometry contract

1. In `opening-cutout-geometry.ts`, name the renderer's existing `curveSegments: 24` value once and export a pure point-profile helper built from the same `buildOpeningCutoutShape(...).extractPoints(curveSegments).shape`. `buildOpeningCutoutGeometry` must use that same segment constant. The helper returns the nominal face boundary; CSG-only bottom padding and extrusion bevel must not enlarge the deducted face area.
2. Export the profile helper from `@pascal-app/viewer`. Do not copy arch equations, radius normalization, or Three.js curve sampling into the app.
3. Extend `polygon-union.ts` with a tested axis-aligned rectangle clip helper and a separate strict `measurePolygonUnionArea`-style API returning an explicit success/failure result. The takeoff must never calculate area by summing `Math.abs` over `unionPolygons` rings.
4. Keep existing `unionPolygons` and all current callers behaviorally unchanged. The strict API may reuse its edge splitting and boundary construction, but it must use a proof-carrying assembly path:
   - accept only finite, simple, convex input rings. This matches every renderer aperture profile (rectangle, normalized rounded rectangle, arch) and their axis-aligned rectangle clips; reject self-crossing or concave arbitrary polygons instead of presenting this helper as a general polygon engine;
   - every retained boundary segment is consumed exactly once;
   - every walk closes; a dead end, unused segment, ambiguous outgoing branch, invalid ring, or non-finite point is failure. A quantized `pointKey` match is only an index lookup: verify `pointsEqual(current.end, next.start)` at every hop, not only at final closure;
   - every assembled ring is simple: non-adjacent edges may neither cross nor touch, and non-adjacent vertices may not repeat;
   - enclosed rings use containment-depth parity, so outer rings add, holes subtract, and nested islands add again regardless of normalized winding;
   - after proving assembled rings are simple and mutually non-contacting/non-crossing, determine whether ring A is inside ring B from one actual vertex of A against B. Do not use a near-edge inward probe or centroid: a probe can land inside a child hole on a thin frame and invert the outer ring's depth;
   - contact with another ring boundary or any unprovable containment is failure;
   - the result is finite and lies between the largest normalized input area and the sum of normalized input areas (within epsilon).
5. The strict API returns failure rather than the existing `unionPolygons` input fallback or a partial set of rings. Do not “repair” a failure by summing source polygons, bounding boxes, or available partial rings.
6. Treat the sampled renderer profile as the source of truth. Pin the current samples in tests: a 2 m × 2 m rectangle is `4.000000 m²`; rounded radius 0.1 is approximately `3.991410 m²`; an arch with `archHeight=1` is approximately `3.561627 m²` at the renderer's current sampling.

## Takeoff contract

1. Refactor the existing straight-wall finish calculation into axis-aligned material cells: horizontal bounds come from normalized region/base intervals; vertical bounds come from the active band spans. Keep exact-role region matching and whole-side base fallback unchanged.
2. Resolve openings exactly as the renderer does: only `door`/`window` ids in `wall.children`; use modeled nominal dimensions, never rough/masonry/finish documentation dimensions. Clip every profile to the wall takeoff envelope and each material cell, then ask the strict union-area API for that cell's deduction. Subtract only a proven result from both interior and exterior faces.
3. Aggregate a material's cells per wall before the existing global `push`, preserving one wall id per material line. Clamp numerical residue to `[0, grossCellArea]`; never emit negative area.
4. Add optional finish-line audit fields for `grossQuantity`, `openingDeductedQuantity`, and `openingAdjustment: 'deducted' | 'unsupported' | 'mixed'`. Merge them deterministically when equal material refs combine across walls. The row shows `gross − openings = net` when deductions exist.
5. Unsupported data remains conservative gross, never an inferred net. Mark the affected line `unsupported`, or `mixed` when it combines supported net cells with gross fallback cells. Required unsupported reasons are:
   - curved wall with a door/window child (placement blocks this today, but old/imported data can contain it);
   - missing/unresolved child or non-finite/non-positive opening geometry;
   - non-door/window item cutout on the same wall, because the renderer cuts it from live mesh bounds that scene metadata cannot reproduce exactly;
   - any profile/clip result that is non-finite, or any strict union result whose rings cannot be fully assembled and parity-classified.
6. For unsupported/mixed rows, Stats must visibly say that some opening area remains gross. If the line reaches INTM, append the same short basis note to the item description; do not silently describe it as a fully net drawing quantity.
7. Keep current takeoff-envelope semantics for wall length and height in this task. Slab/terrain/base-profile surface accounting is a separate problem and must not be folded into the aperture patch. The UI text must call the result “개구부 차감 순면적”, not “exact rendered mesh area.”
8. `deriveTakeoff` remains read-only and deterministic from its node record. Do not call renderer registries, live transforms, stores, or `spatialGridManager`.

## RED tests with numeric math

Add failing tests first, then implement:

- **Unbanded rectangle, both faces:** 4 × 2.5 wall, one 0.9 × 2.1 door. Each painted face changes from `10.00` to `8.11 m²`; the same material on both faces is `16.22 m²`, with gross `20.00` and deduction `3.78`.
- **Band + exact-role region:** 4 × 2.5 wall; lower band 1 m, upper 1.5 m; a lower-region material covers the first half. A 0.8 × 2.0 door centred at station 1 m and y=1 m yields region lower `2.00 − 0.80 = 1.20`, uncovered lower base `2.00`, upper `6.00 − 0.80 = 5.20`, and an exterior whole-side finish `10.00 − 1.60 = 8.40`.
- **Crossing a region boundary:** an unbanded 1 × 1 window centred on the 2 m boundary of a 4 m wall removes `0.50 m²` from each adjacent interior material, proving cell clipping rather than charging the whole opening to one ref.
- **Shape parity:** rectangle, rounded-all, rounded-individual, door top-only rounded, and arch profile areas match the shared renderer samples; an opening crossing wall top/end is clipped to the wall envelope.
- **Overlap:** two 1 × 1 rectangles offset by 0.5 m remove `1.50 m²` per face, not `2.00`, proving union-before-subtraction.
- **Hole parity regression:** the four frame rectangles `[[0,0]..[3,1]]`, `[[0,2]..[3,3]]`, `[[0,1]..[1,2]]`, `[[2,1]..[3,2]]` measure exactly `8.00 m²`, not the normalized-ring absolute sum `10.00 m²`.
- **Thin-frame containment:** repeat the frame with a gap thinner than the former inward-probe offset and still prove outer `+`, hole `−`; containment must not depend on an invented interior sample.
- **Strict assembly regression:** contained, overlapping, disjoint, shared-edge and point-touch inputs either return their proven union area or explicit failure according to the strict contract. Add a focused internal fixture that leaves an unclosed/ambiguous boundary walk and assert failure; a non-empty partial ring set must never become a deduction.
- **Invalid input proof:** the concrete self-crossing ring `[[0,0],[3,2],[0,3],[2,0]]` returns failure, not `1.5`; add a nonzero-area concave input and a near-`pointKey`/over-`EPSILON` join fixture and require failure. Renderer-generated rounded/arch profiles and their clips must pass the simple-convex validation.
- **Host semantics:** a `parentId`/`wallId` opening absent from `wall.children` is ignored; a resolved child is counted. Rough/masonry/finish dimensions do not affect deduction.
- **Fallbacks:** curved, invalid, unresolved, and item-cutout walls retain gross finish area and carry `unsupported`; aggregating them with a supported wall becomes `mixed` and preserves gross/deducted audit totals.
- **Regression:** no-opening quantities remain byte-for-byte equivalent, active band/region tests from `e5a4fb15` stay green, wall construction and gross wall measure do not change, ids stay unique, and a deep-frozen scene is unchanged.
- **Description safety:** supported lines say net drawing quantity; unsupported/mixed lines include “개구부 일부 미차감” in the INTM payload description.

## UI and browser acceptance

Use a disposable scene and the supported scene API to seed deterministic existing geometry, then exercise all feature behavior through visible UI. Do not write the browser store through `evaluate`, reuse a pointer-preview as a committed opening, or accept an ad-hoc bent wall as the fixture. The pure tests own the exact-role `1.20 / 2.00 / 5.20 / 8.40` cell decomposition. The browser owns the equivalent real Zone workflow described below, because the Zone panel intentionally applies one selected material to every active role on the chosen face interval and therefore combines the lower/upper region cells into one visible material row.

### Browser QA rescue after the failed placement run

1. Keep the user-managed original editor on `http://localhost:3002`; do not restart it or replace its `.next`. Create a uniquely named disposable scene with `POST /api/scenes`, using the same already-proven e5 fixture shape: site → building → `Ground Floor` level → one straight 4 m × 2.5 m wall with two active bands (`lowerHeight: 1`) and a manual `Half Wall Zone` whose polygon intersects stations `0..2 m`. Give the wall lower-interior brick, upper-interior wood, and a distinct whole exterior material.
2. Seed one fully modeled rectangular door through that API graph, not through a browser-store mutation: the wall lists the door id in `children`; the door has both `parentId` and `wallId` equal to the wall id, `position: [1, 1.05, 0]`, `width: 0.9`, `height: 2.1`, and the schema-default door/opening fields required by `DoorPanel`. Verify the `POST` returns 201 and a following `GET` returns the same host linkage and dimensions before opening the editor. This is fixture preparation through the application persistence boundary; subsequent material and opening changes remain normal UI actions.
3. Include a separate, distant curved 4 m × 2.5 m wall (`curveOffset: 1`) with a distinct material and a modeled door child. It is the deliberate legacy unsupported row: expected gross is `11.59 m²` at the existing 24-segment wall-length sampling, with `개구부 일부 미차감 · 총 11.59㎡ 유지`. Do not attempt a net amount for it.
4. Navigate to `/scene/<id>`, wait for `Ground Floor`, the viewer surface, and removal of the full-screen SceneLoader before the first click. Use ordinary clicks without `force`. Open Scene → Zones → `Half Wall Zone` → `실제 마감 자재` → `전체 벽면`, select the mocked `Concrete Plate`, and capture the resulting real scene `PUT`. Require the saved wall to contain exactly one region spanning normalized `0..0.5`, with the selected material stored on the active interior roles; require the door linkage to remain intact.
5. Open Stats only after that `PUT` settles. The straight-wall DOM must contain four distinct material rows with these exact calculations:
   - selected Zone material: `총 5.00㎡ − 개구부 1.89㎡ = 3.11㎡`;
   - lower fallback: `2.00㎡`;
   - upper fallback: `3.00㎡`;
   - exterior whole-side material: `총 10.00㎡ − 개구부 1.89㎡ = 8.11㎡`.
   Each audited row must say `개구부 차감 순면적`. The curved fixture row must show the unsupported text from step 3. Capture the row text itself rather than a broad body substring.
6. Reuse the e5 scene-tree path to select `QA Door` (`data-treenode-id` is acceptable because it clicks rendered UI). In `DoorPanel`, click the Width value, type `0.80`, and press Enter. Do not synthesize wall raycasts or call `useScene`. Wait for a real `PUT` whose graph carries `width: 0.8`; Stats must update to Zone `3.32㎡` and exterior `8.32㎡`, each with `1.68㎡` deducted. This proves live opening edits affect takeoff even though the previously attempted pointer placement did not commit.
7. Press normal Undo and require door width `0.9`, Zone `3.11㎡`, and exterior `8.11㎡`; press Redo and require `0.8`, `3.32㎡`, and `8.32㎡`; press Undo once more to leave the fixture at the canonical `0.9` values. Separately undo/redo the Zone material application once and prove `finishRegions` changes `1 → 0 → 1` and the selected-material row disappears/restores. Match saves by graph content, not by request count, because background autosave may add requests.
8. After the final canonical `PUT` settles, wait for a quiet save interval, record the PUT count, open Stats, and require no additional scene mutation from that read-only action. Reload, wait for hydration again, and require the same region, door host/dimensions, `3.11 / 2.00 / 3.00 / 8.11`, unsupported gross label, and real scene `GET 200`. Delete the disposable scene through the supported API only after evidence is written.
9. Mock only catalogue, thumbnail, icon, and texture GETs as labeled synthetic fixtures. Keep the local scene `POST/GET/PUT/DELETE` real. Record fixture response, all matching scene payload snapshots, exact DOM rows, screenshots before/after edit and after reload, request URLs/statuses, console errors, page errors, and external mutations. Require zero console/page errors and zero actual external mutations; static editor asset GETs are allowed and classified.

Using an API-seeded existing door plus normal `DoorPanel` editing is the accepted browser adjustment. Door pointer placement persistence is a separate pre-existing interaction concern and is not a prerequisite for proving this read-only quantity calculation; a transient preview is never acceptable evidence. If the seeded door cannot be selected and edited through the rendered scene tree/panel, the browser gate remains failed.

Add one deliberately unsupported fixture (curved legacy wall or item cutout) and verify gross quantity plus the visible “개구부 일부 미차감” label; it must never present that row as exact net. Catalogue/static asset routes may be mocked and normal editor asset GETs are allowed. Record DOM rows, screenshots, console/page errors, scene PUT/GET, and request URLs. Require zero page/console errors, zero actual INTM/API external mutations, and no scene mutation from merely opening Stats.

## Gates and stop rule

Run focused viewer geometry/polygon tests first, then `quantity-takeoff`, `estimate-submit`, `estimate-lines`, and scene-material override regressions; follow with app typecheck, Biome on owned files, isolated build, and the browser scenario. Builds stay isolated from the active checkout's `.next`; the final integrated browser gate intentionally uses the already-running original port 3002 without restarting it.

Stop and return to Sol planning if the shared renderer profile cannot be exported without changing rendered geometry, if strict union assembly/parity cannot prove every required fixture, or if an unsupported case cannot remain explicitly gross. Existing `unionPolygons` callers are outside scope unless a separate regression proves a root defect and the parent explicitly accepts that boundary. Do not replace a failed proof with rectangle-only deduction, a bounding-box estimate, partial-ring summation, swallowed geometry errors, or duplicated aperture formulas.
