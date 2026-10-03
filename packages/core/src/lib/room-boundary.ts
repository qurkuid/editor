import {
  type AnyNode,
  type AnyNodeId,
  WallNode,
  type WallNode as WallNodeType,
  type ZoneNode,
} from '../schema'
import { isCurvedWall } from '../systems/wall/wall-curve'
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
  expectedSnapshot?: string
}

export type ManualRoomBoundaryPlan = {
  ok: boolean
  updates: WallEndpointUpdate[]
  point?: Point
  reason?: string
  message?: string
  snapshot: string
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

export function buildManualRoomBoundaryRepair(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  input: ManualRoomBoundaryInput,
): ManualRoomBoundaryPlan {
  const snapshot = roomBoundarySnapshot(nodes, input.levelId)
  const reject = (reason: string, message: string): ManualRoomBoundaryPlan => ({
    ok: false,
    updates: [],
    movements: [],
    snapshot,
    reason,
    message,
  })
  if (input.expectedSnapshot !== undefined && input.expectedSnapshot !== snapshot)
    return reject('stale', '벽 또는 부착물이 변경되었습니다. 대상을 다시 선택하세요.')
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
    movements: proposals.filter((p) => p.distance > 1e-9),
    snapshot,
  }
}
