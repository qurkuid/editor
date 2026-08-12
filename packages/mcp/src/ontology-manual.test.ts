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
})
