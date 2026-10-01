import {
  type AnyNode,
  type AnyNodeId,
  createDefaultWallFaceBands,
  DEFAULT_ANGLE_STEP,
  DEFAULT_LEVEL_HEIGHT,
  type DoorNode,
  GROUND_SUPPORT_ID,
  getScaledDimensions,
  getWallConstructionEnvelopeThickness,
  type ItemNode,
  resolveWallSupportSlabPatch,
  runAsSingleSceneHistoryStep,
  snapPointAlongAngleRay,
  spatialGridManager,
  terrainSupportLift,
  useScene,
  type WallNode,
  WallNode as WallSchema,
  type WindowNode,
  withDefaultConstructionMaterials,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import { INFERENCE_TOLERANCE, inferWallDirection } from '../../../lib/wall-direction-lock'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import {
  distanceSquared,
  findWallEndpointFromRaw,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  projectPointOntoWall,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
  wallIdsAtSnapPoint,
} from './wall-snap-geometry'

// The pure snap geometry lives in `./wall-snap-geometry`; re-exported here so
// existing importers (fence drafting, the editor barrel) keep their paths.
export {
  chainEndJoinsExistingWall,
  findWallSnapTarget,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapKind,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
} from './wall-snap-geometry'

export const WALL_GRID_STEP = 0.001
export const WALL_MIN_LENGTH = 0.01
// An endpoint projecting within this distance of an existing wall's corner
// resolves to the corner without splitting — splitting there would mint a
// sliver segment a hair longer than `WALL_MIN_LENGTH` that no snap radius
// can ever target again.
const WALL_SPLIT_ENDPOINT_EPSILON = 0.02

type WallSplitIntersection = {
  /** `null` = snap-only outcome: resolve to `point` but split no wall. */
  wallId: WallNode['id'] | null
  point: WallPlanPoint
}

export function getSegmentGridStep(): number {
  // A 0 step means "no grid lattice" — every grid-snap consumer guards on
  // `step <= 0` and returns the raw value, so disabling grid here suppresses
  // the lattice for walls, fences, and every node move/affordance that reads
  // this choke point, without retuning their snap math.
  return resolveSnapFlags(getActiveSnappingMode()).grid ? useEditor.getState().gridSnapStep : 0
}

export function snapScalarToGrid(value: number, step = WALL_GRID_STEP): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function snapPointToGrid(point: WallPlanPoint, step = WALL_GRID_STEP): WallPlanPoint {
  return [snapScalarToGrid(point[0], step), snapScalarToGrid(point[1], step)]
}

function splitWallAtPoint(
  wall: WallNode,
  splitPoint: WallPlanPoint,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): [WallNode, WallNode] {
  const { id: _id, parentId: _parentId, children, ...rest } = wall

  const first = WallSchema.parse({
    ...rest,
    start: wall.start,
    end: splitPoint,
    children: [],
  })
  const second = WallSchema.parse({
    ...rest,
    start: splitPoint,
    end: wall.end,
    children: [],
  })

  if (wall.supportSlabId !== GROUND_SUPPORT_ID || !wall.parentId) {
    return [first, second]
  }

  const levelId = wall.parentId
  const originalElevation =
    (terrainSupportLift(nodes, levelId, wall.start[0], wall.start[1]) ?? 0) +
    (wall.supportOffset ?? 0)
  const rebase = (segment: WallNode): WallNode => {
    const terrainElevation =
      terrainSupportLift(nodes, levelId, segment.start[0], segment.start[1]) ?? 0
    const supportOffset = originalElevation - terrainElevation
    return {
      ...segment,
      supportOffset: Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
    }
  }
  return [rebase(first), rebase(second)]
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-6): boolean {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function findWallIntersection(
  point: WallPlanPoint,
  walls: WallNode[],
  radius: number,
  ignoreWallIds?: string[],
): WallSplitIntersection | null {
  const ignore = new Set(ignoreWallIds ?? [])
  let best: WallSplitIntersection | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignore.has(wall.id)) continue

    const projected = projectPointOntoWall(point, wall)
    if (!projected) continue

    const candidateDistanceSquared = distanceSquared(point, projected)
    if (
      candidateDistanceSquared > radius * radius ||
      candidateDistanceSquared >= bestDistanceSquared
    ) {
      continue
    }

    const nearCorner = ([wall.start, wall.end] as WallPlanPoint[]).find(
      (corner) =>
        distanceSquared(point, corner) <= radius * radius &&
        distanceSquared(projected, corner) <=
          WALL_SPLIT_ENDPOINT_EPSILON * WALL_SPLIT_ENDPOINT_EPSILON,
    )
    best = nearCorner
      ? { wallId: null, point: [nearCorner[0], nearCorner[1]] }
      : { wallId: wall.id, point: projected }
    bestDistanceSquared = candidateDistanceSquared
  }

  return best
}

function wallHasAttachments(wall: WallNode, nodes: ReturnType<typeof useScene.getState>['nodes']) {
  if ((wall.children?.length ?? 0) > 0) {
    return true
  }

  return Object.values(nodes).some((node) => {
    if (!node) return false
    if ('parentId' in node && node.parentId === wall.id) return true
    if ('wallId' in node && typeof node.wallId === 'string' && node.wallId === wall.id) return true
    return false
  })
}

