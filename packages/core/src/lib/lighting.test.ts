import { describe, expect, test } from 'bun:test'
import { kelvinToRgb, lumensToCandela, resolveLightingFixtureEnabled } from './lighting'

describe('lighting', () => {
  test('an unassigned fixture follows its own enabled state', () => {
    expect(resolveLightingFixtureEnabled({ enabled: true, circuitId: null }, null)).toBe(true)
    expect(resolveLightingFixtureEnabled({ enabled: false, circuitId: null }, null)).toBe(false)
  })

  test('a circuit controls every assigned fixture and fails closed when missing', () => {
    const fixture = { enabled: true, circuitId: 'lighting-circuit_a' }

    expect(resolveLightingFixtureEnabled(fixture, { enabled: true })).toBe(true)
    expect(resolveLightingFixtureEnabled(fixture, { enabled: false })).toBe(false)
    expect(resolveLightingFixtureEnabled(fixture, null)).toBe(false)
  })

  test('converts point-light lumens to candela', () => {
    expect(lumensToCandela(1256.637)).toBeCloseTo(100, 2)
  })

  test('keeps colour temperature channels within display range', () => {
    expect(kelvinToRgb(2700)).toEqual(expect.arrayContaining([expect.any(Number)]))
    for (const value of [...kelvinToRgb(2700), ...kelvinToRgb(6500)]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })
})
