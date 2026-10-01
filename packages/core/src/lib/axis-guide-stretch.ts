import type {
  AnyNode,
  AnyNodeId,
  ConstructionGuideNode,
  DoorNode,
  ItemNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { getScaledDimensions } from '../schema/nodes/item'
import { isCurvedWall, sampleWallCenterline } from '../systems/wall/wall-curve'
import { segmentsIntersect } from './polygon-relations'
import { detectSpacesForLevel, planAutoZonesForLevel } from './space-detection'

export type AxisGuideStretchRequest = {
  guideId: AnyNodeId
  side: -1 | 1
  /** Signed metres. The final axis delta is `side * distance`. */
  distance: number
}

export type AxisGuideStretchPlan = {
  axis: 'x' | 'z'
  delta: number
  updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  affectedIds: AnyNodeId[]
}

export type AxisGuideStretchErrorCode =
  | 'guide-not-found'
  | 'guide-parent-missing'
  | 'guide-parent-not-level'
  | 'invalid-distance'
  | 'invalid-guide-direction'
  | 'invalid-wall'
  | 'wall-collapse'
  | 'wall-reversal'
  | 'unsupported-crossing-wall'
  | 'broken-wall-junction'
  | 'attachment-outside-wall'
  | 'attachment-collision'
  | 'invalid-zone'

/**
 * Stable planner error surfaced by the selected-guide controls. The planner
 * does no scene writes: callers can safely validate first and apply one
 * complete update batch only after this function returns.
 */
export class AxisGuideStretchError extends RangeError {
  readonly code: AxisGuideStretchErrorCode

  constructor(code: AxisGuideStretchErrorCode, message: string) {
    super(message)
    this.name = 'AxisGuideStretchError'
    this.code = code
  }
}

const EPSILON = 1e-6

type Point = [number, number]
type Axis = 'x' | 'z'
type WallLike = WallNode & { curveOffset?: number }
type HostedNode = DoorNode | WindowNode | ItemNode

type WallTransform = {
  wall: WallNode
  next: WallNode
  changed: boolean
  rigid: boolean
}

function fail(code: AxisGuideStretchErrorCode, message: string): never {
  throw new AxisGuideStretchError(code, message)
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1])
}

function pointEqual(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON
}

function axisCoordinate(point: Point, axis: Axis): number {
  return axis === 'x' ? point[0] : point[1]
}

function withAxisCoordinate(point: Point, axis: Axis, value: number): [number, number] {
  return axis === 'x' ? [value, point[1]] : [point[0], value]
}

function classifySelected(value: number, guideCoordinate: number, side: -1 | 1): boolean {
  return (value - guideCoordinate) * side > EPSILON
}

function wallLength(wall: WallLike): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function isParallelToAxis(wall: WallLike, axis: Axis): boolean {
  const dx = Math.abs(wall.end[0] - wall.start[0])
  const dz = Math.abs(wall.end[1] - wall.start[1])
  return axis === 'x' ? dz <= EPSILON && dx > EPSILON : dx <= EPSILON && dz > EPSILON
}

function directionSign(wall: WallLike, axis: Axis): number {
  return Math.sign(axis === 'x' ? wall.end[0] - wall.start[0] : wall.end[1] - wall.start[1])
}