function wallLength(wall: Pick<WallNode, 'start' | 'end'>) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function getWallAttachmentSpan(node: AnyNode): { min: number; max: number; center: number } | null {
  if (node.type === 'door') {
    const door = node as DoorNode
    return {
      min: door.position[0] - door.width / 2,
      max: door.position[0] + door.width / 2,
      center: door.position[0],
    }
  }

  if (node.type === 'window') {
    const win = node as WindowNode
    return {
      min: win.position[0] - win.width / 2,
      max: win.position[0] + win.width / 2,
      center: win.position[0],
    }
  }

  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') {
      return null
    }

    const [width] = getScaledDimensions(item)
    return {
      min: item.position[0] - width / 2,
      max: item.position[0] + width / 2,
      center: item.position[0],
    }
  }

  return null
}

function remapAttachmentToWall(
  node: AnyNode,
  nextWallId: WallNode['id'],
  nextLocalX: number,
  nextWallLength: number,
): Partial<AnyNode> | null {
  const clampedX = Math.max(0, Math.min(nextWallLength, nextLocalX))

  if (node.type === 'door' || node.type === 'window' || node.type === 'item') {
    const currentPosition = 'position' in node ? node.position : null
    if (!currentPosition) return null

    const nextPosition: typeof currentPosition = [
      clampedX,
      currentPosition[1],
      currentPosition[2],
    ] as typeof currentPosition

    return {
      parentId: nextWallId,
      position: nextPosition,
      ...(node.type === 'item'
        ? {
            wallId: nextWallId,
            wallT: nextWallLength > 1e-6 ? clampedX / nextWallLength : 0,
          }
        : {
            wallId: nextWallId,
          }),
    } as Partial<AnyNode>
  }

  return null
}

function buildAttachmentMigrationPlan(
  wall: WallNode,
  splitPoint: WallPlanPoint,
  firstWall: WallNode,
  secondWall: WallNode,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): { id: AnyNodeId; data: Partial<AnyNode> }[] | null {
  const splitDistance = Math.hypot(splitPoint[0] - wall.start[0], splitPoint[1] - wall.start[1])
  const firstLength = wallLength(firstWall)
  const secondLength = wallLength(secondWall)
  const tolerance = 1e-4
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []

  for (const childId of wall.children ?? []) {
    const childNode = nodes[childId as AnyNodeId]
    if (!childNode) continue

    const span = getWallAttachmentSpan(childNode)
    if (!span) {
      return null
    }

    if (span.max <= splitDistance + tolerance) {
      const nextUpdate = remapAttachmentToWall(childNode, firstWall.id, span.center, firstLength)
      if (!nextUpdate) return null
      updates.push({ id: childNode.id as AnyNodeId, data: nextUpdate })
      continue
    }

    if (span.min >= splitDistance - tolerance) {
      const nextUpdate = remapAttachmentToWall(
        childNode,
        secondWall.id,
        span.center - splitDistance,
        secondLength,
      )
      if (!nextUpdate) return null
      updates.push({ id: childNode.id as AnyNodeId, data: nextUpdate })
      continue
    }

    return null
  }

  return updates
}

function splitWallIfNeeded(
  intersection: WallSplitIntersection | null,
  walls: WallNode[],
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  createNodes: ReturnType<typeof useScene.getState>['createNodes'],
  updateNodes: ReturnType<typeof useScene.getState>['updateNodes'],
  deleteNode: ReturnType<typeof useScene.getState>['deleteNode'],
): { walls: WallNode[]; point: WallPlanPoint } | null {
  if (!intersection) return null

  if (!intersection.wallId) {
    return { walls, point: intersection.point }
  }

  const wallToSplit = walls.find((wall) => wall.id === intersection.wallId)
  if (!wallToSplit) {
    return { walls, point: intersection.point }
  }

  const [first, second] = splitWallAtPoint(wallToSplit, intersection.point, nodes)
  const attachmentUpdates = buildAttachmentMigrationPlan(
    wallToSplit,
    intersection.point,
    first,
    second,
    nodes,
  )

  if (wallHasAttachments(wallToSplit, nodes) && !attachmentUpdates) {
    return { walls, point: intersection.point }
  }

  createNodes([
    { node: first, parentId: wallToSplit.parentId as AnyNodeId | undefined },
    { node: second, parentId: wallToSplit.parentId as AnyNodeId | undefined },
  ])
  if (attachmentUpdates && attachmentUpdates.length > 0) {
    updateNodes(attachmentUpdates)
  }
  deleteNode(wallToSplit.id as AnyNodeId)

  return {
    walls: [...walls.filter((wall) => wall.id !== wallToSplit.id), first, second],
    point: intersection.point,
  }
}

