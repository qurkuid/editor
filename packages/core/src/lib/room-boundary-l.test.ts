import { describe, expect, test } from 'bun:test'
import { LevelNode, WallNode } from '../schema'
import {
  buildManualRoomBoundaryRepair,
  type ManualRoomBoundaryInput,
  roomBoundarySnapshot,
} from './room-boundary'

const level = LevelNode.parse({ id: 'level_l_corner' })

function fixture(extra: Record<string, WallNode> = {}) {
  const source = WallNode.parse({
    id: 'wall_l_source',
    parentId: level.id,
    start: [0, 0],
    end: [1, 0],
    children: ['door_l_source'],
    metadata: { source: 'fixture' },
    thickness: 0.14,
    height: 2.8,
    slots: { interior: 'library:concrete-drywall' },
    supportOffset: 0.25,
  })
  const target = WallNode.parse({
    id: 'wall_l_target',
    parentId: level.id,
    start: [3, 2],
    end: [4, 2],
    children: ['window_l_target'],
    supportOffset: 0.25,
  })
  return {
    [level.id]: level,
    [source.id]: source,
    [target.id]: target,
    ...extra,
  }
}

function input(overrides: Partial<ManualRoomBoundaryInput> = {}): ManualRoomBoundaryInput {
  return {
    levelId: level.id,
    wallId: 'wall_l_source',
    endpoint: 'end',
    targetWallId: 'wall_l_target',
    targetEndpoint: 'start',
    mode: 'l-corner',
    bendOrder: 'horizontal-vertical',
    createdWallIds: ['wall_l_leg_a', 'wall_l_leg_b'],
    ...overrides,
  }
}

