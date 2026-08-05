// @ts-expect-error — bun:test is provided by the Bun runtime.
import { describe, expect, test } from 'bun:test'
import {
  CEILING_FEATURE_SEED_PROFILES,
  ceilingProfileSize,
  longestEdgeIndex,
  scaleCeilingProfile,
} from './presets'

describe('ceiling feature presets', () => {
  test('seed profiles hang at or below the ceiling plane from the wall side', () => {
    for (const profile of Object.values(CEILING_FEATURE_SEED_PROFILES)) {
      expect(profile.length).toBeGreaterThanOrEqual(3)
      for (const [u, v] of profile) {
        expect(u).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(0)
      }
    }
  })

  test('scaling resizes without resetting the section shape', () => {
    const custom = CEILING_FEATURE_SEED_PROFILES.custom
    const scaled = scaleCeilingProfile(custom, { width: 0.9, depth: 0.5 })

    expect(ceilingProfileSize(scaled).width).toBeCloseTo(0.9)
    expect(ceilingProfileSize(scaled).depth).toBeCloseTo(0.5)
    // Same vertex count and same u/v ratios per point — a pure rescale.
    expect(scaled.length).toBe(custom.length)
    const { width, depth } = ceilingProfileSize(custom)
    for (let i = 0; i < custom.length; i++) {
      expect(scaled[i]![0]).toBeCloseTo((custom[i]![0] / width) * 0.9)
      expect(scaled[i]![1]).toBeCloseTo((custom[i]![1] / depth) * 0.5)
    }
  })

  test('longestEdgeIndex picks the longest ring edge', () => {
    expect(
      longestEdgeIndex([
        [0, 0],
        [1, 0],
        [1, 5],
        [0, 5],
      ]),
    ).toBe(1)
  })
})
