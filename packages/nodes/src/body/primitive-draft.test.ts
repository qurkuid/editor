import { describe, expect, test } from 'bun:test'
import {
  resolveBodyDraftFeedback,
  resolveCircleDraft,
  resolveLineFaceDraft,
  shouldCloseLineDraft,
  snapLineDraftPoint,
} from './primitive-draft'

describe('snapLineDraftPoint', () => {
  const triangle: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
  ]

  test('sticks onto the start point once the draft can close', () => {
    expect(snapLineDraftPoint(triangle, [0.08, -0.05], 0.12)).toEqual([0, 0])
  })

  test('leaves the point alone outside the tolerance', () => {
    expect(snapLineDraftPoint(triangle, [0.3, 0.3], 0.12)).toEqual([0.3, 0.3])
  })

  test('never snaps while the draft is too short to close', () => {
    expect(snapLineDraftPoint([[0, 0], [2, 0]], [0.05, 0], 0.12)).toEqual([0.05, 0])
  })
})

describe('Body primitive drafting', () => {
  test('creates a circle face from a center and an exact typed radius', () => {
    const points = resolveCircleDraft([2, 3], [2.4, 3], 1.2, 16)

    expect(points).toHaveLength(16)
    expect(points[0]).toEqual([3.2, 3])
    expect(points[4]?.[0]).toBeCloseTo(2, 8)
    expect(points[4]?.[1]).toBeCloseTo(4.2, 8)
  })

  test('closes a line loop near its first point and rejects an open or degenerate loop', () => {
    expect(shouldCloseLineDraft([0, 0], [0.03, 0.04], 0.05)).toBe(true)
    expect(
      resolveLineFaceDraft([
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ])
    expect(
      resolveLineFaceDraft([
        [0, 0],
        [1, 0],
      ]),
    ).toBeNull()
    expect(
      resolveLineFaceDraft([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBeNull()
  })

  test('keeps the start, committed vertices, and live endpoint visible while drawing', () => {
    expect(
      resolveBodyDraftFeedback(
        [
          [1, 2],
          [3, 2],
        ],
        [3, 4],
      ),
    ).toEqual({
      start: [1, 2],
      committed: [
        [1, 2],
        [3, 2],
      ],
      cursor: [3, 4],
      path: [
        [1, 2],
        [3, 2],
        [3, 4],
      ],
    })
  })
})
