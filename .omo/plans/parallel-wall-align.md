# Connected Wall Parallel Alignment — Sol/High Implementation Contract

## Outcome

Add **인접 벽과 평행 맞춤** to the existing single-wall `WallEditControls`. From either 2D or 3D selection, one click makes a slightly crooked straight continuation exactly collinear with one automatically resolved adjacent wall.

The reference wall and shared corner remain unchanged. The selected wall keeps its centreline length. Its free endpoint rotates onto the opposite ray of the reference wall, and walls linked to that free endpoint follow through the existing linked-endpoint contract. A valid result is committed by one `updateNodes(...)` call and therefore one undo step.

This is a direct shared-UI capability. Do not add a canvas pick mode, new tool, shortcut, schema field, AI operation, MCP mutation, or separate 2D/3D implementation.

## Grounded fixture

Use the current scene evidence at `.omo/evidence/expert-dimension-edit-20261001/current-before.json` as the browser acceptance case:

- selected crooked wall: `wall_ev1580n36u0mzfek`
  - start/shared corner: `[3.2932013527106627, -3.378765764859558]`
  - end/free endpoint: `[3.756621646873569, -3.384311150829128]`
  - length: `0.4634534716102427 m`
- unique reference: `wall_9d671l2wsc0l2z0i`, whose `end` is the shared corner
- angular deviation: `0.6855807826831114°`
- expected selected free endpoint: `[3.7566548243209055, -3.378765764859558]`
- free-end linked wall: `wall_gga4jfp1oa10dy2g`; its matching `start` must move to that same expected coordinate
- perpendicular wall `wall_spwze3zf32wqvlss` at the fixed corner remains unchanged

The accepted click must leave `wall_9d671l2wsc0l2z0i` byte-for-byte unchanged and preserve the selected length within numeric epsilon.

## Geometry and candidate resolution

Add the pure exported builder:

```ts
buildWallParallelAlignmentUpdates(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedWallId: AnyNodeId,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
```

Resolve the reference deterministically and fail closed:

1. Require a finite, non-zero, straight selected wall with a non-null parent.
2. Search only finite, non-zero, straight sibling walls with the same `parentId` and an endpoint equal to either selected endpoint under the existing geometry epsilon.
3. At a shared point, compare the ray toward the selected free endpoint with the ray toward the candidate free endpoint. A candidate qualifies only when those rays are opposite continuations and the deviation from 180° is at most **2°**. This matches the repository's existing weak straight-direction inference tolerance and admits the observed `0.685581°` defect without treating ordinary 5–15° bends as accidental skew.
4. Reject same-direction overlaps, perpendicular/oblique branches, endpoint-to-interior contacts, curved walls, and different-parent walls as references.
5. Require exactly one qualifying candidate across both selected endpoints. Zero candidates throw a stable `no-parallel-continuation` error; multiple candidates throw `ambiguous-parallel-continuation`. Never rank by angle, length, id, or insertion order.
6. If `joint` is the shared point, `L` is selected length, and `u` points from `joint` to the reference free endpoint, set the selected free endpoint to `joint - u * L`. Preserve which selected endpoint is the joint and which is free.
7. If the selected geometry already matches the computed result within epsilon, throw `already-parallel`; return no empty/no-op update list and create no history entry.

## Core implementation

Modify:

- `packages/core/src/lib/wall-operations.ts`
- `packages/core/src/index.ts`
- `packages/core/src/lib/wall-operations.test.ts` or a focused `wall-parallel-alignment.test.ts`
- retain and extend `packages/core/src/lib/wall-length.test.ts` only where extraction regression coverage belongs

Extract the endpoint staging and validation currently embedded in `buildWallLengthUpdates` into one private helper accepting the selected wall plus proposed `nextStart` and `nextEnd`. Both `buildWallLengthUpdates` and `buildWallParallelAlignmentUpdates` must call it. Do not export a generic raw endpoint mutation API.

The shared helper must:

- gather same-parent walls and call the existing `getLinkedWallUpdates` once, so all walls sharing a moved selected endpoint receive the identical coordinate;
- omit unchanged sibling updates, including the fixed reference wall;
- stage the complete post-operation wall map before validation and return updates only after all checks pass;
- preserve the current guards for non-finite or zero-length results, wall reversal, unsupported curved linked walls, hosted spans, and detached endpoint/interior T contacts;
- preserve doors, windows, items, ids, links, local positions, rotations, widths, styles, and metadata; recompute only the existing required item `wallT` values when an affected host length changes;
- keep the selected update first and make linked-wall and child-update order stable by id;
- remain mutation-free so a thrown error cannot partially alter the graph.

