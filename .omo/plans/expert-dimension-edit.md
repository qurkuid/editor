# Expert Dimension Editing — Implementation Contract

## Outcome

In 2D **Expert** mode, every generated dimension label remains visibly selectable. A supported label accepts an exact unit-aware target length and moves the wall graph needed to produce that displayed length. The user chooses which end remains fixed. The operation preserves the other independent leaf intervals in the same dimension chain, updates hosted openings and zones, commits once, and undoes once.

“Other dimensions stay unchanged” has one physically consistent boundary: **independent leaf intervals in the selected dimension chain** stay unchanged. A dimension in another chain that shares moved walls may necessarily change. Show this before Apply in plain Korean:

> 같은 치수열의 다른 구간은 유지됩니다. 같은 벽을 공유하는 다른 치수열은 함께 변할 수 있습니다.

This feature edits the model from real generated dimensions. It must never infer intent from rounded label text, DOM position, nearest wall, screen X/Y, or a raster/background plan.

## Supported displayed dimensions

1. Wall construction leaf intervals emitted by `packages/nodes/src/wall/construction-dimensions.ts`, including partition/gap chains and opening-width leaves.
2. Wall construction totals. A total is editable by choosing the leaf that absorbs the total delta; default to the end leaf when the start is fixed and the start leaf when the end is fixed. Every other leaf in that chain remains unchanged.
3. Room clear dimensions emitted by `packages/nodes/src/zone/room-clear-dimensions.ts`, including rectangle and rectilinear inside-face/finish-face spans. These are mandatory, not a later phase.
4. Nominal and documented opening spans when the generator can attach exact opening provenance.

Every generated label is clickable in Expert mode. If a generated dimension does not map to a unique wall-translation operation, the popover opens read-only with a specific reason. Examples are a shared-wall `R-R` thickness dimension, a curved-wall sagitta dimension, or a structural datum with no unique movable wall group. Do not silently ignore the click and do not guess.

## Current gap and governing architecture

- `packages/core/src/registry/types.ts` carries dimension geometry but no typed edit provenance.
- `packages/nodes/src/wall/construction-dimensions.ts` computes semantic tiers and chains, then `packages/nodes/src/shared/dimension-string.ts` reduces them to points/text. Wall ids, opening ids, leaf identity, and total decomposition are lost before rendering.
- `packages/nodes/src/zone/room-clear-dimensions.ts` computes exact inside/finish face spans, but `FaceLine` does not retain the contributing wall/face provenance needed for a unique move.
- `packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx` renders labels with no edit callback; dimension strings are pointer-inert.
- `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx` owns screen-only SVG interaction and Expert-mode state. It is the correct place to gate label interaction. PDF/document geometry must remain inert.
- `packages/core/src/lib/axis-guide-stretch.ts` already owns atomic wall/attachment/zone planning. Reuse its validation and mutation planning through a generic planar half-plane basis. Do not duplicate a second wall topology engine in React or Nodes.
- Plan coordinates are level-local XZ. SVG Y is stored Z, and view rotation affects presentation only. A displayed span may be almost axis-aligned without being axis-exact.

The concrete live label `2067` spans `[-4.596221249620497, -2.7958181493905245]` to `[-2.5296449018689158, -2.795912981271388]` (about `-0.002629°`). It must edit along that exact normalized tangent. Axis snapping or `1e-6` coordinate equality is not acceptable.

## Data contract: preserve provenance through rendering

Modify `packages/core/src/registry/types.ts` with a serializable, render-only descriptor that is optional on a single `dimension` and on each `dimension-string` segment. The descriptor is generated from the model each render and is not stored on scene nodes.

Recommended shape:

```ts
type FloorplanDimensionEditDescriptor = {
  id: string
  status: 'editable' | 'read-only'
  readOnlyReason?: string
  levelId: AnyNodeId
  kind: 'leaf' | 'total' | 'opening-width' | 'room-clear'
  measuredStart: FloorplanPoint
  measuredEnd: FloorplanPoint
  fixedEndOptions: readonly ['start', 'end']
  leaves: readonly FloorplanDimensionEditLeaf[]
  defaultLeafId?: string
  opening?: {
    openingId: AnyNodeId
    reference: 'nominal' | 'rough-opening' | 'masonry-opening' | 'finish-opening'
    displayedField: 'width' | 'roughOpeningWidth' | 'masonryOpeningWidth' | 'finishOpeningWidth'
  }
}
```

Each leaf contains its exact start/end, current model-space length, semantic id, and the wall/face provenance required to validate it. A total includes an ordered decomposition into the independent leaves that generated the visible total. IDs must be deterministic across rerenders from semantic provenance, not array position alone.