function transformedWall(
  wall: WallNode,
  axis: Axis,
  guideCoordinate: number,
  side: -1 | 1,
  delta: number,
): WallTransform {
  const source = wall as WallLike
  if (!finitePoint(source.start) || !finitePoint(source.end) || wallLength(source) <= EPSILON) {
    fail('invalid-wall', `Wall ${wall.id} has invalid or zero-length geometry`)
  }

  const curved = isCurvedWall(source)
  if (curved) {
    const samples = sampleWallCenterline(source)
    const selected = samples.map((point) =>
      classifySelected(axis === 'x' ? point.x : point.y, guideCoordinate, side),
    )
    const everySelected = selected.every(Boolean)
    const anySelected = selected.some(Boolean)
    if (anySelected && !everySelected) {
      fail('unsupported-crossing-wall', `Curved wall ${wall.id} crosses the construction guide`)
    }
    if (!everySelected) return { wall, next: wall, changed: false, rigid: false }
    const start = withAxisCoordinate(wall.start, axis, axisCoordinate(wall.start, axis) + delta)
    const end = withAxisCoordinate(wall.end, axis, axisCoordinate(wall.end, axis) + delta)
    const next = { ...wall, start, end }
    return { wall, next, changed: true, rigid: true }
  }

  const startSelected = classifySelected(axisCoordinate(wall.start, axis), guideCoordinate, side)
  const endSelected = classifySelected(axisCoordinate(wall.end, axis), guideCoordinate, side)
  if (!startSelected && !endSelected) return { wall, next: wall, changed: false, rigid: false }

  if (startSelected !== endSelected && !isParallelToAxis(source, axis)) {
    fail('unsupported-crossing-wall', `Oblique wall ${wall.id} crosses the construction guide`)
  }

  const start = startSelected
    ? withAxisCoordinate(wall.start, axis, axisCoordinate(wall.start, axis) + delta)
    : wall.start
  const end = endSelected
    ? withAxisCoordinate(wall.end, axis, axisCoordinate(wall.end, axis) + delta)
    : wall.end
  const next = { ...wall, start, end }
  const nextLength = wallLength(next)
  if (!finitePoint(start) || !finitePoint(end) || nextLength <= EPSILON) {
    fail('wall-collapse', `Wall ${wall.id} would collapse during the stretch`)
  }
  if (startSelected !== endSelected && directionSign(source, axis) !== directionSign(next, axis)) {
    fail('wall-reversal', `Wall ${wall.id} would reverse direction during the stretch`)
  }
  return {
    wall,
    next,
    changed: !pointEqual(start, wall.start) || !pointEqual(end, wall.end),
    rigid: startSelected && endSelected,
  }
}

function wallPolyline(wall: WallLike): Point[] {
  if (!isCurvedWall(wall)) return [wall.start, wall.end]
  return sampleWallCenterline(wall).map((point) => [point.x, point.y] as [number, number])
}

