import { describe, expect, test } from 'bun:test'
import { DoorNode, LevelNode, WallNode, ZoneNode } from '../schema'
import {
  buildRoomBoundaryRepairUpdates,
  diagnoseRoomBoundaries,
  planRoomBoundaryRepair,
  type RoomBoundaryDiagnostics,
} from './room-boundary'
import { detectSpacesForLevel, planAutoZonesForLevel } from './space-detection'

const level = LevelNode.parse({ id: 'level_boundary_test' })

function rectangleWalls(gap = 0, metadata: Record<string, unknown> = {}) {
  return [
    WallNode.parse({
      id: 'wall_south',
      parentId: level.id,
      start: [-2, -1.5],
      end: [2 - gap, -1.5],
      metadata,
    }),
    WallNode.parse({
      id: 'wall_east',
      parentId: level.id,
      start: [2, -1.5],
      end: [2, 1.5],
      metadata,
    }),
    WallNode.parse({
      id: 'wall_north',
      parentId: level.id,
      start: [2, 1.5],
      end: [-2, 1.5],
      metadata,
    }),
    WallNode.parse({
      id: 'wall_west',
      parentId: level.id,
      start: [-2, 1.5],
      end: [-2, -1.5],
      metadata,
    }),
  ]
}

function diagnose(walls = rectangleWalls(0.2), zones: ZoneNode[] = []) {
  return diagnoseRoomBoundaries(level.id, walls, zones)
}