Modify:

- `packages/nodes/src/shared/dimension-string.ts` to preserve the descriptor per segment.
- `packages/nodes/src/wall/construction-dimensions.ts` to retain leaf, chain, wall, and opening provenance until `FloorplanGeometry` is emitted.
- `packages/nodes/src/zone/room-clear-dimensions.ts` to retain contributing wall ids and face side through line merging and attach a unique room-clear edit descriptor. If merging produces multiple equally valid movable boundaries, mark it read-only with a reason.

The renderer callback receives this exact descriptor. It must not reconstruct provenance from text or coordinates.

## Pure core planner

Refactor `packages/core/src/lib/axis-guide-stretch.ts` so its existing axis-guide API is unchanged, while internal geometry accepts a normalized planar basis:

- movement unit vector `u` is the selected displayed leaf tangent;
- cut origin is the midpoint of that leaf;
- signed coordinate is `dot(point - cutOrigin, u)`;
- fixed-start translates the far/end half-plane by `u * delta`;
- fixed-end translates the far/start half-plane by `-u * delta`;
- `delta = targetLeafLength - currentLeafLength`.

Expose a pure `buildDimensionStretchPlan(nodes, request)` from core. The request includes the descriptor, positive finite target distance, fixed end, and for a total the selected leaf id. The planner returns the complete deterministic update list or throws a typed error before mutation.

For a total, compute `totalDelta = targetTotal - currentTotal` and apply it to the explicitly selected leaf. The selected leaf target is `currentLeaf + totalDelta`; reject a non-positive result. Verify the regenerated mathematical total equals the requested target and every other leaf length in that chain is unchanged within the construction-dimension tolerance.

### Geometry rules

1. Use the exact model-space tangent from the displayed span. Do not canonicalize near-horizontal or near-vertical dimensions to X/Z.
2. A straight wall crossing the cut may stretch only when its centerline is parallel to `u` within the established angular tolerance. Use normalized cross product/angle, not raw coordinate epsilon. A wholly selected wall translates rigidly. A curved wall may translate rigidly when wholly selected; a curved crossing rejects atomically.
3. Preserve shared junction coordinates from one canonical point transform. Reuse the existing wall contact and attachment validators. Reject collapse, reversal, lost T/X contacts, non-finite geometry, or newly invalid overlaps.
4. Near-axis imported noise is supported when the affected walls are consistently parallel to the exact displayed tangent. A topology that cannot satisfy that exact basis returns a typed unsupported error and makes no mutation. Do not silently axis-snap it.
5. Manual zone vertices receive the same piecewise planar transform. Wall-derived zones are reconciled from the complete post-wall snapshot with the existing space detection/reconciliation path.
6. Keep the old `buildAxisGuideStretchPlan` behavior and tests byte-for-byte compatible by wrapping the same generic planner with its X/Z basis.

Before UI integration, add a reduced fixture using the real 2067mm coordinates and the relevant imported wall contacts. Changing this live span to 2200mm **must succeed**, produce the exact displayed target, and preserve every existing wall contact. A typed rejection remains valid for genuinely unsupported geometry, but is not an acceptable result for this known scene. The common room-clear and wall-gap cases in the live scene must also plan successfully.

### Openings and documented widths

- For a normal gap/room stretch, a hosted opening stays rigid. Its center follows the half-plane containing its center; width, documentation metadata, handedness/swing, height, side, and rotation remain unchanged. Recompute its host-local position/`wallT` and validate its full final footprint and host collisions.
- For an opening-width leaf, keep the chosen jamb fixed, change the physical opening width by the leaf delta, shift its center by half that delta, and translate the far wall group by the full delta. Validate the final host range/collisions atomically.
- If the visible reference is RO/MO/FO, compute the existing documented offset from exact provenance. The new physical nominal width is `targetDisplayed - existingOffset`; update the corresponding documented field to `targetDisplayed` so the offset remains invariant. Reject non-positive nominal width or missing/ambiguous provenance with a visible read-only reason.
- An opening footprint crossing the cut is not itself an error. Final host containment and collision validity decide acceptance.

## Expert-mode interaction

Modify:

- `packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx`
- `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx`
- add `packages/editor/src/components/editor-2d/expert-dimension-edit-popover.tsx`
- add focused component tests beside them
- add Korean strings through the existing editor dictionary path

Interaction contract:

