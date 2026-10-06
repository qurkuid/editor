# Manual boundary repair final source review

**Latest follow-up status:** the P1 drag-overlap and P2 DOM-order target defects below are fixed in the stable source. No further concrete defects found in the bounded follow-up. See final follow-up section and `final-review-stable-source-hashes.json`. This is code/pure-session acceptance; parent owns browser and build completion.

Review cutoff (UTC): 2026-10-03T07:54:59.042674+00:00. Read-only review by the planning/review lane. Source remained under active implementation; hashes in `final-review-source-hashes.json` identify this review snapshot. No source, browser, scene database, server or deployment changes were performed by this review.

## Verdict: one runtime-probe defect and one source-modeled target-selection defect

**P1 — Endpoint dragging can create new collinear wall overlap.** `packages/nodes/src/wall/endpoint-edit-plan.ts:44` constructs the final graph, but lines 50–53 only validate newly split walls with `buildWallEndpointUpdates`; no new/increased collinear overlap validation is applied. The manual target planner has that guard, while 2D `floorplan-affordances.ts:375` and 3D `move-endpoint-tool.tsx:582` use this different planner.

Reproduction: same-level A `[0,0]→[1,0]`, target B `[3,-1]→[3,3]`, third wall C `[1.5,0]→[2.5,0]`. Start the actual `wallMoveEndpointAffordance` session on A:end, snapping Off, apply `[3,0]`, call `canCommit` and `commit`. Observed `canCommit === true`, A:end becomes `[3,0]`, overlapping all 1m of C. Expected rejection before a scene write because this overlap did not exist before. This concerns the exposed marker-drag workflow even when target connection is safe; shared planner means the same missing guard exists in 3D (3D UI was not executed in this review).

Invocation: `bun .omo/evidence/manual-boundary-repair-20261003/final-review-drag-probe.ts`. Full fixture, resulting graph and output: `final-review-drag-probe.ts`, `final-review-drag-probe.json`, `final-review-drag-probe.log`. The probe deliberately imports canonical `packages/core/dist/index.js`, matching package resolution used by node/editor imports, so it operates on the same scene store. The prior accidental source-store variant was corrected before recording these results.

Minimal repair recommendation: share the changed-wall, before-versus-final overlap check with this endpoint preflight; preserve unrelated existing overlaps and existing overlaps that do not increase. Validate the final split graph and cover both rejection and unchanged-existing-overlap positive cases through the actual session.

## Fresh verification

| Exact scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Exposed endpoint session creates new overlap | `bun .omo/evidence/manual-boundary-repair-20261003/final-review-drag-probe.ts` | FAIL: canCommit true; source end `[3,0]`; 1m new overlap | `final-review-drag-probe.json`, `final-review-drag-probe.log` |
| Valid target interior split with hosted door | Same probe, `normal-split-opening` case | PASS: commit true; door moves to split host with local X 1.5 preserving world center; exactly one history step; Undo returns exact nodes | Same JSON/log |
| 2D ephemeral child preview, hosted-span rejection, 0.1mm stale change preservation, readOnly transition; marker threshold/release relay; registry and split regressions | `bun test packages/nodes/src/wall/floorplan-affordances.test.ts packages/editor/src/components/tools/wall/wall-drafting.test.ts packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts` | PASS: 78 tests, 297 assertions, 0 failures | `final-review-tests-fresh.log` |
| Manual two-wall L, 1m/no-new-room connection, hosted rebase, precise stale snapshot, level/curve refusal, new overlap refusal, final rotated-item span, metadata review/reset/expiry; existing automatic and endpoint operation tests | `bun test packages/core/src/lib/room-boundary-manual.test.ts packages/core/src/lib/room-boundary.test.ts packages/core/src/lib/wall-operations.test.ts` | PASS: 39 tests, 133 assertions, 0 failures | `final-review-core-tests.log` |

Bun unit tests emit expected unavailable browser-storage warnings; these are not runtime browser results.

## Resolved during concurrent implementation

- Marker release propagation: latest `roomBoundaryMarkerPointerHandlers` allows a dragged pointerup and the threshold pointermove to reach the registry's window listeners, while preserving tap suppression. The new pure-handler test passes; this removes the previously reported static blocker. Real pointer-capture routing remains the parent's browser gate.
- `RoomBoundaryConnect` now retains its activation context rather than resetting it on every context change, and its unmount cleanup ends boundary scopes. ReadOnly, view/mode/tool/level changes and source reparenting have cancellation guards. Its target commit replans the current graph, checks the captured dependency signature and exact preview patches, then uses one `applyNodeChanges` inside a history transaction.
- Open review writes only geometry-specific wall metadata; diagnostic labeling and reset are present, and the pure review/expiry test passes. No fake enclosure flag is written by that action.

## Meaningful coverage still needed for the final product gate

These are verification gaps, not additional defect claims. The parent's real-browser lane owns them: actual marker drag release/Esc with pointer capture; target-pick preview cancellation on tool/view/level/unmount; live readOnly and source/target/child staleness during target preview; intentional-open Undo/save/reload and geometry-expiry display; stable actual two-wall Undo/Redo/save/reload; and 3D endpoint interaction parity. Pure unit success does not establish these UI outcomes. The new drag-overlap scenario above was absent from the current endpoint-session tests and exposed a real bypass despite all focused suites passing.

This report does not claim production build, full editor typecheck, static formatting checks, browser console cleanliness, save/reload, or end-to-end feature completion. No fixes were made by this review lane.

## Supplemental explicit-target hit-region review

