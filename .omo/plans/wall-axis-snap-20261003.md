# Wall endpoint model-axis and L-corner snap contract

Date: 2026-10-03. Scope: existing straight-wall endpoint reshaping in 2D and its 3D sibling. Read-only planning slice; source files were not edited.

## Current evidence and root cause

- `wallMoveEndpointAffordance.apply` and `MoveWallEndpointTool.resolveDragPoint` already call `resolveWallEndpointPoint` with `inferDirection: !wall.curveOffset`. Default grid has `step > 0`, so weak inference already runs. Do not implement a global enable switch or describe this as missing grid inference.
- `packages/editor/src/lib/wall-direction-lock.ts:inferWallDirection` combines local 45-degree axes and adjacent-wall parallel/perpendicular directions, then chooses the nearest angle. A 0.86-degree tilted fixed-corner neighbor wins over horizontal for raw `[4,0.05]`: current result `[3.9995500759232647,0.059993251138848964]`. Without that neighbor it is `[4,0]`. A stronger, endpoint-specific cardinal priority is needed; do not change all drafting behavior.
- Both endpoint callers collect moving-linked walls but exclude them from snap/alignment targets because their stored shared corner is stale during preview. Preserve this exclusion: it prevents old-corner capture from blocking sub-5cm corrections.
- Both `getLinkedJunctionReference` helpers require at least two linked outer endpoints, excluding the edited wall's own fixed endpoint. A normal two-wall L has only one linked outer endpoint, so its stationary anchor never reaches the resolver. Even passing one explicitly currently does nothing: `snapLinkedJunctionDatum` iterates pairs and requires nearly collinear opposite rays. That helper serves T/straight-continuation junctions, not L corners.
- Baseline direct repro with fixed `[0,0]`, linked fixed `[4,3]`, raw `[4.04,0.03]` returns `[4.04,0]`; required exact L intersection is `[4,0]`.
- Current inference is building-local. Leader clarified that user X/Y means the model floor plane X/Z, not screen alignment after camera/view rotation. Preserve the existing model coordinate frame and do not broaden to building-yaw transforms. Pascal Y remains height.

## Smallest implementation

1. Add failing cases to existing `wall-drafting.test.ts` and `floorplan-affordances.test.ts` before implementation. Keep the existing `inferWallDirection` default and 45-degree/parallel behavior intact.
2. Extend the endpoint-only path in existing `wall-drafting.ts`, next to `resolveWallEndpointPoint` / `snapLinkedJunctionDatum`. Use a small pure endpoint cardinal candidate function, or an explicitly endpoint-only option to the existing direction helper; do not add another store, tool, panel, dependency, or generic constraint framework.
3. Keep all snap coordinates in the existing model/building-local plan frame. Use the same endpoint-specific helper from both callers through `resolveWallEndpointPoint`; camera rotation is presentation only. No world-grid helper modification is needed.
4. For grid/lines mode and a straight edited wall, infer horizontal or vertical within the existing 2-degree window before the weak tilted-neighbor/45-degree fallback. Assign the locked coordinate directly from the fixed point, rather than `sin/cos` of a cardinal angle; preserve existing along-ray grid length behavior. Outside the cardinal window, retain the current general inference. Do not expand the global 2-degree tolerance.
5. Let both `getLinkedJunctionReference` callers provide one or more same-level straight moving-linked outer endpoints (change their minimum from 2 to 1). Preserve exclusions of curved/other-level links and Alt-detach behavior. Keep existing two-outer-endpoint collinear datum behavior and tests.
6. Add an L-specific branch beside the existing datum branch: when the primary fixed-point cardinal ray and an outer endpoint's complementary cardinal ray both match the cursor within the existing 2-degree inference window, capture their exact intersection only within the existing tight guide aperture (0.15m). Require finite, nondegenerate legs and forward travel for inferred rays. If multiple distinct intersections qualify, fail closed to the primary-only result instead of choosing an arbitrary branch. Identical candidates can be deduplicated. For horizontal primary return `[outer.x, primaryFixed.z]`; vertical primary `[primaryFixed.x, outer.z]` in model plan coordinates. This preserves both stationary ends and squares both incident segments.
7. Preserve priority: existing intentional exact endpoint hits and explicit construction guides; explicit held/arrow constraint and Angles mode; endpoint cardinal/L inference in grid/lines; existing non-cardinal/collinear fallback. A new L candidate must not pull an explicit non-cardinal lock off its ray. Existing target face capture must use the owned ray and, for a two-axis L intersection, must not replace it with a different intersection. Mark the result `constraintOwned` and `directionInferred` so later alignment and the commit split radius cannot perturb it.
8. Preserve `buildWallEndpointEditPlan`, boundary snapshot checks, `buildWallEndpointUpdates`, hosted-span validation, overrides, and one-step `applyNodeChanges`. Those dirty files implement existing atomic split/connect behavior; do not refactor them. If commit coordinates differ from preview, fix the caller/resolver seam rather than weakening validation.
9. Update the existing direct interaction paragraph in `packages/mcp/src/modeling-agent-manual.ts`, its resource test, and `buildAiModelingPrompt` exposure test. Describe model cardinal endpoint precedence and two-wall L alignment without claiming a new AI/MCP endpoint mutation operation.

