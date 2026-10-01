import { describe, expect, test } from 'bun:test'
import type {
  FloorplanDimensionEditDescriptor,
  FloorplanDimensionEditLeaf,
  FloorplanPoint,
} from '../registry/types'
import {
  type AnyNode,
  type AnyNodeId,
  ConstructionGuideNode,
  DoorNode,
  LevelNode,
  WallNode,
} from '../schema'
import {
  AxisGuideStretchError,
  buildAxisGuideStretchPlan,
  buildDimensionStretchPlan,
} from './axis-guide-stretch'

type Point = [number, number]

function distance(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function makeScene(levelId: AnyNodeId, nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  const level = LevelNode.parse({
    id: levelId,
    children: nodes.filter((node) => node.type === 'wall').map((node) => node.id),
  })
  return {
    [level.id]: level,
    ...Object.fromEntries(nodes.map((node) => [node.id, node])),
  }
}

function makeDescriptor(
  levelId: AnyNodeId,
  id: string,
  kind: FloorplanDimensionEditDescriptor['kind'],
  leaves: readonly FloorplanDimensionEditLeaf[],
  measuredStart: FloorplanPoint,
  measuredEnd: FloorplanPoint,
): FloorplanDimensionEditDescriptor {
  return {
    id,
    levelId,
    kind,
    status: 'editable',
    measuredStart,
    measuredEnd,
    fixedEndOptions: ['start', 'end'],
    leaves,
    defaultLeafId: leaves[0]?.id,
  }
}

function basisPoint(tangent: Point, scalar: number): Point {
  return [tangent[0] * scalar, tangent[1] * scalar]
}

function perpendicularWall(
  id: AnyNodeId,
  parentId: AnyNodeId,
  tangent: Point,
  scalar: number,
  halfLength = 0.5,
): WallNode {
  const center = basisPoint(tangent, scalar)
  const normal: Point = [-tangent[1], tangent[0]]
  return WallNode.parse({
    id,
    parentId,
    start: [center[0] - normal[0] * halfLength, center[1] - normal[1] * halfLength],
    end: [center[0] + normal[0] * halfLength, center[1] + normal[1] * halfLength],
  })
}

function wallPatch(
  plan: ReturnType<typeof buildDimensionStretchPlan>,
  wallId: AnyNodeId,
): { start: Point; end: Point } | undefined {
  return plan.updates.find(({ id }) => id === wallId)?.data as
    | { start: Point; end: Point }
    | undefined
}

function expectPointClose(actual: Point | undefined, expected: Point): void {
  expect(actual).toBeDefined()
  expect(actual?.[0]).toBeCloseTo(expected[0], 10)
  expect(actual?.[1]).toBeCloseTo(expected[1], 10)
}

function expectError(action: () => unknown, code: AxisGuideStretchError['code']): void {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(AxisGuideStretchError)
  expect(error).toMatchObject({ code })
}

describe('buildDimensionStretchPlan', () => {
  test('uses the exact rotated tangent and preserves peer total leaves for either fixed end', () => {
    const levelId = 'level_rotated_dimension'
    const angle = Math.PI / 7
    const tangent: Point = [Math.cos(angle), Math.sin(angle)]
    const left = perpendicularWall('wall_rotated_left', levelId, tangent, -1)
    const selectedFar = perpendicularWall('wall_rotated_selected_far', levelId, tangent, 1)
    const peerFar = perpendicularWall('wall_rotated_peer_far', levelId, tangent, 2)
    const nodes = makeScene(levelId, [left, selectedFar, peerFar])
    const descriptor = makeDescriptor(
      levelId,
      'dimension_rotated_total',
      'total',
      [
        {
          id: 'leaf_selected',
          semanticKey: 'gap:selected',
          measuredStart: basisPoint(tangent, -1),
          measuredEnd: basisPoint(tangent, 1),
          currentLength: 2,
          wallIds: [left.id, selectedFar.id],
        },
        {
          id: 'leaf_peer',
          semanticKey: 'gap:peer',
          measuredStart: basisPoint(tangent, 1),
          measuredEnd: basisPoint(tangent, 2),
          currentLength: 1,
          wallIds: [selectedFar.id, peerFar.id],
        },
      ],
      basisPoint(tangent, -1),
      basisPoint(tangent, 2),
    )

    const fixedStart = buildDimensionStretchPlan(nodes, {
      descriptor,
      targetDistance: 3.5,
      fixedEnd: 'start',
      selectedLeafId: 'leaf_selected',
    })
    const halfDelta = basisPoint(tangent, 0.5)
    expect(fixedStart.delta).toBeCloseTo(0.5, 10)
    expect(wallPatch(fixedStart, left.id)).toBeUndefined()
    expectPointClose(
      fixedStart.updates.find(({ id }) => id === selectedFar.id)?.data.start as Point,
      [selectedFar.start[0] + halfDelta[0], selectedFar.start[1] + halfDelta[1]],
    )
    expectPointClose(
      fixedStart.updates.find(({ id }) => id === selectedFar.id)?.data.end as Point,
      [selectedFar.end[0] + halfDelta[0], selectedFar.end[1] + halfDelta[1]],
    )
    expectPointClose(fixedStart.updates.find(({ id }) => id === peerFar.id)?.data.start as Point, [
      peerFar.start[0] + halfDelta[0],
      peerFar.start[1] + halfDelta[1],
    ])
    expectPointClose(fixedStart.updates.find(({ id }) => id === peerFar.id)?.data.end as Point, [
      peerFar.end[0] + halfDelta[0],
      peerFar.end[1] + halfDelta[1],
    ])
    expect(distance(basisPoint(tangent, 1), basisPoint(tangent, 2))).toBeCloseTo(1, 10)

    const fixedEnd = buildDimensionStretchPlan(nodes, {
      descriptor,
      targetDistance: 3.5,
      fixedEnd: 'end',
      selectedLeafId: 'leaf_selected',
    })
    expect(fixedEnd.delta).toBeCloseTo(0.5, 10)
    const negativeHalfDelta = basisPoint(tangent, -0.5)
    expectPointClose(fixedEnd.updates.find(({ id }) => id === left.id)?.data.start as Point, [
      left.start[0] + negativeHalfDelta[0],
      left.start[1] + negativeHalfDelta[1],
    ])
    expectPointClose(fixedEnd.updates.find(({ id }) => id === left.id)?.data.end as Point, [
      left.end[0] + negativeHalfDelta[0],
      left.end[1] + negativeHalfDelta[1],
    ])
    expect(wallPatch(fixedEnd, selectedFar.id)).toBeUndefined()
    expect(wallPatch(fixedEnd, peerFar.id)).toBeUndefined()
  })

  test('keeps a selected-side 0.5 mm rigid wall from false reversal', () => {
    const levelId = 'level_tiny_rigid_wall'
    const tinyWall = WallNode.parse({
      id: 'wall_tiny_rigid',
      parentId: levelId,
      start: [1, 0],
      end: [1.0005, 0],
    })
    const nodes = makeScene(levelId, [tinyWall])
    const descriptor = makeDescriptor(
      levelId,
      'dimension_tiny_rigid_wall',
      'leaf',
      [
        {
          id: 'leaf_tiny_rigid',
          measuredStart: [-1, 0],
          measuredEnd: [1, 0],
          currentLength: 2,
          wallIds: [tinyWall.id],
        },
      ],
      [-1, 0],
      [1, 0],
    )

    const sourceDirection: Point = [
      tinyWall.end[0] - tinyWall.start[0],
      tinyWall.end[1] - tinyWall.start[1],
    ]
    expect(sourceDirection[0] ** 2 + sourceDirection[1] ** 2).toBeCloseTo(2.5e-7, 15)

    const plan = buildDimensionStretchPlan(nodes, {
      descriptor,
      targetDistance: 2.1,
      fixedEnd: 'start',
    })

    expect(plan.delta).toBeCloseTo(0.1, 10)
    expect(plan.updates.find(({ id }) => id === tinyWall.id)?.data).toEqual({
      start: [1.1, 0],
      end: [1.1005, 0],
    })
  })

  test('widens a documented opening leaf by the physical delta and moves its center by half', () => {
    const levelId = 'level_opening_dimension'
    const doorId = 'door_documented_leaf'
    const wallId = 'wall_opening_host'
    const door = DoorNode.parse({
      id: doorId,
      parentId: wallId,
      wallId,
      position: [2, 1, 0],
      width: 0.8,
      height: 2,
      dimensionReference: 'rough-opening',
      roughOpeningWidth: 0.9,
    })
    const wall = WallNode.parse({
      id: wallId,
      parentId: levelId,
      start: [-2, 0],
      end: [2, 0],
      children: [door.id],
    })
    const nodes = makeScene(levelId, [wall, door])
    const descriptor = makeDescriptor(
      levelId,
      'dimension_documented_total',
      'total',
      [
        {
          id: 'leaf_opening',
          semanticKey: 'opening:rough',
          measuredStart: [-0.45, 0],
          measuredEnd: [0.45, 0],
          currentLength: 0.9,
          wallIds: [wall.id],
          opening: {
            openingId: door.id,
            reference: 'rough-opening',
            displayedField: 'roughOpeningWidth',
            documentedOffset: 0.1,
          },
        },
        {
          id: 'leaf_peer_gap',
          semanticKey: 'gap:peer',
          measuredStart: [0.45, 0],
          measuredEnd: [1.45, 0],
          currentLength: 1,
          wallIds: [wall.id],
        },
      ],
      [-0.45, 0],
      [1.45, 0],
    )

    const plan = buildDimensionStretchPlan(nodes, {
      descriptor,
      targetDistance: 2.2,
      fixedEnd: 'start',
      selectedLeafId: 'leaf_opening',
    })

    expect(plan.delta).toBeCloseTo(0.3, 10)
    expect(plan.updates.find(({ id }) => id === wall.id)?.data).toEqual({
      end: [2.3, 0],
      start: [-2, 0],
    })
    const openingPatch = plan.updates.find(({ id }) => id === door.id)?.data as {
      position: [number, number, number]
      roughOpeningWidth: number
      width: number
    }
    expect(openingPatch.position).toEqual([2.15, 1, 0])
    expect(openingPatch.width).toBeCloseTo(1.1, 10)
    expect(openingPatch.roughOpeningWidth).toBeCloseTo(1.2, 10)
    expect(openingPatch.roughOpeningWidth - openingPatch.width).toBeCloseTo(0.1, 10)
  })

  test('rejects invalid, oblique, and colliding edits before changing the input snapshot', () => {
    const invalidLevelId = 'level_invalid_dimension'
    const invalidLevel = LevelNode.parse({ id: invalidLevelId, children: [] })
    const invalidNodes = { [invalidLevel.id]: invalidLevel } as Record<AnyNodeId, AnyNode>
    const invalidDescriptor = makeDescriptor(
      invalidLevelId,
      'dimension_invalid_target',
      'leaf',
      [
        {
          id: 'leaf_invalid',
          measuredStart: [-1, 0],
          measuredEnd: [1, 0],
          currentLength: 2,
          wallIds: [],
        },
      ],
      [-1, 0],
      [1, 0],
    )
    const invalidSnapshot = structuredClone(invalidNodes)
    expectError(
      () =>
        buildDimensionStretchPlan(invalidNodes, {
          descriptor: invalidDescriptor,
          targetDistance: 0,
          fixedEnd: 'start',
        }),
      'invalid-target',
    )
    expect(invalidNodes).toEqual(invalidSnapshot)

    const obliqueLevelId = 'level_oblique_dimension'
    const obliqueWall = WallNode.parse({
      id: 'wall_oblique_dimension',
      parentId: obliqueLevelId,
      start: [-1, -1],
      end: [1, 1],
    })
    const obliqueNodes = makeScene(obliqueLevelId, [obliqueWall])
    const obliqueDescriptor = makeDescriptor(
      obliqueLevelId,
      'dimension_oblique',
      'leaf',
      [
        {
          id: 'leaf_oblique',
          measuredStart: [-1, 0],
          measuredEnd: [1, 0],
          currentLength: 2,
          wallIds: [obliqueWall.id],
        },
      ],
      [-1, 0],
      [1, 0],
    )
    const obliqueSnapshot = structuredClone(obliqueNodes)
    expectError(
      () =>
        buildDimensionStretchPlan(obliqueNodes, {
          descriptor: obliqueDescriptor,
          targetDistance: 3,
          fixedEnd: 'start',
        }),
      'unsupported-crossing-wall',
    )
    expect(obliqueNodes).toEqual(obliqueSnapshot)

    const collisionLevelId = 'level_dimension_collision'
    const collisionWallId = 'wall_dimension_collision'
    const fixedDoor = DoorNode.parse({
      id: 'door_dimension_fixed',
      parentId: collisionWallId,
      wallId: collisionWallId,
      position: [1.4, 1, 0],
      width: 0.8,
      height: 2,
    })
    const movingDoor = DoorNode.parse({
      id: 'door_dimension_moving',
      parentId: collisionWallId,
      wallId: collisionWallId,
      position: [2.6, 1, 0],
      width: 0.8,
      height: 2,
    })
    const collisionWall = WallNode.parse({
      id: collisionWallId,
      parentId: collisionLevelId,
      start: [-2, 0],
      end: [2, 0],
      children: [fixedDoor.id, movingDoor.id],
    })
    const collisionNodes = makeScene(collisionLevelId, [collisionWall, fixedDoor, movingDoor])
    const collisionDescriptor = makeDescriptor(
      collisionLevelId,
      'dimension_collision',
      'leaf',
      [
        {
          id: 'leaf_collision',
          measuredStart: [-1, 0],
          measuredEnd: [1, 0],
          currentLength: 2,
          wallIds: [collisionWall.id],
        },
      ],
      [-1, 0],
      [1, 0],
    )
    const collisionSnapshot = structuredClone(collisionNodes)
    expectError(
      () =>
        buildDimensionStretchPlan(collisionNodes, {
          descriptor: collisionDescriptor,
          targetDistance: 1.5,
          fixedEnd: 'start',
        }),
      'attachment-collision',
    )
    expect(collisionNodes).toEqual(collisionSnapshot)
  })

  test('accepts a one-milliradian crossing and keeps legacy axis parallel checks strict', () => {
    const dimensionLevelId = 'level_angle_tolerance'
    const wallAngle = 0.001
    const nearAxisWall = WallNode.parse({
      id: 'wall_angle_tolerance',
      parentId: dimensionLevelId,
      start: [-0.5, 0],
      end: [-0.5 + Math.cos(wallAngle), Math.sin(wallAngle)],
    })
    const dimensionNodes = makeScene(dimensionLevelId, [nearAxisWall])
    const descriptor = makeDescriptor(
      dimensionLevelId,
      'dimension_angle_tolerance',
      'leaf',
      [
        {
          id: 'leaf_angle_tolerance',
          measuredStart: [-1, 0],
          measuredEnd: [1, 0],
          currentLength: 2,
          wallIds: [nearAxisWall.id],
        },
      ],
      [-1, 0],
      [1, 0],
    )
    const plan = buildDimensionStretchPlan(dimensionNodes, {
      descriptor,
      targetDistance: 2.2,
      fixedEnd: 'start',
    })
    expect(plan.delta).toBeCloseTo(0.2, 10)
    expect(wallPatch(plan, nearAxisWall.id)).toBeDefined()

    const axisLevelId = 'level_strict_axis'
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_strict_axis',
      parentId: axisLevelId,
      origin: [0, 0],
      direction: [0, 1],
    })
    const longAlmostAxisWall = WallNode.parse({
      id: 'wall_long_almost_axis',
      parentId: axisLevelId,
      start: [-1000, 0],
      end: [1000, 0.000002],
    })
    const axisNodes = makeScene(axisLevelId, [guide, longAlmostAxisWall])
    const axisSnapshot = structuredClone(axisNodes)
    expect(Math.abs(longAlmostAxisWall.end[1] - longAlmostAxisWall.start[1])).toBeGreaterThan(1e-6)
    expectError(
      () =>
        buildAxisGuideStretchPlan(axisNodes, {
          guideId: guide.id,
          side: 1,
          distance: 1,
        }),
      'unsupported-crossing-wall',
    )
    expect(axisNodes).toEqual(axisSnapshot)
  })
})
