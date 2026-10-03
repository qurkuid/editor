import {
  type AnyNode,
  type AnyNodeId,
  WallNode,
  type WallNode as WallNodeType,
  type ZoneNode,
} from '../schema'
import {
  getClampedWallCurveOffset,
  isCurvedWall,
  sampleWallCenterline,
} from '../systems/wall/wall-curve'
import { getWallPlanFootprint, getWallThickness } from '../systems/wall/wall-footprint'
import { calculateLevelMiters } from '../systems/wall/wall-mitering'
import { detectSpacesForLevel, type Space } from './space-detection'
import {
  buildWallEndpointUpdates,
  validateWallEndpointOverlaps,
  type WallEndpointUpdate,
  WallOperationError,
} from './wall-operations'

export const ROOM_BOUNDARY_CONNECT_TOLERANCE = 0.08
export const ROOM_BOUNDARY_MAX_REPAIR_GAP = 0.35
export const ROOM_BOUNDARY_MAX_DISPLAY_GAP = 1.5

type Point = [number, number]

export type RoomBoundaryEndpoint = {
  wallId: WallNodeType['id']
  endpoint: 'start' | 'end'
  point: Point
}

export type RoomBoundaryCandidateReason =
  | 'ambiguous'
  | 'collinear'
  | 'curved'
  | 'large'
  | 'parallel'
  | 'does-not-close-room'

export type RoomBoundaryCandidate = {
  id: string
  endpoint: RoomBoundaryEndpoint
  targetWallId: WallNodeType['id']
  targetEndpoint?: 'start' | 'end'
  targetPoint: Point
  distance: number
  join: 'end-to-end' | 'end-to-segment'
  safe: boolean
  /** A short straight non-parallel gap that can participate in a bundle. */
  geometric?: boolean
  reason?: RoomBoundaryCandidateReason
}

export type RoomBoundaryIssue = {
  id: string
  wallId: WallNodeType['id']
  endpoint: RoomBoundaryEndpoint['endpoint']
  point: Point
  candidates: RoomBoundaryCandidate[]
  reviewedOpen?: boolean
}

export type RoomBoundaryDiagnostics = {
  levelId: string
  spaces: Space[]
  zones: ZoneNode[]
  danglingEndpoints: RoomBoundaryEndpoint[]
  issues: RoomBoundaryIssue[]
  candidateGaps: RoomBoundaryCandidate[]
}

export type RoomBoundaryRepairPlan = {
  ok: boolean
  issueId: string
  updates: WallEndpointUpdate[]
  candidate?: RoomBoundaryCandidate
  candidates?: RoomBoundaryCandidate[]
  beforeSpaceCount: number
  afterSpaceCount: number
  spaces: Space[]
  reason?:
    | RoomBoundaryCandidateReason
    | 'stale'
    | 'not-found'
    | 'no-repairable-candidate'
    | 'invalid'
}

export type RoomBoundaryRepairUpdates = RoomBoundaryRepairPlan & {
  updates: WallEndpointUpdate[]
}

type EndpointRecord = RoomBoundaryEndpoint & { wall: WallNodeType }