1. Enable label hit areas only for screen rendering while 2D Expert mode, Select tool, and idle interaction scope are active. Document/PDF output and ordinary 2D mode remain pointer-inert.
2. Bind the hit area to the final collision-adjusted label position and exact segment descriptor. Add a stable `data-floorplan-dimension-edit-id` for browser tests. Selecting a label highlights that label/ticks above other annotations without changing scene selection.
3. Open a compact popover anchored to the clicked label. Show the current formatted value, a target input parsed with `parseDraftLength`, and two explicit fixed-end actions. The input is an absolute positive target length, not a signed delta.
4. For a total, show a mandatory **변경 구간** selector populated by its leaf decomposition. Preselect the contract default but keep the choice visible before Apply.
5. For a read-only descriptor, keep the label clickable and show the exact reason. Do not render a disabled label with no explanation.
6. Escape, clicking elsewhere, leaving Expert mode, changing tool, or unmounting closes the popover without a scene/history write.
7. On Apply, snapshot current nodes, call the pure planner, and commit its full update list through one scene history transaction and one batched update. Reuse/extract the already proven pause-space-detection/manual-space-cache/apply/refresh sequence from `construction-guide-stretch-controls.tsx`; do not create a competing reactive zone path.
8. Keep the popover open on validation error and show the typed message. On success, refresh generated geometry, show the requested formatted result, and close or retain a clear success state. One Undo restores the exact pre-edit graph; one Redo restores the exact final graph.

No 3D authoring control is added. The committed walls/openings/zones must render with the same geometry in 3D.

## Exact file map

### Core

- `packages/core/src/registry/types.ts` — optional typed edit descriptor on `dimension` and per `dimension-string` segment.
- `packages/core/src/lib/axis-guide-stretch.ts` — extract/reuse planar half-plane engine; add dimension request/plan without changing axis-guide behavior.
- `packages/core/src/lib/axis-guide-stretch.test.ts` and/or `packages/core/src/lib/dimension-stretch.test.ts` — generic basis, atomic validation, old API compatibility, near-axis fixture.
- `packages/core/src/index.ts` — additive exports only; preserve current dirty guide-related hunks.

### Nodes

- `packages/nodes/src/shared/dimension-string.ts` — carry descriptor through grouped strings.
- `packages/nodes/src/wall/construction-dimensions.ts` and focused tests — wall/opening leaf provenance, total decomposition, deterministic IDs.
- `packages/nodes/src/zone/room-clear-dimensions.ts` and tests — face provenance and editable room-clear spans; explicit read-only thickness/ambiguous cases.
- `packages/nodes/src/wall/floorplan.ts` and `packages/nodes/src/zone/floorplan.ts` tests only as needed to prove Expert geometry exposure; do not add mutation logic there.

### Editor

- `packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx` and tests — exact label/segment hit target and selected visual.
- `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx` and tests — Expert/select/idle gate, selection state, exact callback.
- `packages/editor/src/components/editor-2d/expert-dimension-edit-popover.tsx` and tests — unit parsing, fixed end, total leaf selector, read-only/error/cancel/apply UI.
- Extract a small shared atomic scene-apply helper from `packages/editor/src/components/editor-2d/construction-guide-stretch-controls.tsx` only if needed so guide and dimension edits share zone pause/cache/history behavior.
- Existing i18n dictionary files — Korean labels, preservation note, typed error text.

### Manual/exposure

- `packages/mcp/src/modeling-agent-manual.ts`
- `packages/mcp/src/ontology-manual.test.ts`
- `apps/editor/lib/ai-contract.test.ts`

Document the visible Expert-mode workflow, same-chain preservation boundary, totals leaf choice, exact local-XZ tangent under rotated view, supported openings/zones, explicit unsupported reasons, atomicity, and one-undo behavior. Do not add an AI/MCP mutation operation.

## Regression tests

### Core and Nodes

1. Exact arbitrary tangent: grow and shrink a non-axis leaf; fixed side is byte-exact, far side translates rigidly, selected displayed distance equals target, and same-chain peer leaves are unchanged.
2. Real near-axis fixture using the 2067mm points above: `2200mm` produces 2.200m on the exact tangent without X/Z canonicalization; contact topology remains valid.
3. Total edit: select total, choose each possible leaf, apply total delta to that leaf only, preserve all peers, derive the requested total, and reject a collapsed chosen leaf.
4. Rectangle and rectilinear room-clear dimensions: inside/finish face distance reaches target; opposite boundary is fixed; wall thickness remains; the orthogonal independent span is unchanged.
5. Ambiguous merged faces and `R-R` wall-thickness dimensions emit stable read-only descriptors with reasons.
6. Ordinary opening gap edit preserves opening width/metadata and rigidly remaps its center. Opening-width edit keeps one jamb fixed, reaches target, and preserves neighboring chain intervals.
7. Nominal/RO/MO/FO fixtures preserve their existing documented offsets and update the correct fields. Missing provenance is read-only, never guessed.
8. Auto zones match post-wall detection/reconciliation. Manual zone identity/metadata survive the piecewise transform. Invalid polygons, host overflow, collision, lost junction, wall reversal/collapse, oblique or curved crossing reject with zero updates.
9. Old axis-guide tests remain unchanged and passing. Insertion order does not change update order/results.