/**
 * Commit-time split resolution for an endpoint MOVE — the sibling of the
 * inline resolution in `createWallOnCurrentLevel`: when a moved endpoint is
 * dropped on another wall's interior, split that host exactly like the draw
 * path (duplicate props, migrate attachments by span, skip the split when an
 * opening straddles the point). Mutates the scene store (create halves /
 * migrate attachments / delete host), so callers MUST run it inside the same
 * `runAsSingleSceneHistoryStep` as their endpoint write.
 *
 * Returns the resolved endpoint (projection onto the host, or a nearby corner
 * when the drop is within `WALL_SPLIT_ENDPOINT_EPSILON` of one — corner joins
 * are not splits), or `null` when the point lands on no wall.
 */
export function resolveEndpointWallSplit(args: {
  point: WallPlanPoint
  /** Level the moved wall lives on — only its walls are split candidates. */
  levelId: string | null
  /** The moved wall + every wall receiving an endpoint update in the same commit. */
  ignoreWallIds: string[]
  /**
   * Capture radius. The endpoint already snapped onto the wall body during
   * the drag, so the tight connect radius (drop genuinely on the wall) is
   * the default.
   */
  radius?: number
}): WallPlanPoint | null {
  const { point, levelId, ignoreWallIds, radius = WALL_CONNECT_SNAP_RADIUS } = args
  const { nodes, createNodes, updateNodes, deleteNode } = useScene.getState()
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && (node.parentId ?? null) === levelId,
  )

  const intersection = findWallIntersection(point, walls, radius, ignoreWallIds)
  const split = splitWallIfNeeded(intersection, walls, nodes, createNodes, updateNodes, deleteNode)
  return split ? split.point : null
}

export type GuideSnapLine = {
  origin: readonly [number, number]
  direction: readonly [number, number]
}

// Construction guides always attract (like the wall connect snap): a guide is
// explicit drafting intent, so sticking to it is mode-independent. Alt
// (bypassSnap) is the only way past it.
export const GUIDE_LINE_SNAP_RADIUS = 0.15
export const GUIDE_INTERSECTION_SNAP_RADIUS = 0.2

/** The active level's visible construction-guide lines, as snap targets. */
export function collectGuideSnapLines(
  nodes: Record<string, AnyNode | undefined>,
  levelId: string | null | undefined,
): GuideSnapLine[] {
  if (!levelId) return []
  const guides: GuideSnapLine[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'construction-guide' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    guides.push({ origin: node.origin, direction: node.direction })
  }
  return guides
}

type GuideLineFrame = { px: number; pz: number; dx: number; dz: number }

function intersectGuideLines(a: GuideLineFrame, b: GuideLineFrame): [number, number] | null {
  const cross = a.dx * b.dz - a.dz * b.dx
  if (Math.abs(cross) <= 1e-6) return null
  const t = ((b.px - a.px) * b.dz - (b.pz - a.pz) * b.dx) / cross
  return [a.px + a.dx * t, a.pz + a.dz * t]
}

/**
 * Stick a mode-positioned draft point to nearby construction guides: a
 * guide × guide intersection wins, then the nearest line foot. With an
 * angle-locked `ray`, the stick slides along the ray to the ray × guide
 * intersection so the angle lock is never broken. Null when nothing is in
 * range.
 */
export function snapPointToGuides(
  point: WallPlanPoint,
  guides: readonly GuideSnapLine[],
  ray?: { origin: WallPlanPoint; through: WallPlanPoint },
): WallPlanPoint | null {
  const lines: GuideLineFrame[] = []
  for (const guide of guides) {
    const length = Math.hypot(guide.direction[0], guide.direction[1])
    if (length <= 1e-9) continue
    lines.push({
      px: guide.origin[0],
      pz: guide.origin[1],
      dx: guide.direction[0] / length,
      dz: guide.direction[1] / length,
    })
  }
  if (lines.length === 0) return null

  let best: { point: [number, number]; distance: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = intersectGuideLines(lines[i]!, lines[j]!)
      if (!candidate) continue
      const distance = Math.hypot(candidate[0] - point[0], candidate[1] - point[1])
      if (distance <= GUIDE_INTERSECTION_SNAP_RADIUS && (!best || distance < best.distance)) {
        best = { point: candidate, distance }
      }
    }
  }
  if (best) return [...best.point]

  let rayLine: GuideLineFrame | null = null
  if (ray) {
    const dx = ray.through[0] - ray.origin[0]
    const dz = ray.through[1] - ray.origin[1]
    const length = Math.hypot(dx, dz)
    if (length > 1e-9) {
      rayLine = { px: ray.origin[0], pz: ray.origin[1], dx: dx / length, dz: dz / length }
    }
  }

  for (const line of lines) {
    let candidate: [number, number] | null
    if (rayLine) {
      candidate = intersectGuideLines(rayLine, line)
    } else {
      const t = (point[0] - line.px) * line.dx + (point[1] - line.pz) * line.dz
      candidate = [line.px + line.dx * t, line.pz + line.dz * t]
    }
    if (!candidate) continue
    const distance = Math.hypot(candidate[0] - point[0], candidate[1] - point[1])
    if (distance <= GUIDE_LINE_SNAP_RADIUS && (!best || distance < best.distance)) {
      best = { point: candidate, distance }
    }
  }
  return best ? [...best.point] : null
}

