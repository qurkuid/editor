# Connected Wall Parallel Align — Implementation Contract

## Outcome

Add one **벽 평행 맞춤** button to the existing single-wall `WallEditControls`. From either 2D or 3D selection, one click straightens a slightly skewed connected wall against one automatically resolved adjacent continuation wall.

The operation keeps the reference wall byte-for-byte unchanged, keeps the shared corner exact, preserves the selected wall's current centreline length, and rotates only the selected wall's free endpoint onto the reference axis. Walls sharing that free endpoint follow through the existing linked-endpoint rules. The whole accepted result commits through one `updateNodes(...)` call and undoes in one step.

This is a direct shared UI capability. Do not add an AI/MCP operation, reference-pick mode, shortcut, schema field, or reuse the furniture-only `wall-align-pick` flow.

## Current evidence and constraints

- `packages/editor/src/components/ui/helpers/wall-edit-controls.tsx` is already the shared single-wall control rendered by `packages/nodes/src/wall/panel.tsx`; the same selected wall data drives 2D and 3D.
- `packages/core/src/lib/wall-operations.ts` already owns `buildWallLengthUpdates`, attachment span checks, T-junction validation, and linked endpoint propagation through `getLinkedWallUpdates`.
- `packages/core/src/systems/wall/wall-move.ts` owns the endpoint propagation contract. Reuse it; do not implement a second adjacency cascade.
- `packages/editor/src/lib/wall-align-pick.ts` aligns floor-placed furniture flush to a clicked wall and is unrelated to wall topology.
- Wall-attached item yaw is wall-local (`wiki/architecture/tools.md`, “Wall-attached node rotations must be wall-local”). The existing item span calculation in `wall-operations.ts` subtracts wall yaw and must not be reused unchanged for a wall rotation.
- `initSpaceDetectionSync` reacts to one wall graph update and reconciles derived spaces/zones with history paused. Let that existing path run; do not emit separate zone writes from the button.
- Starting point is HEAD `d121617a5a9bc6b3f53f6d1811fb8d17d01e69a0` on `deploy/floorplan`. Preserve all pre-existing dirty guide, apartment trace/import, floorplan panel, core index, manual, ontology, and output changes.

## Geometry and reference contract

Implement one pure exported builder, tentatively:

```ts
buildWallParallelAlignmentUpdates(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedWallId: AnyNodeId,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
```

Reference resolution is automatic and fails closed:

1. The selected wall must be straight, finite, non-zero length, and have a parent.
2. Candidate references are straight, finite sibling walls with the same `parentId` that share exactly one selected endpoint.
3. From the shared point, the candidate ray and selected free-end ray must point in opposite directions and differ from a straight continuation by at most `DEFAULT_ANGLE_STEP` (15°). A perpendicular branch is never a fallback.
4. Exactly one candidate must qualify. Zero candidates return a stable “no near-parallel continuation” error; two or more return an ambiguity error. Do not rank candidates or guess by insertion order.
5. Keep the shared point fixed. Let `L` be the selected wall's current centreline length and `u` the unit vector from the shared point toward the reference wall's free endpoint. Set the selected free endpoint to `shared - u * L`, preserving whether the free endpoint is `start` or `end`. This preserves nominal length and authored wall direction while making the two walls exactly collinear.
6. If the selected wall is already aligned within geometry epsilon, return a stable no-op/already-aligned error so the click creates no history entry.

## Implementation tasks and bounded ownership

### 1. Share endpoint-update validation in core

Modify only:

- `packages/core/src/lib/wall-operations.ts`
- `packages/core/src/index.ts`
- add `packages/core/src/lib/wall-parallel-alignment.test.ts`

Extract the mutation-free endpoint staging/validation currently embedded in `buildWallLengthUpdates` into a private helper that accepts a selected wall's proposed `nextStart`/`nextEnd`. Both length editing and the new parallel-align builder must use it.

The shared helper must:

- call `getLinkedWallUpdates` for same-parent walls so every wall sharing a moved selected endpoint receives the identical coordinate;
- stage all affected walls before validating and return updates only after every check succeeds;
- reject a collapsed, reversed, curved, non-finite, or direction-flipped affected wall;
- reject loss of any existing endpoint/interior T contact using the current before/after segment checks;
- validate doors, windows, and wall-hosted items against every affected final host span;
- treat wall-attached item rotation as wall-local when projecting its footprint (`localYaw = item.rotation[1]`), then recompute item `wallT` when an affected host length changes;
- leave child local `position`, local rotation, ids, parent/wall links, metadata, widths, and wall styles unchanged so hosted children follow the rotated wall frame naturally;
- return deterministic update ordering: selected wall first, linked walls by stable id, then required child `wallT` updates by stable id.

`buildWallLengthUpdates` must retain its existing public behavior and error coverage after the extraction. Export only `buildWallParallelAlignmentUpdates`; keep the lower-level endpoint validator private to avoid a new generic mutation API.