function polylinesTouch(left: WallLike, right: WallLike): boolean {
  const leftPolyline = wallPolyline(left)
  const rightPolyline = wallPolyline(right)
  for (let leftIndex = 0; leftIndex + 1 < leftPolyline.length; leftIndex += 1) {
    const leftStart = leftPolyline[leftIndex]!
    const leftEnd = leftPolyline[leftIndex + 1]!
    for (let rightIndex = 0; rightIndex + 1 < rightPolyline.length; rightIndex += 1) {
      if (
        segmentsIntersect(
          leftStart,
          leftEnd,
          rightPolyline[rightIndex]!,
          rightPolyline[rightIndex + 1]!,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function validateWallContacts(walls: readonly WallTransform[]): void {
  for (let leftIndex = 0; leftIndex < walls.length; leftIndex += 1) {
    const left = walls[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < walls.length; rightIndex += 1) {
      const right = walls[rightIndex]!
      const wasTouching = polylinesTouch(left.wall as WallLike, right.wall as WallLike)
      const isTouching = polylinesTouch(left.next as WallLike, right.next as WallLike)
      if (wasTouching !== isTouching) {
        fail(
          'broken-wall-junction',
          `Stretch would change the shared junction between ${left.wall.id} and ${right.wall.id}`,
        )
      }
    }
  }
}

function hostIdForNode(node: AnyNode, walls: ReadonlyMap<string, WallNode>): string | null {
  if (node.type !== 'door' && node.type !== 'window' && node.type !== 'item') return null
  const candidate =
    'wallId' in node && typeof node.wallId === 'string' ? node.wallId : node.parentId
  if (!candidate || !walls.has(candidate)) return null
  if (
    node.type === 'item' &&
    node.asset.attachTo !== 'wall' &&
    node.asset.attachTo !== 'wall-side'
  ) {
    return null
  }
  return candidate
}

function wallLocalToWorld(wall: WallLike, localX: number, localZ: number): [number, number] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= EPSILON) {
    fail('invalid-wall', `Wall ${wall.id} has invalid attachment geometry`)
  }
  const tangent: [number, number] = [dx / length, dz / length]
  const normal: [number, number] = [-tangent[1], tangent[0]]
  return [
    wall.start[0] + localX * tangent[0] + localZ * normal[0],
    wall.start[1] + localX * tangent[1] + localZ * normal[1],
  ]
}

function wallWorldToLocal(wall: WallLike, point: Point): [number, number] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= EPSILON) {
    fail('invalid-wall', `Wall ${wall.id} has invalid attachment geometry`)
  }
  const tangent: [number, number] = [dx / length, dz / length]
  const normal: [number, number] = [-tangent[1], tangent[0]]
  const offset: [number, number] = [point[0] - wall.start[0], point[1] - wall.start[1]]
  return [
    offset[0] * tangent[0] + offset[1] * tangent[1],
    offset[0] * normal[0] + offset[1] * normal[1],
  ]
}

function attachmentWorldCenter(node: HostedNode, wall: WallLike): [number, number] {
  const position = node.position
  if (!position.every(Number.isFinite)) {
    fail('invalid-wall', `Hosted node ${node.id} has invalid position`)
  }
  return wallLocalToWorld(wall, position[0], position[2])
}

function attachmentHalfSpan(node: HostedNode, wall: WallLike): number {
  if (node.type === 'door' || node.type === 'window') {
    return Number.isFinite(node.width) && node.width > 0 ? node.width / 2 : Number.NaN
  }
  const [width, , depth] = getScaledDimensions(node)
  // Item rotation is expressed in the host wall's local frame.  The
  // attachment span therefore projects using the local yaw directly; the
  // wall tangent has already been accounted for by wallLocalToWorld.
  const localYaw = node.rotation[1]
  return (Math.abs(width * Math.cos(localYaw)) + Math.abs(depth * Math.sin(localYaw))) / 2
}

type AttachmentSpan = {
  node: HostedNode
  localX: number
  halfSpan: number
  minY: number
  maxY: number
}

function attachmentSpan(node: HostedNode, wall: WallLike): AttachmentSpan {
  const [localX] = wallWorldToLocal(wall, attachmentWorldCenter(node, wall))
  const halfSpan = attachmentHalfSpan(node, wall)
  if (!Number.isFinite(localX) || !Number.isFinite(halfSpan) || halfSpan < 0) {
    fail('invalid-wall', `Hosted node ${node.id} has invalid dimensions`)
  }
  if (node.type === 'item') {
    const height = getScaledDimensions(node)[1]
    return {
      node,
      localX,
      halfSpan,
      minY: node.position[1],
      maxY: node.position[1] + height,
    }
  }
  return {
    node,
    localX,
    halfSpan,
    minY: node.position[1] - node.height / 2,
    maxY: node.position[1] + node.height / 2,
  }
}

function spansOverlap(left: AttachmentSpan, right: AttachmentSpan): number {
  const xOverlap =
    Math.min(left.localX + left.halfSpan, right.localX + right.halfSpan) -
    Math.max(left.localX - left.halfSpan, right.localX - right.halfSpan)
  const yOverlap = Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY)
  return xOverlap > EPSILON && yOverlap > EPSILON ? xOverlap * yOverlap : 0
}

