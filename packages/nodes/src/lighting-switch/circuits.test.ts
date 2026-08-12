import { describe, expect, test } from 'bun:test'
import {
  lightingSwitchGangObjectName,
  resolveLightingSwitchCircuitIds,
  resolveLightingSwitchGangIndex,
} from './circuits'
import { LightingSwitchNode } from './schema'

describe('lighting switch circuits', () => {
  test('resolves one independent circuit per gang', () => {
    const node = LightingSwitchNode.parse({
      circuitId: 'lighting-circuit_legacy',
      circuitIds: ['lighting-circuit_1', 'lighting-circuit_2', null, 'lighting-circuit_4'],
      gangCount: 4,
    })

    expect(resolveLightingSwitchCircuitIds(node)).toEqual([
      'lighting-circuit_1',
      'lighting-circuit_2',
      null,
      'lighting-circuit_4',
    ])
  })

  test('keeps a legacy single circuit assigned to the first gang', () => {
    const node = LightingSwitchNode.parse({ circuitId: 'lighting-circuit_legacy' })

    expect(resolveLightingSwitchCircuitIds(node)).toEqual(['lighting-circuit_legacy'])
  })

  test('maps a click position to the matching gang', () => {
    expect(resolveLightingSwitchGangIndex(lightingSwitchGangObjectName(0), 4)).toBe(0)
    expect(resolveLightingSwitchGangIndex(lightingSwitchGangObjectName(1), 4)).toBe(1)
    expect(resolveLightingSwitchGangIndex(lightingSwitchGangObjectName(2), 4)).toBe(2)
    expect(resolveLightingSwitchGangIndex(lightingSwitchGangObjectName(3), 4)).toBe(3)
  })
})