export type WallJunctionReference = {
  sharedPoint: WallPlanPoint
  oppositeEndpoints: readonly WallPlanPoint[]
}

type SnapWallDraftArgs = {
  point: WallPlanPoint
  walls: WallNode[]
  start?: WallPlanPoint
  angleSnap?: boolean
  inferDirection?: boolean
  ignoreWallIds?: string[]
  bypassSnap?: boolean
  /** Override the grid step. */
  step?: number
  /**
   * Magnetic snapping to existing wall geometry (corners, midpoints,
   * crossings, wall bodies). When `false`, only grid/angle snap applies and
   * `snap` is always `null`. Defaults to `true` so callers that don't care
   * keep the prior behaviour.
   */
  magnetic?: boolean
  /**
   * Optional grid-snap override. Lets the caller route grid snapping
   * through a world-XZ aligned snap (so a rotated building's draft
   * lands on the visible grid). When omitted, falls back to the
   * local-axis grid at `step`.
   */
  gridSnap?: (point: WallPlanPoint) => WallPlanPoint
  /** Optional magnetic snap radii. Omitted means wall tools keep their defaults. */
  snapRadii?: WallSnapRadii
  /**
   * Construction guide lines to stick to. When omitted, the active level's
   * guides are collected from the scene store — guide snapping is on by
   * default for every drafting path. Pass [] to disable.
   */
  guides?: readonly GuideSnapLine[]
  /**
   * A caller-owned ray, used while an axis/arrow lock is active. The raw
   * cursor still decides whether a wall face is captured; this ray decides
   * the exact centerline intersection returned by that capture.
   */
  constraintRay?: { origin: WallPlanPoint; through: WallPlanPoint }
  /**
   * Optional datum from the two stationary outer endpoints at a linked
   * junction. The datum is used only by endpoint moves in grid/lines mode.
   */
  junctionReference?: WallJunctionReference
}

export type WallEndpointSnapResult = WallDraftSnapResult & {
  /** True when a fixed-corner direction constraint owns the resolved point. */
  constraintOwned?: boolean
  /** True when an existing wall endpoint or face supplied the resolved point. */
  targetCaptured?: boolean
}

export function snapWallDraftPointDetailed(args: SnapWallDraftArgs): WallDraftSnapResult {
  const {
    point,
    walls,
    start,
    angleSnap = false,
    inferDirection = false,
    ignoreWallIds,
    bypassSnap = false,
    step: overrideStep,
    magnetic = true,
    gridSnap,
    snapRadii,
    guides,
  } = args

  if (bypassSnap) return { point, snap: null, targetWallIds: [] }

  // Discrete special points (corner / midpoint / crossing) are taken from the
  // raw cursor so an interim grid snap can't mask them. A corner always wins,
  // then the nearer of midpoint / crossing — see `findWallSpecialPointSnap`.
  if (magnetic) {
    const special = findWallSpecialPointSnap(point, walls, ignoreWallIds, snapRadii)
    if (special) return special
  }

  if (inferDirection && !magnetic) {
    const connected = findWallSpecialPointSnap(point, walls, ignoreWallIds, {
      endpoint: WALL_CONNECT_SNAP_RADIUS,
      midpoint: WALL_CONNECT_SNAP_RADIUS,
      intersection: WALL_CONNECT_SNAP_RADIUS,
    })
    if (connected) return connected
  }

  if (inferDirection && start && !angleSnap) {
    const edge = findWallSnapTarget(point, walls, {
      ignoreWallIds,
      radius: magnetic ? snapRadii?.wall : WALL_CONNECT_SNAP_RADIUS,
    })
    if (edge)
      return {
        point: edge,
        snap: 'wall',
        targetWallIds: wallIdsAtSnapPoint(edge, walls, ignoreWallIds),
      }
  }

  const step = overrideStep ?? getSegmentGridStep()
  // The angle path snaps the distance ALONG the 15° ray — a scalar, the
  // same in world and local frames — so the `gridSnap` world-grid override
  // only applies when the angle lock is off.
  const modePoint: WallPlanPoint =
    start && angleSnap
      ? [...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, step)]
      : gridSnap
        ? gridSnap(point)
        : snapPointToGrid(point, step)

  // Guide stick runs from the mode-positioned point (like the wall connect
  // snap below) so grid quantise / angle lock are respected right up to the
  // guide. On by default: with no explicit list, the active level's guides
  // come from the scene store.
  const guideLines =
    guides ??
    collectGuideSnapLines(useScene.getState().nodes, useViewer.getState().selection.levelId)
  const guideStick =
    guideLines.length > 0
      ? snapPointToGuides(
          modePoint,
          guideLines,
          start && angleSnap ? { origin: start, through: modePoint } : undefined,
        )
      : null
  const inferred =
    !guideStick && start && !angleSnap && inferDirection && (step > 0 || magnetic)
      ? inferWallDirection(
          start,
          point,
          step,
          walls.filter((w) => !ignoreWallIds?.includes(w.id)),
        )
      : null
  const basePoint: WallPlanPoint = guideStick ?? inferred ?? modePoint

  if (magnetic) {
    const wallSnap = findWallSnapTarget(basePoint, walls, {
      ignoreWallIds,
      radius: snapRadii?.wall,
    })
    if (wallSnap) {
      return {
        point: wallSnap,
        snap: 'wall',
        targetWallIds: wallIdsAtSnapPoint(wallSnap, walls, ignoreWallIds),
      }
    }
    return {
      point: basePoint,
      snap: null,
      targetWallIds: [],
      ...(inferred ? { directionInferred: true } : {}),
    }
  }

  // Non-magnetic modes (grid / off / angles): connectivity still sticks so a
  // room can close, but only within a tight radius — placement elsewhere is left
  // to the mode (grid quantise / angle lock / free). Snap from the already
  // positioned `basePoint` so the mode's placement is respected right up to the
  // wall, then the last few cm stick onto it (and the beacon shows).
  const connectRadii: WallSnapRadii = {
    endpoint: WALL_CONNECT_SNAP_RADIUS,
    midpoint: WALL_CONNECT_SNAP_RADIUS,
    intersection: WALL_CONNECT_SNAP_RADIUS,
    wall: WALL_CONNECT_SNAP_RADIUS,
  }
  const connectSpecial = findWallSpecialPointSnap(basePoint, walls, ignoreWallIds, connectRadii)
  if (connectSpecial) return connectSpecial
  const connectWall = findWallSnapTarget(basePoint, walls, {
    ignoreWallIds,
    radius: WALL_CONNECT_SNAP_RADIUS,
  })
  if (connectWall) {
    return {
      point: connectWall,
      snap: 'wall',
      targetWallIds: wallIdsAtSnapPoint(connectWall, walls, ignoreWallIds),
    }
  }

  return {
    point: basePoint,
    snap: null,
    targetWallIds: [],
    ...(inferred ? { directionInferred: true } : {}),
  }
}