### Editor

1. Labels are interactive only in screen Expert + Select + idle; normal mode, another tool, active drag, PDF, and document export remain inert.
2. A grouped dimension string dispatches the exact clicked segment descriptor, including colliding/overlapping labels; no coordinate/text reverse lookup occurs.
3. Metric, millimetre, and imperial absolute target input parses correctly; empty, zero, negative, and invalid values cannot apply.
4. Fixed-start/end dispatches the correct direction. Total selector defaults correctly and sends the explicitly selected leaf.
5. Read-only reasons, typed planning failures, Escape, outside click, mode/tool change, and successful Apply have the specified UI/history behavior.
6. Apply performs one batched mutation and one history entry. Undo/redo restores exact walls, hosted data, zone polygons/boundaries/metadata, and documentation fields.

## Real-browser acceptance owned by root

Use the safe clone scene `128765970842` on `localhost:3002`; do not alter the user's original scene.

1. Enable Expert mode at the existing 45° view rotation. Confirm generated numeric labels, not raster/background text, receive hover/click affordance.
2. Click the live 2067mm segment with endpoints listed above, enter `2200mm`, choose the fixed end, and Apply. Confirm stored motion follows its exact normalized XZ tangent, the regenerated visible value is exactly 2200mm, same-chain peer leaves are unchanged, and its chain total changes by exactly +133mm.
3. Edit an automatic room clear dimension by +300mm. Confirm the chosen inside/finish-face span reaches target, the fixed boundary remains exact, the far room side translates rigidly, and the independent orthogonal room span is unchanged.
4. Click a chain total, visibly choose a non-default leaf, change the total, and confirm only that leaf absorbs the delta while other leaves remain exact.
5. Edit an ordinary opening-adjacent gap and confirm opening width remains exact. Edit an opening-width leaf and confirm fixed jamb, final width, documentation offset, swing/handing, host, and neighboring leaf spans.
6. Verify all expected openings and zones remain, auto-zone boundaries/polygons match the final walls, manual zone metadata remains, and 3D shows the same committed geometry.
7. One Undo restores the complete pre-edit graph exactly; one Redo restores the final graph exactly.
8. Exercise a read-only `R-R`/ambiguous label and a compression/topology failure. Each opens with a useful reason/error and leaves graph plus history depth unchanged.
9. Switch out of Expert mode and export/preview a document: dimensions remain visually unchanged and non-interactive. Console errors remain zero.

## Verification gates and stop condition

Run focused tests first, then affected wall operations, axis-guide stretch, construction dimensions, room-clear dimensions, hosted opening, space reconciliation, renderer/registry interaction, history, and manual exposure suites. Run package type checks/builds in dependency order and Biome only on changed files, coordinated with the live HMR browser session.

Stop only when:

- every generated label is clickable in Expert mode and either edits or explains why it cannot;
- near-axis real geometry uses the exact displayed tangent;
- same-chain independent leaves are proven unchanged;
- totals require/retain an explicit leaf choice;
- openings and zones are part of the same validated plan;
- invalid cases produce no mutation/history;
- one undo/redo is graph-exact; and
- the committed 2D result matches 3D in the real browser.

## Dirty-work guard

The working tree already contains unrelated apartment trace/import-frame/vector, guide perspective/schema/renderer, floorplan panel, core index, and modeling-manual work. Preserve it. Touch shared dirty files additively around their current contents, do not replace them from another checkout, and do not stage, format, revert, or copy over unrelated hunks.

## Implementation handoff

The requirements are executable without another product decision. The only apparent ambiguity is resolved in the UI: the user chooses the fixed end, and a total exposes the leaf that absorbs its delta. Shared physical dimensions outside the selected chain may change and are disclosed before Apply. Dimensions that are not realizable by a unique wall translation remain clickable with an explicit reason.

Planning lane: `gpt-5.6-sol`, high reasoning. Implementation should stay with the designated executor; root owns integration and real-browser evidence.
