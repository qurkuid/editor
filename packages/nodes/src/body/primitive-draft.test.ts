import { describe, expect, test } from 'bun:test'
import { DEFAULT_ARC_SEGMENTS, DEFAULT_POLYGON_SIDES, useBodyToolOptions } from './options'
import {
  resolveArcDraft,
  resolveBodyDraftFeedback,
  resolveCircleDraft,
  resolveLineFaceDraft,
  resolveRegularPolygonDraft,
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
    expect(
      snapLineDraftPoint(
        [
          [0, 0],
          [2, 0],
        ],
        [0.05, 0],
        0.12,
      ),
    ).toEqual([0.05, 0])
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

  test('creates a counter-clockwise regular polygon with typed radius and direction', () => {
    const points = resolveRegularPolygonDraft([2, 3], [3, 3], 2, 4)

    expect(points).toHaveLength(4)
    expect(points?.[0]).toEqual([4, 3])
    expect(points?.[1]?.[0]).toBeCloseTo(2, 8)
    expect(points?.[1]?.[1]).toBeCloseTo(5, 8)
  })

  test('rejects invalid polygon radius and sides and clamps authoring sides', () => {
    expect(resolveRegularPolygonDraft([0, 0], [0, 0], null, 6)).toBeNull()
    expect(resolveRegularPolygonDraft([0, 0], [1, 0], null, 2)).toBeNull()
    expect(resolveRegularPolygonDraft([0, 0], [1, 0], null, 257)).toBeNull()

    const options = useBodyToolOptions.getState()
    options.setPolygonSides(999)
    expect(useBodyToolOptions.getState().polygonSides).toBe(256)
    expect(
      resolveRegularPolygonDraft([0, 0], [1, 0], null, useBodyToolOptions.getState().polygonSides),
    ).toHaveLength(256)
    options.setPolygonSides(1)
    expect(useBodyToolOptions.getState().polygonSides).toBe(3)
    options.setPolygonSides(DEFAULT_POLYGON_SIDES)
  })

  test('samples the three-point arc through its curvature point', () => {
    const points = resolveArcDraft([1, 0], [0, 1], [-1, 0], 8)

    expect(points).toHaveLength(9)
    expect(points?.[0]).toEqual([1, 0])
    expect(points?.at(-1)).toEqual([-1, 0])
    expect(points?.[4]?.[1]).toBeCloseTo(1, 8)
  })

  test('rejects duplicate, collinear, tiny-radius, and full-circle arcs', () => {
    expect(resolveArcDraft([0, 0], [0, 0], [1, 0])).toBeNull()
    expect(resolveArcDraft([0, 0], [1, 0], [2, 0])).toBeNull()
    expect(resolveArcDraft([0, 0], [0.0001, 0], [0, 0.0001])).toBeNull()
    expect(resolveArcDraft([1, 0], [0, 1], [1, 0])).toBeNull()
    expect(resolveArcDraft([0, 0], [1, 1], [2, 0], 1)).toBeNull()
  })

  test('clamps authoring segment count and samples the live value', () => {
    const options = useBodyToolOptions.getState()
    options.setArcSegments(999)
    expect(useBodyToolOptions.getState().arcSegments).toBe(256)
    expect(
      resolveArcDraft([1, 0], [0, 1], [-1, 0], useBodyToolOptions.getState().arcSegments),
    ).toHaveLength(257)

    options.setArcSegments(1)
    expect(useBodyToolOptions.getState().arcSegments).toBe(2)
    expect(
      resolveArcDraft([1, 0], [0, 1], [-1, 0], useBodyToolOptions.getState().arcSegments),
    ).toHaveLength(3)

    options.setArcSegments(DEFAULT_ARC_SEGMENTS)
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
