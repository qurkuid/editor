import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { closestRoomBoundaryTargets, createRoomBoundaryWallIds } from './room-boundary-interaction'

const target = WallNode.parse({ id: 'wall_target_hit', start: [2, 0.2], end: [2, 2] })
const competing = WallNode.parse({ id: 'wall_competing_hit', start: [2.03, 0.3], end: [2.03, 2] })

describe('manual boundary target hit resolution', () => {
  test('selects the nearest actual centerline independent of SVG wall order', () => {
    for (const walls of [
      [target, competing],
      [competing, target],
    ]) {
      expect(closestRoomBoundaryTargets(walls, [2, 1], 0.01)).toEqual([
        { wallId: target.id, endpoint: undefined, targetPoint: [2, 1], distance: 0 },
      ])
      expect(closestRoomBoundaryTargets(walls, [2.03, 1], 0.01)).toEqual([
        {
          wallId: competing.id,
          endpoint: undefined,
          targetPoint: [2.03, 1],
          distance: expect.closeTo(0, 12),
        },
      ])
    }
  })
  test('selects the exact endpoint over an overlapping later wall hit area', () => {
    expect(closestRoomBoundaryTargets([target, competing], [2, 0.2], 0.02)).toEqual([
      { wallId: target.id, endpoint: 'start', targetPoint: [2, 0.2], distance: 0 },
    ])
  })
  test('returns all exact equidistant choices for explicit selection in stable order', () => {
    const forward = closestRoomBoundaryTargets([target, competing], [2.015, 1], 0.01)
    const reverse = closestRoomBoundaryTargets([competing, target], [2.015, 1], 0.01)
    expect(forward).toHaveLength(2)
    expect(reverse).toEqual(forward)
  })
  test('rejects outside hit radius and zero-length targets', () => {
    expect(closestRoomBoundaryTargets([target], [2.2, 1], 0.01)).toEqual([])
    expect(
      closestRoomBoundaryTargets([{ ...target, end: target.start }], target.start, 0.01),
    ).toEqual([])
  })

  test('projects body clicks onto the target centerline for L contacts', () => {
    expect(closestRoomBoundaryTargets([target], [2.07, 1], 0.01)).toEqual([
      {
        wallId: target.id,
        endpoint: undefined,
        targetPoint: [2, 1],
        distance: expect.closeTo(0.07, 12),
      },
    ])
  })

  test('allocates two distinct wall ids for one L preview', () => {
    const ids = createRoomBoundaryWallIds()
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids.every((id) => id.startsWith('wall_'))).toBe(true)
  })
})
