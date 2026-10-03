import './bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { MODELING_AGENT_MANUAL } from './modeling-agent-manual'

describe('Phase 2 ontology manual contract', () => {
  test('documents weak endpoint inference separately from explicit angle locking', () => {
    expect(MODELING_AGENT_MANUAL).toContain('ArrowRight toggles')
    expect(MODELING_AGENT_MANUAL).toContain('survive Shift release')
    expect(MODELING_AGENT_MANUAL).toContain('wall drawing and endpoint dragging')
    expect(MODELING_AGENT_MANUAL).toContain('within 2 degrees')
    expect(MODELING_AGENT_MANUAL).toContain('horizontal or vertical model-axis intent')
    expect(MODELING_AGENT_MANUAL).toContain('exact L-corner intersection')
    expect(MODELING_AGENT_MANUAL).toContain('distinct competing intersections fail closed')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Existing endpoint/edge snaps take priority for exact cursor endpoint hits',
    )
    expect(MODELING_AGENT_MANUAL).toContain('physical construction-envelope face capture')
    expect(MODELING_AGENT_MANUAL).toContain('`targetWallIds`')
    expect(MODELING_AGENT_MANUAL).toContain('Off disables weak inference')
    expect(MODELING_AGENT_MANUAL).toContain('not a documented SketchUp tolerance')
  })
  test('documents validated length edits and boundary review', () => {
    expect(MODELING_AGENT_MANUAL).toContain('buildWallLengthUpdates')
    expect(MODELING_AGENT_MANUAL).toContain('all affected host spans')
    expect(MODELING_AGENT_MANUAL).toContain('metadata.boundaryNeedsReview')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Every confirmed closed apartment Space receives exactly one enclosed physical `Zone`',
    )
    expect(MODELING_AGENT_MANUAL).toContain('generatedFrom: detected-space')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Split closed faces get replacement enclosed zones, while existing open review zones retain their stored polygon, content, and review marker',
    )
    expect(MODELING_AGENT_MANUAL).toContain('smallest multi-gap bundle')
    expect(MODELING_AGENT_MANUAL).toContain(
      'direct UI capability with no AI/MCP mutation operation',
    )
    expect(MODELING_AGENT_MANUAL).toContain('reject stale or read-only scenes before mutation')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Explicit target connection can extend both straight walls',
    )
    expect(MODELING_AGENT_MANUAL).toContain('Keep open stores a geometry-specific endpoint review')
    expect(MODELING_AGENT_MANUAL).toContain('Endpoint dragging in both 2D and 3D validates')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Manual wall boundary connection has two explicit routes',
    )
    expect(MODELING_AGENT_MANUAL).toContain('horizontal→vertical or vertical→horizontal bends')
    expect(MODELING_AGENT_MANUAL).toContain('Preview creates no scene nodes')
  })

  test('documents the shared wall parallel alignment capability', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'align one uniquely resolved same-parent straight continuation within 2 degrees',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'preserving the shared corner, reference wall, and selected length',
    )
    expect(MODELING_AGENT_MANUAL).toContain('validating linked walls and hosted spans atomically')
    expect(MODELING_AGENT_MANUAL).toContain(
      'direct UI capability with no AI/MCP mutation operation',
    )
  })

  test('documents direct axis-guide stretch without adding an AI mutation command', () => {
    expect(MODELING_AGENT_MANUAL).toContain('Axis-guide stretch is a direct 2D authoring workflow')
    expect(MODELING_AGENT_MANUAL).toContain('classify an opening by its world center')
    expect(MODELING_AGENT_MANUAL).toContain('Existing unrelated hosted overlap is retained')
    expect(MODELING_AGENT_MANUAL).toContain('no AI/MCP mutation operation')
    expect(MODELING_AGENT_MANUAL).toContain('Guide Line for the existing reference-offset flow')
  })

  test('documents exact Expert dimension editing without adding an AI mutation command', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'Expert 2D dimensions are generated from exact model-space provenance',
    )
    expect(MODELING_AGENT_MANUAL).toContain('A total requires an explicit leaf choice')
    expect(MODELING_AGENT_MANUAL).toContain('near an axis')
    expect(MODELING_AGENT_MANUAL).toContain('room-to-room wall-thickness (R-R)')
    expect(MODELING_AGENT_MANUAL).toContain('default Expert dimension set omits')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Exterior horizontal and vertical placement chains share one baseline per tier and span their connected wall network, with an outer overall dimension; standalone opening-width and structural-datum rows preserve their own references.',
    )
    expect(MODELING_AGENT_MANUAL).toContain('one undo step')
    expect(MODELING_AGENT_MANUAL).toContain('no AI/MCP mutation operation')
  })
  test('documents net finish quantities separately from gross measures', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'Expert dimensions and quantity takeoff remain separate',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'Finish lines are net of clipped hosted door/window unions per side, active band, and finish region',
    )
    expect(MODELING_AGENT_MANUAL).toContain('downstream coverage and waste are applied once')
  })
  test('documents ontology discovery and evidence requirements', () => {
    expect(MODELING_AGENT_MANUAL).toContain('pascal://ontology/manifest')
    expect(MODELING_AGENT_MANUAL).toContain('query_design_ontology')
    expect(MODELING_AGENT_MANUAL).toContain('explain_design_rule')
    expect(MODELING_AGENT_MANUAL).toContain('evidence')
  })

  test('documents the canonical Body transform and direct scale interactions', () => {
    expect(MODELING_AGENT_MANUAL).toContain('Selecting or re-clicking any scene element is inert')
    expect(MODELING_AGENT_MANUAL).toContain('explicitly choosing Move')
    expect(MODELING_AGENT_MANUAL).toContain(
      'arbitrary-axis rotation, positive XYZ scale, and pivot',
    )
    expect(MODELING_AGENT_MANUAL).toContain('existing six linear-resize handles')
    expect(MODELING_AGENT_MANUAL).toContain('shared pivot state machine around X, Y, or Z')
    expect(MODELING_AGENT_MANUAL).toContain('snapshots that feature at gesture start')
    expect(MODELING_AGENT_MANUAL).toContain('selected persistent vertex, half-edge, or face')
    expect(MODELING_AGENT_MANUAL).toContain('floor plan remains whole-Body')
  })

  test('documents apartment wall extraction and junction continuity', () => {
    expect(MODELING_AGENT_MANUAL).toContain('splits a straight host at every interior T/X contact')
    expect(MODELING_AGENT_MANUAL).toContain('overlapping projected thickness bands')
    expect(MODELING_AGENT_MANUAL).toContain('clusters touching both endpoints')
    expect(MODELING_AGENT_MANUAL).toContain('opening guards are applied before clustering')
    expect(MODELING_AGENT_MANUAL).toContain('`buildWallSplitAtContacts`')
    expect(MODELING_AGENT_MANUAL).toContain('`no-wall-contacts`')
    expect(MODELING_AGENT_MANUAL).toContain('retains source-backed thin wall runs')
    expect(MODELING_AGENT_MANUAL).toContain(
      'maximal connected, non-branching source-gray wall chains',
    )
    expect(MODELING_AGENT_MANUAL).toContain('contained OCR crop retry')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Never synthesize a missing boundary by closing a room polygon',
    )
    expect(MODELING_AGENT_MANUAL).toContain('vector document version 15')
    expect(MODELING_AGENT_MANUAL).toContain('within 10% of a merged dimension-line midpoint')
    expect(MODELING_AGENT_MANUAL).toContain('each merged interval contributes at most one vote')
    expect(MODELING_AGENT_MANUAL).toContain('centered evidence conflicts or fails to cluster')
    expect(MODELING_AGENT_MANUAL).toContain(
      'never infer scale from a silhouette bounding box or a single axis',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'An explicit synchronized same-guide Set Scale can supply physical calibration for a pixel document',
    )
    expect(MODELING_AGENT_MANUAL).toContain('this does not relax the automatic calibration gate')
  })

  test('documents the bounded apartment weld budget', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`min(1 m, original segment length)`')
    expect(MODELING_AGENT_MANUAL).toContain('preserve hosted openings')
    expect(MODELING_AGENT_MANUAL).toContain('unsupported or ambiguous closure')
  })

  test('documents source-chain merge and snap guards', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'Same-run normalization and opening hosting use separate reason-aware unions',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'nonabsorbable by the existing same-run predicate on both sides',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'reject only that relation’s opposite-root normal union',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'A failed opening-host union fails the import before placement',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'all inferred crossing extensions preserve retained source contacts; otherwise leave the opening unhosted for review',
    )
    expect(MODELING_AGENT_MANUAL).toContain('relation-owned snap/weld moves through the bridge')
    expect(MODELING_AGENT_MANUAL).toContain(
      'distance ≤ 1e-6 m) never extends to that segment’s distant endpoint',
    )
    expect(MODELING_AGENT_MANUAL).toContain('Measure contained duplicate spans only')
    expect(MODELING_AGENT_MANUAL).toContain('source-backed dual-jamb ray cluster')
    expect(MODELING_AGENT_MANUAL).toContain('host the raw span without clamping')
  })

  test('documents shared apartment import orientation', () => {
    expect(MODELING_AGENT_MANUAL).toContain('horizontal/vertical source-image flips')
    expect(MODELING_AGENT_MANUAL).toContain('same undoable import')
    expect(MODELING_AGENT_MANUAL).toContain('image center')
    expect(MODELING_AGENT_MANUAL).toContain(
      'A guide with `scale === 1` and `scaleReference === null` is the default placeholder',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'automatic modeling promotes it to the physical source `guideScale` while preserving position and yaw',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'Preserve every explicit `scaleReference`, including scale 1, and every manually numeric non-1 guide scale',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'guide promotion and generated nodes remain one undoable history step',
    )
    expect(MODELING_AGENT_MANUAL).toContain('a failed import mutates neither guide nor graph')
  })

  test('documents initial apartment floor persistence', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'persist derived auto Slabs and Ceilings only for confirmed closed wall spaces after the final-frame detection',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'source or semantic open-space Zones do not prove a floor footprint',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'Hydration and deletion cleanup remain level-scoped and preserve the existing derived-node lifecycle',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'Direct deletion or elevation edits to an auto Slab persist without an own-level replan',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'own-level `slabKey` reconciliation applies only to manual or non-auto Slab ids and elevations',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'Above-level covering undersides remain unchanged for every non-recessed Slab, including auto Slabs',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'above-level auto deletion, elevation, or thickness changes still clamp the lower Ceiling',
    )
    expect(MODELING_AGENT_MANUAL).toContain('initial hydration baselines remain unchanged')
  })

  test('documents detection-only straight graph planarization', () => {
    expect(MODELING_AGENT_MANUAL).toContain('planarizes only the derived graph')
    expect(MODELING_AGENT_MANUAL).toContain(
      'strict interior intersections of straight walls use one canonical point in both incident split lists',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'complete straight endpoint cluster agrees on one unique non-parallel host and projected point',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'A compact complete component of non-parallel straight endpoint corners may follow each authored outward ray only when every pair has an exact intersection',
    )
    expect(MODELING_AGENT_MANUAL).toContain('authored construction footprints overlap')
    expect(MODELING_AGENT_MANUAL).toContain(
      'each source line extends only to its farthest proven intersection and nearer intersections remain split points',
    )
    expect(MODELING_AGENT_MANUAL).toContain('Stored wall endpoints are never mutated or bent')
    expect(MODELING_AGENT_MANUAL).toContain(
      'parallel or collinear gaps and unmatched passages stay open',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'separated passages, curved incidents, incomplete or ambiguous components, and door-hosted approximate contacts fail closed',
    )
  })

  test('documents preserved Zone boundaries and structural membership UI', () => {
    expect(MODELING_AGENT_MANUAL).toContain('deletion-only boundary loss preserves')
    expect(MODELING_AGENT_MANUAL).toContain('read-only Zone membership')
    expect(MODELING_AGENT_MANUAL).toContain('collapsed 마감재 section')
    expect(MODELING_AGENT_MANUAL).toContain('four columns')
  })

  test('documents source-backed opening and room boundary contracts', () => {
    expect(MODELING_AGENT_MANUAL).toContain('local swing-arc evidence')
    expect(MODELING_AGENT_MANUAL).toContain('uncertain internal fixtures remain `opening`')
    expect(MODELING_AGENT_MANUAL).toContain('measured semantic width in node metadata')
    expect(MODELING_AGENT_MANUAL).toContain('full room barrier')
    expect(MODELING_AGENT_MANUAL).toContain('protect small labeled rooms')
    expect(MODELING_AGENT_MANUAL).toContain('conflicting OCR labels')
    expect(MODELING_AGENT_MANUAL).toContain('source-backed boundaries')
    expect(MODELING_AGENT_MANUAL).toContain('semantic zones without creating physical walls')
    expect(MODELING_AGENT_MANUAL).toContain('bright ridge between darker rails')
  })

  test('documents persistent Body sub-entity selection', () => {
    expect(MODELING_AGENT_MANUAL).toContain('selects the persistent vertex or half-edge id')
    expect(MODELING_AGENT_MANUAL).toContain('Edge midpoints select their owning edge')
    expect(MODELING_AGENT_MANUAL).toContain('discard a stale feature id or remap it')
    expect(MODELING_AGENT_MANUAL).toContain('select a persistent Body vertex, half-edge, or face')
    expect(MODELING_AGENT_MANUAL).toContain('The floor plan continues to move the whole Body')
    expect(MODELING_AGENT_MANUAL).toContain('rejected atomically')
  })

  test('documents Body Autofold constraints', () => {
    expect(MODELING_AGENT_MANUAL).toContain('Body Move Autofold is an opt-in 3D preference')
    expect(MODELING_AGENT_MANUAL).toContain('hole-free line-edged face')
    expect(MODELING_AGENT_MANUAL).toContain('reciprocal topology')
    expect(MODELING_AGENT_MANUAL).toContain('floor plan does not expose Autofold')
  })

  test('documents whole-Body array operations', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`arrayBodyLinear`')
    expect(MODELING_AGENT_MANUAL).toContain('`arrayBodyCircular`')
    expect(MODELING_AGENT_MANUAL).toContain('integer `count` from 2 to 100')
    expect(MODELING_AGENT_MANUAL).toContain('one undo step')
  })

  test('documents editor-only Body container edit routing', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`groupBodies` and `createComponent`')
    expect(MODELING_AGENT_MANUAL).toContain('editor-only isolated Body-container edit context')
    expect(MODELING_AGENT_MANUAL).toContain('stable node ids directly')
    expect(MODELING_AGENT_MANUAL).toContain('no editor edit-context flag is persisted')
  })

  test('documents solid inspection and Body boolean operations', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`inspectBodySolid`')
    expect(MODELING_AGENT_MANUAL).toContain('`unionBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('`subtractBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('`intersectBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('`toolBodyId`')
    expect(MODELING_AGENT_MANUAL).toContain('concave planar solids are supported')
    expect(MODELING_AGENT_MANUAL).toContain('positive-volume overlap')
    expect(MODELING_AGENT_MANUAL).toContain('undo restores both Bodies')
  })

  test('documents Solid Tools ordering and tool lifetime', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`outerShellBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('`trimBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('`splitBodies`')
    expect(MODELING_AGENT_MANUAL).toContain('target-only, intersection, tool-only order')
    expect(MODELING_AGENT_MANUAL).toContain('preserving the tool unchanged')
    expect(MODELING_AGENT_MANUAL).toContain('fewer than two pieces')
  })

  test('documents the canonical Body offset operation and signed interaction', () => {
    expect(MODELING_AGENT_MANUAL).toContain('`offsetBodyFace`')
    expect(MODELING_AGENT_MANUAL).toContain('canonical metres/radians')
    expect(MODELING_AGENT_MANUAL).toContain('deterministic miter rule')
    expect(MODELING_AGENT_MANUAL).toContain('Inward offset preserves the source ring')
    expect(MODELING_AGENT_MANUAL).toContain('nested outward offset requires exactly one reciprocal')
    expect(MODELING_AGENT_MANUAL).toContain('exterior is positive and interior is negative')
    expect(MODELING_AGENT_MANUAL).toContain('floor-plan action menu')
    expect(MODELING_AGENT_MANUAL).toContain('explicitly typed sign authoritative')
  })

  test('documents signed imprint through-cuts and the 2D render-only boundary', () => {
    expect(MODELING_AGENT_MANUAL).toContain('reaches or passes the nearest blocking plane')
    expect(MODELING_AGENT_MANUAL).toContain('persistent through-cut')
    expect(MODELING_AGENT_MANUAL).toContain(
      'source face and Boolean cut-surface material/UV provenance',
    )
    expect(MODELING_AGENT_MANUAL).toContain('2D remains render-only')
    expect(MODELING_AGENT_MANUAL).toContain('multi-shell output atomically')
  })

  test('documents sampled Arc parity through existing Body operations', () => {
    expect(MODELING_AGENT_MANUAL).toContain('sampled three-point-arc profile')
    expect(MODELING_AGENT_MANUAL).toContain('defaulting to 32 segments')
    expect(MODELING_AGENT_MANUAL).toContain('authoring-time Arc segments')
    expect(MODELING_AGENT_MANUAL).toContain('regular polygon profile')
    expect(MODELING_AGENT_MANUAL).toContain('defaulting to 6 sides')
    expect(MODELING_AGENT_MANUAL).toContain('sampled open path on Enter')
    expect(MODELING_AGENT_MANUAL).toContain('closing chord on C')
  })

  test('documents Zone finish face protection and atomic floor/template apply', () => {
    expect(MODELING_AGENT_MANUAL).toContain(
      'Zone finish targets resolve inward `Space.boundaryFaces`',
    )
    expect(MODELING_AGENT_MANUAL).toContain(
      'reject the operation because the opposite face cannot be protected',
    )
    expect(MODELING_AGENT_MANUAL).toContain('Disjoint Slabs are ignored')
    expect(MODELING_AGENT_MANUAL).toContain('invalid holes, recessed or stepped conflicts')
    expect(MODELING_AGENT_MANUAL).toContain(
      'Zone ceiling finish resolves one exact same-level Ceiling',
    )
    expect(MODELING_AGENT_MANUAL).toContain('with no explicit height')
    expect(MODELING_AGENT_MANUAL).toContain('manual-zone-subsegment-unsupported')
    expect(MODELING_AGENT_MANUAL).toContain('curved-wall-partial-finish-unsupported')
    expect(MODELING_AGENT_MANUAL).toContain('stable interval keys')
    expect(MODELING_AGENT_MANUAL).toContain('gaps are left untouched')
    expect(MODELING_AGENT_MANUAL).toContain('floor and canvas targets remain available')
    expect(MODELING_AGENT_MANUAL).toContain('one atomic apply and one undo step')
  })
})
