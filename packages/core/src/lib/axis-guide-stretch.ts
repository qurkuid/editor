import type {
  FloorplanDimensionEditDescriptor,
  FloorplanDimensionEditFixedEnd,
  FloorplanDimensionEditLeaf,
  FloorplanPoint,
} from '../registry/types'
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
  | 'dimension-not-editable'
  | 'dimension-level-missing'
  | 'dimension-leaf-not-found'
  | 'invalid-target'
  | 'unsupported-dimension'
  | 'invalid-opening-documentation'
  | 'dimension-total-mismatch'

export type DimensionStretchRequest = {
  descriptor: FloorplanDimensionEditDescriptor
  /** Positive, absolute target length in metres. */
  targetDistance: number
  fixedEnd: FloorplanDimensionEditFixedEnd
  /** Required for totals; optional for a descriptor with one leaf. */
  selectedLeafId?: string
}

export type DimensionStretchPlan = {
  descriptorId: string
  fixedEnd: FloorplanDimensionEditFixedEnd
  targetDistance: number
  /** Signed physical change applied to the selected wall/opening leaf. */
  delta: number
  updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  affectedIds: AnyNodeId[]
}

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

type PlanarStretchBasis = {
  origin: Point
  tangent: Point
  /** Maximum normalized cross product for a crossing straight wall. */
  parallelTolerance: number
  /** Preserve the legacy raw-coordinate axis check for construction guides. */
  axis?: Axis
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

function planarSignedCoordinate(point: Point, basis: PlanarStretchBasis): number {
  return (
    (point[0] - basis.origin[0]) * basis.tangent[0] +
    (point[1] - basis.origin[1]) * basis.tangent[1]
  )
}

function planarSelected(point: Point, basis: PlanarStretchBasis, side: -1 | 1): boolean {
  return planarSignedCoordinate(point, basis) * side > EPSILON
}

function planarWallIsParallel(wall: WallLike, basis: PlanarStretchBasis): boolean {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  if (basis.axis) {
    return basis.axis === 'x'
      ? Math.abs(dz) <= EPSILON && Math.abs(dx) > EPSILON
      : Math.abs(dx) <= EPSILON && Math.abs(dz) > EPSILON
  }
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= EPSILON) return false
  return (
    Math.abs((dx / length) * basis.tangent[1] - (dz / length) * basis.tangent[0]) <=
    basis.parallelTolerance
  )
}

function transformWallWithBasis(
  wall: WallNode,
  basis: PlanarStretchBasis,
  side: -1 | 1,
  delta: number,
  crossingMessage: string,
): WallTransform {
  const source = wall as WallLike
  if (!finitePoint(source.start) || !finitePoint(source.end) || wallLength(source) <= EPSILON) {
    fail('invalid-wall', `Wall ${wall.id} has invalid or zero-length geometry`)
  }
  const move: Point = [basis.tangent[0] * side * delta, basis.tangent[1] * side * delta]
  if (isCurvedWall(source)) {
    const samples = sampleWallCenterline(source)
    const selected = samples.map((point) => planarSelected([point.x, point.y], basis, side))
    const everySelected = selected.every(Boolean)
    const anySelected = selected.some(Boolean)
    if (anySelected && !everySelected) fail('unsupported-crossing-wall', crossingMessage)
    if (!everySelected) return { wall, next: wall, changed: false, rigid: false }
    return {
      wall,
      next: {
        ...wall,
        start: [wall.start[0] + move[0], wall.start[1] + move[1]],
        end: [wall.end[0] + move[0], wall.end[1] + move[1]],
      },
      changed: true,
      rigid: true,
    }
  }

  const startSelected = planarSelected(wall.start, basis, side)
  const endSelected = planarSelected(wall.end, basis, side)
  if (!startSelected && !endSelected) return { wall, next: wall, changed: false, rigid: false }
  if (startSelected !== endSelected && !planarWallIsParallel(source, basis)) {
    fail('unsupported-crossing-wall', crossingMessage)
  }
  const start = startSelected
    ? ([wall.start[0] + move[0], wall.start[1] + move[1]] as Point)
    : wall.start
  const end = endSelected ? ([wall.end[0] + move[0], wall.end[1] + move[1]] as Point) : wall.end
  const next = { ...wall, start, end }
  const nextLength = wallLength(next)
  if (!finitePoint(start) || !finitePoint(end) || nextLength <= EPSILON) {
    fail('wall-collapse', `Wall ${wall.id} would collapse during the stretch`)
  }
  const sourceDirection: Point = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const nextDirection: Point = [end[0] - start[0], end[1] - start[1]]
  if (
    startSelected !== endSelected &&
    sourceDirection[0] * nextDirection[0] + sourceDirection[1] * nextDirection[1] <= 0
  ) {
    fail('wall-reversal', `Wall ${wall.id} would reverse direction during the stretch`)
  }
  return {
    wall,
    next,
    changed: !pointEqual(start, wall.start) || !pointEqual(end, wall.end),
    rigid: startSelected && endSelected,
  }
}

