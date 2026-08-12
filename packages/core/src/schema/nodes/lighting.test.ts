import { describe, expect, test } from 'bun:test'
import { LightingCircuitNode } from './lighting-circuit'
import { LightingFixtureNode } from './lighting-fixture'
import { LightingSwitchNode } from './lighting-switch'

describe('lighting node schemas', () => {
  test('creates a circuit, fixture, and switch with stable defaults', () => {
    const circuit = LightingCircuitNode.parse({ name: 'Kitchen' })
    const fixture = LightingFixtureNode.parse({ circuitId: circuit.id })
    const lightingSwitch = LightingSwitchNode.parse({ circuitId: circuit.id })

    expect(circuit.enabled).toBe(true)
    expect(fixture.position).toEqual([0, 2.4, 0])
    expect(fixture.circuitId).toBe(circuit.id)
    expect(lightingSwitch.position).toEqual([0, 1.2, 0])
    expect(lightingSwitch.circuitId).toBe(circuit.id)
    expect(lightingSwitch.gangCount).toBe(1)
    expect(lightingSwitch.switchShape).toBe('rectangle')
  })

  test('accepts multi-gang round wall switches', () => {
    const lightingSwitch = LightingSwitchNode.parse({
      circuitIds: ['lighting-circuit_1', 'lighting-circuit_2', 'lighting-circuit_3', null],
      gangCount: 4,
      switchShape: 'round',
    })

    expect(lightingSwitch.gangCount).toBe(4)
    expect(lightingSwitch.circuitIds).toEqual([
      'lighting-circuit_1',
      'lighting-circuit_2',
      'lighting-circuit_3',
      null,
    ])
    expect(lightingSwitch.switchShape).toBe('round')
  })

  test('rejects invalid photometric values', () => {
    expect(LightingFixtureNode.safeParse({ lumens: -1 }).success).toBe(false)
    expect(LightingFixtureNode.safeParse({ colorTemperature: 500 }).success).toBe(false)
    expect(LightingFixtureNode.safeParse({ beamAngle: 180 }).success).toBe(false)
  })

  test('validates a linear fixture with start/end and a default linearWidth', () => {
    const fixture = LightingFixtureNode.parse({
      lightType: 'linear',
      start: [0, 0],
      end: [2, 0],
    })
    expect(fixture.lightType).toBe('linear')
    expect(fixture.start).toEqual([0, 0])
    expect(fixture.end).toEqual([2, 0])
    expect(fixture.linearWidth).toBe(0.05)
  })

  test('point/spot/area fixtures still validate unchanged without start/end', () => {
    for (const lightType of ['point', 'spot', 'area'] as const) {
      const fixture = LightingFixtureNode.parse({ lightType })
      expect(fixture.lightType).toBe(lightType)
      expect(fixture.start).toBeUndefined()
      expect(fixture.end).toBeUndefined()
    }
  })

  test('rejects linearWidth outside [0.01, 0.5]', () => {
    expect(LightingFixtureNode.safeParse({ lightType: 'linear', linearWidth: 0 }).success).toBe(
      false,
    )
    expect(LightingFixtureNode.safeParse({ lightType: 'linear', linearWidth: 0.6 }).success).toBe(
      false,
    )
    expect(LightingFixtureNode.safeParse({ lightType: 'linear', linearWidth: 0.2 }).success).toBe(
      true,
    )
  })
})