function updateHostedAttachments(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  walls: readonly WallTransform[],
  axis: Axis,
  guideCoordinate: number,
  side: -1 | 1,
  delta: number,
): Map<AnyNodeId, Partial<AnyNode>> {
  const originalWalls = new Map<string, WallNode>(walls.map(({ wall }) => [wall.id, wall]))
  const nextWalls = new Map<string, WallNode>(walls.map(({ next }) => [next.id, next]))
  const changedHostIds = new Set<string>(
    walls.filter((item) => item.changed).map((item) => item.wall.id),
  )
  const hostedByWall = new Map<string, HostedNode[]>()
  for (const node of Object.values(nodes)) {
    const hostId = hostIdForNode(node, originalWalls)
    if (!hostId || !changedHostIds.has(hostId)) continue
    const hosted = node as HostedNode
    const list = hostedByWall.get(hostId) ?? []
    if (!list.some((existing) => existing.id === hosted.id)) list.push(hosted)
    hostedByWall.set(hostId, list)
  }

  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const [hostId, hosted] of hostedByWall) {
    const transform = walls.find((item) => item.wall.id === hostId)
    const original = originalWalls.get(hostId)
    const next = nextWalls.get(hostId)
    if (!(transform && original && next)) continue
    const originalSpans = hosted.map((node) => attachmentSpan(node, original))
    const nextSpans: AttachmentSpan[] = []
    for (const [index, node] of hosted.entries()) {
      const originalCenter = attachmentWorldCenter(node, original)
      const position = node.position
      const centerSelected = classifySelected(
        axisCoordinate(originalCenter, axis),
        guideCoordinate,
        side,
      )
      const shouldMoveCenter = transform.rigid || centerSelected
      const targetCenter = shouldMoveCenter
        ? withAxisCoordinate(originalCenter, axis, axisCoordinate(originalCenter, axis) + delta)
        : ([originalCenter[0], originalCenter[1]] as [number, number])
      nextSpans.push(attachmentSpan(node, next))
      const local = wallWorldToLocal(next, targetCenter)
      const halfSpan = attachmentHalfSpan(node, next)
      const nextLength = wallLength(next)
      if (local[0] - halfSpan < -EPSILON || local[0] + halfSpan > nextLength + EPSILON) {
        fail('attachment-outside-wall', `Hosted node ${node.id} no longer fits on wall ${hostId}`)
      }
      const patch: Record<string, unknown> = {}
      if (
        Math.abs(local[0] - position[0]) > EPSILON ||
        Math.abs(local[1] - position[2]) > EPSILON
      ) {
        patch.position = [local[0], position[1], local[1]]
      }
      if (node.type === 'item') {
        patch.wallT = local[0] / nextLength
      }
      if (Object.keys(patch).length > 0) updates.set(node.id, patch as Partial<AnyNode>)
      nextSpans[index] = {
        ...attachmentSpan(node, next),
        localX: local[0],
        halfSpan,
      }
    }

    for (let leftIndex = 0; leftIndex < nextSpans.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nextSpans.length; rightIndex += 1) {
        const beforeOverlap = spansOverlap(originalSpans[leftIndex]!, originalSpans[rightIndex]!)
        const afterOverlap = spansOverlap(nextSpans[leftIndex]!, nextSpans[rightIndex]!)
        if (afterOverlap > EPSILON && afterOverlap > beforeOverlap + EPSILON) {
          fail(
            'attachment-collision',
            `Hosted nodes ${hosted[leftIndex]!.id} and ${hosted[rightIndex]!.id} collide on wall ${hostId}`,
          )
        }
      }
    }
  }
  return updates
}

function manualZoneIsSimple(polygon: ZoneNode['polygon']): boolean {
  if (polygon.length < 3 || polygon.some((point) => !finitePoint(point))) return false
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    area += point[0] * next[1] - next[0] * point[1]
    for (let other = index + 1; other < polygon.length; other += 1) {
      const otherNext = (other + 1) % polygon.length
      if (other === index || otherNext === index || other === (index + 1) % polygon.length) continue
      if (segmentsIntersect(point, next, polygon[other]!, polygon[otherNext]!)) return false
    }
  }
  return Math.abs(area) > EPSILON
}

function updateZones(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: AnyNodeId,
  walls: readonly WallTransform[],
  axis: Axis,
  guideCoordinate: number,
  side: -1 | 1,
  delta: number,
): Map<AnyNodeId, Partial<AnyNode>> {
  const levelWalls = walls.map(({ next }) => next)
  const previousWalls = walls.map(({ wall }) => wall)
  const previousSpaces = detectSpacesForLevel(levelId, previousWalls).spaces
  const nextSpaces = detectSpacesForLevel(levelId, levelWalls).spaces
  const zones = Object.values(nodes).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId,
  )
  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  const autoPlan = planAutoZonesForLevel(
    nextSpaces,
    zones.filter((zone) => zone.autoFromWalls),
    {
      previousSpaces,
      changedWalls: levelWalls.filter(
        (wall) => walls.find((item) => item.wall.id === wall.id)?.changed,
      ),
    },
  )
  for (const update of autoPlan.update) updates.set(update.id, update.data)

  for (const zone of zones.filter((zone) => !zone.autoFromWalls)) {
    const polygon = zone.polygon.map((point) =>
      classifySelected(axisCoordinate(point, axis), guideCoordinate, side)
        ? withAxisCoordinate(point, axis, axisCoordinate(point, axis) + delta)
        : [point[0], point[1]],
    ) as ZoneNode['polygon']
    if (!polygon.every((point, index) => pointEqual(point, zone.polygon[index]!))) {
      if (!manualZoneIsSimple(polygon)) fail('invalid-zone', `Zone ${zone.id} would become invalid`)
      updates.set(zone.id, { polygon })
    }
  }
  return updates
}