function transformedWall(
  wall: WallNode,
  axis: Axis,
  guideCoordinate: number,
  side: -1 | 1,
  delta: number,
): WallTransform {
  const basis: PlanarStretchBasis = {
    origin: axis === 'x' ? [guideCoordinate, 0] : [0, guideCoordinate],
    tangent: axis === 'x' ? [1, 0] : [0, 1],
    parallelTolerance: EPSILON,
    axis,
  }
  return transformWallWithBasis(
    wall,
    basis,
    side,
    delta,
    `Wall ${wall.id} crosses the construction guide with unsupported geometry`,
  )
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

function attachmentSpanWithWidth(
  node: HostedNode,
  wall: WallLike,
  widthOverride?: number,
): AttachmentSpan {
  const span = attachmentSpan(node, wall)
  return widthOverride === undefined ? span : { ...span, halfSpan: widthOverride / 2 }
}

function spansOverlap(left: AttachmentSpan, right: AttachmentSpan): number {
  const xOverlap =
    Math.min(left.localX + left.halfSpan, right.localX + right.halfSpan) -
    Math.max(left.localX - left.halfSpan, right.localX - right.halfSpan)
  const yOverlap = Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY)
  return xOverlap > EPSILON && yOverlap > EPSILON ? xOverlap * yOverlap : 0
}

type OpeningDimensionEdit = {
  openingId: AnyNodeId
  targetWidth: number
  targetDisplayedWidth: number
  displayedField: NonNullable<FloorplanDimensionEditDescriptor['opening']>['displayedField']
}

