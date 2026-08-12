import './bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { MODELING_AGENT_MANUAL } from './modeling-agent-manual'

describe('Phase 2 ontology manual contract', () => {
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
