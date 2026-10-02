import { describe, expect, test } from 'bun:test'
import { detectSpacesForLevel, SlabNode, WallNode, ZoneNode } from '@pascal-app/core'
import { resolveRelatedZonesForNode } from './zone-content'

const levelId = 'level-related-zone'

function sharedRoomWalls() {
  return [
    WallNode.parse({ id: 'wall_left_bottom', parentId: levelId, start: [0, 0], end: [2, 0] }),
    WallNode.parse({ id: 'wall_shared', parentId: levelId, start: [2, 0], end: [2, 3] }),
    WallNode.parse({ id: 'wall_right_bottom', parentId: levelId, start: [2, 0], end: [4, 0] }),
    WallNode.parse({ id: 'wall_right', parentId: levelId, start: [4, 0], end: [4, 3] }),
    WallNode.parse({ id: 'wall_right_top', parentId: levelId, start: [4, 3], end: [2, 3] }),
    WallNode.parse({ id: 'wall_left_top', parentId: levelId, start: [2, 3], end: [0, 3] }),
    WallNode.parse({ id: 'wall_left', parentId: levelId, start: [0, 3], end: [0, 0] }),
  ]
}

function roomZones() {
  const walls = sharedRoomWalls()
  const spaces = detectSpacesForLevel(levelId, walls).spaces
  return spaces.map((space, index) =>
    ZoneNode.parse({
      id: `zone_room_${index + 1}`,
      name: index === 0 ? '왼쪽 방' : '오른쪽 방',
      parentId: levelId,
      polygon: space.polygon,
      boundaryWallIds: space.wallIds,
      autoFromWalls: true,
      spaceRole: 'room',
      roomNumber: String(index + 1),
      occupancy: index === 0 ? '침실' : '서재',
    }),
  )
}

function nodeRecord(
  nodes: Array<
    | ReturnType<typeof WallNode.parse>
    | ReturnType<typeof ZoneNode.parse>
    | ReturnType<typeof SlabNode.parse>
  >,
) {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('resolveRelatedZonesForNode', () => {
  test('returns both rooms that share a partition wall', () => {
    const walls = sharedRoomWalls()
    const zones = roomZones()
    const related = resolveRelatedZonesForNode(nodeRecord([...walls, ...zones]), 'wall_shared')

    expect(related.map((zone) => zone.id).sort()).toEqual(zones.map((zone) => zone.id).sort())
    expect(related.map((zone) => zone.area)).toEqual([6, 6])
  })

  test('includes a generic zone when the structural boundary is proven', () => {
    const walls = sharedRoomWalls()
    const zone = roomZones()[0]!
    const genericZone = ZoneNode.parse({ ...zone, spaceRole: 'generic', id: 'zone_generic' })
    const related = resolveRelatedZonesForNode(
      nodeRecord([...walls, genericZone]),
      'wall_left_bottom',
    )

    expect(related.map((entry) => entry.id)).toEqual(['zone_generic'])
  })

  test('keeps a stored auto boundary association when a neighboring wall was deleted', () => {
    const walls = sharedRoomWalls()
    const zone = roomZones()[0]!
    const remainingWalls = walls.filter((wall) => wall.id !== 'wall_shared')
    const related = resolveRelatedZonesForNode(
      nodeRecord([...remainingWalls, zone]),
      'wall_left_bottom',
    )

    expect(related.map((entry) => entry.id)).toEqual([zone.id])
  })

  test('associates a room inside a containing support slab', () => {
    const walls = sharedRoomWalls()
    const zone = roomZones()[0]!
    const supportSlab = SlabNode.parse({
      id: 'slab_support',
      parentId: levelId,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 4],
        [-1, 4],
      ],
    })
    const related = resolveRelatedZonesForNode(
      nodeRecord([...walls, zone, supportSlab]),
      supportSlab.id,
    )

    expect(related.map((entry) => entry.id)).toEqual([zone.id])
  })

  test('does not associate a slab whose hole crosses the room footprint', () => {
    const walls = sharedRoomWalls()
    const zone = roomZones()[0]!
    const slabWithHole = SlabNode.parse({
      id: 'slab_hole',
      parentId: levelId,
      polygon: zone.polygon,
      holes: [
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
        ],
      ],
    })
    const related = resolveRelatedZonesForNode(
      nodeRecord([...walls, zone, slabWithHole]),
      slabWithHole.id,
    )

    expect(related).toEqual([])
  })
})
