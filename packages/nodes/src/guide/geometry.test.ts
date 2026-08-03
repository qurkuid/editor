import { describe, expect, test } from 'bun:test'
import type { GuidePerspectiveCorners } from '@pascal-app/core'
import { createGuidePlaneGeometry } from './geometry'

describe('guide plane perspective geometry', () => {
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
})
