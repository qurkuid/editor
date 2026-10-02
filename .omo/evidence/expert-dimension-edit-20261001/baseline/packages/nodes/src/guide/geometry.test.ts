import { describe, expect, test } from 'bun:test'
import type { GuidePerspectiveCorners } from '@pascal-app/core'
import { createGuidePlaneGeometry } from './geometry'

describe('guide plane perspective geometry', () => {
  test.each([
    ['none', false, false],
    ['horizontal', true, false],
    ['vertical', false, true],
    ['combined', true, true],
  ])('applies %s image-space flips without changing plane dimensions', (_name, flipX, flipY) => {
    const geometry = createGuidePlaneGeometry({
      flipX,
      flipY,
      height: 5,
      perspectiveCorners: null,
      segments: 1,
      width: 10,
    })
    const uv = geometry.getAttribute('uv')
    expect(geometry.parameters.width).toBe(10)
    expect(geometry.parameters.height).toBe(5)
    expect(uv.getX(0)).toBe(flipX ? 1 : 0)
    expect(uv.getY(0)).toBe(flipY ? 0 : 1)
    expect(uv.getX(3)).toBe(flipX ? 0 : 1)
    expect(uv.getY(3)).toBe(flipY ? 1 : 0)
    geometry.dispose()
  })

  test('maps the corrected rectangle UV corners to the four selected image points', () => {
    const corners: GuidePerspectiveCorners = [
      [0.1, 0.9],
      [0.9, 0.8],
      [0.85, 0.1],
      [0.15, 0.05],
    ]

    const geometry = createGuidePlaneGeometry({
      height: 5,
      perspectiveCorners: corners,
      segments: 1,
      width: 10,
    })
    const uv = geometry.getAttribute('uv')

    for (const [index, expected] of [
      [0, corners[0]],
      [1, corners[1]],
      [2, corners[3]],
      [3, corners[2]],
    ] as const) {
      expect(uv.getX(index)).toBeCloseTo(expected[0])
      expect(uv.getY(index)).toBeCloseTo(expected[1])
    }
    geometry.dispose()
  })

  test('applies image flips before perspective correction', () => {
    const corners: GuidePerspectiveCorners = [
      [0.1, 0.9],
      [0.9, 0.8],
      [0.85, 0.1],
      [0.15, 0.05],
    ]

    const geometry = createGuidePlaneGeometry({
      flipX: true,
      flipY: true,
      height: 5,
      perspectiveCorners: corners,
      segments: 1,
      width: 10,
    })
    const uv = geometry.getAttribute('uv')

    for (const [index, expected] of [
      [0, corners[2]],
      [1, corners[3]],
      [2, corners[1]],
      [3, corners[0]],
    ] as const) {
      expect(uv.getX(index)).toBeCloseTo(expected[0])
      expect(uv.getY(index)).toBeCloseTo(expected[1])
    }
    geometry.dispose()
  })
})
