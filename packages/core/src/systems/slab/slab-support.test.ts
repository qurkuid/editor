import { describe, expect, it } from 'bun:test'
import { SlabNode, WallNode } from '../../schema'
import { MIN_WALL_HEIGHT } from '../wall/wall-top'
import {
  clampSlabElevationForWalls,
  computeWallSlabSupport,
  getSlabElevationUpperBound,
} from './slab-support'

// 4×3 room slab drawn on the wall centerlines, like an auto-slab.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

const STOREY_HEIGHT = 2.7
const BOUND = STOREY_HEIGHT - MIN_WALL_HEIGHT

function roomSlab(elevation: number) {
  return SlabNode.parse({ polygon: SQUARE, elevation, autoFromWalls: true })
}

function roomWalls(height?: number) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

describe('clampSlabElevationForWalls', () => {
  it('clamps a slab under plane-bound walls at the plane minus MIN_WALL_HEIGHT', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(true)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('leaves proposals at or below the bound untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(BOUND, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('passes negative (recessed-committing) proposals through untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(-0.6, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(-0.6)
  })

  it('does not clamp when the walls all carry explicit heights', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(2.5), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })

  it('does not clamp a slab covering no walls', () => {
    const island = SlabNode.parse({
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.05,
    })
    const result = clampSlabElevationForWalls(2.5, island, roomWalls(), [island], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })
})

describe('getSlabElevationUpperBound', () => {
  it('bounds a slab electable by plane-bound walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(), [slab], STOREY_HEIGHT)).toBeCloseTo(BOUND)
  })

  it('is unbounded under explicit-height walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(2.5), [slab], STOREY_HEIGHT)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('computeWallSlabSupport preferred host', () => {
  const wallLike = { start: [0, 1.5] as [number, number], end: [4, 1.5] as [number, number] }
  const low = SlabNode.parse({
    id: 'slab_low',
    polygon: SQUARE,
    elevation: 0.1,
    autoFromWalls: true,
  })
  const high = SlabNode.parse({
    id: 'slab_high',
    polygon: SQUARE,
    elevation: 0.6,
    autoFromWalls: true,
  })

  it('elects the highest supporting elevation without a preference', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [])
    expect(support.elevation).toBeCloseTo(0.6)
  })

  it('pins the elected elevation to a still-supporting preferred slab', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [], 'slab_low')
    expect(support.elevation).toBeCloseTo(0.1)
    // Fill-down machinery still derives from ALL supporting slabs.
    expect(support.baseSegments).toHaveLength(1)
    expect(support.baseSegments[0]!.elevation).toBeCloseTo(0.6)
  })

  it('ignores a preferred slab that no longer supports the wall', () => {
    const island = SlabNode.parse({
      id: 'slab_island',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.9,
    })
    const support = computeWallSlabSupport(wallLike, [low, high, island], [], 'slab_island')
    expect(support.elevation).toBeCloseTo(0.6)
  })
})