### 2. Add the shared one-click UI

Modify only:

- `packages/editor/src/components/ui/helpers/wall-edit-controls.tsx`

Within the existing single-wall branch, add a full-width or sibling `ActionButton` labelled **벽 평행 맞춤** near the split control. On click:

1. clear the existing local error;
2. read the latest scene snapshot;
3. build the complete update list with `buildWallParallelAlignmentUpdates`;
4. call `scene.updateNodes(updates)` exactly once;
5. keep the selected wall selected and surface stable Korean messages for no reference, ambiguous reference, already aligned, read-only, detached junction, collapsed/reversed neighbor, curve, and attachment overflow.

Do not arm a canvas pick mode, change interaction scope, or add separate 2D/3D controls. Invalid and read-only attempts must leave scene nodes and history depth unchanged.

### 3. Lock history, manual, and exposure contracts

Modify only:

- `packages/core/src/store/use-scene-dirty-tracking.test.ts`
- `packages/mcp/src/modeling-agent-manual.ts`
- `packages/mcp/src/resources/resources.test.ts`
- `apps/editor/lib/ai-provider.test.ts`

Add one store-level fixture that applies the builder output through a single `updateNodes` call, verifies one undo restores the exact pre-click wall/child graph, and redo restores the aligned graph.

Add a concise canonical manual paragraph stating that the single-wall properties panel can auto-align one slightly skewed connected continuation, uses exactly one same-parent near-parallel reference, preserves selected length/shared corner/reference geometry, moves linked free-end siblings, validates hosted spans and junctions atomically, and remains a direct UI-only capability with no AI/MCP mutation operation. Assert the same wording is exposed by `pascal://agent-guide` and `buildAiModelingPrompt`.

## Focused acceptance tests

Core tests must cover:

1. End-to-start and start-to-end continuations in both authored directions produce exact collinearity, preserve selected length, and do not modify the reference.
2. A 1–10° skew within the 15° threshold aligns; an exactly perpendicular branch and a same-direction overlapping ray are rejected as no reference.
3. Two qualifying continuation candidates reject deterministically regardless of node-map insertion order.
4. A selected wall with no parent, a curved/zero-length selected wall, a curved/zero-length reference, and an already-aligned wall reject without updates.
5. Two or more walls sharing the selected free endpoint receive the same new endpoint. A downstream collapse/reversal or curved linked wall rejects the entire operation.
6. Existing interior T contacts on the selected or moved linked walls remain valid or cause atomic rejection; no contact may silently detach.
7. A door, window, and wall-hosted item retain local position/rotation and links while their world transform follows the rotated host. A rotated item fixture proves span projection uses wall-local yaw; host overflow rejects with no partial updates.
8. `buildWallLengthUpdates` regressions remain green after the shared validator extraction.
9. One store commit creates one undo step; undo/redo restores exact graphs and invalid attempts add no history.

## Verification gates

Run in this order after implementation:

1. `bun test packages/core/src/lib/wall-parallel-alignment.test.ts packages/core/src/lib/wall-length.test.ts packages/core/src/store/use-scene-dirty-tracking.test.ts`
2. `bun test packages/mcp/src/ontology-manual.test.ts packages/mcp/src/resources/resources.test.ts apps/editor/lib/ai-provider.test.ts`
3. `bun run --cwd packages/core build`
4. `bun run --cwd apps/editor check-types`
5. `bunx biome check` on the changed files only.
6. `bun run --cwd apps/editor build`
7. In the existing `http://localhost:3002` session, use a disposable/clone scene: select a slightly crooked connected wall in 2D, click **벽 평행 맞춤**, inspect stored endpoints/children and zone result, switch to 3D for the same geometry, then verify Undo and Redo each require one action and the browser console remains clean.
8. Browser-negative cases: perpendicular-only connection, two valid references, a protected T contact, and hosted-span overflow each show a useful error with unchanged scene and undo depth.

Stop when the button is visible for one selected wall in both editor surfaces, the accepted geometry and dependent graph match the contract, all rejection paths are atomic, one-step undo/redo is proven, manual exposure tests pass, and the real 2D→3D browser flow has zero new console errors.

## Dirty-work and handoff guard

The implementation owner may edit only the files listed above. Apply additive hunks around the user's existing changes in `packages/core/src/index.ts`, `packages/mcp/src/modeling-agent-manual.ts`, and tests; do not restore, reformat, stage, or overwrite unrelated work. Root owns deployment and production evidence after local verification.

Model relay note: this draft was prepared in the resolved `gpt-5.6-sol` **medium** planner profile, while `develop-pascal-editor` requires Sol **high** for the approved planning contract. A Sol/high planner must review and approve this artifact before assigning implementation to the fixed `luna-max` lane, and the implementation handoff must verify Luna/max actually resolved.
