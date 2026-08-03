# Repeat Body Push/Pull Plan

## Outcome

Support repeated Push/Pull on an already extruded closed `body` face through the existing AI `pushPullBodyFace` operation.

The result must keep the direct-modeling kernel pure in `packages/core`, preserve existing persistent topology IDs for the moved face and its boundary features, preserve face material and UV frames, keep semantic measurement anchors resolving after each extrusion, keep face paint roles stable, and apply the AI operation as one Undo step.

## Evidence

- `packages/core/src/lib/body-topology.ts` is already 515 LOC and contains the current one-shot push/pull implementation guarded to one open planar face.
- `packages/core/src/index.ts` is already 427 LOC and currently root-exports Body topology plus `pushPullBodyFace`.
- `packages/core/package.json` has package subpath exports but no Body-specific subpath yet.
- `apps/editor/lib/ai-control.ts` already maps AI `pushPullBodyFace` patches to `pushPullBodyFace(current, patch.faceId, patch.distance)` and wraps the patch application in `runAsSingleSceneHistoryStep`.
- Body rendering, measurement, and paint already key off persistent face and half-edge IDs through `packages/nodes/src/body/{geometry,measurement,paint}.ts`.
- Architecture constraints keep topology/schema logic in `packages/core`; viewer/editor must not own domain geometry.

## Scope

Implementation files:

- `packages/core/src/lib/body-push-pull.ts` new pure cohesive module for Push/Pull topology mutation.
- `packages/core/src/lib/body-topology.ts` shrink by moving push/pull-specific implementation out; retain topology validation, hash, helpers, and re-export or import compatibility as needed.
- `packages/core/src/lib/body-topology.test.ts` red-first kernel tests, then updated green expectations.
- `packages/core/src/lib/body-push-pull.test.ts` optional if the moved module deserves its own focused suite; otherwise keep kernel behavior in `body-topology.test.ts`.
- `packages/core/package.json` add a subpath export, recommended `./body-push-pull`, pointing at `./dist/lib/body-push-pull.{js,d.ts}`.
- `packages/core/src/index.ts` adjust exports without increasing LOC. Prefer replacing the existing `pushPullBodyFace` export source with the new module while preserving public root import compatibility.
- `packages/nodes/src/body/geometry.test.ts`
- `packages/nodes/src/body/measurement.test.ts`
- `packages/nodes/src/body/paint.test.ts`
- `apps/editor/lib/ai-control.test.ts`

Do not edit in this pass:

- `packages/nodes/src/body/selection.tsx`
- UI affordances, manual tool selection, or 2D/3D interaction code
- Body schema shape unless a test proves schema data cannot represent the result

## Design

Refactor the existing open-face extrusion algorithm into `body-push-pull.ts`, then add a second path for closed-face repeat extrusion.

Keep the public function name:

```ts
pushPullBodyFace(source: BodyNode, faceId: string, distance: number): PushPullBodyResult
```

The function should:

- Validate finite non-zero distance and existing face ID before mutation.
- Read the target face outer loop through ordered half-edges.
- Preserve the target face ID and loop ID as the moved cap.
- Move only the vertices owned by the target face boundary when repeat extrusion is topologically safe.
- Preserve target face `surface` exactly, including `materialRef`, `uvOrigin`, `uvU`, and `uvV`.
- Create new side faces only for boundary edges that need side wall extension.
- Keep existing neighboring topology valid by replacing or extending twins/side faces rather than duplicating dangling edges.
- Increment `revision` exactly once.
- Return deterministic `created`, `deleted`, `preserved`, `split`, and `merged` remap entries.
- Parse the final result through `BodyNode.parse` and pass `validateBodyTopology`.

For a rectangular prism produced by the first extrusion, repeating Push/Pull on `face:0` should behave like extending the cap farther along its current normal. Existing adjacent side faces should remain connected to the moved cap and base. The first implementation should support closed planar polygon faces without inner loops and line half-edges only. If curved edges or inner loops are encountered, throw a clear `RangeError` before mutation.