Do **not** change `getAttachmentSpan`'s wall-item yaw calculation in this feature. Its current local/world-yaw semantics are an existing, independent defect; changing them here would alter length/split validation beyond the requested alignment behavior. Keep current length-edit tests green and open that correction separately if needed.

Do not write zone geometry from this builder. The single wall batch must flow through the existing reactive space/zone reconciliation path.

## Shared UI implementation

Modify:

- `packages/editor/src/components/ui/helpers/wall-edit-controls.tsx`
- add a focused component test only if needed to prove the handler contract

In the existing single-wall branch, place an `ActionButton` labelled **인접 벽과 평행 맞춤** beside or directly below the split controls. The handler must:

1. clear the local error;
2. read the latest `useScene.getState()` snapshot;
3. reject `scene.readOnly` with a visible Korean message before planning;
4. call `buildWallParallelAlignmentUpdates(scene.nodes, wall.id)`;
5. call `scene.updateNodes(updates)` exactly once;
6. keep the selected wall selected and surface the builder's stable failure reason through the existing alert region.

`WallEditControls` is already mounted by the shared wall properties flow used from both 2D and 3D. Do not add view-specific controls or interaction-scope state.

## Manual and exposure

Modify the existing dirty files additively:

- `packages/mcp/src/modeling-agent-manual.ts`
- `packages/mcp/src/ontology-manual.test.ts`
- `packages/mcp/src/resources/resources.test.ts`
- `apps/editor/lib/ai-provider.test.ts`

Document that the shared single-wall properties panel can align one uniquely resolved same-parent continuation within 2°, preserving the shared corner, reference wall, and selected length while validating linked walls and hosted spans atomically. State explicitly that this is a direct UI capability with no AI/MCP mutation operation. Prove both `pascal://agent-guide` and `buildAiModelingPrompt` expose the canonical wording; do not duplicate the manual text elsewhere.

## Required regression coverage

Core tests:

1. Reproduce the grounded `wall_ev...` → `wall_9d...` case with exact coordinates; assert the expected selected free endpoint, exact selected length, unchanged reference and fixed-corner branch, and matching `wall_gga...` linked endpoint.
2. Cover start-joint and end-joint selected walls in both authored directions.
3. Accept a deviation below/at 2° and reject one just above 2°, a perpendicular branch, a same-direction overlap, a different-parent wall, a curved candidate, and an endpoint-to-interior contact.
4. Reject zero candidates and multiple qualifying candidates deterministically regardless of node-map insertion order.
5. Reject curved/zero-length/no-parent selected walls and an already aligned result without updates.
6. Prove all free-end linked walls receive one identical endpoint; reject atomically when a linked wall would collapse, reverse, remain curved, lose a T contact, or place an attachment outside its final host.
7. Keep all existing `buildWallLengthUpdates` behavior and error coverage green after extraction.
8. Apply the returned list through one store `updateNodes` call and prove one undo restores the exact pre-click graph and redo restores the aligned graph. Invalid/read-only paths must add no history entry.

## Verification and browser acceptance

Run, in order:

1. Focused wall-operation, wall-length, store history, and UI-handler tests.
2. Manual/agent-guide/AI-prompt exposure tests.
3. Core build, editor typecheck, changed-file Biome, relevant regression tests, and the editor production build.
4. On a disposable clone at `http://localhost:3002`, select `wall_ev1580n36u0mzfek` in 2D and click the button. Inspect stored coordinates and confirm the expected endpoint and linked `wall_gga...` endpoint, `wall_9d...` and `wall_sp...` unchanged, selected length preserved, and no unwanted zone-review regression.
5. Switch to 3D and invoke the same shared control on a reset/clone scene; confirm the same graph result and rendering.
6. Verify one Undo restores the exact original graph and one Redo restores the aligned graph; inspect the console for new errors.
7. Browser-negative checks: perpendicular-only connection, ambiguous two-reference connection, read-only scene, protected T contact, and attachment overflow show a useful error and leave graph/history unchanged.

Stop when the shared button works from both views, the grounded `0.685581°` case produces the exact expected graph, all rejection paths are atomic, one-step undo/redo is proven, manual exposure is synchronized, and all focused/static/build/browser gates pass.

## Scope and dirty-work guard

Preserve the user's existing apartment/guide/floorplan/manual/index/test changes. Apply narrow additive hunks only to the files above; do not restore, stage, reformat, or overwrite unrelated work. Root owns final integration, browser evidence, commit, and deployment.

Approved planning profile: `gpt-5.6-sol`, reasoning `high`.
