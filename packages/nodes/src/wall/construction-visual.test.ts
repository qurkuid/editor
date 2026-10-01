import { describe, expect, test } from 'bun:test'
import { buildWallStudPlacements } from './construction-visual'

describe('buildWallStudPlacements', () => {
  test('returns only discrete stud locations and leaves the spans between them empty', () => {
    const placements = buildWallStudPlacements(2, 0.3, 0.033)

    expect(placements[0]).toEqual({ center: 0.0165, ratio: 0.00825 })
    expect(placements.at(-1)).toEqual({ center: 1.9835, ratio: 0.99175 })
    expect(placements.every((placement) => placement.center >= 0 && placement.center <= 2)).toBe(
      true,
    )
    expect(placements.some((placement) => placement.center > 0.1 && placement.center < 0.25)).toBe(
      false,
    )
  })
})
