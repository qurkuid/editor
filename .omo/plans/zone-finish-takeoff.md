# Zone wall finish quantity takeoff — implementation contract

## Status and result

**Approved bounded repair.** Make Zone-applied straight-wall finishes appear in Stats quantities without changing the scene, Zone authoring, renderer, estimate flow, or persistence. The source baseline is deployed commit `999b2771`; deployment evidence is in `.omo/evidence/zone-finish-release-20261002/deployment-status.md`.

The planning profile is confirmed as `gpt-5.6-sol` with `high` reasoning from the active `code-reviewer` profile (`~/.codex/agents/code-reviewer.toml:4-5`). Implementation must use the repository's `luna-max` lane and verify `gpt-5.6-luna` / `max` before editing.

## Ownership and exclusions

Own only:

- `apps/editor/lib/quantity-takeoff.ts`
- `apps/editor/lib/quantity-takeoff.test.ts`

Do not edit Zone/paint, core schema, viewer, Stats UI, apartment import, guide, scene loader, or modeling-manual files. No schema, migration, persisted data, pricing, estimate, retry, or API change is needed. Work in the clean isolated checkout `/Users/changseok/.codex/worktrees/zone-finish-takeoff/editor`; preserve the dirty main checkout.

## Current facts

- `deriveTakeoff` currently reads only `wall.slots.interior` and `wall.slots.exterior`, assigning each ref the whole face area. It ignores `wall.finishRegions` and active face-band slots.
- Zone partial-wall application stores normalized `finishRegions` with the exact active roles. Full-wall application writes the roles to `wall.slots` and removes the replaced region roles.
- The renderer first selects the active vertical role with `getWallFaceBandConfig` and `getWallBandSlotId`, then applies a region only when that exact role matches. While bands are active, a region's whole-side `interior`/`exterior` role does not override a band.
- A missing base band slot falls back to the corresponding explicit whole-side slot. Built-in visual defaults remain renderer-only; takeoff currently and intentionally emits no finish line for an unpainted wall.
- Straight-wall regions are rendered by normalized station. Curved partial regions are unsupported by Zone and are not assigned by the renderer's station resolver.
- Wall and finish quantities currently use gross authored length × height. Door/window geometry is removed later by exact renderer CSG, including rounded and arched profiles; there is no existing pure exact-area helper suitable for this bounded repair.

## Implementation contract

Keep the calculation pure and local to `quantity-takeoff.ts`.

1. Derive the active vertical spans for each side from the core helpers:
   - no active bands: one span, slot `interior` or `exterior`, height = effective wall height;
   - two bands: `lower` and remaining `upper`;
   - three bands: `lower`, `middle`, and remaining `upper`;
   - four bands: `lower`, `middle`, `upper`, and remaining `top`.
   Use the clamped heights returned by `getWallFaceBandConfig`; zero-height spans contribute nothing. Ignore stale slots for inactive bands.
2. Resolve the base persisted ref for each active span exactly like the renderer's explicit-slot fallback: `wall.slots[activeSlot]`, then the corresponding `wall.slots[side]` obtained with `getWallSurfaceSideFromBandSlot`. If neither exists, emit no fallback finish. Do not count `WALL_SURFACE_SLOT_DEFAULTS` or legacy visual defaults.
3. For a straight wall, normalize `finishRegions` and consider only regions on the current side that contain the exact active slot role. Each matching interval overrides the base ref only for `length × bandHeight × (end - start)`. Emit the base ref for the uncovered fraction. Same-role regions are already non-overlapping by the wall schema; adjacent ranges must neither overlap nor leave numerical double-counting.
4. Do not spread a region's `interior`/`exterior` role across active band roles. Region fallback is exact-role only. Base-slot fallback from a missing band slot to the whole-side slot remains required.
5. Accumulate all finish contributions for one wall in a local `materialRef → area` map, then call the existing global `push` once per ref for that wall. This recombines equal region/base/band refs and keeps each wall ID unique without changing `push` behavior for any other takeoff category.
6. Ignore `finishRegions` for curved walls. Continue measuring explicit base slots/bands with `getWallCurveLength`; report partial curved finish as unsupported rather than inventing chord/station semantics.
7. Preserve the existing gross-area contract: door/window/item cutouts do not reduce wall measure or finish quantities in this phase. Keep wall face measure, wall length, construction assembly lines, grouping keys, level scoping, and downstream estimate behavior unchanged.
8. Do not mutate nodes, slot maps, regions, or arrays. A frozen/deep-equality test must prove `deriveTakeoff` is read-only.

