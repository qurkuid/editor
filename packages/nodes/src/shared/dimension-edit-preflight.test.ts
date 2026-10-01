import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  type FloorplanDimensionEditDescriptor,
  type GeometryContext,
  LevelNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { buildLevelWallConstructionDimensionPlan } from '../wall/construction-dimensions'
import { buildRoomClearDimensions } from '../zone/room-clear-dimensions'
import { preflightWallDimensionEdit, preflightZoneDimensionEdit } from './dimension-edit-preflight'

function exteriorWall(overrides: Partial<WallNode> = {}) {
  return WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
    ...overrides,
  })
}

function level() {
  return LevelNode.parse({ id: 'level_main', type: 'level', children: [] })
}

function descriptorFor(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  predicate: (descriptor: FloorplanDimensionEditDescriptor) => boolean,
) {
  const entries = buildLevelWallConstructionDimensionPlan([wall], nodes).get(wall.id) ?? []
  const descriptor = entries
    .map((entry) => entry.editDescriptor)
    .find(
      (candidate): candidate is FloorplanDimensionEditDescriptor =>
        candidate !== undefined && predicate(candidate),
    )
  if (!descriptor) throw new Error('test descriptor not found')
  return descriptor
}

describe('node-owned Expert dimension preflight', () => {
  test('applies one wall edit only after the regenerated chain reaches the target', () => {
    const wall = exteriorWall()
    const nodes = { [level().id]: level(), [wall.id]: wall } satisfies Record<string, AnyNode>
    const descriptor = descriptorFor(wall, nodes, (candidate) => candidate.kind === 'total')

    const result = preflightWallDimensionEdit({
      node: wall,
      nodes,
      request: {
        descriptor,
        selectedLeafId: descriptor.leaves[0]!.id,
        targetDistance: 12,
        fixedEnd: 'start',
      },
    })

    expect(result.descriptorId).toBe(descriptor.id)
    expect(result.updates).toEqual([
      expect.objectContaining({
        id: wall.id,
        data: { start: [0, 0], end: [12, 0] },
      }),
    ])
  })

  test('resolves a selected opening leaf inside a total and preserves its peers', () => {
    const wall = exteriorWall()
    const door = DoorNode.parse({
      id: 'door_main',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const nodes = {
      [level().id]: level(),
      [wall.id]: wall,
      [door.id]: door,
    } satisfies Record<string, AnyNode>
    const descriptor = descriptorFor(wall, nodes, (candidate) => candidate.kind === 'total')
    const selected = descriptor.leaves.find((leaf) => leaf.opening?.openingId === door.id)
    if (!selected) throw new Error('opening leaf not found')

    const result = preflightWallDimensionEdit({
      node: wall,
      nodes,
      request: {
        descriptor,
        selectedLeafId: selected.id,
        targetDistance: 10.2,
        fixedEnd: 'start',
      },
    })

    const wallUpdate = result.updates.find((update) => update.id === wall.id)
    const doorUpdate = result.updates.find((update) => update.id === door.id)
    expect(wallUpdate?.data).toEqual({ start: [0, 0], end: [10.2, 0] })
    expect(doorUpdate?.data.width).toBeCloseTo(1.2)
    expect(doorUpdate?.data.position).toEqual([expect.closeTo(2.1, 8), expect.closeTo(1.05, 8), 0])
  })

  test('uses documented opening offset once when a total selects a rough-opening leaf', () => {
    const wall = exteriorWall()
    const door = DoorNode.parse({
      id: 'door_rough',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 1,
      dimensionReference: 'rough-opening',
      roughOpeningWidth: 1.2,
    })
    const nodes = {
      [level().id]: level(),
      [wall.id]: wall,
      [door.id]: door,
    } satisfies Record<string, AnyNode>
    const descriptor = descriptorFor(wall, nodes, (candidate) => candidate.kind === 'total')
    const selected = descriptor.leaves.find((leaf) => leaf.opening?.openingId === door.id)
    if (!selected) throw new Error('rough-opening leaf not found')
    expect(selected.currentLength).toBeCloseTo(1.2)
    expect(selected.opening?.documentedOffset).toBeCloseTo(0.2)

    const result = preflightWallDimensionEdit({
      node: wall,
      nodes,
      request: {
        descriptor,
        selectedLeafId: selected.id,
        targetDistance: 10.2,
        fixedEnd: 'start',
      },
    })

    const doorUpdate = result.updates.find((update) => update.id === door.id)
    expect(doorUpdate?.data.width).toBeCloseTo(1.2)
  })

  test('rejects editable descriptors without stable node-owned provenance', () => {
    const wall = exteriorWall()
    const nodes = { [level().id]: level(), [wall.id]: wall } satisfies Record<string, AnyNode>
    const descriptor = descriptorFor(wall, nodes, (candidate) => candidate.kind === 'total')

    expect(() =>
      preflightWallDimensionEdit({
        node: wall,
        nodes,
        request: {
          descriptor: { ...descriptor, generatorKey: undefined },
          selectedLeafId: descriptor.leaves[0]!.id,
          targetDistance: 12,
          fixedEnd: 'start',
        },
      }),
    ).toThrow(/regeneration provenance/)
  })

  test('regenerates a room-clear span after moving its fixed boundary', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = points.map((start, index) =>
      WallNode.parse({
        id: `wall_room_${index}`,
        parentId: 'level_main',
        start,
        end: points[(index + 1) % points.length]!,
        thickness: 0.2,
      }),
    )
    const zone = ZoneNode.parse({
      id: 'zone_room',
      parentId: 'level_main',
      name: 'Room',
      polygon: points,
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
      spaceRole: 'room',
      clearDimensionPolicy: 'inside-faces',
    })
    const roomLevel = level()
    const nodes = Object.fromEntries(
      [roomLevel, ...walls, zone].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const context = {
      resolve: (id) => nodes[id],
      children: [],
      siblings: [zone],
      parent: roomLevel,
    } satisfies GeometryContext
    const geometry = buildRoomClearDimensions(zone, context)
    const dimension = geometry.find(
      (entry): entry is Extract<typeof entry, { kind: 'dimension' }> =>
        entry.kind === 'dimension' && entry.editDescriptor?.status === 'editable',
    )
    const descriptor = dimension?.editDescriptor
    if (!descriptor) throw new Error('room-clear descriptor not found')
    const current = descriptor.leaves[0]!.currentLength

    const result = preflightZoneDimensionEdit({
      node: zone,
      nodes,
      request: {
        descriptor,
        targetDistance: current + 0.3,
        fixedEnd: 'start',
      },
    })

    expect(result.descriptorId).toBe(descriptor.id)
    expect(result.updates.some((update) => walls.some((wall) => wall.id === update.id))).toBe(true)
  })
})
