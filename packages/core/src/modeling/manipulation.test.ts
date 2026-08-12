import { describe, expect, test } from 'bun:test'
import type { MeasurementFeature, MeasurementFeatureBinding } from '../registry/types'
import {
  manipulationSnapCandidateFromFeature,
  manipulationSnapMarkerToken,
  manipulationSnapTier,
} from './manipulation'

const SNAP_CASES = [
  { kind: 'endpoint', tier: 'endpoint' },
  { kind: 'midpoint', tier: 'midpoint' },
  { kind: 'center', tier: 'midpoint' },
  { kind: 'edge', tier: 'edge' },
  { kind: 'face', tier: 'face' },
] as const

describe('precise manipulation snap semantics', () => {
  for (const { kind, tier } of SNAP_CASES) {
    test(`normalizes ${kind} into one candidate and marker token`, () => {
      const feature: MeasurementFeature = {
        id: `feature:${kind}`,
        label: kind,
        snapKind: kind,
        geometry: { kind: 'point', point: [1, 2, 3] },
        ...(kind === 'face' ? { normal: [0, 1, 0] as const } : {}),
      }
      const binding: MeasurementFeatureBinding = {
        featureId: feature.id,
        point: [1, 2, 3],
        distance: 0.02,
      }

      const candidate = manipulationSnapCandidateFromFeature(feature, binding)

      expect(candidate).toMatchObject({
        featureId: feature.id,
        point: [1, 2, 3],
        snapKind: kind,
        tier,
        markerToken: manipulationSnapMarkerToken(kind),
      })
      expect(JSON.parse(JSON.stringify(candidate))).toEqual(candidate)
    })
  }

  test('leaves non-priority measurement kinds without a manipulation tier', () => {
    expect(manipulationSnapTier('ridge')).toBeNull()
    expect(manipulationSnapTier('height')).toBeNull()
    expect(manipulationSnapMarkerToken('ridge')).toBe('manipulation-snap:ridge')
  })
})