## Red-First Tests

Add failing tests before implementation:

1. Core repeat extrusion:
   - Create `createRectangleBody({ width: 1.2, depth: 0.8 })`.
   - First `pushPullBodyFace(source, 'face:0', 1.2)`.
   - Second `pushPullBodyFace(first.body, 'face:0', 0.6)`.
   - Expect no `RangeError`, `revision === 2`, topology valid, six faces for the rectangular prism if the operation extends existing sides rather than adding an extra shell, moved `face:0` vertices at `y === 1.8`, and base face unchanged at `y === 0`.

2. Identity/material/UV preservation:
   - Paint `face:0` with a scene/library material and non-default UV frame.
   - Repeat Push/Pull.
   - Expect `face:0` exists, has the exact same `surface`, and `result.remap.preserved` contains `face:0`.

3. Measurement anchor stability:
   - Bind a Body face measurement using `matchBodyMeasurementFeature` on `face:0`.
   - Push/Pull twice.
   - Resolve the same feature reference and expect the point to move to the repeated cap, not detach or resolve to the old side/base.

4. Paint role stability:
   - After repeat Push/Pull, `bodyPaint.resolveRole` still returns `face:0` for a mesh hit with `{ bodyId, faceId: 'face:0' }`.
   - `bodyPaint.buildPatch` changes only that face surface.

5. AI and Undo:
   - Extend `apps/editor/lib/ai-control.test.ts` with an already-extruded body in scene state.
   - Apply an AI plan with one `pushPullBodyFace` patch against `face:0`.
   - Expect `pastStates.length === 1`.
   - One undo restores `revision === 1`, not deletes the body and not leaves `revision === 2`.

## Implementation Steps

1. Move Push/Pull types and helpers out of `body-topology.ts`.
   - Create `packages/core/src/lib/body-push-pull.ts`.
   - Move `PushPullBodyResult`, `TopologyRemap`, `canonicalFaceNormal` if only used by push/pull, ordered loop-edge helper if specific to mutation, and the existing `pushPullBodyFace` implementation.
   - If `getBodyFaceFrame` still needs normal calculation, keep a small shared exported helper in `body-topology.ts` or a new internal geometry helper; do not duplicate normal math in nodes.
   - Keep `body-topology.ts` below 515 LOC after the move.

2. Preserve root import compatibility and add subpath export.
   - Keep `pushPullBodyFace` and its result/remap types available from `@pascal-app/core`.
   - Add `@pascal-app/core/body-push-pull` in `packages/core/package.json`.
   - Do not let `packages/core/src/index.ts` exceed 427 LOC; replace export source lines rather than append.

3. Implement repeat closed-face extrusion in the new module.
   - Detect whether the target loop has open boundary edges or reciprocal twins.
   - Existing open-face behavior must remain byte-for-byte behaviorally equivalent where possible.
   - For closed repeat, move target face boundary vertices along the face normal by `distance`.
   - Rebuild or update adjacent side face UV frames only when required; do not change the moved face surface.
   - Maintain reciprocal twins and shell membership.
   - Reject unsupported inner loops, curved edges, non-planar/degenerate loops, or topology that cannot be safely extended.

4. Update tests from red to green.
   - Keep the red-first tests committed or staged before implementation if this is done in an execution session.
   - Add only focused tests for the new behavior and contract preservation.
   - Avoid broad snapshot churn.

5. Run targeted validation, then broad validation.
   - Start with the narrow Body and AI suites.
   - Then run package-level and repo-level checks.

6. Perform actual AI chat E2E.
   - Start the editor app on a free port, normally `PORT=3002 bun --cwd apps/editor dev`.
   - Verify `GET /api/ai/chat` reports configured status.
   - In the browser, create/load a scene with an already extruded Body, submit a chat request that produces `pushPullBodyFace` for the same face, click apply, then verify scene state and one Undo.
   - If Codex CLI OAuth is unavailable, record this as a blocked external-auth validation gap and keep all local API/control-plane tests green.