const ENDPOINT_EXACT_SNAP_RADIUS = 1e-4
const ENDPOINT_FACE_CAPTURE_TOLERANCE = 0.005

function cross2(a: WallPlanPoint, b: WallPlanPoint) {
  return a[0] * b[1] - a[1] * b[0]
}

function intersectInferredRayWithWall(
  origin: WallPlanPoint,
  through: WallPlanPoint,
  wall: WallNode,
  allowReverseRay = false,
): WallPlanPoint | null {
  const ray: WallPlanPoint = [through[0] - origin[0], through[1] - origin[1]]
  const rayLength = Math.hypot(ray[0], ray[1])
  const target: WallPlanPoint = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const targetLength = Math.hypot(target[0], target[1])
  if (rayLength <= 1e-9 || targetLength <= 1e-9) return null

  const rayDirection: WallPlanPoint = [ray[0] / rayLength, ray[1] / rayLength]
  const denominator = cross2(rayDirection, target)
  if (Math.abs(denominator) <= 1e-9) return null
  const offset: WallPlanPoint = [wall.start[0] - origin[0], wall.start[1] - origin[1]]
  const rayDistance = cross2(offset, target) / denominator
  const wallT = cross2(offset, rayDirection) / denominator
  if ((!allowReverseRay && rayDistance <= 1e-6) || wallT < -1e-6 || wallT > 1 + 1e-6) return null
  const clampedWallT = Math.max(0, Math.min(1, wallT))
  return [wall.start[0] + target[0] * clampedWallT, wall.start[1] + target[1] * clampedWallT]
}

function findEndpointFaceCapture(args: {
  point: WallPlanPoint
  origin: WallPlanPoint
  inferredPoint: WallPlanPoint
  walls: WallNode[]
  ignoreWallIds?: string[]
  allowReverseRay?: boolean
  acceptPoint?: (point: WallPlanPoint) => boolean
}): { point: WallPlanPoint; wallId: WallNode['id'] } | null {
  const ignored = new Set(args.ignoreWallIds ?? [])
  const candidates: Array<{ wall: WallNode; distance: number }> = []
  for (const wall of args.walls) {
    if (ignored.has(wall.id) || Math.abs(wall.curveOffset ?? 0) > 1e-6) continue
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const lengthSquared = dx * dx + dz * dz
    if (lengthSquared <= 1e-12) continue
    const t =
      ((args.point[0] - wall.start[0]) * dx + (args.point[1] - wall.start[1]) * dz) / lengthSquared
    const projected: WallPlanPoint = [
      wall.start[0] + dx * Math.max(0, Math.min(1, t)),
      wall.start[1] + dz * Math.max(0, Math.min(1, t)),
    ]
    const distance = Math.hypot(args.point[0] - projected[0], args.point[1] - projected[1])
    const halfThickness = getWallConstructionEnvelopeThickness(wall) / 2
    const endpointDistance = Math.min(
      Math.hypot(args.point[0] - wall.start[0], args.point[1] - wall.start[1]),
      Math.hypot(args.point[0] - wall.end[0], args.point[1] - wall.end[1]),
    )
    const interior = t > 1e-6 && t < 1 - 1e-6
    const withinCaptureRadius = distance <= halfThickness + ENDPOINT_FACE_CAPTURE_TOLERANCE
    if (withinCaptureRadius) candidates.push({ wall, distance })
  }

  candidates.sort((a, b) => a.distance - b.distance)
  for (const candidate of candidates) {
    const captured = intersectInferredRayWithWall(
      args.origin,
      args.inferredPoint,
      candidate.wall,
      args.allowReverseRay,
    )
    if (captured && (!args.acceptPoint || args.acceptPoint(captured))) {
      return { point: captured, wallId: candidate.wall.id }
    }
  }
  return null
}

