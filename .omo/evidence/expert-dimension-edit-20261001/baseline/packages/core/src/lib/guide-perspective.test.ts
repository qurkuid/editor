import { describe, expect, test } from 'bun:test'
import type { GuidePerspectiveCorners } from '../schema/nodes/guide'
import {
  canonicalizeGuidePerspectiveCorners,
  projectGuidePerspectivePoint,
} from './guide-perspective'

const corners: GuidePerspectiveCorners = [
  [0.1, 0.9],
  [0.9, 0.8],
  [0.85, 0.1],
  [0.15, 0.05],
]

describe('guide perspective projection', () => {
  test.each([
    [false, false, [0, 1, 2, 3]],
    [true, false, [1, 0, 3, 2]],
    [false, true, [3, 2, 1, 0]],
    [true, true, [2, 3, 0, 1]],
  ])('canonicalizes displayed corners for %s/%s flips', (flipX, flipY, order) => {
    expect(canonicalizeGuidePerspectiveCorners(corners, flipX, flipY)).toEqual(
      order.map((index) => corners[index as 0 | 1 | 2 | 3]),
    )
  })

  test('maps each corrected rectangle corner to the selected source-image corner', () => {
    for (const [point, expected] of [
      [[0, 0], corners[0]],
      [[1, 0], corners[1]],
      [[1, 1], corners[2]],
      [[0, 1], corners[3]],
    ] as const) {
      const projected = projectGuidePerspectivePoint(corners, point)
      expect(projected[0]).toBeCloseTo(expected[0])
      expect(projected[1]).toBeCloseTo(expected[1])
    }
  })

  test('keeps an identity rectangle unchanged', () => {
    const identity: GuidePerspectiveCorners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]

    expect(projectGuidePerspectivePoint(identity, [0.25, 0.75])).toEqual([0.25, 0.75])
  })
})