describe('manual room boundary L connector', () => {
  test('plans two horizontal-then-vertical walls without changing either selected wall', () => {
    const nodes = fixture()
    const before = structuredClone(nodes)
    const plan = buildManualRoomBoundaryRepair(nodes, input())

    expect(plan.ok).toBe(true)
    expect(plan.updates).toEqual([])
    expect(plan.creates).toHaveLength(2)
    expect(plan.creates.map((wall) => [wall.start, wall.end])).toEqual([
      [
        [1, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [3, 2],
      ],
    ])
    expect(plan.measurements.map((measurement) => measurement.distance)).toEqual([2, 2])
    expect(nodes).toEqual(before)
  })

  test('plans the alternate vertical-then-horizontal order with stable supplied ids', () => {
    const plan = buildManualRoomBoundaryRepair(
      fixture(),
      input({
        bendOrder: 'vertical-horizontal',
        createdWallIds: ['wall_l_vertical', 'wall_l_horizontal'],
      }),
    )

    expect(plan.ok).toBe(true)
    expect(plan.creates.map((wall) => [wall.start, wall.end])).toEqual([
      [
        [1, 0],
        [1, 2],
      ],
      [
        [1, 2],
        [3, 2],
      ],
    ])
    expect(plan.creates.map((wall) => wall.id)).toEqual(['wall_l_vertical', 'wall_l_horizontal'])
  })

  test('copies source construction and materials while clearing identity and attachments', () => {
    const plan = buildManualRoomBoundaryRepair(fixture(), input())
    expect(plan.ok).toBe(true)
    const created = plan.creates[0]!
    expect(created.thickness).toBe(0.14)
    expect(created.height).toBe(2.8)
    expect(created.supportOffset).toBe(0.25)
    expect(created.slots).toEqual({ interior: 'library:concrete-drywall' })
    expect(created.children).toEqual([])
    expect(created.metadata).toEqual({})
    expect(created.frontSide).toBe('unknown')
    expect(created.backSide).toBe('unknown')
    expect(created.name).toBeUndefined()
    expect(created.finishRegions).toBeUndefined()
  })

  test('requires a shared support slab and inherits it into both created legs', () => {
    const nodes = fixture()
    nodes['wall_l_source'] = WallNode.parse({ ...nodes['wall_l_source'], supportSlabId: 'ground' })
    nodes['wall_l_target'] = WallNode.parse({ ...nodes['wall_l_target'], supportSlabId: 'ground' })
    const plan = buildManualRoomBoundaryRepair(nodes, input())
    expect(plan.ok).toBe(true)
    expect(plan.creates.map((wall) => wall.supportSlabId)).toEqual(['ground', 'ground'])

    const mismatched = {
      ...nodes,
      wall_l_target: WallNode.parse({ ...nodes['wall_l_target'], supportSlabId: 'slab_other' }),
    }
    expect(buildManualRoomBoundaryRepair(mismatched, input())).toMatchObject({
      ok: false,
      reason: 'elevation-mismatch',
      creates: [],
    })
  })

  test('rejects aligned legs, missing endpoint, id collision, and stale snapshots without creates', () => {
    const nodes = fixture()
    const cases = [
      input({ targetEndpoint: undefined }),
      input({ targetPoint: [3, 0] }),
      input({ createdWallIds: ['wall_l_source', 'wall_l_other'] }),
      input({ expectedSnapshot: `${roomBoundarySnapshot(nodes, level.id)}-stale` }),
    ]
    for (const candidate of cases) {
      const plan = buildManualRoomBoundaryRepair(nodes, candidate)
      expect(plan.ok).toBe(false)
      expect(plan.creates).toEqual([])
      expect(plan.updates).toEqual([])
    }
  })

  test('rejects a route crossing an unrelated wall and a nearby curved obstacle', () => {
    const crossing = WallNode.parse({
      id: 'wall_l_crossing',
      parentId: level.id,
      start: [2, -1],
      end: [2, 1],
    })
    expect(
      buildManualRoomBoundaryRepair(fixture({ [crossing.id]: crossing }), input()),
    ).toMatchObject({
      ok: false,
      reason: 'crossing',
      creates: [],
    })

    const curved = WallNode.parse({
      id: 'wall_l_curved',
      parentId: level.id,
      start: [2, -1],
      end: [2, 1],
      curveOffset: 0.2,
    })
    expect(buildManualRoomBoundaryRepair(fixture({ [curved.id]: curved }), input())).toMatchObject({
      ok: false,
      reason: 'curved-obstacle',
      creates: [],
    })
  })

  test('rejects a near-collinear source retrace after an intended endpoint contact', () => {
    const source = WallNode.parse({
      id: 'wall_l_source',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0.001],
      thickness: 0.1,
      supportOffset: 0.25,
    })
    const target = WallNode.parse({
      id: 'wall_l_target',
      parentId: level.id,
      start: [-1, 2],
      end: [-2, 2],
      supportOffset: 0.25,
    })
    expect(
      buildManualRoomBoundaryRepair(
        {
          [level.id]: level,
          [source.id]: source,
          [target.id]: target,
        },
        input(),
      ),
    ).toMatchObject({
      ok: false,
      reason: 'overlap',
      creates: [],
    })
  })

  test('rejects a near-collinear target retrace after an intended endpoint contact', () => {
    const target = WallNode.parse({
      id: 'wall_l_target',
      parentId: level.id,
      start: [3, 2],
      end: [3.001, 1],
      supportOffset: 0.25,
    })
    expect(buildManualRoomBoundaryRepair(fixture({ [target.id]: target }), input())).toMatchObject({
      ok: false,
      reason: 'overlap',
      creates: [],
    })
  })

  test('allows a far-away curved wall after the conservative broad phase', () => {
    const curved = WallNode.parse({
      id: 'wall_l_curved_far',
      parentId: level.id,
      start: [20, 20],
      end: [21, 20],
      curveOffset: 0.2,
    })
    expect(buildManualRoomBoundaryRepair(fixture({ [curved.id]: curved }), input())).toMatchObject({
      ok: true,
      creates: [{ id: 'wall_l_leg_a' }, { id: 'wall_l_leg_b' }],
    })
  })

  test('accepts a short selected-host gap when final wall footprints stay disjoint', () => {
    const source = WallNode.parse({
      id: 'wall_l_short_source',
      parentId: level.id,
      start: [-1, 0],
      end: [0, 0],
      thickness: 0.1,
    })
    const target = WallNode.parse({
      id: 'wall_l_short_target',
      parentId: level.id,
      start: [0.16, 0.08],
      end: [0.16, 1],
      thickness: 0.1,
    })
    const plan = buildManualRoomBoundaryRepair(
      {
        [level.id]: level,
        [source.id]: source,
        [target.id]: target,
      },
      input({
        wallId: source.id,
        targetWallId: target.id,
        targetEndpoint: 'start',
        createdWallIds: ['wall_l_short_leg_a', 'wall_l_short_leg_b'],
      }),
    )
    expect(plan.ok).toBe(true)
  })

  test('uses a projected body target point for an L connection', () => {
    const target = WallNode.parse({
      id: 'wall_l_target',
      parentId: level.id,
      start: [3, 2],
      end: [5, 2],
      supportOffset: 0.25,
    })
    const plan = buildManualRoomBoundaryRepair(
      fixture({ [target.id]: target }),
      input({
        targetEndpoint: undefined,
        targetPoint: [3.5, 2],
      }),
    )
    expect(plan.ok).toBe(true)
    expect(plan.point).toEqual([3.5, 2])
    expect(plan.creates.map((wall) => [wall.start, wall.end])).toEqual([
      [
        [1, 0],
        [3.5, 0],
      ],
      [
        [3.5, 0],
        [3.5, 2],
      ],
    ])
    expect(plan.updates).toEqual([])
  })

  test('keeps the original direct connection support-line behavior when targetPoint is supplied', () => {
    const target = WallNode.parse({
      id: 'wall_l_target',
      parentId: level.id,
      start: [3, -1],
      end: [3, 2],
    })
    const nodes = fixture({ [target.id]: target })
    const withoutPoint = buildManualRoomBoundaryRepair(nodes, {
      ...input(),
      mode: 'direct',
      targetEndpoint: undefined,
      targetPoint: undefined,
      createdWallIds: undefined,
    })
    const withPoint = buildManualRoomBoundaryRepair(nodes, {
      ...input(),
      mode: 'direct',
      targetEndpoint: undefined,
      targetPoint: [3, 0.5],
      createdWallIds: undefined,
    })
    expect(withPoint).toEqual(withoutPoint)
  })
})
