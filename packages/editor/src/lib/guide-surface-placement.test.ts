import { describe, expect, test } from 'bun:test'
import { resolveGuideSurfacePlacement } from './guide-surface-placement'

describe('guide surface placement', () => {
  test('offsets a floor image above the surface without rotating it', () => {
    const placement = resolveGuideSurfacePlacement([1, 0, 2], [0, 1, 0])

    expect(placement.position).toEqual([1, 0.002, 2])
    expect(placement.rotation).toEqual([0, 0, 0])
  })

  test('rotates the image plane from floor-up to a vertical wall normal', () => {
    const placement = resolveGuideSurfacePlacement([1, 2, 3], [0, 0, 1])

    expect(placement.position).toEqual([1, 2, 3.002])
    expect(placement.rotation[0]).toBeCloseTo(Math.PI / 2)
    expect(placement.rotation[1]).toBeCloseTo(0)
    expect(placement.rotation[2]).toBeCloseTo(0)
  })

  test('rejects a zero-length surface normal', () => {
    expect(() => resolveGuideSurfacePlacement([0, 0, 0], [0, 0, 0])).toThrow(RangeError)
  })
})
