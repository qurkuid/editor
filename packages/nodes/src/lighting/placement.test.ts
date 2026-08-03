import type { AlignmentAnchor } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { lightingFixtureDefinition } from '../lighting-fixture/definition'
import {
  LINEAR_LIGHT_FALLBACK_LENGTH,
  resolveLightingAlignedPoint,
  resolveLightingCommitPoint,
  resolveLightingGridPoint,
  resolveLinearLightLength,
  resolveLinearLightSegment,
} from './placement'

describe('lighting floor-grid placement', () => {
  test('declares the item snapping context so the visible floor grid activates', () => {
    expect(lightingFixtureDefinition.snapProfile).toBe('item')
  })

  test('uses the visible grid interval in both plan coordinates', () => {
    expect(resolveLightingGridPoint([1.24, 2.76], 0.5, true)).toEqual([1, 3])
  })

  test('keeps the raw cursor position when grid snapping is off', () => {
    expect(resolveLightingGridPoint([1.24, 2.76], 0.5, false)).toEqual([1.24, 2.76])
  })
})

describe('lighting preview/commit identity', () => {
  test('reuses the preview snapshot untouched, ignoring what a fresh resolve would return', () => {
    const resolveFresh = () => [9.99, -3.5] as [number, number]
    expect(resolveLightingCommitPoint([1.24, 2.76], resolveFresh)).toEqual([1.24, 2.76])
  })

  test('falls back to a fresh resolution when there is no snapshot yet', () => {
    const resolveFresh = () => [4.2, 5.6] as [number, number]
    expect(resolveLightingCommitPoint(null, resolveFresh)).toEqual([4.2, 5.6])
  })

  // The linear draft's two-click flow resolves each endpoint through the
  // same helper — start on click 1 (no snapshot yet), end on click 2 (the
  // hover preview snapshot already shown to the user).
  test('resolves the drafted start point (click 1) from a fresh resolution', () => {
    const resolveFresh = () => [1, 1] as [number, number]
    expect(resolveLightingCommitPoint(null, resolveFresh)).toEqual([1, 1])
  })

  test('resolves the drafted end point (click 2) from the preview snapshot', () => {
    const resolveFresh = () => [99, 99] as [number, number]
    expect(resolveLightingCommitPoint([3, 4], resolveFresh)).toEqual([3, 4])
  })
})

describe('linear light segment derivation', () => {
  test('derives midpoint, rotation, and length for a horizontal segment', () => {
    const segment = resolveLinearLightSegment([0, 0], [2, 0])
    expect(segment.position).toEqual([1, 0])
    expect(segment.rotationY).toBeCloseTo(0)
    expect(segment.length).toBeCloseTo(2)
  })

  test('derives midpoint, rotation, and length for a vertical segment', () => {
    const segment = resolveLinearLightSegment([0, 0], [0, 3])
    expect(segment.position).toEqual([0, 1.5])
    expect(segment.rotationY).toBeCloseTo(-Math.PI / 2)
    expect(segment.length).toBeCloseTo(3)
  })

  test('derives midpoint, rotation, and length for a diagonal (3-4-5) segment', () => {
    const segment = resolveLinearLightSegment([1, 1], [4, 5])
    expect(segment.position).toEqual([2.5, 3])
    expect(segment.rotationY).toBeCloseTo(-Math.atan2(4, 3))
    expect(segment.length).toBeCloseTo(5)
  })

  test('derives the opposite rotation when the segment is drawn in reverse', () => {
    const forward = resolveLinearLightSegment([0, 0], [2, 0])
    const reverse = resolveLinearLightSegment([2, 0], [0, 0])
    expect(reverse.position).toEqual(forward.position)
    expect(reverse.length).toBeCloseTo(forward.length)
    expect(Math.abs(reverse.rotationY - forward.rotationY)).toBeCloseTo(Math.PI)
  })
})

describe('linear light length resolution', () => {
  test('falls back to the default length when start/end are missing', () => {
    expect(resolveLinearLightLength(undefined, undefined)).toBe(LINEAR_LIGHT_FALLBACK_LENGTH)
  })

  test('derives the length from start/end when both are present', () => {
    expect(resolveLinearLightLength([0, 0], [3, 4])).toBeCloseTo(5)
  })

  test('clamps a near-zero-length draft to the minimum instead of collapsing to zero', () => {
    expect(resolveLinearLightLength([0, 0], [0, 0])).toBeGreaterThan(0)
  })
})

describe('lighting reference-element alignment', () => {
  const wallCorner: AlignmentAnchor = { nodeId: 'wall_a', kind: 'corner', x: 2, z: 1.98 }

  test('returns an aligned point when a candidate anchor is within threshold', () => {
    const result = resolveLightingAlignedPoint([2.02, 3], [wallCorner], {
      showGuides: true,
      applySnap: true,
    })
    expect(result.point).toEqual([2, 3])
    expect(result.guides).toHaveLength(1)
  })

  test('keeps the raw grid point when nothing is near', () => {
    const result = resolveLightingAlignedPoint([2.02, 3], [wallCorner], {
      showGuides: true,
      applySnap: true,
      threshold: 0.01,
    })
    expect(result.point).toEqual([2.02, 3])
    expect(result.guides).toHaveLength(0)
  })

  test('skips alignment entirely when the alignment guide gate is off', () => {
    const result = resolveLightingAlignedPoint([2.02, 3], [wallCorner], {
      showGuides: false,
      applySnap: true,
    })
    expect(result.point).toEqual([2.02, 3])
    expect(result.guides).toHaveLength(0)
  })

  test('publishes a passive guide without pulling the point when the magnetic gate is off', () => {
    const result = resolveLightingAlignedPoint([2.02, 3], [wallCorner], {
      showGuides: true,
      applySnap: false,
    })
    expect(result.point).toEqual([2.02, 3])
    expect(result.guides).toHaveLength(1)
  })

  // The commit handler re-resolves the point through the same snapshot the
  // preview already showed (`resolveLightingCommitPoint`), so an aligned
  // preview point must commit unchanged rather than being re-aligned fresh.
  test('preview/commit identity holds when the preview point was aligned', () => {
    const previewed = resolveLightingAlignedPoint([2.02, 3], [wallCorner], {
      showGuides: true,
      applySnap: true,
    }).point
    const resolveFresh = () => [9.99, -3.5] as [number, number]
    expect(resolveLightingCommitPoint(previewed, resolveFresh)).toEqual(previewed)
  })
})