type SharedBoundaryNode = {
  point: Point
  wallIds: Set<WallNodeType['id']>
}

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointKey(point: Point) {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`
}

function endpointId(endpoint: RoomBoundaryEndpoint) {
  return `${endpoint.wallId}:${endpoint.endpoint}:${pointKey(endpoint.point)}`
}

function normalize(dx: number, dy: number): Point | null {
  const length = Math.hypot(dx, dy)
  return length > 1e-9 ? [dx / length, dy / length] : null
}

function cross(a: Point, b: Point) {
  return a[0] * b[1] - a[1] * b[0]
}

function dot(a: Point, b: Point) {
  return a[0] * b[0] + a[1] * b[1]
}

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]]
}

function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]]
}

function scale(point: Point, amount: number): Point {
  return [point[0] * amount, point[1] * amount]
}

function projectPoint(point: Point, start: Point, end: Point) {
  const direction = subtract(end, start)
  const lengthSquared = dot(direction, direction)
  if (lengthSquared <= 1e-12) {
    return { point: [...start] as Point, t: 0, distance: distance(point, start) }
  }
  const t = dot(subtract(point, start), direction) / lengthSquared
  const clamped = Math.max(0, Math.min(1, t))
  const projected = add(start, scale(direction, clamped))
  return { point: projected, t, distance: distance(point, projected) }
}

function lineIntersection(
  start: Point,
  direction: Point,
  otherStart: Point,
  otherDirection: Point,
) {
  const denominator = cross(direction, otherDirection)
  if (Math.abs(denominator) <= 1e-7) return null
  const offset = subtract(otherStart, start)
  const along = cross(offset, otherDirection) / denominator
  const otherAlong = cross(offset, direction) / denominator
  return {
    point: add(start, scale(direction, along)),
    along,
    otherAlong,
  }
}

function nearestEndpoint(wall: WallNodeType, point: Point) {
  const start = distance(point, wall.start)
  const end = distance(point, wall.end)
  return start <= end
    ? { point: [...wall.start] as Point, endpoint: 'start' as const, distance: start }
    : { point: [...wall.end] as Point, endpoint: 'end' as const, distance: end }
}

function buildSharedBoundaryNodes(spaces: readonly Space[]) {
  const byKey = new Map<string, SharedBoundaryNode>()
  for (const space of spaces) {
    for (const boundary of space.boundaryFaces) {
      const first = boundary.points[0]
      const last = boundary.points[boundary.points.length - 1]
      const endpointPoints = first && last && first !== last ? [first, last] : [first]
      for (const tuple of endpointPoints) {
        if (!tuple) continue
        const point: Point = [tuple[0], tuple[1]]
        const key = pointKey(point)
        const node = byKey.get(key) ?? { point, wallIds: new Set<WallNodeType['id']>() }
        node.wallIds.add(boundary.wallId)
        byKey.set(key, node)
      }
    }
  }
  return [...byKey.values()].filter((node) => node.wallIds.size >= 2)
}

function isConnected(
  endpoint: EndpointRecord,
  walls: readonly WallNodeType[],
  sharedBoundaryNodes: readonly SharedBoundaryNode[],
) {
  const endpointWall = endpoint.wall
  const endpointLength = distance(endpointWall.start, endpointWall.end)
  if (endpointLength > 1e-9 && !isCurvedWall(endpointWall)) {
    const endpointDirection = subtract(endpointWall.end, endpointWall.start)
    const endpointLengthSquared = dot(endpointDirection, endpointDirection)
    for (const node of sharedBoundaryNodes) {
      if (!node.wallIds.has(endpoint.wallId) || node.wallIds.size < 2) continue
      if (distance(endpoint.point, node.point) > ROOM_BOUNDARY_CONNECT_TOLERANCE) continue

      const along =
        dot(subtract(node.point, endpointWall.start), endpointDirection) / endpointLengthSquared
      const isOutward = endpoint.endpoint === 'start' ? along <= 1e-7 : along >= 1 - 1e-7
      if (!isOutward) continue
      const pointOnLine = add(endpointWall.start, scale(endpointDirection, along))
      if (distance(node.point, pointOnLine) <= 1e-6) return true
    }
  }

  return walls.some((wall) => {
    if (wall.id === endpoint.wallId) return false
    if (isCurvedWall(wall)) {
      return (
        Math.min(distance(endpoint.point, wall.start), distance(endpoint.point, wall.end)) <= 1e-6
      )
    }
    if (
      pointKey(endpoint.point) === pointKey(wall.start) ||
      pointKey(endpoint.point) === pointKey(wall.end)
    ) {
      return true
    }
    const projection = projectPoint(endpoint.point, wall.start, wall.end)
    if (projection.distance > ROOM_BOUNDARY_CONNECT_TOLERANCE) return false
    const length = distance(wall.start, wall.end)
    const along = projection.t * length
    return (
      along > ROOM_BOUNDARY_CONNECT_TOLERANCE && along < length - ROOM_BOUNDARY_CONNECT_TOLERANCE
    )
  })
}

function candidateForWall(
  endpoint: EndpointRecord,
  wall: WallNodeType,
): RoomBoundaryCandidate | null {
  if (wall.id === endpoint.wallId) return null

  const sourceDirection = normalize(
    endpoint.wall.end[0] - endpoint.wall.start[0],
    endpoint.wall.end[1] - endpoint.wall.start[1],
  )
  if (!sourceDirection) return null

  if (isCurvedWall(endpoint.wall) || isCurvedWall(wall)) {
    const nearest = nearestEndpoint(wall, endpoint.point)
    if (nearest.distance > ROOM_BOUNDARY_MAX_DISPLAY_GAP) return null
    return {
      id: `${endpointId(endpoint)}->${wall.id}:${pointKey(nearest.point)}`,
      endpoint,
      targetWallId: wall.id,
      targetEndpoint: nearest.endpoint,
      targetPoint: nearest.point,
      distance: nearest.distance,
      join: 'end-to-end',
      safe: false,
      geometric: false,
      reason: 'curved',
    }
  }

  const targetStart = wall.start as Point
  const targetEnd = wall.end as Point
  const targetDirection = normalize(targetEnd[0] - targetStart[0], targetEnd[1] - targetStart[1])
  if (!targetDirection) return null

  const intersection = lineIntersection(
    endpoint.point,
    sourceDirection,
    targetStart,
    targetDirection,
  )
  const targetLength = distance(targetStart, targetEnd)
  if (intersection) {
    const targetOnSegment =
      intersection.otherAlong >= -1e-6 && intersection.otherAlong <= targetLength + 1e-6
    const targetPoint = intersection.point
    const gap = distance(endpoint.point, targetPoint)
    // An endpoint can lie on the infinite extension of a target wall while
    // sitting beyond that wall's actual segment. That produces a zero-length
    // mirror candidate for the same corner; the real repair is the opposing
    // endpoint's positive gap.
    if (!targetOnSegment && gap <= 1e-6) return null
    const targetEndpoint = !targetOnSegment
      ? undefined
      : intersection.otherAlong <= 1e-6
        ? ('start' as const)
        : intersection.otherAlong >= targetLength - 1e-6
          ? ('end' as const)
          : undefined
    const join = targetEndpoint ? 'end-to-end' : 'end-to-segment'
    if (gap > ROOM_BOUNDARY_MAX_DISPLAY_GAP) return null
    const reason = gap > ROOM_BOUNDARY_MAX_REPAIR_GAP ? 'large' : undefined
    return {
      id: `${endpointId(endpoint)}->${wall.id}:${pointKey(targetPoint)}`,
      endpoint,
      targetWallId: wall.id,
      ...(targetEndpoint ? { targetEndpoint } : {}),
      targetPoint,
      distance: gap,
      join,
      safe: false,
      geometric: !reason,
      ...(reason ? { reason } : {}),
    }
  }

  const projected = projectPoint(endpoint.point, wall.start, wall.end)
  if (projected.distance > ROOM_BOUNDARY_MAX_DISPLAY_GAP) return null

  const parallelDistance = Math.abs(cross(subtract(endpoint.point, targetStart), targetDirection))
  const reason: RoomBoundaryCandidateReason =
    parallelDistance <= ROOM_BOUNDARY_CONNECT_TOLERANCE ? 'collinear' : 'parallel'
  const nearest = nearestEndpoint(wall, projected.point)
  return {
    id: `${endpointId(endpoint)}->${wall.id}:${pointKey(projected.point)}`,
    endpoint,
    targetWallId: wall.id,
    ...(nearest.distance <= ROOM_BOUNDARY_CONNECT_TOLERANCE
      ? { targetEndpoint: nearest.endpoint }
      : {}),
    targetPoint: projected.point,
    distance: projected.distance,
    join: nearest.distance <= ROOM_BOUNDARY_CONNECT_TOLERANCE ? 'end-to-end' : 'end-to-segment',
    safe: false,
    geometric: false,
    reason: projected.distance > ROOM_BOUNDARY_MAX_REPAIR_GAP ? 'large' : reason,
  }
}

function applyCandidate(walls: readonly WallNodeType[], candidate: RoomBoundaryCandidate) {
  return walls.map((wall) => {
    if (wall.id !== candidate.endpoint.wallId) return wall
    return candidate.endpoint.endpoint === 'start'
      ? WallNode.parse({ ...wall, start: candidate.targetPoint })
      : WallNode.parse({ ...wall, end: candidate.targetPoint })
  })
}

function applyCandidates(
  walls: readonly WallNodeType[],
  candidates: readonly RoomBoundaryCandidate[],
) {
  let nextWalls = [...walls]
  for (const candidate of candidates) nextWalls = applyCandidate(nextWalls, candidate)
  return nextWalls
}

function spaceContainsCandidates(space: Space, candidates: readonly RoomBoundaryCandidate[]) {
  const wallIds = new Set(space.wallIds)
  return candidates.every(
    (candidate) => wallIds.has(candidate.endpoint.wallId) && wallIds.has(candidate.targetWallId),
  )
}

function candidateClosesRoom(
  levelId: string,
  walls: readonly WallNodeType[],
  candidate: RoomBoundaryCandidate,
) {
  const movingWall = walls.find((wall) => wall.id === candidate.endpoint.wallId)
  if (!movingWall || candidate.distance > ROOM_BOUNDARY_MAX_REPAIR_GAP) return false
  const nextWall =
    candidate.endpoint.endpoint === 'start'
      ? { ...movingWall, start: candidate.targetPoint }
      : { ...movingWall, end: candidate.targetPoint }
  const nextLength = distance(nextWall.start, nextWall.end)
  if (nextLength < 0.01) return false
  const before = detectSpacesForLevel(levelId, [...walls]).spaces.length
  const after = detectSpacesForLevel(levelId, applyCandidate(walls, candidate)).spaces
  return after.length > before && after.some((space) => spaceContainsCandidates(space, [candidate]))
}

function candidatesCloseRoom(
  levelId: string,
  walls: readonly WallNodeType[],
  candidates: readonly RoomBoundaryCandidate[],
) {
  if (candidates.length < 2) return false
  const before = detectSpacesForLevel(levelId, [...walls]).spaces.length
  const after = detectSpacesForLevel(levelId, applyCandidates(walls, candidates)).spaces
  return after.length > before && after.some((space) => spaceContainsCandidates(space, candidates))
}

function candidateBundleKey(candidate: RoomBoundaryCandidate) {
  return `${candidate.endpoint.wallId}:${candidate.endpoint.endpoint}`
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  const visit = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]!)
      visit(index + 1, current)
      current.pop()
    }
  }
  visit(0, [])
  return result
}

function findClosingCandidateBundle(
  levelId: string,
  walls: readonly WallNodeType[],
  issue: RoomBoundaryIssue,
  issues: readonly RoomBoundaryIssue[],
) {
  const candidates = issues
    .flatMap((entry) => entry.candidates)
    .filter(
      (candidate) =>
        candidate.geometric === true &&
        candidate.reason === 'does-not-close-room' &&
        candidate.distance <= ROOM_BOUNDARY_MAX_REPAIR_GAP,
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
  const requested = issue.candidates.filter(
    (candidate) => candidate.geometric === true && candidate.reason === 'does-not-close-room',
  )
  if (requested.length === 0 || candidates.length < 2) return null

  for (const size of [2, 3, 4]) {
    if (candidates.length < size) continue
    for (const bundle of combinations(candidates, size)) {
      if (!bundle.some((candidate) => requested.some((entry) => entry.id === candidate.id)))
        continue
      const keys = bundle.map(candidateBundleKey)
      if (new Set(keys).size !== keys.length) continue
      if (candidatesCloseRoom(levelId, walls, bundle)) return bundle
    }
  }
  return null
}

function diagnoseEndpoint(
  levelId: string,
  endpoint: EndpointRecord,
  walls: readonly WallNodeType[],
): RoomBoundaryIssue {
  const candidates = walls
    .map((wall) => candidateForWall(endpoint, wall))
    .filter((candidate): candidate is RoomBoundaryCandidate => Boolean(candidate))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6)

  const safeCandidates = candidates.filter(
    (candidate) =>
      !candidate.reason &&
      candidate.distance <= ROOM_BOUNDARY_MAX_REPAIR_GAP &&
      candidate.distance > 1e-6,
  )
  const nearestDistance = safeCandidates[0]?.distance ?? Number.POSITIVE_INFINITY
  const competing = safeCandidates.filter(
    (candidate) => Math.abs(candidate.distance - nearestDistance) <= 0.05,
  )
  for (const candidate of candidates) {
    if (candidate.reason || !safeCandidates.includes(candidate)) continue
    if (competing.length !== 1) {
      candidate.reason = 'ambiguous'
      continue
    }
    candidate.safe = candidateClosesRoom(levelId, walls, candidate)
    if (!candidate.safe) candidate.reason = 'does-not-close-room'
  }

  return {
    id: endpointId(endpoint),
    wallId: endpoint.wallId,
    endpoint: endpoint.endpoint,
    point: [...endpoint.point],
    candidates,
    reviewedOpen: isRoomBoundaryReviewedOpen(endpoint.wall, endpoint.endpoint),
  }
}

export function diagnoseRoomBoundaries(
  levelId: string,
  walls: readonly WallNodeType[],
  zones: readonly ZoneNode[] = [],
): RoomBoundaryDiagnostics {
  const spaces = detectSpacesForLevel(levelId, [...walls]).spaces
  const sharedBoundaryNodes = buildSharedBoundaryNodes(spaces)
  const endpoints: EndpointRecord[] = walls.flatMap((wall) => [
    { wallId: wall.id, endpoint: 'start' as const, point: [...wall.start] as Point, wall },
    { wallId: wall.id, endpoint: 'end' as const, point: [...wall.end] as Point, wall },
  ])
  const danglingEndpoints = endpoints.filter(
    (endpoint) => !isConnected(endpoint, walls, sharedBoundaryNodes),
  )
  const issues = danglingEndpoints.map((endpoint) => diagnoseEndpoint(levelId, endpoint, walls))
  // A short gap may need a second independent endpoint move before a room
  // exists. Mark every member of a proven bundle as safe so the panel can
  // offer the same one-click action it offers for a direct repair. Keep the
  // `does-not-close-room` reason for diagnostics; planning recognizes the
  // bundle before considering the individual candidate.
  for (const issue of issues) {
    const bundle = findClosingCandidateBundle(levelId, walls, issue, issues)
    for (const candidate of bundle ?? []) candidate.safe = true
  }
  const candidateGaps = issues
    .flatMap((issue) => issue.candidates)
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex((other) => other.id === candidate.id) === index,
    )

  return {
    levelId,
    spaces,
    zones: [...zones],
    danglingEndpoints: danglingEndpoints.map(({ wall, ...endpoint }) => endpoint),
    issues,
    candidateGaps,
  }
}

export function planRoomBoundaryRepair(
  levelId: string,
  walls: readonly WallNodeType[],
  issueId: string,
  diagnosticsSnapshot?: RoomBoundaryDiagnostics,
): RoomBoundaryRepairPlan {
  const diagnostics =
    diagnosticsSnapshot?.levelId === levelId
      ? diagnosticsSnapshot
      : diagnoseRoomBoundaries(levelId, walls)
  const beforeSpaceCount = diagnostics.spaces.length
  const issue = diagnostics.issues.find((entry) => entry.id === issueId)
  if (!issue) {
    return {
      ok: false,
      issueId,
      updates: [],
      beforeSpaceCount,
      afterSpaceCount: beforeSpaceCount,
      spaces: diagnostics.spaces,
      reason: 'stale',
    }
  }

  const candidate = issue.candidates.find((entry) => entry.safe && !entry.reason)
  const bundle = candidate
    ? null
    : findClosingCandidateBundle(levelId, walls, issue, diagnostics.issues)
  const selectedCandidates = candidate ? [candidate] : (bundle ?? [])
  if (selectedCandidates.length === 0) {
    return {
      ok: false,
      issueId,
      updates: [],
      beforeSpaceCount,
      afterSpaceCount: beforeSpaceCount,
      spaces: diagnostics.spaces,
      reason: issue.candidates[0]?.reason ?? 'no-repairable-candidate',
    }
  }

  const nextWalls = applyCandidates(walls, selectedCandidates)
  const spaces = detectSpacesForLevel(levelId, nextWalls).spaces
  if (spaces.length <= beforeSpaceCount) {
    return {
      ok: false,
      issueId,
      updates: [],
      candidate: selectedCandidates[0],
      candidates: selectedCandidates,
      beforeSpaceCount,
      afterSpaceCount: spaces.length,
      spaces,
      reason: 'does-not-close-room',
    }
  }

  return {
    ok: true,
    issueId,
    candidate: selectedCandidates[0],
    candidates: selectedCandidates,
    updates: selectedCandidates.map((entry) => ({
      id: entry.endpoint.wallId,
      data:
        entry.endpoint.endpoint === 'start'
          ? { start: entry.targetPoint }
          : { end: entry.targetPoint },
    })),
    beforeSpaceCount,
    afterSpaceCount: spaces.length,
    spaces,
  }
}

/**
 * Rebuild and validate a room-boundary repair against a complete scene
 * snapshot. This expands the geometry-only plan into the same wall operation
 * updates used by endpoint editing, including linked walls and hosted-child
 * rebasing. The caller can apply the returned list as one atomic update.
 */
export function buildRoomBoundaryRepairUpdates(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string,
  issueId: string,
  diagnosticsSnapshot?: RoomBoundaryDiagnostics,
): RoomBoundaryRepairUpdates {
  const walls = Object.values(nodes).filter(
    (node): node is WallNodeType => node.type === 'wall' && node.parentId === levelId,
  )
  const plan = planRoomBoundaryRepair(levelId, walls, issueId, diagnosticsSnapshot)
  if (!plan.ok) return plan

  const candidates = plan.candidates ?? (plan.candidate ? [plan.candidate] : [])
  if (candidates.length === 0) {
    return { ...plan, ok: false, updates: [], reason: 'no-repairable-candidate' }
  }

  const snapshot: Record<AnyNodeId, AnyNode> = { ...nodes }
  const updatesById = new Map<AnyNodeId, WallEndpointUpdate>()
  const movedEndpoints = new Set<string>()
  try {
    for (const candidate of candidates) {
      const endpointKey = `${candidate.endpoint.wallId}:${candidate.endpoint.endpoint}`
      if (movedEndpoints.has(endpointKey)) {
        return { ...plan, ok: false, updates: [], reason: 'invalid' }
      }
      movedEndpoints.add(endpointKey)

      const wall = snapshot[candidate.endpoint.wallId]
      if (wall?.type !== 'wall' || wall.parentId !== levelId) {
        return { ...plan, ok: false, updates: [], reason: 'stale' }
      }
      const nextStart = candidate.endpoint.endpoint === 'start' ? candidate.targetPoint : wall.start
      const nextEnd = candidate.endpoint.endpoint === 'end' ? candidate.targetPoint : wall.end
      const validated = buildWallEndpointUpdates(snapshot, wall.id, nextStart, nextEnd)
      for (const update of validated) {
        const current = snapshot[update.id]
        if (!current) return { ...plan, ok: false, updates: [], reason: 'stale' }
        snapshot[update.id] = { ...current, ...update.data } as AnyNode
        const previous = updatesById.get(update.id)
        updatesById.set(update.id, {
          id: update.id,
          data: { ...(previous?.data ?? {}), ...update.data } as Partial<AnyNode>,
        })
      }
    }
  } catch (error) {
    if (error instanceof WallOperationError) {
      return { ...plan, ok: false, updates: [], reason: 'invalid' }
    }
    throw error
  }

  const finalWalls = Object.values(snapshot).filter(
    (node): node is WallNodeType => node.type === 'wall' && node.parentId === levelId,
  )
  const spaces = detectSpacesForLevel(levelId, finalWalls).spaces
  if (spaces.length <= plan.beforeSpaceCount) {
    return {
      ...plan,
      ok: false,
      updates: [],
      afterSpaceCount: spaces.length,
      spaces,
      reason: 'does-not-close-room',
    }
  }

  return { ...plan, updates: [...updatesById.values()] }
}

export type ManualRoomBoundaryInput = {
  levelId: string
  wallId: WallNodeType['id']
  endpoint: 'start' | 'end'
  targetWallId: WallNodeType['id']
  targetEndpoint?: 'start' | 'end'
  /** Existing direct connection is the default; L creates two new walls. */
  mode?: ManualRoomBoundaryMode
  /** The first leg is horizontal for the horizontal-vertical route. */
  bendOrder?: ManualRoomBoundaryBendOrder
  /** Projected centerline point from a body click; L-corner mode may end at an interior point. */
  targetPoint?: Point
  /** Stable ids allocated by the UI once for an L preview and replayed on apply. */
  createdWallIds?: readonly [WallNodeType['id'], WallNodeType['id']]
  expectedSnapshot?: string
}

export type ManualRoomBoundaryMode = 'direct' | 'l-corner'

export type ManualRoomBoundaryBendOrder = 'horizontal-vertical' | 'vertical-horizontal'

export type ManualRoomBoundaryMeasurement = {
  leg: 1 | 2
  wallId: WallNodeType['id']
  from: Point
  to: Point
  distance: number
}

export type ManualRoomBoundaryPlan = {
  ok: boolean
  updates: WallEndpointUpdate[]
  creates: WallNodeType[]
  point?: Point
  reason?: string
  message?: string
  snapshot: string
  measurements: ManualRoomBoundaryMeasurement[]
  bendOrder?: ManualRoomBoundaryBendOrder
  movements: {
    wallId: WallNodeType['id']
    endpoint: 'start' | 'end'
    from: Point
    to: Point
    distance: number
  }[]
}

export function roomBoundarySnapshot(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string | null,
) {
  const wallIds = new Set(
    Object.values(nodes)
      .filter((node) => node.type === 'wall' && node.parentId === levelId)
      .map((node) => node.id),
  )
  return JSON.stringify(
    Object.values(nodes)
      .filter(
        (node) =>
          node.id === levelId ||
          wallIds.has(node.id) ||
          wallIds.has(node.parentId as AnyNodeId) ||
          wallIds.has((node as AnyNode & { wallId?: AnyNodeId }).wallId!),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
}

function boundaryWallSignature(wall: WallNodeType) {
  return JSON.stringify([
    wall.parentId,
    wall.start,
    wall.end,
    wall.curveOffset ?? 0,
    wall.thickness,
  ])
}

export function isRoomBoundaryReviewedOpen(wall: WallNodeType, endpoint: 'start' | 'end') {
  const metadata = wall.metadata as Record<string, unknown> | undefined
  const reviews = metadata?.boundaryOpenReviews as Record<string, unknown> | undefined
  return reviews?.[endpoint] === boundaryWallSignature(wall)
}

export function buildRoomBoundaryOpenReviewUpdate(
  wall: WallNodeType,
  endpoint: 'start' | 'end',
  reviewed: boolean,
): WallEndpointUpdate {
  const metadata = { ...(wall.metadata as Record<string, unknown> | undefined) }
  const reviews = { ...(metadata.boundaryOpenReviews as Record<string, unknown> | undefined) }
  if (reviewed) reviews[endpoint] = boundaryWallSignature(wall)
  else delete reviews[endpoint]
  if (Object.keys(reviews).length) metadata.boundaryOpenReviews = reviews
  else delete metadata.boundaryOpenReviews
  return { id: wall.id, data: { metadata: metadata as WallNodeType['metadata'] } }
}

const ROOM_BOUNDARY_L_MIN_SEGMENT = 0.01
const ROOM_BOUNDARY_GEOMETRY_EPSILON = 1e-6

type LCornerSegment = {
  start: Point
  end: Point
  distance: number
}

type SegmentContact = {
  distance: number
  alongA: number
  alongB: number
  collinearOverlap: number
}

function finitePoint(point: Point) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1])
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pointAtSegment(segment: LCornerSegment, along: number): Point {
  if (segment.distance <= ROOM_BOUNDARY_GEOMETRY_EPSILON) return [...segment.start]
  const t = clamp(along / segment.distance, 0, 1)
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * t,
    segment.start[1] + (segment.end[1] - segment.start[1]) * t,
  ]
}

function segmentContact(a: Point, b: Point, c: Point, d: Point): SegmentContact {
  const ab = subtract(b, a)
  const cd = subtract(d, c)
  const lengthA = Math.hypot(ab[0], ab[1])
  const lengthB = Math.hypot(cd[0], cd[1])
  if (lengthA <= ROOM_BOUNDARY_GEOMETRY_EPSILON || lengthB <= ROOM_BOUNDARY_GEOMETRY_EPSILON) {
    return {
      distance: Math.min(distance(a, c), distance(a, d), distance(b, c), distance(b, d)),
      alongA: 0,
      alongB: 0,
      collinearOverlap: 0,
    }
  }

  const denominator = cross(ab, cd)
  if (Math.abs(denominator) > ROOM_BOUNDARY_GEOMETRY_EPSILON) {
    const intersection = lineIntersection(a, ab, c, cd)
    if (
      intersection &&
      intersection.along >= -ROOM_BOUNDARY_GEOMETRY_EPSILON &&
      intersection.along <= 1 + ROOM_BOUNDARY_GEOMETRY_EPSILON &&
      intersection.otherAlong >= -ROOM_BOUNDARY_GEOMETRY_EPSILON &&
      intersection.otherAlong <= 1 + ROOM_BOUNDARY_GEOMETRY_EPSILON
    ) {
      return {
        distance: 0,
        alongA: clamp(intersection.along, 0, 1) * lengthA,
        alongB: clamp(intersection.otherAlong, 0, 1) * lengthB,
        collinearOverlap: 0,
      }
    }
  } else if (Math.abs(cross(subtract(c, a), ab)) <= ROOM_BOUNDARY_GEOMETRY_EPSILON) {
    const cAlong = dot(subtract(c, a), ab) / lengthA
    const dAlong = dot(subtract(d, a), ab) / lengthA
    const overlapStart = Math.max(0, Math.min(cAlong, dAlong))
    const overlapEnd = Math.min(lengthA, Math.max(cAlong, dAlong))
    if (overlapEnd >= overlapStart - ROOM_BOUNDARY_GEOMETRY_EPSILON) {
      return {
        distance: 0,
        alongA: clamp(overlapStart, 0, lengthA),
        alongB: 0,
        collinearOverlap: Math.max(0, overlapEnd - overlapStart),
      }
    }
  }

  const candidates = [
    (() => {
      const projected = projectPoint(a, c, d)
      return { distance: projected.distance, alongA: 0, alongB: projected.t * lengthB }
    })(),
    (() => {
      const projected = projectPoint(b, c, d)
      return { distance: projected.distance, alongA: lengthA, alongB: projected.t * lengthB }
    })(),
    (() => {
      const projected = projectPoint(c, a, b)
      return { distance: projected.distance, alongA: projected.t * lengthA, alongB: 0 }
    })(),
    (() => {
      const projected = projectPoint(d, a, b)
      return { distance: projected.distance, alongA: projected.t * lengthA, alongB: lengthB }
    })(),
  ]
  candidates.sort((left, right) => left.distance - right.distance)
  const closest = candidates[0]!
  return { ...closest, collinearOverlap: 0 }
}

function buildLCornerSegments(
  sourcePoint: Point,
  targetPoint: Point,
  bendOrder: ManualRoomBoundaryBendOrder,
): { elbow: Point; segments: [LCornerSegment, LCornerSegment] } | null {
  const elbow: Point =
    bendOrder === 'horizontal-vertical'
      ? [targetPoint[0], sourcePoint[1]]
      : [sourcePoint[0], targetPoint[1]]
  const first: LCornerSegment = {
    start: [...sourcePoint],
    end: [...elbow],
    distance: distance(sourcePoint, elbow),
  }
  const second: LCornerSegment = {
    start: [...elbow],
    end: [...targetPoint],
    distance: distance(elbow, targetPoint),
  }
  if (
    first.distance < ROOM_BOUNDARY_L_MIN_SEGMENT - ROOM_BOUNDARY_GEOMETRY_EPSILON ||
    second.distance < ROOM_BOUNDARY_L_MIN_SEGMENT - ROOM_BOUNDARY_GEOMETRY_EPSILON
  )
    return null
  return { elbow, segments: [first, second] }
}

function sameSupportPlane(source: WallNodeType, target: WallNodeType) {
  const sourceOffset = source.supportOffset ?? 0
  const targetOffset = target.supportOffset ?? 0
  return (
    source.supportSlabId === target.supportSlabId &&
    Math.abs(sourceOffset - targetOffset) <= ROOM_BOUNDARY_GEOMETRY_EPSILON &&
    (source.fillToTerrain ?? false) === (target.fillToTerrain ?? false)
  )
}

function allowedLCornerContact(
  segment: LCornerSegment,
  contact: SegmentContact,
  wall: WallNodeType,
  source: WallNodeType,
  target: WallNodeType,
  sourcePoint: Point,
  targetPoint: Point,
  clearance: number,
) {
  const startsAtSource = distance(segment.start, sourcePoint) <= ROOM_BOUNDARY_GEOMETRY_EPSILON
  const endsAtTarget = distance(segment.end, targetPoint) <= ROOM_BOUNDARY_GEOMETRY_EPSILON
  const contactPoint = pointAtSegment(segment, contact.alongA)
  if (
    wall.id === source.id &&
    startsAtSource &&
    contact.alongA <= clearance + ROOM_BOUNDARY_GEOMETRY_EPSILON &&
    distance(contactPoint, sourcePoint) <= clearance + ROOM_BOUNDARY_GEOMETRY_EPSILON
  )
    return !segmentRetracesWall(segment, wall)
  if (
    wall.id === target.id &&
    endsAtTarget &&
    segment.distance - contact.alongA <= clearance + ROOM_BOUNDARY_GEOMETRY_EPSILON &&
    distance(contactPoint, targetPoint) <= clearance + ROOM_BOUNDARY_GEOMETRY_EPSILON
  )
    return !segmentRetracesWall(segment, wall)
  return false
}

function segmentRetracesWall(segment: LCornerSegment, wall: WallNodeType) {
  const wallVector = subtract(wall.end, wall.start)
  const wallLength = Math.hypot(wallVector[0], wallVector[1])
  if (wallLength <= ROOM_BOUNDARY_GEOMETRY_EPSILON) return true
  const wallUnit: Point = [wallVector[0] / wallLength, wallVector[1] / wallLength]
  const projectAlongWall = (point: Point) => dot(subtract(point, wall.start), wallUnit)
  const segmentStartAlongWall = projectAlongWall(segment.start)
  const segmentEndAlongWall = projectAlongWall(segment.end)
  const overlapStart = Math.max(0, Math.min(segmentStartAlongWall, segmentEndAlongWall))
  const overlapEnd = Math.min(wallLength, Math.max(segmentStartAlongWall, segmentEndAlongWall))
  return overlapEnd - overlapStart > ROOM_BOUNDARY_GEOMETRY_EPSILON
}

function polygonsHavePositiveOverlap(
  first: readonly { x: number; y: number }[],
  second: readonly { x: number; y: number }[],
) {
  const polygons = [first, second]
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]!
      const end = polygon[(index + 1) % polygon.length]!
      const edgeX = end.x - start.x
      const edgeY = end.y - start.y
      const length = Math.hypot(edgeX, edgeY)
      if (length <= ROOM_BOUNDARY_GEOMETRY_EPSILON) continue
      const axisX = -edgeY / length
      const axisY = edgeX / length
      const project = (points: readonly { x: number; y: number }[]) => {
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (const point of points) {
          const value = point.x * axisX + point.y * axisY
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
        return { min, max }
      }
      const firstProjection = project(first)
      const secondProjection = project(second)
      if (
        Math.min(firstProjection.max, secondProjection.max) -
          Math.max(firstProjection.min, secondProjection.min) <=
        ROOM_BOUNDARY_GEOMETRY_EPSILON
      )
        return false
    }
  }
  return true
}

function validateLCornerSegments(
  walls: readonly WallNodeType[],
  source: WallNodeType,
  target: WallNodeType,
  sourcePoint: Point,
  targetPoint: Point,
  segments: readonly LCornerSegment[],
  createdWalls: readonly [WallNodeType, WallNodeType],
) {
  const newThickness = getWallThickness(source)
  const selectedHostPairs = new Set<string>()
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!
    for (const wall of walls) {
      if (isCurvedWall(wall)) {
        const curvePoints = sampleWallCenterline(wall)
        const curveOffset = Math.abs(getClampedWallCurveOffset(wall))
        const clearance = (newThickness + getWallThickness(wall)) / 2 + curveOffset
        const segmentMinX = Math.min(segment.start[0], segment.end[0]) - clearance
        const segmentMaxX = Math.max(segment.start[0], segment.end[0]) + clearance
        const segmentMinY = Math.min(segment.start[1], segment.end[1]) - clearance
        const segmentMaxY = Math.max(segment.start[1], segment.end[1]) + clearance
        const curveMinX = Math.min(...curvePoints.map((point) => point.x))
        const curveMaxX = Math.max(...curvePoints.map((point) => point.x))
        const curveMinY = Math.min(...curvePoints.map((point) => point.y))
        const curveMaxY = Math.max(...curvePoints.map((point) => point.y))
        if (
          curveMaxX < segmentMinX ||
          curveMinX > segmentMaxX ||
          curveMaxY < segmentMinY ||
          curveMinY > segmentMaxY
        )
          continue
        return 'curved-obstacle'
      }
      const contact = segmentContact(segment.start, segment.end, wall.start, wall.end)
      if (contact.collinearOverlap > ROOM_BOUNDARY_GEOMETRY_EPSILON) return 'overlap'
      const clearance = (newThickness + getWallThickness(wall)) / 2
      if (contact.distance > clearance + ROOM_BOUNDARY_GEOMETRY_EPSILON) continue
      if (
        allowedLCornerContact(
          segment,
          contact,
          wall,
          source,
          target,
          sourcePoint,
          targetPoint,
          clearance,
        )
      )
        continue
      if (wall.id === source.id || wall.id === target.id) {
        selectedHostPairs.add(`${segmentIndex}:${wall.id}`)
        continue
      }
      return 'crossing'
    }
  }

  if (selectedHostPairs.size > 0) {
    const miterData = calculateLevelMiters([...walls, ...createdWalls])
    const footprints = createdWalls.map((wall) => getWallPlanFootprint(wall, miterData))
    for (const pair of selectedHostPairs) {
      const separator = pair.indexOf(':')
      const segmentIndex = Number(pair.slice(0, separator))
      const hostId = pair.slice(separator + 1)
      const host = hostId === source.id ? source : target
      const createdFootprint = footprints[segmentIndex]
      const hostFootprint = getWallPlanFootprint(host, miterData)
      if (
        createdFootprint &&
        createdFootprint.length > 2 &&
        hostFootprint.length > 2 &&
        polygonsHavePositiveOverlap(createdFootprint, hostFootprint)
      )
        return 'overlap'
    }
  }
  return null
}

function buildLCornerWall(source: WallNodeType, id: WallNodeType['id'], start: Point, end: Point) {
  return WallNode.parse({
    id,
    parentId: source.parentId,
    visible: source.visible,
    start,
    end,
    material: source.material,
    materialPreset: source.materialPreset,
    interiorMaterial: source.interiorMaterial,
    interiorMaterialPreset: source.interiorMaterialPreset,
    exteriorMaterial: source.exteriorMaterial,
    exteriorMaterialPreset: source.exteriorMaterialPreset,
    slots: source.slots ? { ...source.slots } : undefined,
    thickness: source.thickness,
    height: source.height,
    supportOffset: source.supportOffset,
    fillToTerrain: source.fillToTerrain,
    supportSlabId: source.supportSlabId,
    faceBands: source.faceBands ? { ...source.faceBands } : undefined,
    skirting: source.skirting ? { ...source.skirting } : undefined,
    crown: source.crown ? { ...source.crown } : undefined,
    chairRail: source.chairRail ? { ...source.chairRail } : undefined,
    frontSide: 'unknown',
    backSide: 'unknown',
    children: [],
    metadata: {},
  })
}

export function buildManualRoomBoundaryRepair(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  input: ManualRoomBoundaryInput,
): ManualRoomBoundaryPlan {
  const snapshot = roomBoundarySnapshot(nodes, input.levelId)
  const reject = (reason: string, message: string): ManualRoomBoundaryPlan => ({
    ok: false,
    updates: [],
    creates: [],
    movements: [],
    measurements: [],
    snapshot,
    reason,
    message,
  })
  if (input.expectedSnapshot !== undefined && input.expectedSnapshot !== snapshot)
    return reject('stale', '벽 또는 부착물이 변경되었습니다. 대상을 다시 선택하세요.')
  const mode = input.mode ?? 'direct'
  if (mode !== 'direct' && mode !== 'l-corner')
    return reject('invalid-mode', '지원하지 않는 연결 방식입니다.')
  const source = nodes[input.wallId]
  const target = nodes[input.targetWallId]
  if (
    source?.type !== 'wall' ||
    target?.type !== 'wall' ||
    source.id === target.id ||
    source.parentId !== input.levelId ||
    target.parentId !== input.levelId
  )
    return reject('invalid-target', '같은 층의 다른 벽을 선택하세요.')
  if (isCurvedWall(source) || isCurvedWall(target))
    return reject('curved', '곡선 벽은 직선 경계 연결을 지원하지 않습니다.')
  const sourceDirection = normalize(...subtract(source.end, source.start))
  const targetDirection = normalize(...subtract(target.end, target.start))
  if (
    !sourceDirection ||
    !targetDirection ||
    ![...source.start, ...source.end, ...target.start, ...target.end].every(Number.isFinite)
  )
    return reject('invalid', '유효한 직선 벽이 필요합니다.')

  if (mode === 'l-corner') {
    if (!sameSupportPlane(source, target))
      return reject('elevation-mismatch', '출발 벽과 대상 벽의 지지 높이가 다릅니다.')

    const sourcePoint = [...source[input.endpoint]] as Point
    if (!finitePoint(sourcePoint)) return reject('invalid', '유효한 직선 벽이 필요합니다.')
    if (!input.targetPoint && !input.targetEndpoint)
      return reject('l-target-required', 'ㄱ자 연결은 대상 벽 또는 끝점을 선택해야 합니다.')
    const targetPoint = input.targetPoint
      ? ([...input.targetPoint] as Point)
      : ([...target[input.targetEndpoint!]] as Point)
    if (!finitePoint(targetPoint)) return reject('invalid', '유효한 직선 벽이 필요합니다.')
    const projectedTarget = projectPoint(targetPoint, target.start, target.end)
    if (projectedTarget.distance > ROOM_BOUNDARY_GEOMETRY_EPSILON)
      return reject('invalid-target', 'ㄱ자 연결의 대상 위치가 벽 중심선 위에 있어야 합니다.')
    if (
      input.targetEndpoint &&
      distance(targetPoint, target[input.targetEndpoint]) > ROOM_BOUNDARY_GEOMETRY_EPSILON
    )
      return reject('invalid-target', 'ㄱ자 연결은 선택한 대상 끝점에서 시작해야 합니다.')

    const bendOrder = input.bendOrder ?? 'horizontal-vertical'
    if (bendOrder !== 'horizontal-vertical' && bendOrder !== 'vertical-horizontal')
      return reject('invalid-route', '지원하지 않는 ㄱ자 꺾임 순서입니다.')
    const route = buildLCornerSegments(sourcePoint, targetPoint, bendOrder)
    if (!route) return reject('l-zero-length', 'ㄱ자 연결의 두 변은 각각 1cm 이상이어야 합니다.')

    const createdWallIds = input.createdWallIds
    if (createdWallIds?.length !== 2)
      return reject('l-id-required', 'ㄱ자 미리보기의 벽 식별자가 필요합니다.')
    const [firstId, secondId] = createdWallIds
    if (!firstId || !secondId || firstId === secondId || nodes[firstId] || nodes[secondId])
      return reject('l-id-conflict', 'ㄱ자 연결 벽 식별자가 이미 사용 중입니다.')

    const levelWalls = Object.values(nodes).filter(
      (node): node is WallNodeType => node.type === 'wall' && node.parentId === input.levelId,
    )
    let creates: WallNodeType[]
    try {
      creates = [
        buildLCornerWall(source, firstId, route.segments[0]!.start, route.segments[0]!.end),
        buildLCornerWall(source, secondId, route.segments[1]!.start, route.segments[1]!.end),
      ]
    } catch {
      return reject('invalid', 'ㄱ자 연결 벽을 만들 수 없습니다.')
    }
    const collision = validateLCornerSegments(
      levelWalls,
      source,
      target,
      sourcePoint,
      targetPoint,
      route.segments,
      [creates[0]!, creates[1]!],
    )
    if (collision === 'curved-obstacle')
      return reject('curved-obstacle', '곡선 벽과의 접촉은 안전하게 검증할 수 없습니다.')
    if (collision === 'overlap') return reject('overlap', 'ㄱ자 연결 경로가 기존 벽과 겹칩니다.')
    if (collision === 'crossing')
      return reject('crossing', 'ㄱ자 연결 경로가 다른 벽을 가로지릅니다.')

    return {
      ok: true,
      point: targetPoint,
      updates: [],
      creates,
      bendOrder,
      measurements: route.segments.map((segment, index) => ({
        leg: (index + 1) as 1 | 2,
        wallId: creates[index]!.id,
        from: [...segment.start],
        to: [...segment.end],
        distance: segment.distance,
      })),
      movements: [],
      snapshot,
    }
  }

  const intersection = lineIntersection(
    source.start,
    sourceDirection,
    target.start,
    targetDirection,
  )
  let point: Point
  let targetEndpoint: 'start' | 'end' | undefined
  if (!intersection) {
    if (Math.abs(cross(subtract(target.start, source.start), sourceDirection)) > 1e-6)
      return reject('parallel', '분리된 평행 벽은 직접 연결할 수 없습니다.')
    targetEndpoint =
      input.targetEndpoint ?? nearestEndpoint(target, source[input.endpoint]).endpoint
    point = [...target[targetEndpoint]]
    const sourceFixed = source[input.endpoint === 'start' ? 'end' : 'start']
    const targetOther = target[targetEndpoint === 'start' ? 'end' : 'start']
    if (dot(subtract(sourceFixed, point), subtract(targetOther, point)) >= 0)
      return reject('overlap', '벽이 겹치는 연결은 적용할 수 없습니다.')
    targetEndpoint = undefined
  } else {
    point = intersection.point
    const length = distance(target.start, target.end)
    if (intersection.otherAlong < -1e-6 || intersection.otherAlong > length + 1e-6) {
      targetEndpoint = intersection.otherAlong < 0 ? 'start' : 'end'
      if (input.targetEndpoint && input.targetEndpoint !== targetEndpoint)
        return reject('invalid-target', '교차점에 가까운 대상 끝점을 선택하세요.')
    } else if (input.targetEndpoint && distance(target[input.targetEndpoint], point) > 1e-6) {
      return reject(
        'invalid-target',
        '선택한 끝점은 원래 벽 진행선의 교차점이 아닙니다. 벽 몸체를 선택하세요.',
      )
    }
  }
  const proposals = [
    {
      wallId: source.id,
      endpoint: input.endpoint,
      from: source[input.endpoint],
      to: point,
      distance: distance(source[input.endpoint], point),
    },
  ]
  if (targetEndpoint)
    proposals.push({
      wallId: target.id,
      endpoint: targetEndpoint,
      from: target[targetEndpoint],
      to: point,
      distance: distance(target[targetEndpoint], point),
    })
  const working = { ...nodes }
  const updates = new Map<AnyNodeId, WallEndpointUpdate>()
  try {
    for (const proposal of proposals) {
      if (proposal.distance <= 1e-9) continue
      const wall = working[proposal.wallId] as WallNodeType
      const patches = buildWallEndpointUpdates(
        working,
        wall.id,
        proposal.endpoint === 'start' ? point : wall.start,
        proposal.endpoint === 'end' ? point : wall.end,
      )
      for (const patch of patches) {
        working[patch.id] = { ...working[patch.id], ...patch.data } as AnyNode
        updates.set(patch.id, {
          id: patch.id,
          data: { ...updates.get(patch.id)?.data, ...patch.data } as Partial<AnyNode>,
        })
      }
    }
  } catch (error) {
    if (error instanceof WallOperationError) return reject(error.code, error.message)
    throw error
  }
  try {
    validateWallEndpointOverlaps(nodes, [...updates.values()])
  } catch (error) {
    if (error instanceof WallOperationError) return reject(error.code, error.message)
    throw error
  }
  if (!updates.size) return reject('unchanged', '이미 연결된 위치입니다.')
  return {
    ok: true,
    point,
    updates: [...updates.values()],
    creates: [],
    measurements: [],
    movements: proposals.filter((p) => p.distance > 1e-9),
    snapshot,
  }
}
