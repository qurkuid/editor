import { describe, expect, test } from 'bun:test'
import { projectPushPullSnapDistance, snapPushPullDistanceToGrid } from './push-pull-snap'

describe('Push/Pull snapping', () => {
  test('projects semantic surface hits onto the selected face normal', () => {
    expect(
      projectPushPullSnapDistance({
        anchor: [1, 2, 3],
        normal: [0, 1, 0],
        point: [4, 3.25, 9],
      }),
    ).toBeCloseTo(1.25)
  })

  test('quantizes the scalar distance only when a positive grid step is active', () => {
    expect(snapPushPullDistanceToGrid(1.24, 0.5)).toBe(1)
    expect(snapPushPullDistanceToGrid(1.26, 0.5)).toBe(1.5)
    expect(snapPushPullDistanceToGrid(1.26, 0)).toBe(1.26)
  })
})