describe('room boundary diagnostics', () => {
  test('finds a repairable dangling corner without requiring a zone', () => {
    const result = diagnose()

    expect(result.spaces).toHaveLength(0)
    expect(result.danglingEndpoints.length).toBeGreaterThan(0)
    expect(
      result.issues.some((issue) => issue.candidates.some((candidate) => candidate.safe)),
    ).toBe(true)
    expect(
      result.issues.some((issue) => issue.candidates.some((candidate) => candidate.distance)),
    ).toBe(true)
  })

  test('does not surface a zero-length mirror candidate beyond the target segment', () => {
    const result = diagnose()
    const eastStart = result.issues.find(
      (issue) => issue.wallId === 'wall_east' && issue.endpoint === 'start',
    )

    expect(eastStart).toBeDefined()
    expect(eastStart!.candidates.some((candidate) => candidate.distance <= 1e-6)).toBe(false)
    expect(result.candidateGaps.some((candidate) => candidate.distance <= 1e-6)).toBe(false)
  })

  test('surfaces a corner seam beyond the derived physical-contact tolerance', () => {
    const result = diagnose(rectangleWalls(0.09))
    expect(result.spaces).toHaveLength(0)
    expect(result.danglingEndpoints.some((endpoint) => endpoint.wallId === 'wall_south')).toBe(true)
  })

  test('does not mark a sub-millimetre quantized corner as dangling', () => {
    const result = diagnose(rectangleWalls(0.0004))
    expect(result.spaces).toHaveLength(1)
    expect(result.danglingEndpoints).toHaveLength(0)
  })

  test('clears recovered endpoint markers from a derived three-wall corner', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_p07_top',
        parentId: level.id,
        start: [-0.6216924548734495, 2.904138363417701],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_left',
        parentId: level.id,
        start: [-0.6216924548734496, 2.904138363417701],
        end: [-0.6216924548734496, 0.5557383634177002],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_bottom',
        parentId: level.id,
        start: [-0.60729245487345, 0.5557383634177003],
        end: [0.7031075451265515, 0.5557383634177003],
        thickness: 0.2347,
        children: ['door_p07'],
      }),
      WallNode.parse({
        id: 'wall_p07_right',
        parentId: level.id,
        start: [0.7031075451265515, 0.5557383634177002],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_diagonal',
        parentId: level.id,
        start: [-0.6216924548734496, 0.545578679623234],
        end: [-0.7280976681316088, 0.4705062267908951],
        thickness: 0.1588,
      }),
    ]
    const result = diagnoseRoomBoundaries(level.id, walls, [])

    expect(result.spaces).toHaveLength(1)
    expect(result.danglingEndpoints).not.toContainEqual(
      expect.objectContaining({ wallId: 'wall_p07_left', endpoint: 'end' }),
    )
    expect(result.danglingEndpoints).not.toContainEqual(
      expect.objectContaining({ wallId: 'wall_p07_bottom', endpoint: 'start' }),
    )
    expect(result.danglingEndpoints).toContainEqual(
      expect.objectContaining({ wallId: 'wall_p07_diagonal', endpoint: 'start' }),
    )
  })

  test('rejects a T contact that is already within the room graph tolerance', () => {
    const walls = rectangleWalls(0)
    walls.push(
      WallNode.parse({
        id: 'wall_t_branch',
        parentId: level.id,
        start: [0, -1.5],
        end: [0, 1.5],
      }),
    )

    const result = diagnose(walls)
    expect(result.issues.some((issue) => issue.wallId === 'wall_t_branch')).toBe(false)
  })

  test('reports a collinear passage as manual review only', () => {
    const walls = [
      WallNode.parse({ id: 'wall_collinear_a', parentId: level.id, start: [0, 0], end: [1.8, 0] }),
      WallNode.parse({ id: 'wall_collinear_b', parentId: level.id, start: [2, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_collinear_up', parentId: level.id, start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_collinear_left', parentId: level.id, start: [0, 0], end: [0, 3] }),
      WallNode.parse({ id: 'wall_collinear_top', parentId: level.id, start: [4, 3], end: [0, 3] }),
    ]

    const result = diagnose(walls)
    const candidates = result.issues.flatMap((issue) => issue.candidates)
    expect(candidates.some((candidate) => candidate.reason === 'collinear')).toBe(true)
    expect(candidates.some((candidate) => candidate.safe)).toBe(false)
  })

  test('does not flag a continuous hosted opening as a boundary gap', () => {
    const walls = rectangleWalls(0)
    const door = DoorNode.parse({
      id: 'door_hosted',
      parentId: walls[0]!.id,
      wallId: walls[0]!.id,
      position: [0.8, 1, 0],
      width: 0.8,
    })

    walls[0]!.children = [door.id]
    const result = diagnose(walls, [])
    expect(result.danglingEndpoints).toHaveLength(0)
    expect(result.issues).toHaveLength(0)
  })

  test('marks a large gap as non-repairable', () => {
    const largeGap = [
      WallNode.parse({ id: 'wall_large_a', parentId: level.id, start: [0, 0], end: [1, 0] }),
      WallNode.parse({ id: 'wall_large_b', parentId: level.id, start: [2, 0], end: [2, 3] }),
      WallNode.parse({ id: 'wall_large_c', parentId: level.id, start: [2, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_large_d', parentId: level.id, start: [0, 3], end: [0, 0] }),
    ]
    const largeResult = diagnose(largeGap)
    expect(
      largeResult.issues.flatMap((issue) => issue.candidates).some((c) => c.reason === 'large'),
    ).toBe(true)
    expect(largeResult.issues.flatMap((issue) => issue.candidates).some((c) => c.safe)).toBe(false)
  })

  test('marks competing straight targets as ambiguous', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_ambiguous_source',
        parentId: level.id,
        start: [0, 0],
        end: [1.8, 0],
      }),
      WallNode.parse({
        id: 'wall_ambiguous_target_a',
        parentId: level.id,
        start: [2, -1],
        end: [2, 1],
      }),
      WallNode.parse({
        id: 'wall_ambiguous_target_b',
        parentId: level.id,
        start: [2.04, -1],
        end: [2.04, 1],
      }),
      WallNode.parse({ id: 'wall_ambiguous_top', parentId: level.id, start: [2, 1], end: [0, 1] }),
      WallNode.parse({ id: 'wall_ambiguous_left', parentId: level.id, start: [0, 1], end: [0, 0] }),
    ]
    const result = diagnose(walls)
    expect(
      result.issues.flatMap((issue) => issue.candidates).some((c) => c.reason === 'ambiguous'),
    ).toBe(true)
    expect(result.issues.flatMap((issue) => issue.candidates).some((c) => c.safe)).toBe(false)
  })

  test('a simulated safe repair proves a new closed space and rejects stale geometry', () => {
    const walls = rectangleWalls(0.2)
    const result = diagnose(walls)
    const issue = result.issues.find((entry) =>
      entry.candidates.some((candidate) => candidate.safe),
    )
    expect(issue).toBeDefined()

    const plan = planRoomBoundaryRepair(level.id, walls, issue!.id)
    expect(plan.ok).toBe(true)
    expect(plan.updates.length).toBeGreaterThan(0)
    expect(plan.beforeSpaceCount).toBe(0)
    expect(plan.afterSpaceCount).toBeGreaterThan(plan.beforeSpaceCount)

    const stale = walls.map((wall) =>
      wall.id === 'wall_south' ? WallNode.parse({ ...wall, end: [1.7, -1.5] }) : wall,
    )
    const stalePlan = planRoomBoundaryRepair(level.id, stale, issue!.id)
    expect(stalePlan.ok).toBe(false)
  })

  test('reuses a current diagnostics snapshot for render-time planning', () => {
    const walls = rectangleWalls(0.2)
    const diagnostics = diagnose(walls)
    const issue = diagnostics.issues.find((entry) =>
      entry.candidates.some((candidate) => candidate.safe),
    )
    expect(issue).toBeDefined()

    const plan = planRoomBoundaryRepair(level.id, walls, issue!.id, diagnostics)
    expect(plan.ok).toBe(true)

    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
    const updates = buildRoomBoundaryRepairUpdates(nodes, level.id, issue!.id, diagnostics)
    expect(updates.ok).toBe(true)
  })

  test('plans the smallest two-gap bundle and rebases a hosted opening on a moved start', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_bundle_south',
        parentId: level.id,
        start: [-2, -1.5],
        end: [1.8, -1.5],
      }),
      WallNode.parse({
        id: 'wall_bundle_east',
        parentId: level.id,
        start: [2, -1.3],
        end: [2, 1.5],
      }),
      WallNode.parse({
        id: 'wall_bundle_north',
        parentId: level.id,
        start: [2, 1.5],
        end: [-2, 1.5],
      }),
      WallNode.parse({
        id: 'wall_bundle_west',
        parentId: level.id,
        start: [-2, 1.5],
        end: [-2, -1.5],
      }),
    ]
    const door = DoorNode.parse({
      id: 'door_bundle_east',
      parentId: walls[1]!.id,
      wallId: walls[1]!.id,
      position: [1.4, 1, 0],
      width: 0.8,
    })
    walls[1]!.children = [door.id]
    const result = diagnoseRoomBoundaries(level.id, walls)
    const issue = result.issues.find((entry) =>
      entry.candidates.some((candidate) => candidate.reason === 'does-not-close-room'),
    )
    expect(issue).toBeDefined()
    expect(issue!.candidates.some((candidate) => candidate.safe)).toBe(true)

    const plan = planRoomBoundaryRepair(level.id, walls, issue!.id)
    expect(plan.ok).toBe(true)
    expect(plan.candidates).toHaveLength(2)
    expect(plan.updates.map((update) => update.id)).toEqual(
      expect.arrayContaining(['wall_bundle_south', 'wall_bundle_east']),
    )
    expect(plan.afterSpaceCount).toBeGreaterThan(plan.beforeSpaceCount)

    const nodes = Object.fromEntries([
      [level.id, level],
      ...walls.map((wall) => [wall.id, wall]),
      [door.id, door],
    ])
    const validated = buildRoomBoundaryRepairUpdates(nodes, level.id, issue!.id)
    expect(validated.ok).toBe(true)
    expect(validated.updates.map((update) => update.id)).toEqual(
      expect.arrayContaining(['wall_bundle_south', 'wall_bundle_east', door.id]),
    )
    const doorUpdate = validated.updates.find((update) => update.id === door.id)
    expect(
      (doorUpdate?.data as { position?: [number, number, number] })?.position?.[0],
    ).toBeCloseTo(1.6)
    expect(
      (doorUpdate?.data as { position?: [number, number, number] })?.position?.slice(1),
    ).toEqual([1, 0])
  })

  test('does not bundle an unrelated dangling L into a separate room closure', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_unrelated_l_horizontal',
        parentId: level.id,
        start: [0, 1],
        end: [9.8, 1],
      }),
      WallNode.parse({
        id: 'wall_unrelated_l_vertical',
        parentId: level.id,
        start: [0, 1],
        end: [0, 4],
      }),
      WallNode.parse({
        id: 'wall_remote_south',
        parentId: level.id,
        start: [10, 0],
        end: [13.8, 0],
      }),
      WallNode.parse({
        id: 'wall_remote_east',
        parentId: level.id,
        start: [14, 0.2],
        end: [14, 3],
      }),
      WallNode.parse({
        id: 'wall_remote_north',
        parentId: level.id,
        start: [14, 3],
        end: [10, 3],
      }),
      WallNode.parse({
        id: 'wall_remote_west',
        parentId: level.id,
        start: [10, 3],
        end: [10, 0],
      }),
    ]
    const result = diagnoseRoomBoundaries(level.id, walls)
    const unrelatedIssue = result.issues.find(
      (issue) => issue.wallId === 'wall_unrelated_l_horizontal' && issue.endpoint === 'end',
    )
    expect(
      unrelatedIssue?.candidates.some((candidate) => candidate.reason === 'does-not-close-room'),
    ).toBe(true)

    const unrelatedPlan = planRoomBoundaryRepair(level.id, walls, unrelatedIssue!.id)
    expect(unrelatedPlan.ok).toBe(false)

    const remoteIssue = result.issues.find(
      (issue) => issue.wallId === 'wall_remote_south' && issue.endpoint === 'end',
    )
    expect(remoteIssue).toBeDefined()
    const remotePlan = planRoomBoundaryRepair(level.id, walls, remoteIssue!.id)
    expect(remotePlan.ok).toBe(true)
    expect(remotePlan.candidates).toHaveLength(2)
  })

  test('preserves existing semantic subdivision coverage when planning auto zones', () => {
    const walls = rectangleWalls(0)
    const subdivision = ZoneNode.parse({
      id: 'zone_semantic_subdivision_a',
      parentId: level.id,
      name: 'Living area',
      polygon: [
        [-2, -1.5],
        [2, -1.5],
        [2, 0],
        [-2, 0],
      ],
      spaceRole: 'generic',
      autoFromWalls: false,
      metadata: { source: 'user' },
    })
    const secondSubdivision = ZoneNode.parse({
      id: 'zone_semantic_subdivision_b',
      parentId: level.id,
      name: 'Kitchen area',
      polygon: [
        [-2, 0],
        [2, 0],
        [2, 1.5],
        [-2, 1.5],
      ],
      spaceRole: 'generic',
      autoFromWalls: false,
      metadata: { source: 'user' },
    })
    const result: RoomBoundaryDiagnostics = diagnoseRoomBoundaries(level.id, walls, [
      subdivision,
      secondSubdivision,
    ])
    expect(result.spaces).toHaveLength(1)

    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const plan = planAutoZonesForLevel(spaces, [subdivision, secondSubdivision], {
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })
})