function updateHostedAttachmentsWithBasis(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  walls: readonly WallTransform[],
  basis: PlanarStretchBasis,
  side: -1 | 1,
  delta: number,
  openingEdit?: OpeningDimensionEdit,
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
      const isWidthEdit = openingEdit?.openingId === node.id
      const centerSelected = planarSelected(originalCenter, basis, side)
      const move = [basis.tangent[0] * side * delta, basis.tangent[1] * side * delta] as Point
      const targetCenter = isWidthEdit
        ? moveDimensionPoint(originalCenter, [move[0] / 2, move[1] / 2])
        : transform.rigid || centerSelected
          ? moveDimensionPoint(originalCenter, move)
          : originalCenter
      const local = wallWorldToLocal(next, targetCenter)
      const widthOverride = isWidthEdit ? openingEdit.targetWidth : undefined
      const halfSpan =
        widthOverride === undefined ? attachmentHalfSpan(node, next) : widthOverride / 2
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
      if (isWidthEdit) {
        patch.width = openingEdit.targetWidth
        if (openingEdit.displayedField !== 'width') {
          patch[openingEdit.displayedField] = openingEdit.targetDisplayedWidth
        }
      }
      if (Object.keys(patch).length > 0) updates.set(node.id, patch as Partial<AnyNode>)
      nextSpans[index] = {
        ...attachmentSpanWithWidth(node, next, widthOverride),
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

function updateHostedAttachments(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  walls: readonly WallTransform[],
  axis: Axis,
  guideCoordinate: number,
  side: -1 | 1,
  delta: number,
): Map<AnyNodeId, Partial<AnyNode>> {
  const basis: PlanarStretchBasis = {
    origin: axis === 'x' ? [guideCoordinate, 0] : [0, guideCoordinate],
    tangent: axis === 'x' ? [1, 0] : [0, 1],
    parallelTolerance: EPSILON,
  }
  return updateHostedAttachmentsWithBasis(nodes, walls, basis, side, delta)
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

function updateZonesWithBasis(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: AnyNodeId,
  walls: readonly WallTransform[],
  basis: PlanarStretchBasis,
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

  const move: Point = [basis.tangent[0] * side * delta, basis.tangent[1] * side * delta]
  for (const zone of zones.filter((zone) => !zone.autoFromWalls)) {
    const polygon = zone.polygon.map((point) =>
      planarSelected(point, basis, side) ? moveDimensionPoint(point, move) : [point[0], point[1]],
    ) as ZoneNode['polygon']
    if (!polygon.every((point, index) => pointEqual(point, zone.polygon[index]!))) {
      if (!manualZoneIsSimple(polygon)) fail('invalid-zone', `Zone ${zone.id} would become invalid`)
      updates.set(zone.id, { polygon })
    }
  }
  return updates
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
  const basis: PlanarStretchBasis = {
    origin: axis === 'x' ? [guideCoordinate, 0] : [0, guideCoordinate],
    tangent: axis === 'x' ? [1, 0] : [0, 1],
    parallelTolerance: EPSILON,
  }
  return updateZonesWithBasis(nodes, levelId, walls, basis, side, delta)
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

// ---------------------------------------------------------------------------
// Generic Expert dimension editing
// ---------------------------------------------------------------------------
//
// Construction dimensions are often only approximately axis aligned after an
// import (the live 2067 label is a useful example).  Keep this planner beside
// the guide planner so both operations share the same wall/contact/attachment
// validation, while the public guide API above remains byte-compatible.

const DIMENSION_ANGLE_TOLERANCE = 0.001

type DimensionBasis = PlanarStretchBasis

type DimensionWallTransform = WallTransform

function dimensionDistance(first: readonly [number, number], second: readonly [number, number]) {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function normalizeDimensionBasis(start: FloorplanPoint, end: FloorplanPoint): DimensionBasis {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= EPSILON) {
    fail('unsupported-dimension', 'Dimension span has no usable tangent')
  }
  return {
    origin: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    tangent: [dx / length, dz / length],
    parallelTolerance: DIMENSION_ANGLE_TOLERANCE,
  }
}

function dimensionSelected(point: Point, basis: DimensionBasis, side: -1 | 1): boolean {
  return planarSelected(point, basis, side)
}

function dimensionMoveVector(basis: DimensionBasis, side: -1 | 1, delta: number): Point {
  return [basis.tangent[0] * side * delta, basis.tangent[1] * side * delta]
}

function moveDimensionPoint(point: Point, move: Point): Point {
  return [point[0] + move[0], point[1] + move[1]]
}

function transformedDimensionWall(
  wall: WallNode,
  basis: DimensionBasis,
  side: -1 | 1,
  delta: number,
): DimensionWallTransform {
  return transformWallWithBasis(
    wall,
    basis,
    side,
    delta,
    `Wall ${wall.id} crosses the dimension cut with unsupported geometry`,
  )
}

function dimensionTransformedLeafLength(
  leaf: FloorplanDimensionEditLeaf,
  basis: DimensionBasis,
  side: -1 | 1,
  delta: number,
): number {
  const move = dimensionMoveVector(basis, side, delta)
  const start = dimensionSelected(leaf.measuredStart as Point, basis, side)
    ? moveDimensionPoint(leaf.measuredStart as Point, move)
    : (leaf.measuredStart as Point)
  const end = dimensionSelected(leaf.measuredEnd as Point, basis, side)
    ? moveDimensionPoint(leaf.measuredEnd as Point, move)
    : (leaf.measuredEnd as Point)
  return dimensionDistance(start, end)
}

function dimensionDisplayedLength(leaf: FloorplanDimensionEditLeaf): number {
  // The generated leaf geometry is already measured in the displayed datum.
  // An opening's documented offset is only the bridge back to its physical
  // hosted width when applying the scene update; adding it here would double
  // count rough/masonry/finish opening spans.
  return leaf.currentLength
}

function resolveDimensionLeaf(
  descriptor: FloorplanDimensionEditDescriptor,
  request: DimensionStretchRequest,
): FloorplanDimensionEditLeaf {
  if (descriptor.leaves.length === 0)
    fail('dimension-leaf-not-found', 'Dimension has no editable leaves')
  const defaultTotalLeafId =
    request.fixedEnd === 'start' ? descriptor.leaves.at(-1)?.id : descriptor.leaves[0]?.id
  const requestedId =
    request.selectedLeafId ??
    (descriptor.kind === 'total' ? defaultTotalLeafId : descriptor.defaultLeafId)
  if (descriptor.kind === 'total' && !requestedId) {
    fail('dimension-leaf-not-found', 'A total dimension requires a selected leaf')
  }
  const leaf = requestedId
    ? descriptor.leaves.find((candidate) => candidate.id === requestedId)
    : descriptor.leaves[0]
  if (!leaf) fail('dimension-leaf-not-found', `Dimension leaf ${requestedId ?? ''} was not found`)
  return leaf
}

function verifyDimensionLeaves(
  descriptor: FloorplanDimensionEditDescriptor,
  selectedLeaf: FloorplanDimensionEditLeaf,
  basis: DimensionBasis,
  side: -1 | 1,
  delta: number,
  targetSelectedDistance: number,
  targetTotalDistance: number,
): void {
  const lengths = descriptor.leaves.map((leaf) =>
    dimensionTransformedLeafLength(leaf, basis, side, delta),
  )
  const selectedIndex = descriptor.leaves.findIndex((leaf) => leaf.id === selectedLeaf.id)
  const selectedLength = lengths[selectedIndex]
  if (selectedLength === undefined || Math.abs(selectedLength - targetSelectedDistance) > 2e-5) {
    fail('dimension-total-mismatch', 'The edited dimension did not reach the requested length')
  }
  if (descriptor.kind === 'total') {
    const currentTotal = descriptor.leaves.reduce(
      (sum, leaf) => sum + dimensionDisplayedLength(leaf),
      0,
    )
    // Transformed leaf geometry is already in the displayed datum.  The
    // documented offset only maps a displayed opening target back to its
    // physical hosted width during scene updates; adding it here would make
    // rough/masonry/finish totals drift from the generated dimension chain.
    const nextTotal = lengths.reduce((sum, length) => sum + length, 0)
    if (Math.abs(nextTotal - targetTotalDistance) > 2e-5 || !Number.isFinite(currentTotal)) {
      fail('dimension-total-mismatch', 'The dimension total could not be verified')
    }
    for (let index = 0; index < descriptor.leaves.length; index += 1) {
      if (index === selectedIndex) continue
      if (Math.abs(lengths[index]! - descriptor.leaves[index]!.currentLength) > 2e-5) {
        fail('dimension-total-mismatch', 'Another leaf in the dimension chain would change')
      }
    }
  }
}

/**
 * Plan an exact Expert-mode edit from generated dimension provenance.
 *
 * The returned update list is scene-store ready and contains no guide or UI
 * state. Every validation runs before returning, so callers can safely wrap a
 * single history transaction around one `updateNodes` call.
 */
export function buildDimensionStretchPlan(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  request: DimensionStretchRequest,
): DimensionStretchPlan {
  const descriptor = request.descriptor
  if (descriptor.status !== 'editable') {
    fail('dimension-not-editable', descriptor.readOnlyReason ?? 'Dimension cannot be edited')
  }
  if (request.fixedEnd !== 'start' && request.fixedEnd !== 'end') {
    fail('invalid-target', 'Dimension fixed end must be start or end')
  }
  if (!Number.isFinite(request.targetDistance) || request.targetDistance <= EPSILON) {
    fail('invalid-target', 'Dimension target must be a positive finite length')
  }
  const level = nodes[descriptor.levelId]
  if (level?.type !== 'level') fail('dimension-level-missing', 'Dimension level no longer exists')

  const selectedLeaf = resolveDimensionLeaf(descriptor, request)
  const basis = normalizeDimensionBasis(selectedLeaf.measuredStart, selectedLeaf.measuredEnd)
  const selectedCurrent = dimensionDisplayedLength(selectedLeaf)
  if (!Number.isFinite(selectedCurrent) || selectedCurrent <= EPSILON) {
    fail('unsupported-dimension', 'Dimension leaf has no valid current length')
  }

  const currentTotal = descriptor.leaves.reduce(
    (sum, leaf) => sum + dimensionDisplayedLength(leaf),
    0,
  )
  let targetLeafDistance =
    descriptor.kind === 'total'
      ? selectedCurrent + (request.targetDistance - currentTotal)
      : request.targetDistance
  if (!Number.isFinite(targetLeafDistance) || targetLeafDistance <= EPSILON) {
    fail(
      descriptor.kind === 'total' ? 'invalid-target' : 'unsupported-dimension',
      descriptor.kind === 'total'
        ? 'Selected total leaf would collapse'
        : 'Dimension target is not a positive finite length',
    )
  }
  let physicalCurrent = selectedCurrent
  let physicalTarget = targetLeafDistance
  // A total's selected leaf carries the opening provenance.  The descriptor
  // itself describes the chain, so relying on descriptor.opening alone would
  // silently turn that leaf edit into a nominal wall edit.
  const descriptorOpening = descriptor.opening
  const selectedOpening = selectedLeaf.opening
  if (
    descriptorOpening &&
    selectedOpening &&
    (descriptorOpening.openingId !== selectedOpening.openingId ||
      descriptorOpening.reference !== selectedOpening.reference ||
      descriptorOpening.displayedField !== selectedOpening.displayedField ||
      Math.abs(
        (descriptorOpening.documentedOffset ?? 0) - (selectedOpening.documentedOffset ?? 0),
      ) > 2e-5)
  ) {
    fail('invalid-opening-documentation', 'Opening provenance conflicts with the selected leaf')
  }
  const opening = selectedOpening ?? descriptorOpening
  const openingNode = opening ? nodes[opening.openingId] : undefined
  if (opening) {
    if (openingNode?.type !== 'door' && openingNode?.type !== 'window') {
      fail('invalid-opening-documentation', 'Opening provenance no longer resolves to an opening')
    }
    const documentedOffset = opening.documentedOffset ?? 0
    if (!Number.isFinite(documentedOffset)) {
      fail('invalid-opening-documentation', 'Opening documentation offset is invalid')
    }
    physicalCurrent = openingNode.width
    physicalTarget = targetLeafDistance - documentedOffset
    if (!Number.isFinite(physicalTarget) || physicalTarget <= EPSILON) {
      fail(
        'invalid-opening-documentation',
        'Documented opening width leaves no positive nominal width',
      )
    }
  }

  const delta = physicalTarget - physicalCurrent
  if (!Number.isFinite(delta) || Math.abs(delta) <= EPSILON) {
    fail('invalid-target', 'Dimension target does not change the model')
  }
  const side: -1 | 1 = request.fixedEnd === 'start' ? 1 : -1
  const wallTransforms = Object.values(nodes)
    .filter((node): node is WallNode => node.type === 'wall' && node.parentId === level.id)
    .map((wall) => transformedDimensionWall(wall, basis, side, delta))
  validateWallContacts(wallTransforms)

  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const transform of wallTransforms) {
    if (!transform.changed) continue
    mergeUpdate(updates, transform.wall.id, {
      start: transform.next.start,
      end: transform.next.end,
    })
  }

  const attachmentUpdates = updateHostedAttachmentsWithBasis(
    nodes,
    wallTransforms,
    basis,
    side,
    delta,
    opening
      ? {
          openingId: opening.openingId,
          targetWidth: physicalTarget,
          targetDisplayedWidth: targetLeafDistance,
          displayedField: opening.displayedField,
        }
      : undefined,
  )
  for (const [id, data] of attachmentUpdates) mergeUpdate(updates, id, data)

  const zoneUpdates = updateZonesWithBasis(nodes, level.id, wallTransforms, basis, side, delta)
  for (const [id, data] of zoneUpdates) mergeUpdate(updates, id, data)

  verifyDimensionLeaves(
    descriptor,
    selectedLeaf,
    basis,
    side,
    delta,
    targetLeafDistance,
    request.targetDistance,
  )

  const sortedUpdates = [...updates.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([id, data]) => ({ id, data }))
  return {
    descriptorId: descriptor.id,
    fixedEnd: request.fixedEnd,
    targetDistance: request.targetDistance,
    delta,
    updates: sortedUpdates,
    affectedIds: sortedUpdates.map(({ id }) => id),
  }
}