## Acceptance criteria

- A partial unbanded Zone region replaces only its covered fraction; uncovered area retains the explicit whole-side finish, and the opposite face is unchanged.
- With active bands, each material quantity equals its active band height × covered wall length. Missing band refs fall back to the explicit whole-side ref; inactive/stale band refs contribute zero.
- A whole-side region role has no effect while bands are active unless the exact active band role is also present.
- Region and fallback areas sum to the painted gross span with no double counting. Equal refs aggregate into one existing `finish:<ref>` line, and `nodeIds` contains each contributing wall exactly once.
- A partial region on an otherwise unpainted face contributes only its covered area; the uncovered part does not gain a visual-default finish line.
- Curved walls keep arc-length base finish quantities, and any partial `finishRegions` are ignored as unsupported.
- Adding rectangular, rounded, or arched opening children does not change the existing gross wall/finish quantity. This limitation is explicit and tested.
- Existing wall measures, construction lines, floors, ceilings, furniture, lighting, level filters, estimate conversion, and scene-material override tests remain green.

## Focused tests and static gates

Add table-driven or compact focused cases in `quantity-takeoff.test.ts` for:

- unbanded partial override + base remainder + opposite-side independence;
- no-base partial coverage;
- two/three/four-band height accounting, missing-band-to-side fallback, and stale inactive roles;
- exact-role region behavior while bands are active, including ignored whole-side region roles;
- adjacent/disjoint regions, same-ref recombination, unique wall IDs, and total-area conservation;
- curved base arc length with ignored partial region;
- gross opening behavior with wall-hosted door/window fixtures;
- input immutability.

Run, in order:

1. `bun test apps/editor/lib/quantity-takeoff.test.ts`
2. `bun test apps/editor/lib/quantity-takeoff.test.ts apps/editor/lib/estimate-lines.test.ts apps/editor/lib/scene-material-overrides.test.ts`
3. `bun run --cwd apps/editor check-types`
4. `bunx biome check apps/editor/lib/quantity-takeoff.ts apps/editor/lib/quantity-takeoff.test.ts`
5. `bun run --cwd apps/editor build` from an isolated output/snapshot that does not reuse the active main checkout's `.next` or port 3002.

## Real browser Zone → Stats proof

Run the isolated checkout on a dedicated port with a disposable local scene/database and no production writes. Use a deterministic straight 4 m × 2.5 m wall with two active bands: lower 1 m and upper 1.5 m. Give the lower band an explicit material, leave the upper band to fall back to the whole-side material, and use a manual Zone covering exactly half the wall.

Through the visible Zone finish UI, apply a third material to that partial wall face, then open Stats normally. Verify the finish rows show:

- Zone region material: `4 × 2.5 × 0.5 = 5.00 m²`;
- uncovered lower-band material: `4 × 1.0 × 0.5 = 2.00 m²`;
- uncovered upper fallback/whole-side material: `4 × 1.5 × 0.5 = 3.00 m²`.

Reload the disposable scene and confirm the same rows. Compare the saved scene graph immediately after Zone apply with the graph after opening Stats: Stats/takeoff must not mutate nodes or metadata. Record the exercised DOM text, scene responses, console errors, page errors, and network requests in JSON plus screenshots. Permit known editor asset GETs; require zero external INTM/API mutations and zero console/page errors.

## Handoff and stop rule

Hand this contract to `luna-max` in the isolated checkout. Luna may choose local helper names but may not broaden ownership or change gross-area semantics. If renderer parity requires a core/viewer edit, an opening-area algorithm, or curved-region support, stop and return that boundary crossing to Sol planning instead of expanding the patch. Completion requires the owned diff only, every focused/static/build gate green, and the recorded Zone → Stats browser quantities above.
