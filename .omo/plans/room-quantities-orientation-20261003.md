# Room quantities orientation — scoped implementation contract

Status: Sol planning complete, pending parent approval and Luna max implementation. Planning changed no product/source files. Preserve every pre-existing dirty file.

## Source-backed root cause

`packages/nodes/src/zone/quantities-panel.tsx:64` projects the polygon using `offsetY + (maxY - y) * scale`, reflecting its second coordinate. Zone polygon coordinates are ground-plane X/Z. `packages/nodes/src/zone/floorplan.ts:37` passes the resolved ring directly as `[x, z]` floorplan points. `packages/editor/src/lib/floorplan/plan-coords.ts:4` documents direct X/Z -> SVG x/y. `packages/editor/src/components/editor/floorplan-panel.tsx:1018` and `:1022` both return identity coordinates. `packages/editor/src/lib/floorplan/geometry.ts:15` defines a zero baseline rotation, north as world -Z. Thus the quantity sketch reverses the vertical direction of the canonical plan.

The sketch's labels and vertex circles already derive from its projected polygon; correcting that one projection moves all three consistently. Effective polygon selection (`livePolygon ?? proceduralPolygon ?? zone.polygon`) already serves automatic and manual zones. Quantity calculation and modeled scene geometry need no changes.

Evidence: `.omo/evidence/room-quantities-orientation-plan-20261003/source-diagnosis.json` records the exact source expression and asymmetric six-vertex fixture: current first edge y=142 is below the last vertices y=34, whereas canonical projection requires first edge y=34 and last vertices y=142. This is source diagnosis, not browser verification.

## Smallest change

1. Read the full `packages/nodes/src/zone/quantities-panel.tsx` before editing. Change only the projection term from `(maxY - y)` to `(y - minY)`.
2. Add a meaningful failing-then-passing test at `packages/nodes/src/zone/quantities-panel.test.tsx`. Prefer a named export of `ZonePlanSketch` from its existing module and render it with React server rendering; keep the default panel export unchanged. Verify emitted polygon/circle/label coordinates, not the spelling of the source formula. If module import prevents this, a tiny same-file exported pure projection helper used by the component is acceptable; do not introduce a general-purpose abstraction or a dependency.
3. Keep polygon order, edge-length association, aspect ratio, fitting/padding, empty-boundary UI, and unit formatting intact. Do not edit import transforms, core quantities, camera conventions, room reconciliation, scene data, or the modeling manual for this presentation-only fix.
4. Fixed building-local sketch orientation is the existing contract. Arbitrary orbit/compass synchronization is not part of this correction. Compare browser surfaces at canonical top/north-aligned orientation; if new evidence requires camera following, return to planning.

## Focused regression contract

Use asymmetric concave polygon `[[0,0],[6,0],[6,2],[2,2],[2,5],[0,5]]`, edge lengths `[6,2,4,3,2,5]`, metric metres. Expected projected points approximately `[[73.2,34],[202.8,34],[202.8,77.2],[116.4,77.2],[116.4,142],[73.2,142]]` at existing 276×176 dimensions. Assert top long edge remains above the bottom short edge; X ordering is unchanged; notch is at lower right rather than upper right; uniform edge scale and same edge label indices remain intact. Compare orientation to `buildZoneFloorplan` output or explicit canonical X/Z values. Add translated negative-coordinate fixture to catch origin-dependent mistakes. Check fewer-than-three-points fallback. Do not rely on rectangles or area-only assertions, which cannot detect reflection.

## Verification and captured artifacts

Record actual commands, exit codes, and output under `.omo/evidence/room-quantities-orientation-20261003/` unless working loop status provides a current attempt directory. `omo-agent-toolkit ulw-loop status --json` currently fails because its installed runtime target is absent; do not reinstall tooling for this task.

| Scenario | Invocation | Binary observable | Required artifact |
| --- | --- | --- | --- |
| Test catches existing reflection | `bun test packages/nodes/src/zone/quantities-panel.test.tsx` before fix | Orientation assertion fails for actual rendered/component output | `focused-before.log` |
| Fixed sketch orientation and indexing | Same command after fix | All focused cases pass | `focused-after.log` |
| Nodes package builds | `bun run --cwd packages/nodes build` | Exit 0 | `nodes-build.log` |
| Editor types | `bun run --cwd apps/editor check-types` | Exit 0, or exact pre-existing blocker separately reported | `editor-types.log` |
| Changed-file static check | `bunx biome check packages/nodes/src/zone/quantities-panel.tsx packages/nodes/src/zone/quantities-panel.test.tsx` | Exit 0 | `biome.log` |
| Zone rendering and numeric quantities stay correct | `bun test packages/nodes/src/zone/floorplan.test.ts packages/nodes/src/zone/room-documentation.test.ts packages/core/src/lib/zone-quantities.test.ts` | All cases pass | `regression.log` |
| Diff scope | `git diff --check` plus scoped diff | No whitespace issues; only scoped production edits | `diff-check.log`, `scoped.diff` |

## Real browser acceptance (parent owns this lane)

The initial localhost:3002 probe refused connection. Parent reports existing isolated QA editor at `http://localhost:3008/scene/d91d9557b8a3`, using `.omo/evidence/apartment-zone-real-20261003/qa-scenes.db`; verify it directly and reuse it rather than replacing a user-managed server. No production saved-scene mutation is authorized by this plan.

1. Open the QA scene; use visible 2D/top/north alignment controls and Zone selection. Choose an existing asymmetric automatically generated room. Capture its room/zone ID, resolved polygon, camera/plan orientation, and scene graph before interaction as evidence.
2. Open the selected zone's visible `Room quantities` section. Capture a screenshot including both main 2D room footprint and the mini-plan. The asymmetric notch or unequal top/bottom edges must occupy the same side in both; there must be no Y reflection. Read the actual SVG polygon and record points beside the selected zone's resolved coordinates. Screenshot alone is not the numeric assertion, and DOM alone is not the visual assertion.
3. Check each displayed edge length remains associated with its original polygon segment and is upright/readable; record the room's A/P and quantity values before/after, unchanged by this fix.
4. Check the same room against canonical 3D top view if available, or preserve an explicit gap. A freely orbited 3D camera is not a canonical orientation comparison.
5. Capture browser console errors for the workflow and verify opening/selecting the quantities card does not change the scene graph. Preserve user scene; no geometry edits/Undo requirement is introduced by a display-only task.

Artifacts: `browser-before.png` if reproduction is still available, `browser-after.png`, `browser-geometry.json` (selected room ID, raw and effective polygon, actual sketch points, orientation assertions, A/P values), `console.json`, and `scene-unchanged.json` (before/after comparison). The parent must re-read artifacts and report any unexecuted browser branch. Do not mark UI completion from this planning artifact. Production build is required if implementation broadens to feature-sized changes; this one-line presentation fix uses nodes compilation plus editor typecheck and real browser proof.
