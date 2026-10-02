# Expert floorplan drawing rules — implementation contract

## Basis and product rule

- **Domestic official basis:** The Ministry of Land, Infrastructure and Transport's [Standards for Preparation of Architectural Design Documents, section 13.1](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000251374) requires architectural drawings to follow [KS F 1501, General Rules for Architectural Drawing](https://standard.go.kr/KSCI/standardIntro/getStandardSearchView.do?ksNo=KSF1501&reformNo=13&tmprKsNo=KSF1501). The official KS status and this applicability relationship were confirmed on 2025-05-02. The publicly accessible official pages did not expose the detailed clauses of the KS text, so no unverified clause-level rule is attributed to KS F 1501 here.
- **General international reference:** ISO 129-1 supplies general dimension-presentation principles.
- **Overseas practice reference:** The current [US UFC 3-101-01 Change 4 (2024-01-08)](https://www.wbdg.org/FFC/DOD/UFC/ufc_3_101_01_2020_c4.pdf) requires sufficient dimensions in section 5-2.5.2; section 5-2.5.3 describes exterior overall and continuous strings covering openings and wall breaks; and section 5-2.5.4 describes interior dimensions taken consistently from one wall face, with wall thickness provided either as a dimension or by wall type. This is a US reference, not a Korean mandatory requirement.
- Pascal Expert floorplans therefore use millimetres at the presentation boundary, exterior overall + segment chains, and interior finished-face clear spans. Generated annotations must remain distinguishable from source guide raster content.

## Current causes

1. `packages/nodes/src/wall/floorplan.ts` forces `intersectionReferencePolicy: 'both-faces'` for finished-face exterior chains, producing partition-thickness-only segments.
2. `packages/nodes/src/zone/room-clear-dimensions.ts` always appends `buildRoomToRoomClearDimensions`, adding `R-R` shared-wall thickness labels beside usable room dimensions.
3. `packages/nodes/src/wall/construction-dimensions.ts` emits a wall-local overall dimension for an interior wall even when it has no hosted opening, duplicating room clear dimensions.
4. `apps/editor/lib/apt-vector-scene.ts` creates detected room zones without enabling finished-face clear dimensions and does not apply the detector's returned `wallUpdates` before publishing the imported graph.
5. Existing saved APT scenes can already contain `metadata.source: 'apt-vector'` zones while still carrying the schema default `clearDimensionPolicy: 'none'` and stale or unknown wall-side fields. Reimporting is not an acceptable upgrade path.

## Minimal change

1. Remove the finished-face `both-faces` override so an exterior chain uses one consistent partition finish face. Preserve the existing level-wide grouped segment and overall-chain machinery. For each exterior horizontal and vertical direction, render every placement/opening segment tier as one continuous chain on a shared baseline from the exterior overall start witness to its end witness; an opening-width-only tier may remain a separate local width annotation.
2. Stop adding `R-R` shared-wall thickness dimensions to the default automatic Expert presentation. Preserve room width/depth dimensions and their editable descriptors. Render room-clear dimensions and wall-plan `interior` / `interior-overall` tiers with the shared blue `#2563eb`; preserve the existing exterior measurement stroke and the selected-wall stroke override.
3. Suppress a wall-local overall for an opening-free interior wall only when an actually generated room-clear edit descriptor proves coverage of that wall. Keep the wall dimension when room-clear generation is unsupported or unproven, and keep existing jamb, opening-width, gap, and overall chains for walls with hosted openings.
4. During apartment import, apply space detection `wallUpdates` to the imported walls and set generated room zones to `clearDimensionPolicy: 'finish-faces'`.
5. For automatic-dimension rendering, derive effective wall-side classification from `detectSpacesForLevel(...).wallUpdates` into temporary wall copies. For an existing auto-from-walls APT room whose policy is still `none`, resolve an effective `finish-faces` policy for this render only. Do not call scene-store updates, rewrite zone polygons, or persist this compatibility result. Explicit `inside-faces` and `finish-faces` values remain authoritative.

Explicitly out of scope:

- No arbitrary minimum-length filter that could hide real construction information.
- No zone-polygon or wall-geometry normalization to force room-clear output for unsupported rooms.
- No connected-network extent expansion for oblique or curved dimensions; their existing local measurements remain unchanged.
- No global `use-viewer` unit-default migration.
- No change to authored/manual construction-dimension anchors, storage, or drawing overrides.
- No new measurement or takeoff engine.

## Acceptance criteria

### Automated

- Finished-face exterior horizontal and vertical chains contain segment dimensions to one consistent face and one overall dimension; no segment exists only to report partition thickness.
- Within each exterior placement/opening segment tier, consecutive dimensions share witness endpoints without gaps or overlaps, the first and last witnesses equal the exterior overall endpoints, and the segment lengths sum to the overall length within the existing geometry tolerance.
- Opening-width-only annotations may remain separate, but their provenance and edit IDs continue to reference the actual hosted opening; filling a facade-chain gap must not synthesize an opening or replace an existing editable leaf identity.
- Every facade edit descriptor and leaf measures along the same projected axis used by its rendered dimension line: descriptor/leaf length equals the rendered `dimensionStart`–`dimensionEnd` length. Visual witness origins remain attached to the actual geometry and do not define the editable target when facade lines have different normal coordinates.
- A rectangular room produces its finished-face clear width and depth without any `R-R` annotation.
- An opening-free interior partition with proven generated room-clear coverage produces no wall-local overall dimension; unsupported or unproven rooms retain the wall dimension.
- An interior wall with hosted openings retains its opening-placement chain and editable dimension descriptors.
- Apartment import publishes classified wall sides from `wallUpdates` and room zones with finished-face clear dimensions enabled.
- A previously saved APT scene with unknown wall sides and a default `none` room policy receives the same exterior chains and finished-face room spans without reimporting and without changing serialized scene nodes.
- Screen and export continue to consume the same generated geometry; retained dimension IDs/descriptors and manual construction-dimension anchors remain stable.

### Browser / export

- In Expert + finished faces + mm, each exterior horizontal and vertical direction has an uninterrupted grouped placement/opening segment chain on one baseline and a farther overall dimension with matching endpoints and total.
- Proven rooms show usable finished-face clear spans for furniture and cabinet placement, without wall-crossing `R-R` clutter or covered opening-free interior-wall duplicates. Unsupported or unproven rooms retain wall dimensions rather than losing construction information.
- Room-clear dimensions and interior wall tiers use the shared blue stroke, while exterior chains retain their existing measurement stroke; generated dimensions can therefore be distinguished from dimensions already embedded in the guide raster.
- Editing a retained automatic dimension still updates geometry and supports undo/redo.
- Image/PDF export contains the same generated dimension set and values as the canvas.

### Known room-coverage limit

Room-clear generation currently requires a proven rectangular or supported rectilinear finished-face enclosure. In the actual APT scene used for browser verification, 9 automatic room zones yield 4 clear-span labels; the remaining unsupported or unproven rooms retain their wall dimensions. Geometry normalization to increase that coverage is outside this change.

## Quantity boundary

`apps/editor/lib/quantity-takeoff.ts` derives quantities from model geometry, independent of visible dimension annotations. Current finish-material lines are gross `wall length × height`; hosted openings are not deducted. The existing generic `벽면 (양면)` measure and wall construction build-up also remain gross unless a later framing-specific contract changes them.

### Approved minimal net-finish extension

Change only finish-material area lines:

1. Pre-index wall-hosted door/window nodes once in `deriveTakeoff` using their wall host and wall-local `position`, `width`, and `height`.
2. Represent each opening as a wall-local rectangle and clip it to `[0, wall curve length] × [0, effective wall height]`.
3. Extend the existing finish partitioning so every side/band/material-region cell has horizontal `[start, end]` and vertical `[bottom, top]` bounds. For each cell, subtract the **union** of clipped opening rectangles intersecting that cell. This prevents double deductions for overlapping openings and assigns each deducted area to the correct base or regional material and height band.
4. Compute rectangle-union area with a small pure sweep: split on unique X edges, merge overlapping Y intervals in each slice, and sum covered slice area. The existing `mergeIntervals` in slab support is private and one-dimensional, so it should not be coupled into takeoff. No polygon Boolean dependency is needed.
5. Emit the resulting net m² through the existing `finish` lines. `buildEstimateDraft` and `applyCoverage` must remain unchanged so the established material coverage, discrete rounding, and waste-rate pipeline applies once, after the net takeoff.

Floor/slab polygons and holes, ceiling quantities, placed-item counts, furniture/cabinet counts, wall length, gross wall measure, and wall construction assembly quantities are untouched.

### Quantity acceptance

- A 4.0 m × 2.5 m painted wall with one 0.9 m × 2.1 m door reports `8.11 m²` net finish on each painted side carrying that material.
- Two overlapping hosted openings deduct their geometric union once, not the sum of both rectangles.
- Openings extending beyond either wall end, below zero, or above wall height are clipped before deduction and never produce negative area.
- An opening spanning two height bands deducts the correct intersected area from each band.
- An opening spanning a finish-region boundary deducts from the base and override materials according to the overlap in each region; materials are still grouped by their existing reference keys.
- Curved-wall runs use the existing curve length as the horizontal domain; finish regions remain governed by the existing curved-wall behavior.
- The generic gross wall measure and construction assembly lines keep their present values and labels, while finish lines show net area.
- Floor/slab polygon-hole quantities and item counts remain byte-for-byte equivalent for the same scene fixtures.
- Coverage and waste tests prove that waste is applied to the net finish quantity exactly once.

### Exact implementation surface

- `packages/nodes/src/wall/floorplan.ts`: pure effective wall-side classification before automatic dimension planning; keep scene data immutable.
- `packages/nodes/src/wall/construction-dimensions.ts`: approved exterior/interior generation policy only.
- `packages/nodes/src/zone/room-clear-dimensions.ts`: effective legacy APT policy and removal of default `R-R` output.
- `apps/editor/lib/apt-vector-scene.ts`: persist correct wall sides and finished-face policy for new imports.
- `apps/editor/lib/quantity-takeoff.ts`: wall opening index, clipped rectangle-union helper, and net area per side/band/finish region.
- `packages/nodes/src/wall/construction-dimension-reference-policy.test.ts`, `packages/nodes/src/wall/construction-dimensions.test.ts`, `packages/nodes/src/zone/room-clear-dimensions.test.ts`, `apps/editor/lib/apt-vector-scene.test.ts`, and `apps/editor/lib/quantity-takeoff.test.ts`: focused regression coverage.

No production change is required in `apps/editor/lib/wall-assembly-takeoff.ts`, `apps/editor/lib/material-coverage.ts`, `apps/editor/lib/estimate-lines.ts`, `apps/editor/components/stats-tab.tsx`, or `packages/core/src/lib/zone-quantities.ts`; these already consume or preserve the required outputs.
