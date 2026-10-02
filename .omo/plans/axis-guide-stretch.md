# Axis Guide Stretch — Implementation Contract

## Outcome and scope

Add a direct 2D workflow that places a model-axis construction guide and stretches the same-level wall graph by an exact signed distance on one chosen side of that guide.

- A **vertical** guide is parallel to model Z and moves geometry on X. Its actions are **Left (X−)** and **Right (X+)**.
- A **horizontal** guide is parallel to model X and moves geometry on Z. Because stored positive Z maps to downward SVG Y, its screen actions are **Up (Z−, side −1)** and **Down (Z+, side +1)**.
- Axes are the existing building/level-local XZ frame. A rotated plan view does not rotate the operation; users can use the existing north-alignment control when they want model axes shown upright.
- Walls wholly on the chosen side translate rigidly. Straight walls crossing the guide change only their X or Z extent. The opposite side and points on the guide remain fixed.
- Hosted doors/windows and zones stay synchronized. Applying is one undo step; closing, deselecting, or pressing Escape before Apply makes no scene change.
- This first slice is a **wall-layout stretch**. It does not translate furniture, slabs, ceilings, roofs, Bodies, dimensions, other guides, or annotations. Do not add an AI/MCP mutation operation or a 3D authoring control.

The existing reference-offset Guide Line remains unchanged. Add two direct placement entries alongside it: **Vertical Guide** and **Horizontal Guide**. Each is one click to place and then returns to Select with the new guide selected. The selected guide exposes a unit-aware distance field and the two orientation-appropriate Apply buttons. No drag preview is required.

## Current ownership and root gap

- `packages/core/src/schema/nodes/construction-guide.ts` already defines the infinite level-local guide as `origin` + `direction`.
- `packages/nodes/src/construction-guide/floorplan-tool.tsx` only supports the two-step reference/parallel-offset flow. It already receives loose `toolDefaults`, has coordinate conversion and grid snapping, and commits a guide.
- `packages/editor/src/components/ui/action-menu/measurement-control.tsx` has one Guide Line entry and activates the registered `construction-guide` tool.
- `packages/nodes/src/construction-guide/definition.ts` currently sets `presentation.actionMenu: false`, so selected guides cannot host exact stretch controls.
- `packages/editor/src/components/editor-2d/floorplan-registry-action-menu.tsx` owns selected registered-node controls. Its generic DOM-bounding-box anchor is unsuitable for an infinite line; a guide needs an anchor derived from its model origin through the floorplan CTM.
- Core has wall, hosted-attachment, space detection, and zone reconciliation primitives, but no single pure half-plane stretch planner. Do not assemble this geometry piecemeal in React.

## Files and responsibility

### Core: pure validation and update plan

Add:

- `packages/core/src/lib/axis-guide-stretch.ts`
- `packages/core/src/lib/axis-guide-stretch.test.ts`

Export the public types/function from `packages/core/src/index.ts` without disturbing its existing dirty guide-perspective export.

Recommended contract:

```ts
type AxisGuideStretchRequest = {
  guideId: AnyNodeId
  side: -1 | 1
  distance: number // signed metres; final axis delta = side * distance
}

type AxisGuideStretchPlan = {
  axis: 'x' | 'z'
  delta: number
  updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  affectedIds: AnyNodeId[]
}

function buildAxisGuideStretchPlan(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  request: AxisGuideStretchRequest,
): AxisGuideStretchPlan
```

Use a typed error with stable codes for UI/tests. The planner must be side-effect free and either return the complete plan or throw before any mutation.

Validation and geometry rules:

1. Resolve the guide and its parent level. Reject a missing parent, non-finite/zero distance, zero direction, and a non-axis-aligned guide. Normalize direction; accept only parallel-to-X or parallel-to-Z within the repository geometry epsilon.
2. Define a single piecewise coordinate transform on the movement axis:
   - coordinate strictly on the selected half-plane → `coordinate + delta`;
   - coordinate on the guide or on the fixed half-plane → unchanged.
   Use one epsilon and one classification result per endpoint so shared junctions receive exactly identical coordinates.
3. Apply it only to same-level walls:
   - both endpoints selected → translate both; preserve length, angle, thickness, curve data, metadata, ids, parent/children;
   - neither endpoint selected → unchanged;
   - one endpoint selected → fixed endpoint stays exact and selected endpoint moves only on X or Z.
4. A crossing wall is supported only when straight and parallel to the movement axis. Reject a curved or oblique crossing wall atomically; do not silently skew it, flatten it, split it, or approximate it. A curved wall wholly on the moving side is a rigid translation and remains supported.
5. Reject a result that collapses/reverses a wall, breaks a shared junction, detaches a T/X contact, or creates invalid non-finite geometry. Reuse existing wall/contact/attachment helpers instead of adding a looser alternate path.
6. Preserve authored short walls. Never use a post-hoc minimum-length deletion threshold.

Hosted attachment rules:

