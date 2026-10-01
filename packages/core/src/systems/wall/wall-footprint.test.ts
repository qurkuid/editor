import { expect, test } from 'bun:test'
import { createDefaultWallFaceBands } from '../../lib/wall-construction'
import { WallNode } from '../../schema'
import { getWallPlanFootprint } from './wall-footprint'
import { calculateLevelMiters } from './wall-mitering'

test('T branch ends at the physical host face without a wedge inside the host', () => {
  const host = WallNode.parse({ start: [-2, 0], end: [2, 0], thickness: 0.2 })
  const branch = WallNode.parse({ start: [0, 0], end: [0, 2], thickness: 0.1 })
  const footprint = getWallPlanFootprint(branch, calculateLevelMiters([host, branch]))
  expect(Math.min(...footprint.map((point) => point.y))).toBeCloseTo(0.1, 8)
})

test('junctions use construction thickness rather than a stale authored thickness', () => {
  const host = WallNode.parse({
    start: [-2, 0],
    end: [2, 0],
    thickness: 0.1,
    faceBands: createDefaultWallFaceBands(0.3),
  })
  const branch = WallNode.parse({ start: [0, 2], end: [0, 0], thickness: 0.1 })
  const footprint = getWallPlanFootprint(branch, calculateLevelMiters([host, branch]))
  expect(Math.min(...footprint.map((point) => point.y))).toBeCloseTo(0.15, 8)
})
