// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type Point2D, subtractPolygonsFromPolygon, unionPolygons } from './polygon-union'

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area / 2)
}

describe('unionPolygons', () => {
  test('collapses a contained polygon into the containing polygon', () => {
    const small: Point2D[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const large: Point2D[] = [
      [-1, -1],
      [2, -1],
      [2, 2],
      [-1, 2],
    ]

    const result = unionPolygons([small, large])

    expect(result).toHaveLength(1)
    expect(polygonArea(result[0]!)).toBeCloseTo(9)
  })

  test('combines overlapping rectangles into one boundary', () => {
    const left: Point2D[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]
    const right: Point2D[] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]

    const result = unionPolygons([left, right])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(8)
    expect(polygonArea(result[0]!)).toBeCloseTo(7)
  })

  test('keeps disjoint polygons as separate boundaries', () => {
    const left: Point2D[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const right: Point2D[] = [
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
    ]

    const result = unionPolygons([left, right])

    expect(result).toHaveLength(2)
    expect(result.map(polygonArea)).toEqual([1, 1])
  })
})

describe('subtractPolygonsFromPolygon', () => {
  test('returns an outer contour and an enclosed window hole', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const window: Point2D[] = [
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
    ]

    const result = subtractPolygonsFromPolygon(slab, [window])

    expect(result).toHaveLength(2)
    expect(result.map(polygonArea).sort((a, b) => a - b)).toEqual([2, 12])
  })

  test('turns a boundary-overlapping cutter into an indentation', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const cutout: Point2D[] = [
      [1, -0.5],
      [3, -0.5],
      [3, 1],
      [1, 1],
    ]

    const result = subtractPolygonsFromPolygon(slab, [cutout])

    expect(result).toHaveLength(1)
    expect(result[0]).toContainEqual([1, 1])
    expect(result[0]).toContainEqual([3, 1])
    expect(polygonArea(result[0]!)).toBeCloseTo(10)
  })

  test('returns separate contours when a cutter splits the subject', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const cutout: Point2D[] = [
      [1.5, -1],
      [2.5, -1],
      [2.5, 4],
      [1.5, 4],
    ]

    const result = subtractPolygonsFromPolygon(slab, [cutout])

    expect(result).toHaveLength(2)
    expect(result.map(polygonArea).sort((a, b) => a - b)).toEqual([4.5, 4.5])
  })

  test('keeps two disjoint window holes as three contours', () => {
    const slab: Point2D[] = [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ]
    const leftWindow: Point2D[] = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ]
    const rightWindow: Point2D[] = [
      [3, 1],
      [4, 1],
      [4, 2],
      [3, 2],
    ]

    const result = subtractPolygonsFromPolygon(slab, [leftWindow, rightWindow])

    expect(result).toHaveLength(3)
    expect(result.map(polygonArea).sort((a, b) => a - b)).toEqual([1, 1, 20])
  })

  test('clips an opening crossing the footprint cap', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const crossingOpening: Point2D[] = [
      [3, 1],
      [5, 1],
      [5, 2],
      [3, 2],
    ]

    const result = subtractPolygonsFromPolygon(slab, [crossingOpening])

    expect(result).toHaveLength(1)
    expect(polygonArea(result[0]!)).toBeCloseTo(11)
    expect(result[0]).toContainEqual([4, 1])
    expect(result[0]).toContainEqual([4, 2])
  })

  test('handles an opening ending exactly on the footprint boundary', () => {
    const slab: Point2D[] = [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ]
    const boundaryOpening: Point2D[] = [
      [2, 1],
      [5, 1],
      [5, 2],
      [2, 2],
    ]

    const result = subtractPolygonsFromPolygon(slab, [boundaryOpening])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(8)
    expect(polygonArea(result[0]!)).toBeCloseTo(17)
  })

  test('extends a floor-level door notch to the exact semantic padding', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const floorDoor: Point2D[] = [
      [1, -0.02],
      [2, -0.02],
      [2, 1.05],
      [1, 1.05],
    ]

    const result = subtractPolygonsFromPolygon(slab, [floorDoor])

    expect(result).toHaveLength(1)
    expect(polygonArea(result[0]!)).toBeCloseTo(10.95)
    expect(result[0]).toContainEqual([1, 0])
    expect(result[0]).toContainEqual([2, 0])
  })
})