type LinkedJunctionDatumSnap = {
  point: WallPlanPoint
  ray: { origin: WallPlanPoint; through: WallPlanPoint }
}

function snapLinkedJunctionDatum(args: {
  point: WallPlanPoint
  primaryRay?: { origin: WallPlanPoint; through: WallPlanPoint }
  allowReverseRay: boolean
  junctionReference?: WallJunctionReference
}): LinkedJunctionDatumSnap | null {
  const reference = args.junctionReference
  if (!reference) return null

  let best: (LinkedJunctionDatumSnap & { distance: number }) | null = null
  const endpoints = reference.oppositeEndpoints
  for (let i = 0; i < endpoints.length; i++) {
    const first = endpoints[i]
    if (!first) continue
    const firstFromShared: WallPlanPoint = [
      first[0] - reference.sharedPoint[0],
      first[1] - reference.sharedPoint[1],
    ]
    const firstLength = Math.hypot(firstFromShared[0], firstFromShared[1])
    if (firstLength <= 1e-9) continue

    for (let j = i + 1; j < endpoints.length; j++) {
      const second = endpoints[j]
      if (!second) continue
      const secondFromShared: WallPlanPoint = [
        second[0] - reference.sharedPoint[0],
        second[1] - reference.sharedPoint[1],
      ]
      const secondLength = Math.hypot(secondFromShared[0], secondFromShared[1])
      const datumDirection: WallPlanPoint = [second[0] - first[0], second[1] - first[1]]
      const datumLength = Math.hypot(datumDirection[0], datumDirection[1])
      if (secondLength <= 1e-9 || datumLength <= 1e-9) continue

      // The two stationary rays must describe one straight continuation through
      // the shared corner. Use the existing 2° inference window so a near-straight
      // scan-imported junction is accepted without making arbitrary pairs datums.
      const parallelError =
        Math.abs(cross2(firstFromShared, secondFromShared)) / (firstLength * secondLength)
      const continuation =
        firstFromShared[0] * secondFromShared[0] + firstFromShared[1] * secondFromShared[1]
      if (continuation >= 0 || parallelError > Math.sin(INFERENCE_TOLERANCE) + 1e-12) continue

      const datum: GuideSnapLine = {
        origin: [...first] as WallPlanPoint,
        direction: [datumDirection[0] / datumLength, datumDirection[1] / datumLength],
      }
      const candidate = snapPointToGuides(args.point, [datum], args.primaryRay)
      if (!candidate) continue

      if (args.primaryRay) {
        const rayDirection: WallPlanPoint = [
          args.primaryRay.through[0] - args.primaryRay.origin[0],
          args.primaryRay.through[1] - args.primaryRay.origin[1],
        ]
        const rayLength = Math.hypot(rayDirection[0], rayDirection[1])
        if (rayLength <= 1e-9) continue
        const fromOrigin: WallPlanPoint = [
          candidate[0] - args.primaryRay.origin[0],
          candidate[1] - args.primaryRay.origin[1],
        ]
        const rayDistance =
          (fromOrigin[0] * rayDirection[0] + fromOrigin[1] * rayDirection[1]) / rayLength
        const rayOffset = Math.abs(cross2(fromOrigin, rayDirection)) / rayLength
        if (rayOffset > 1e-7 || (!args.allowReverseRay && rayDistance < -1e-7)) continue
      }

      const distance = Math.hypot(candidate[0] - args.point[0], candidate[1] - args.point[1])
      if (!best || distance < best.distance) {
        best = {
          point: candidate,
          ray: { origin: [...first] as WallPlanPoint, through: [...second] as WallPlanPoint },
          distance,
        }
      }
    }
  }

  return best
}

/**
 * Endpoint-specific snap resolution. A fixed-corner direction inference is
 * established before broad face/alignment snapping so a square, 45°, or
 * parallel/perpendicular intent owns the point. A raw cursor over a target's
 * physical construction envelope can still capture that target, but the
 * committed point is the intersection of the inferred ray and its centerline.
 */