function mergeUpdate(
  updates: Map<AnyNodeId, Partial<AnyNode>>,
  id: AnyNodeId,
  data: Partial<AnyNode>,
): void {
  const existing = updates.get(id)
  const merged: Record<string, unknown> = {
    ...(existing as Record<string, unknown> | undefined),
    ...(data as Record<string, unknown>),
  }
  updates.set(id, existing ? (merged as Partial<AnyNode>) : data)
}

export function buildAxisGuideStretchPlan(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  request: AxisGuideStretchRequest,
): AxisGuideStretchPlan {
  const guide = nodes[request.guideId]
  if (guide?.type !== 'construction-guide') {
    fail('guide-not-found', `Construction guide ${request.guideId} was not found`)
  }
  const parsedGuide = guide as ConstructionGuideNode
  const parentId = parsedGuide.parentId
  if (!parentId)
    fail('guide-parent-missing', `Construction guide ${parsedGuide.id} has no level parent`)
  const parent = (nodes as Readonly<Record<string, AnyNode>>)[parentId]
  if (!parent)
    fail('guide-parent-missing', `Level ${parentId} for guide ${parsedGuide.id} was not found`)
  if (parent.type !== 'level')
    fail('guide-parent-not-level', `Guide ${parsedGuide.id} is not attached to a level`)
  if (request.side !== -1 && request.side !== 1)
    fail('invalid-distance', 'Stretch side must be -1 or 1')
  if (!Number.isFinite(request.distance) || Math.abs(request.distance) <= EPSILON) {
    fail('invalid-distance', 'Stretch distance must be finite and non-zero')
  }

  const [dx, dz] = parsedGuide.direction
  const directionLength = Math.hypot(dx, dz)
  if (!Number.isFinite(directionLength) || directionLength <= EPSILON) {
    fail('invalid-guide-direction', 'Construction guide direction must be non-zero')
  }
  const normalizedDx = Math.abs(dx) / directionLength
  const normalizedDz = Math.abs(dz) / directionLength
  const axis: Axis | null =
    normalizedDx <= EPSILON && normalizedDz > EPSILON
      ? 'x'
      : normalizedDz <= EPSILON && normalizedDx > EPSILON
        ? 'z'
        : null
  if (!axis) fail('invalid-guide-direction', 'Construction guide must be parallel to model X or Z')
  const guideCoordinate = axis === 'x' ? parsedGuide.origin[0] : parsedGuide.origin[1]
  if (!Number.isFinite(guideCoordinate))
    fail('invalid-guide-direction', 'Construction guide origin is invalid')
  const delta = request.side * request.distance
  if (!Number.isFinite(delta) || Math.abs(delta) <= EPSILON)
    fail('invalid-distance', 'Stretch delta is invalid')

  const levelWalls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === parent.id,
  )
  const wallTransforms = levelWalls.map((wall) =>
    transformedWall(wall, axis, guideCoordinate, request.side, delta),
  )
  validateWallContacts(wallTransforms)

  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const transform of wallTransforms) {
    if (!transform.changed) continue
    mergeUpdate(updates, transform.wall.id, {
      start: transform.next.start,
      end: transform.next.end,
    })
  }

  const attachmentUpdates = updateHostedAttachments(
    nodes,
    wallTransforms,
    axis,
    guideCoordinate,
    request.side,
    delta,
  )
  for (const [id, data] of attachmentUpdates) mergeUpdate(updates, id, data)

  const zoneUpdates = updateZones(
    nodes,
    parent.id,
    wallTransforms,
    axis,
    guideCoordinate,
    request.side,
    delta,
  )
  for (const [id, data] of zoneUpdates) mergeUpdate(updates, id, data)

  const sortedUpdates = [...updates.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([id, data]) => ({ id, data }))
  return {
    axis,
    delta,
    updates: sortedUpdates,
    affectedIds: sortedUpdates.map(({ id }) => id),
  }
}
