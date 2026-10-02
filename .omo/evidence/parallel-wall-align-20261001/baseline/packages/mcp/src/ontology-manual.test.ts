import './bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { MODELING_AGENT_MANUAL } from './modeling-agent-manual'

describe('Phase 2 ontology manual contract', () => {
  test('documents weak endpoint inference separately from explicit angle locking', () => {
    expect(MODELING_AGENT_MANUAL).toContain('ArrowRight toggles')
    expect(MODELING_AGENT_MANUAL).toContain('survive Shift release')
    expect(MODELING_AGENT_MANUAL).toContain('wall drawing and endpoint dragging')
    expect(MODELING_AGENT_MANUAL).toContain('within 2 degrees')
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
    expect(MODELING_AGENT_MANUAL).toContain('one undo step')
    expect(MODELING_AGENT_MANUAL).toContain('no AI/MCP mutation operation')
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
  })

  test('documents shared apartment import orientation', () => {
    expect(MODELING_AGENT_MANUAL).toContain('horizontal/vertical source-image flips')
    expect(MODELING_AGENT_MANUAL).toContain('same undoable import')
    expect(MODELING_AGENT_MANUAL).toContain('image center')
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
})