export function resolveWallEndpointPoint(args: SnapWallDraftArgs): WallEndpointSnapResult {
  const { point, walls, start, ignoreWallIds, bypassSnap = false } = args
  if (bypassSnap || !start || !args.inferDirection) {
    return snapWallDraftPointDetailed(args)
  }

  const exactEndpoint = findWallEndpointFromRaw(
    point,
    walls,
    ignoreWallIds,
    ENDPOINT_EXACT_SNAP_RADIUS,
  )
  if (exactEndpoint) {
    return {
      point: exactEndpoint,
      snap: 'endpoint',
      targetWallIds: wallIdsAtSnapPoint(exactEndpoint, walls, ignoreWallIds),
      targetCaptured: true,
    }
  }

  const step = args.step ?? getSegmentGridStep()
  const magnetic = args.magnetic ?? true
  const anglePoint = args.angleSnap
    ? ([...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, step)] as WallPlanPoint)
    : null
  const modePoint =
    args.constraintRay?.through ??
    anglePoint ??
    (args.gridSnap ? args.gridSnap(point) : snapPointToGrid(point, step))
  const guideLines =
    args.guides ??
    collectGuideSnapLines(useScene.getState().nodes, useViewer.getState().selection.levelId)
  const guideStick =
    guideLines.length > 0
      ? snapPointToGuides(
          modePoint,
          guideLines,
          args.constraintRay
            ? args.constraintRay
            : anglePoint
              ? { origin: start, through: anglePoint }
              : undefined,
        )
      : null
  if (guideStick) {
    return {
      point: guideStick,
      snap: null,
      targetWallIds: [],
      constraintOwned: true,
    }
  }

  const references = walls.filter((wall) => !ignoreWallIds?.includes(wall.id))
  const inferredPoint =
    args.constraintRay?.through ??
    anglePoint ??
    (step > 0 || magnetic ? inferWallDirection(start, point, step, references) : null)
  const captureOrigin = args.constraintRay?.origin ?? start
  const captureThrough = inferredPoint ?? point
  const primaryRay = inferredPoint ? { origin: captureOrigin, through: inferredPoint } : undefined
  const junction =
    !args.angleSnap && (step > 0 || magnetic)
      ? snapLinkedJunctionDatum({
          point,
          primaryRay,
          allowReverseRay: Boolean(args.constraintRay),
          junctionReference: args.junctionReference,
        })
      : null

  const faceCapture = findEndpointFaceCapture({
    point,
    origin: junction && !primaryRay ? junction.ray.origin : captureOrigin,
    inferredPoint: junction && !primaryRay ? junction.ray.through : captureThrough,
    walls,
    ignoreWallIds,
    allowReverseRay: Boolean(args.constraintRay) || Boolean(junction && !primaryRay),
    acceptPoint:
      junction && primaryRay
        ? (candidate) =>
            Math.hypot(candidate[0] - junction.point[0], candidate[1] - junction.point[1]) <= 1e-7
        : undefined,
  })
  if (faceCapture) {
    const targetWallIds = wallIdsAtSnapPoint(faceCapture.point, walls, ignoreWallIds)
    if (!targetWallIds.includes(faceCapture.wallId)) targetWallIds.push(faceCapture.wallId)
    return {
      point: faceCapture.point,
      snap: 'wall',
      targetWallIds,
      ...(inferredPoint || junction ? { directionInferred: true, constraintOwned: true } : {}),
      targetCaptured: true,
    }
  }

  if (junction) {
    return {
      point: junction.point,
      snap: null,
      targetWallIds: [],
      constraintOwned: true,
      directionInferred: true,
    }
  }

  if (args.constraintRay) {
    return {
      point: [...args.constraintRay.through],
      snap: null,
      targetWallIds: [],
      directionInferred: true,
      constraintOwned: true,
    }
  }

  if (!inferredPoint) return snapWallDraftPointDetailed(args)

  // Keep the inferred ray exact when no physical target captures the raw
  // cursor. This prevents a nearby endpoint, midpoint, edge, or alignment
  // anchor from pulling the endpoint off the user's fixed-corner constraint.
  return {
    point: inferredPoint,
    snap: null,
    targetWallIds: [],
    directionInferred: true,
    constraintOwned: true,
  }
}

export function snapWallDraftPoint(args: SnapWallDraftArgs): WallPlanPoint {
  return snapWallDraftPointDetailed(args).point
}