## Modifier and mode contract

- Grid and Lines: new endpoint cardinal/L capture enabled. Off: new weak/cardinal/L inference disabled, raw cursor in empty space. Do not broaden this task to remove the existing tight intentional wall-connect behavior or explicit construction guides.
- Angles: preserve explicit 15-degree ray behavior; no new L override.
- Alt in these two endpoint callers currently means detach, not general snap bypass. Preserve it: linked wall remains unchanged, omit junction reference, new linked-anchor L snap disabled, primary endpoint still follows active mode. Do not silently reinterpret Alt using older generic architecture prose.
- Shift currently holds inferred direction for wall edits; ArrowRight/Left/Down existing locks remain. Do not replace Shift hold with mode cycling as part of this fix. Existing local arrow semantics remain documented; the new automatic cardinal behavior uses the same model axes.
- Curved walls remain outside new straight endpoint inference; preserve current validation/rejection.

## Regression scenarios and required artifacts

Implementer records all fresh outputs inside the active attempt directory, else `.omo/evidence/wall-axis-snap-20261003/`. No scenario below is claimed executed by this plan.

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Horizontal/vertical default endpoint, reversed directions, off-grid fixed coordinate, tilted adjacent wall | `bun test packages/editor/src/components/tools/wall/wall-drafting.test.ts` | Exact locked fixed coordinate; cardinal wins inside 2 degrees; outside remains existing inference/free | `resolver-tests.log` |
| L corner: both primary endpoint orientations, both linked orientations, symmetric primary wall selection, sub-5cm correction | same resolver suite and `bun test packages/nodes/src/wall/floorplan-affordances.test.ts` | shared point exactly equals stationary-axis intersection, both outer ends unchanged, linked preview same point, no scene write before commit | `affordance-tests.log` |
| Camera/view rotation | native browser 2D/3D gesture on same local fixture | same exact model X/Z output despite view rotation | `view-rotation-state.json` |
| Limits/priority: Off, Alt, Angles, Shift/arrow, exact target endpoint, explicit guide, physical face, curved link, other level, ambiguous multi-link | same suites plus `bun test packages/editor/src/lib/wall-direction-lock.test.ts` | no new inappropriate capture; old T-collinear test passes; no stolen lock or false branch | `modifier-regression.log` |
| One commit, exact Undo/Redo, Escape, attachment/collapse rejection | affordance suite and existing `endpoint-edit-plan.test.ts` | one history entry, complete graph equality after Undo, no persisted change on cancel/rejection | `atomicity-tests.log` |
| Manual reaches internal prompt and MCP guide | `bun test packages/mcp/src/ontology-manual.test.ts packages/mcp/src/resources/resources.test.ts apps/editor/lib/ai-provider.test.ts` | new contract included in both serving paths | `manual-tests.log` |
| Package compile, types, scoped static, production build | `bun run --cwd packages/nodes build`; `bun run --cwd apps/editor check-types`; `bunx biome check <changed files>`; `bun run --cwd apps/editor build` | exit 0 for each; preserve independent preexisting failures with exact evidence if encountered | separate `nodes-build.log`, `types.log`, `biome.log`, `app-build.log` |