describe('computeWallSlabSupport apartment automatic base fallback', () => {
  const levelId = 'level_auto_base'
  const sourceCoordinates = [
    [
      [-1.5598013527106631, 3.754434235140441],
      [-3.610501352710662, 3.754434235140441],
    ],
    [
      [-1.1336013527106625, 3.752434235140441],
      [-1.5598013527106631, 3.752434235140441],
    ],
  ] as const
  const makeWall = (
    start: [number, number],
    end: [number, number],
    overrides: Record<string, unknown> = {},
  ) =>
    WallNode.parse({
      parentId: levelId,
      start,
      end,
      thickness: 0.1,
      metadata: { source: 'apt-vector' },
      ...overrides,
    })
  const remoteAutoSlab = (overrides: Record<string, unknown> = {}) =>
    SlabNode.parse({
      parentId: levelId,
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.05,
      autoFromWalls: true,
      ...overrides,
    })
  const fallback = {
    elevation: 0.05,
    electedSlabId: null,
    baseElevation: 0.05,
    baseSegments: [{ start: 0, end: 1, elevation: 0.05 }],
  }

  it('uses the unanimous automatic floor for the two exact unsupported source walls', () => {
    const walls = sourceCoordinates.map(([start, end]) => makeWall([...start], [...end]))
    const slabs = [remoteAutoSlab()]

    for (const wall of walls) {
      expect(computeWallSlabSupport(wall, slabs, walls)).toEqual(fallback)
      expect(
        computeWallSlabSupport(
          {
            start: wall.start,
            end: wall.end,
            curveOffset: wall.curveOffset,
            thickness: wall.thickness,
            supportOffset: wall.supportOffset,
          },
          slabs,
          walls,
        ),
      ).toEqual(fallback)
    }
  })

  it('keeps real slab support authoritative and resumes the fallback after removal', () => {
    const wall = makeWall([0, 0], [2, 0])
    const remote = remoteAutoSlab()
    const actual = SlabNode.parse({
      id: 'slab_actual',
      parentId: levelId,
      polygon: [
        [-1, -1],
        [3, -1],
        [3, 1],
        [-1, 1],
      ],
      elevation: 0.05,
    })
    const raised = SlabNode.parse({ ...actual, id: 'slab_raised', elevation: 0.2 })

    expect(computeWallSlabSupport(wall, [remote, actual], [wall])).toMatchObject({
      elevation: 0.05,
      electedSlabId: actual.id,
    })
    expect(computeWallSlabSupport(wall, [remote, raised], [wall])).toMatchObject({
      elevation: 0.2,
      electedSlabId: raised.id,
    })
    expect(computeWallSlabSupport(wall, [remote], [wall])).toEqual(fallback)
  })

  it('fails closed for ambiguous identity and authored vertical intent', () => {
    const wall = makeWall([0, 0], [2, 0])
    const auto = remoteAutoSlab()
    const cases = [
      { query: wall, slabs: [auto], walls: [] },
      { query: wall, slabs: [auto], walls: [wall, { ...wall, id: 'wall_duplicate' }] },
      { query: makeWall([0, 0], [2, 0], { metadata: { source: 'manual' } }), slabs: [auto] },
      { query: makeWall([0, 0], [2, 0], { height: 2.5 }), slabs: [auto] },
      { query: makeWall([0, 0], [2, 0], { supportSlabId: 'ground' }), slabs: [auto] },
      { query: makeWall([0, 0], [2, 0], { supportOffset: 0.1 }), slabs: [auto] },
    ]

    for (const entry of cases) {
      const walls = entry.walls ?? [entry.query]
      expect(computeWallSlabSupport(entry.query, entry.slabs, walls).elevation).toBe(0)
    }
    expect(computeWallSlabSupport({ ...wall, supportOffset: 0.1 }, [auto], [wall]).elevation).toBe(
      0,
    )
  })

  it('fails closed for missing, conflicting, recessed, holed, or capped floor evidence', () => {
    const wall = makeWall([0, 0], [2, 0])
    const auto = remoteAutoSlab()
    const invalidSlabSets = [
      [],
      [remoteAutoSlab({ parentId: 'level_other' })],
      [
        auto,
        remoteAutoSlab({
          id: 'slab_high',
          elevation: 0.2,
          polygon: [
            [20, 20],
            [22, 20],
            [22, 22],
            [20, 22],
          ],
        }),
      ],
      [
        auto,
        remoteAutoSlab({
          id: 'slab_authored_step',
          autoFromWalls: false,
          elevation: 0.2,
          polygon: [
            [20, 20],
            [22, 20],
            [22, 22],
            [20, 22],
          ],
        }),
      ],
      [remoteAutoSlab({ recessed: true })],
      [
        remoteAutoSlab({
          holes: [
            [
              [10.2, 10.2],
              [10.8, 10.2],
              [10.5, 10.8],
            ],
          ],
        }),
      ],
    ]

    for (const slabs of invalidSlabSets) {
      expect(computeWallSlabSupport(wall, slabs, [wall]).elevation).toBe(0)
    }
    expect(computeWallSlabSupport(wall, [auto], [wall], null, -0.01).elevation).toBe(0)
    expect(computeWallSlabSupport(wall, [auto], [wall], null, 0.04)).toEqual(fallback)
    expect(computeWallSlabSupport(wall, [auto], [wall], null, 0.05)).toEqual(fallback)
  })
})