- Cover door, window, and wall-hosted item forms already recognized by the wall-operation helpers.
- Compute each child’s original world center on its original host before changing any wall.
- If its host translates rigidly, retain its wall-local coordinate; it follows the host rigidly.
- If its straight host stretches, classify the **center**, not the full opening footprint, against the guide. A center on the selected half-plane moves by the same axis delta; a center on the fixed side or exactly on the guide remains fixed. Preserve width, height, handedness/swing, side, rotation, metadata, ids, and parent/wall links, then recompute the host-local position and `wallT` from the intended world center on the updated host.
- A door/window may straddle the guide. That alone is valid and must not block a central living-room stretch.
- After remapping, validate the full rigid footprint is still inside the final host and does not introduce or worsen a hosted-span collision. Existing unrelated overlap must not become a blanket blocker. Compression that cannot keep every attachment valid rejects the entire plan.

Zone rules:

- Build an in-memory post-wall set before producing zone updates.
- For `autoFromWalls` zones, run `detectSpacesForLevel` and `planAutoZonesForLevel` with previous spaces and changed walls. Include the returned polygon, boundary ids, and review metadata updates in this plan; do not wait for a later reactive sync or create a second undo entry.
- For manual/semantic zones, apply the same piecewise axis transform to polygon vertices so named open-space subdivisions follow the wall layout while retaining name, color, class, source metadata, and `autoFromWalls: false`.
- Reject manual polygons that become non-finite, degenerate, or self-intersecting after compression.
- Leave other levels untouched.

### Nodes: direct guide placement

Modify:

- `packages/nodes/src/construction-guide/floorplan-tool.tsx`
- `packages/nodes/src/construction-guide/definition.ts`
- add focused pure/tool tests beside the construction-guide implementation as fits the current test pattern.

Read `toolDefaults.mode` as `reference-offset | vertical | horizontal`; absent defaults preserve `reference-offset`.

- `vertical`: preview `[0, 1]`, grid-snap only cursor X, click commits origin `[snappedX, cursorZ]`.
- `horizontal`: preview `[1, 0]`, grid-snap only cursor Z, click commits origin `[cursorX, snappedZ]`.
- One click creates one guide, selects it, clears the construction-guide defaults, and calls `finishTool()` so the contextual controls appear.
- Escape before click clears preview/defaults and exits with no node/history entry.
- Keep the current reference-pick → offset → repeated-place behavior and typed offset input unchanged.
- Update definition hints/description for both placement modes and enable its 2D action menu. Keep the node invisible in 3D as reference geometry.

### Editor: visible entry and exact apply controls

Modify/add:

- `packages/editor/src/components/ui/action-menu/measurement-control.tsx`
- `packages/editor/src/components/editor-2d/floorplan-registry-action-menu.tsx`
- `packages/editor/src/components/editor-2d/construction-guide-stretch-controls.tsx`
- component tests beside those files
- `packages/editor/src/i18n/dictionary/action-menu.ts` (and existing locale files only if this dictionary pattern requires them)

Measurement menu:

- Keep **Guide Line** for reference-offset placement.
- Add **Vertical Guide** and **Horizontal Guide**, each setting `toolDefaults('construction-guide', { mode })`, switching to structure/elements, 2D, build, and the registered tool.
- Active state distinguishes all three modes.

Selected-guide controls:

- Anchor the floating menu at `guide.origin` transformed with `[data-floorplan-scene]`’s SVG CTM, not the infinite SVG line’s bounding box.
- Render a compact unit-aware distance input plus `Left (X−) / Right (X+)` for vertical or `Up (Z−) / Down (Z+)` for horizontal. Reuse `parseSignedDraftLength` and the viewer’s unit/metric notation. Positive input stretches outward in the button direction; negative input compresses toward the fixed side.
- Disable Apply for empty, invalid, or zero input and for a diagonal guide. Surface planner errors in the control without mutating the scene.
- On Apply: snapshot current nodes, call the core planner, then pass its complete update array to **one** `useScene.getState().updateNodes(...)` call inside the established single-history helper only if store behavior requires it. Never write per wall and never mutate during validation.
- On successful Apply, keep the guide selected and fixed, clear the field/error, and emit one suitable completion SFX.
- Escape closes/clears this control without changing nodes. Deselect/unmount also discards only local input/error state.

Do not add this operation to the generic 3D floating menu. The operation is authored in 2D, while the committed scene data must render consistently in 3D.

### Manual and exposure

Modify only the canonical manual and its existing exposure tests:

- `packages/mcp/src/modeling-agent-manual.ts`
- `packages/mcp/src/ontology-manual.test.ts`
- `apps/editor/lib/ai-contract.test.ts`

Document the visible direct workflow, model-axis behavior, supported walls/attachments/zones, center-based opening rule, atomic rejection cases, one-undo behavior, and 2D authoring/3D result. Do not add an AI/MCP command or imply that the modeling agent can invoke the UI-only stretch operation. The tests should prove `pascal://agent-guide` and `buildAiModelingPrompt` expose the same canonical manual wording.