## Validation Commands

Red-first expected failure:

```sh
bun test packages/core/src/lib/body-topology.test.ts packages/nodes/src/body/measurement.test.ts packages/nodes/src/body/paint.test.ts apps/editor/lib/ai-control.test.ts
```

Targeted green checks:

```sh
bun test packages/core/src/lib/body-topology.test.ts
bun test packages/nodes/src/body/geometry.test.ts
bun test packages/nodes/src/body/measurement.test.ts
bun test packages/nodes/src/body/paint.test.ts
bun test apps/editor/lib/ai-control.test.ts
```

Package checks:

```sh
bun --cwd packages/core test
bun --cwd packages/core build
bun --cwd apps/editor check-types
```

Full repo checks:

```sh
bun check
bun check-types
bun test packages/core/src packages/nodes/src apps/editor/lib
bun build
```

Line-count guard:

```sh
wc -l packages/core/src/lib/body-topology.ts packages/core/src/index.ts
test "$(wc -l < packages/core/src/lib/body-topology.ts)" -le 515
test "$(wc -l < packages/core/src/index.ts)" -le 427
```

AI chat E2E setup:

```sh
PORT=3002 bun --cwd apps/editor dev
curl -s http://localhost:3002/api/ai/chat
```

## Acceptance Criteria

- `pushPullBodyFace` accepts an already extruded closed Body face created by the first Push/Pull.
- Repeated Push/Pull on `face:0` extends the same solid, increments revision once, and returns valid topology.
- The moved face ID stays `face:0`.
- The moved face material and UV frame are exactly preserved.
- Existing side/base topology remains connected with reciprocal twins.
- Semantic Body measurement references to the moved face resolve after repeat extrusion.
- Body paint role resolution and patching still target persistent face IDs.
- AI `pushPullBodyFace` plan application remains one undoable scene history step.
- `packages/core/src/lib/body-topology.ts` remains at or below 515 LOC.
- `packages/core/src/index.ts` remains at or below 427 LOC.
- No changes are made to `packages/nodes/src/body/selection.tsx`.
- All targeted checks, full Biome/type/tests/build, and AI chat E2E are either passing or have a documented external-auth blocker.

## Rollback

If implementation destabilizes topology:

```sh
git diff -- packages/core/src/lib/body-topology.ts packages/core/src/lib/body-push-pull.ts packages/core/package.json packages/core/src/index.ts packages/nodes/src/body apps/editor/lib/ai-control.test.ts
```

Then revert only the files touched by this plan, preserving unrelated dirty work:

```sh
git restore -- packages/core/src/lib/body-topology.ts packages/core/src/index.ts packages/core/package.json packages/core/src/lib/body-topology.test.ts packages/nodes/src/body/geometry.test.ts packages/nodes/src/body/measurement.test.ts packages/nodes/src/body/paint.test.ts apps/editor/lib/ai-control.test.ts
rm -f packages/core/src/lib/body-push-pull.ts packages/core/src/lib/body-push-pull.test.ts
```

Before any rollback, inspect `git diff` because this worktree already contains unrelated dirty files.

## Risks

- Half-edge repeat extrusion can accidentally leave non-reciprocal twins or duplicate feature IDs; keep `validateBodyTopology` as the first invariant.
- Moving cap vertices may unintentionally move shared base/side vertices if ownership is inferred incorrectly; tests must prove base coordinates stay fixed.
- Face normal orientation can flip if closed-face loop winding changes; tests must assert signed movement for positive and negative distances.
- Regenerating side faces may break material/UV continuity; preserve existing surfaces unless geometry requires recalculation.
- AI chat E2E depends on Codex CLI OAuth and may be blocked outside local credentials.

## Stop Rule

Stop when the repeat Push/Pull contract is green in core, Body geometry/measurement/paint, AI one-Undo tests, full repo checks, and AI chat E2E, with line-count guards passing and no edit to `selection.tsx`.
