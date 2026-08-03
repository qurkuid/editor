import { describe, expect, test } from 'bun:test'
import type { GuidePerspectiveCorners } from '../schema/nodes/guide'
import { projectGuidePerspectivePoint } from './guide-perspective'

const corners: GuidePerspectiveCorners = [
  [0.1, 0.9],
  [0.9, 0.8],
  [0.85, 0.1],
  [0.15, 0.05],
]

describe('guide perspective projection', () => {
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