**P2 source-reproducible target ambiguity — overlapping generous target strokes select the later DOM wall rather than the wall center the user clicked.** `room-boundary-connect.tsx:199` renders every target wall in `Object.values(nodes)` order. Every line receives `strokeWidth={18 * scale}` and directly calls `selectTarget(wall.id)`; there is no coordinate disambiguation. With two same-span vertical walls at x=2 and x=2.03, unitsPerPixel=0.01, the later x=2.03 wall's stroke covers x=[1.94,2.12]. Clicking the exact x=2 centerline at the common midpoint therefore hits the later wall. At scale .005 the defect persists; at .001 those hit regions no longer overlap. Transparent stroke remains a painted SVG stroke for hit-testing.

The deterministic source-derived hit-region model is captured in `final-review-target-hit-model.json`, including source hash and review time. It proves coverage/order ambiguity, not actual browser dispatch. Parent is reproducing the actual UI event on the stable runtime. Browser test: populate walls in x=2 then x=2.03 order, select the horizontal source endpoint, and click x=2/common midpoint at a zoom where unitsPerPixel >= .003334; observe preview target id and source end x. Expected x=2; this DOM arrangement routes to x=2.03. Reverse the fixture insertion order to expose order dependence.

A narrow fix should preserve easy hit areas while resolving the user's plan-space click to the closest eligible centerline/endpoint; coincident/equidistant candidates with different affected-wall edits need explicit choice rather than silent DOM-order selection. The plan's same-intersection/different-affected-walls requirement is relevant here. No source changes or browser actions were made by this review.

Target model replay: `python3 .omo/evidence/manual-boundary-repair-20261003/final-review-target-hit-probe.py`; captured output `final-review-target-hit-probe.log`.

## Follow-up: P1 overlap fixed

Fresh actual endpoint-session replay now rejects the original new-overlap fixture: `canCommit=false`, source end `[1,0]`, 0 history steps, exact original graph. The valid split+hosted-door fixture still commits with one history step and exact Undo. Invocation unchanged: `bun .omo/evidence/manual-boundary-repair-20261003/final-review-drag-probe.ts`. New captured artifacts: `final-review-drag-recheck.log`, `final-review-drag-recheck.json`. The probe rewrites `final-review-drag-probe.json`; the original failing runtime output remains in `final-review-drag-probe.log`.

The shared `validateWallEndpointOverlaps` now runs from `buildWallEndpointUpdates`, so both 2D and 3D endpoint planner calls use it. It checks only pairs involving changed walls and rejects increased overlap relative to the input snapshot. Additional positive actual-session probes cover unchanged overlap on the changed wall and unrelated preexisting overlap: both can commit to `[3,0]`, record one history step and Undo exactly. Invocation: `bun .omo/evidence/manual-boundary-repair-20261003/final-review-drag-existing-overlap.ts`; artifacts `final-review-drag-existing-overlap.{ts,json,log}`.

Fresh focused regression command: `bun test packages/core/src/lib/room-boundary-manual.test.ts packages/core/src/lib/room-boundary.test.ts packages/core/src/lib/wall-operations.test.ts packages/nodes/src/wall/floorplan-affordances.test.ts`. Result: 52 pass, 0 fail, 197 assertions. Artifact: `final-review-overlap-recheck-tests.log`; reviewed-source hashes and UTC time: `final-review-recheck-source-hashes.json`. P1 is closed at that source snapshot. UI selection and cursor fixes are still being implemented and are not accepted by this subsection.

## Final stable-source follow-up — 2026-10-03T08:07:30.491968+00:00

No remaining concrete defect found within the assigned bounded follow-up. Stable source hashes/time are captured in `final-review-stable-source-hashes.json`.

**P2 target selection closed at source/pure-test layer.** The target group's click and hover handlers now convert event client coordinates with `clientToPlan` and call `closestRoomBoundaryTargets`. Wall/circle children retain easy hit areas but do not commit their DOM wall identity. Nearest geometric centerline is selected regardless of SVG stacking order. Equal-distance matches remain explicit choices with target ids, names/coordinates and endpoint labels; selecting a choice invokes the same validated fresh planner. Review confirmed choice state clears on cancel/source identity change/target selection. The prior source hit-region probe describes the superseded implementation and should not be rerun as current acceptance.

Fresh invocation: `bun test packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts`. Result: 26 pass, 0 fail, 94 assertions (`final-review-ui-stable-tests.log`). This specifically checks x=2 versus x=2.03 centerline selection in both wall orders, endpoint selection against overlapping hit areas, equidistant explicit choices, outside-radius and zero-length rejection, marker pointer relay and dispatcher regression.

**Draft cursor occlusion fix reviewed.** `floorplan-panel.tsx:4591` wraps draft polygon/polyline/closing-segment/cursor feedback in `<g pointerEvents="none">`; there is no descendant override restoring hit testing. The separate active draft anchor at line 11761 also uses none. These visual-only layers no longer participate in SVG pointer targeting, allowing underlying markers/target groups to receive events. Source assertion evidence: `final-review-cursor-source-check.json`. No browser actions were performed by this lane; parent is independently running the real pointer/click and exact Undo flows.

**P1 remains closed.** The rechecked actual endpoint session rejects the original newly created overlap with zero graph/history write. Unchanged existing overlap on the changed wall and unrelated existing overlap both remain allowed, and valid host split/door rebase/one-step exact Undo remain positive. Fresh relevant core+endpoint tests: 52/52, 197 assertions (`final-review-overlap-recheck-tests.log`).

These follow-up results supersede the initial defect verdict for the stable hashes only. Production build/typecheck/runtime/save-reload completion remains the parent's gate; no deployment/push or source changes were performed by this reviewer.
