import {
  generateId,
  type ManualRoomBoundaryBendOrder,
  type ManualRoomBoundaryMode,
  type WallNode,
} from '@pascal-app/core'
import useInteractionScope from '../../store/use-interaction-scope'

export type RoomBoundaryConnectMode = ManualRoomBoundaryMode
export type RoomBoundaryBendOrder = ManualRoomBoundaryBendOrder

export function createRoomBoundaryWallIds(): [WallNode['id'], WallNode['id']] {
  return [generateId('wall'), generateId('wall')]
}

export function beginRoomBoundaryInteraction(
  wallId: WallNode['id'],
  endpoint: 'start' | 'end',
  intent: 'boundary-connect' | 'boundary-move' = 'boundary-connect',
) {
  useInteractionScope.getState().begin({
    kind: 'reshaping',
    reshape: 'endpoint',
    driver: 'floorplan',
    nodeId: wallId,
    endpoint,
    intent,
  })
}

export type RoomBoundaryTargetHit = {
  wallId: WallNode['id']
  endpoint?: 'start' | 'end'
  targetPoint: [number, number]
  distance: number
}

export function closestRoomBoundaryTargets(
  walls: readonly WallNode[],
  point: readonly [number, number],
  unitsPerPixel: number,
): RoomBoundaryTargetHit[] {
  const hits: RoomBoundaryTargetHit[] = []
  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0]
    const dy = wall.end[1] - wall.start[1]
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-12) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dy) / lengthSquared,
      ),
    )
    const distance = Math.hypot(
      point[0] - wall.start[0] - t * dx,
      point[1] - wall.start[1] - t * dy,
    )
    if (distance > 9 * unitsPerPixel) continue
    const startDistance = Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1])
    const endDistance = Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1])
    const endpoint =
      Math.min(startDistance, endDistance) <= 7 * unitsPerPixel
        ? startDistance <= endDistance
          ? 'start'
          : 'end'
        : undefined
    hits.push({
      wallId: wall.id,
      endpoint,
      targetPoint: [wall.start[0] + t * dx, wall.start[1] + t * dy],
      distance,
    })
  }
  hits.sort((a, b) => a.distance - b.distance || a.wallId.localeCompare(b.wallId))
  const closest = hits[0]
  return closest ? hits.filter((hit) => Math.abs(hit.distance - closest.distance) <= 1e-6) : []
}
