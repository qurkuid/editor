import '../bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { explainDesignRule, explainDesignRuleInputSchema } from './rule'

describe('design ontology rule explanations', () => {
  test('explains the Window-hosted-by-Wall rule with evidence and bounds', async () => {
    const operations = createSceneOperations({ bridge: new SceneBridge() })
    const result = await explainDesignRule(
      operations,
      explainDesignRuleInputSchema.parse({
        ruleId: 'pascal:rule/window-hosted-by-wall',
        maxNodes: 1,
      }),
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.rule.id).toBe('pascal:rule/window-hosted-by-wall')
    expect(result.rule.evidence.length).toBeGreaterThan(0)
    expect(result.ruleId).toBe('pascal:rule/window-hosted-by-wall')
    expect(result.sourceId).toBe('pascal:rule/window-hosted-by-wall')
    expect(result.sourceVersion).toBe('1.0.0')
    expect(result.license).toBe('MIT')
    expect(result.evidenceLocators).toContain('Window hosted by Wall')
    expect(result.relatedNodes.length).toBeLessThanOrEqual(1)
    expect(result.edges.length).toBeLessThanOrEqual(1)
  })
})