## Real browser acceptance (leader-owned, native CUA surface)

Check the already running `http://localhost:3002` (planning HTTP probe returned 307); do not restart it. Use a local isolated fixture or approved non-production scene, keeping the user's persisted scene safe. Browser action must be the visible endpoint handle in select/2D or 3D; script state injection alone is not gesture proof. Capture screenshot plus before/preview/after/Undo graph data and console output.

1. In 2D default Grid, select an existing almost-horizontal wall with a slightly tilted neighbor at its fixed end; drag the endpoint near horizontal, release. Repeat near vertical and with a non-grid fixed coordinate. Observe precise cardinal committed coordinate and visible handle placement.
2. Fixture L: edited wall `[0,0]→[4.04,0.03]`, linked wall `[4.04,0.03]→[4,3]`. Select either wall's shared endpoint, drag near `[4.04,0.03]`, release. Both must commit shared `[4,0]`, fixed `[0,0]` and `[4,3]` unchanged. One Undo restores complete fixture, one Redo reapplies it. Capture `2d-l-before.png`, `2d-l-preview.png`, `2d-l-after.png`, `2d-l-state.json`, `2d-l-undo.json`.
3. Move cursor outside capture, Off, Alt-detach, and Escape once each. Capture `2d-modes.json` with raw/committed coordinates, linkage and graph comparison; `2d-modes.png`. The new snapping must release and cancellation must clear guides/overrides.
4. Repeat the basic cardinal and L handle gestures in 3D, capturing `3d-cardinal.png`, `3d-l-after.png`, `3d-state.json`, `3d-undo.json`. Shared resolver code does not substitute for runtime parity proof.
5. Repeat one gesture with a rotated camera/view; capture `view-rotation-state.json` and a screenshot proving the same model X/Z coordinates. Do not mutate building yaw or expand implementation into world/screen snapping.
6. Capture `browser-console.json`; inspect errors. No AI endpoint operation is added, so verify manual/prompt exposure rather than claiming an AI action that does not exist. A missing browser scenario is an explicit incomplete gate, not a pass.

## Planning evidence and model provenance

Baseline command: `bun test packages/editor/src/lib/wall-direction-lock.test.ts packages/editor/src/components/tools/wall/wall-drafting.test.ts packages/nodes/src/wall/floorplan-affordances.test.ts`. Observable: **60 pass / 0 fail**. Artifact: `.omo/evidence/wall-axis-snap-plan-20261003/baseline-tests.log`.

Root-cause repro command: `bun .omo/evidence/wall-axis-snap-plan-20261003/repro.ts`. Observable: tilted reference `isExactHorizontal=false`, control `true`, L `bothAxesExact=false`. Artifacts: `repro.ts`, `repro.json` in that directory. These prove baseline gaps, not feature completion.

Attempt runtime lookup: `omo-agent-toolkit ulw-loop status --json` failed because installed runtime target `.../omo/5.1.0/dist/cli/index.js` is missing; use fallback `.omo/evidence/`, do not reinstall runtime for this task.

Required planning profile is `gpt-5.6-sol` / `high`; this child has no host-resolved model/effort telemetry tool in its context. Leader must report the spawn metadata and must not claim this note independently verifies resolution. Required implementation lane remains `luna-max`, with actual route verified by leader before assignment.