export function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint): boolean {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

export type WallConstructionOptions = {
  preserveDirection?: boolean
  /** Pointer-decided maximum support elevation in level-local metres. */
  supportCap?: number | null
  /** Support source selected by the first click or inherited from a snapped wall. */
  preferredSupportSlabId?: string | null
  /** Frozen level-local Y shown by the draft ghost. */
  constructionElevation?: number | null
  /** Height shown by the draft ghost. */
  constructionHeight?: number | null
}

export function resolveTerrainWallConstructionOptions(
  nodes: Record<string, AnyNode>,
  levelId: string,
  point: WallPlanPoint,
  defaults?: Record<string, unknown>,
): WallConstructionOptions | undefined {
  const constructionElevation = terrainSupportLift(nodes, levelId, point[0], point[1])
  if (constructionElevation == null) return undefined

  const level = nodes[levelId]
  const constructionHeight =
    typeof defaults?.height === 'number'
      ? defaults.height
      : level?.type === 'level'
        ? (level.height ?? DEFAULT_LEVEL_HEIGHT)
        : DEFAULT_LEVEL_HEIGHT

  return {
    constructionElevation,
    constructionHeight,
    supportCap: constructionElevation,
  }
}

export function createWallOnCurrentLevel(
  start: WallPlanPoint,
  end: WallPlanPoint,
  options?: WallConstructionOptions,
): WallNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, createNodes, deleteNode, nodes } = useScene.getState()
  const { updateNodes } = useScene.getState()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  let workingWalls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === currentLevelId,
  )

  let resolvedStart = start
  let resolvedEnd = end

  // The corner-join / wall-split resolution follows the snapping mode like the
  // draft preview does: magnetic ('lines') keeps the generous join radius,
  // every other mode uses the same tight connect radius the draft path already
  // sticks endpoints with. So an endpoint the user saw connect to a wall body
  // actually splits that wall (and redistributes its attachments) in every
  // mode, while `'off'` / `'angles'` gain no residual long-range snap.
  const joinRadius = options?.preserveDirection
    ? 1e-7
    : isMagneticSnapActive()
      ? WALL_JOIN_SNAP_RADIUS
      : WALL_CONNECT_SNAP_RADIUS

  // One undo step for the whole commit: the split ops (create halves, migrate
  // attachments, delete host) plus the new wall each push their own history
  // entry, and a single Ctrl-Z must not strand a half-split wall network.
  return runAsSingleSceneHistoryStep(useScene, () => {
    const endIntersection = findWallIntersection(resolvedEnd, workingWalls, joinRadius)
    const splitEnd = splitWallIfNeeded(
      endIntersection,
      workingWalls,
      nodes,
      createNodes,
      updateNodes,
      deleteNode,
    )
    if (splitEnd) {
      workingWalls = splitEnd.walls
      resolvedEnd = splitEnd.point
    }

    const startIntersection = findWallIntersection(resolvedStart, workingWalls, joinRadius)
    const splitStart = splitWallIfNeeded(
      startIntersection,
      workingWalls,
      nodes,
      createNodes,
      updateNodes,
      deleteNode,
    )
    if (splitStart) {
      workingWalls = splitStart.walls
      resolvedStart = splitStart.point
    }

    if (
      !isSegmentLongEnough(resolvedStart, resolvedEnd) ||
      pointsEqual(resolvedStart, resolvedEnd)
    ) {
      return null
    }

    const duplicateWall = workingWalls.some(
      (wall) =>
        (pointsEqual(wall.start, resolvedStart) && pointsEqual(wall.end, resolvedEnd)) ||
        (pointsEqual(wall.start, resolvedEnd) && pointsEqual(wall.end, resolvedStart)),
    )
    if (duplicateWall) {
      return null
    }

    const wallCount = Object.values(nodes).filter((node) => node.type === 'wall').length
    // A placed wall preset seeds `toolDefaults.wall` (thickness, height,
    // materials, sides) before the tool activates; merge those first so the
    // drawn wall reproduces the preset. Identity + endpoints always win.
    const defaults = useEditor.getState().toolDefaults.wall ?? {}
    const thickness = typeof defaults.thickness === 'number' ? defaults.thickness : 0.1
    const wall = WallSchema.parse({
      ...defaults,
      thickness,
      // Applied here, not only in the node defaults: this is the path a wall
      // drawn by hand actually takes, and it must arrive already priceable.
      // A caller that supplied its own bands keeps them, products and all.
      faceBands:
        defaults.faceBands ??
        withDefaultConstructionMaterials(createDefaultWallFaceBands(thickness)),
      name: `Wall ${wallCount + 1}`,
      start: resolvedStart,
      end: resolvedEnd,
    })

    createNode(wall, currentLevelId)
    const createdWall = useScene.getState().nodes[wall.id]
    if (createdWall?.type === 'wall') {
      const terrainBase = terrainSupportLift(
        useScene.getState().nodes,
        currentLevelId,
        createdWall.start[0],
        createdWall.start[1],
      )
      const preferredSupportSlabId =
        options?.preferredSupportSlabId ??
        (options?.constructionElevation != null && terrainBase != null ? GROUND_SUPPORT_ID : null)
      const supportPatch = resolveWallSupportSlabPatch(createdWall, useScene.getState().nodes, {
        maxElevation: options?.supportCap ?? null,
        preferredSlabId: preferredSupportSlabId,
      })
      const supportSlabId = supportPatch.supportSlabId
      const sourceSupport = spatialGridManager.getSlabSupportForWall(
        currentLevelId,
        createdWall.start,
        createdWall.end,
        createdWall.curveOffset,
        createdWall.thickness,
        supportSlabId,
        options?.supportCap ?? null,
      )
      const supportOffset =
        options?.constructionElevation == null
          ? undefined
          : options.constructionElevation - sourceSupport.elevation
      const preserveDraftHeight =
        createdWall.height == null &&
        options?.constructionHeight != null &&
        options.constructionElevation != null &&
        (terrainBase != null || Math.abs(options.constructionElevation) > 1e-6)
      useScene.getState().updateNode(createdWall.id, {
        ...supportPatch,
        height: preserveDraftHeight
          ? (options?.constructionHeight ?? createdWall.height)
          : createdWall.height,
        supportOffset:
          supportOffset != null && Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
      })
    }
    sfxEmitter.emit('sfx:structure-build')

    const committedWall = useScene.getState().nodes[wall.id]
    return committedWall?.type === 'wall' ? committedWall : wall
  })
}