## Regression and acceptance tests

### Pure core fixtures

1. Vertical guide, X+ and X−, outward and compression:
   - fixed-side wall endpoints are byte-for-byte unchanged;
   - a straight horizontal crossing wall changes only its selected X endpoint;
   - a wholly selected-side wall translates both endpoints by the exact delta;
   - shared junction coordinates remain exact and topology ids remain stable.
2. Horizontal guide repeats the same matrix for Z+ and Z−.
3. A wall ending exactly on the guide stays anchored there; a wall lying on the guide is unchanged.
4. Curved wall wholly on the moving side translates without changing `curveOffset`; curved crossing and oblique straight crossing reject with zero updates.
5. Reject non-axis guide, missing/wrong-level guide, NaN/infinite/zero distance, collapse/reversal, detached T/X topology, and invalid final geometry.
6. Door/window fixtures on a stretching host:
   - selected-side center moves exactly by delta;
   - fixed-side and on-guide centers remain exact;
   - an opening whose width straddles the guide succeeds when its final host span is valid;
   - width, swing/hinge, side, rotation and metadata remain unchanged;
   - recomputed local coordinate/`wallT` yields the expected world center;
   - host overflow or post-compression span collision rejects the whole plan.
7. Auto zone polygon and `boundaryWallIds` equal the post-wall detected space. Manual zone vertices receive the piecewise transform and preserve semantic metadata. Degenerate/self-intersecting manual results reject atomically.
8. Guide, other levels, unrelated annotations, furniture, slabs/ceilings/roofs/Bodies, and free items are unchanged.
9. Returned updates are deterministic regardless of node-map insertion order.

### UI/tool tests

1. Each measurement menu option sets the exact construction-guide mode and 2D tool state.
2. Direct vertical/horizontal placement uses the model axes under a rotated view, snaps only the fixed coordinate, commits on one click, selects the guide, and exits to Select.
3. Escape before placement creates no node and no undo entry; reference-offset placement retains its existing two-step/repeated flow.
4. Selected guide shows the correct labels, parses metric/imperial signed lengths, dispatches the correct side and distance, and reports planner errors without updates.
5. One Apply produces one history entry. Undo restores the exact pre-operation scene graph including wall endpoints, host-local attachment data, zone polygons/boundaries/metadata, and guide; redo restores the exact final graph. Selection remains on the guide as UI state and is not part of graph equality.

## Browser plan owned by root

Use the untouched-safe clone scene `128765970842` on the existing `localhost:3002` session/tab. Do not alter the original user scene.

1. Open the measurement menu, place a vertical guide in one click, confirm selection and contextual distance controls.
2. Enter `500mm`, apply Right/X+, and verify stored coordinates: left/fixed wall graph unchanged, crossing wall selected endpoint +0.5 m on X only, right-side walls translated rigidly, guide unchanged.
3. Use the current Centum Richville living-room case where the guide crosses the long lower window. Verify the operation succeeds, the window width stays exact, its center follows the center-half rule, it remains hosted and collision-free, and all 16 openings remain present.
4. Verify 12 zones remain present; the nine wall-derived zones match post-stretch detected polygons/boundary ids, while manual semantic zones retain identity/metadata and follow the stretch.
5. Undo once and compare the whole graph to the pre-apply snapshot; redo once and compare to the post-apply snapshot.
6. Repeat with a horizontal guide and one Z direction after undo or on a separate clone.
7. Exercise a curved-crossing fixture, an oblique-crossing fixture, and a compression that invalidates an opening span. Each must show a useful error and leave graph plus undo depth unchanged.
8. Switch to 3D and confirm walls/openings/zones reflect the same committed result; construction guide remains 2D-only. Check console errors are zero.

## Verification gates

Run in order after implementation:

1. Focused failing-then-passing tests for the core planner, construction-guide direct placement, measurement menu, stretch controls, and manual exposure.
2. Relevant regressions: `wall-operations`, `space-detection`, construction-guide floorplan/affordance, floorplan registry action menu, door/window hosted placement, and undo/history tests.
3. `bun run --cwd packages/core build`
4. `bun run --cwd packages/nodes build`
5. `bun run --cwd apps/editor check-types`
6. `bunx biome check` on only the changed files.
7. `bun run --cwd apps/editor build`
8. Root’s real-browser sequence above.

Stop only when the direct UI is visible, every supported mutation is planned before the sole commit, invalid cases prove no partial writes/history, one-step undo/redo is exact, and 2D/3D stored-result parity is browser-verified.

## Dirty-work guard

The working tree already contains unrelated apartment trace/import-frame, apartment vector, guide perspective/schema/renderer, floorplan panel, core index, and modeling-manual work. Preserve it. In particular, edit `packages/core/src/index.ts`, `packages/mcp/src/modeling-agent-manual.ts`, and their tests additively around the current contents; do not restore, reformat, stage, or copy over unrelated hunks. Do not touch the apartment vector/import-frame or guide perspective implementations for this feature.
