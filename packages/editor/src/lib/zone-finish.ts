import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  CeilingNode as CeilingNodeSchema,
  detectSpacesForLevel,
  generateId,
  generateSceneMaterialId,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  getWallSurfaceSideFromBandSlot,
  isCurvedWall,
  type MaterialSchema,
  MaterialSchema as MaterialSchemaSchema,
  MIN_SLAB_THICKNESS,
  normalizeWallFinishRegions,
  pointInPolygon2D,
  runAsSingleSceneHistoryStep,
  type SceneMaterial as SceneMaterialType,
  type SlabNode,
  SlabNode as SlabNodeSchema,
  type Space,
  toSceneMaterialRef,
  useScene,
  validateWallFinishRegions,
  type WallFinishRegion,
  WallFinishRegionSchema,
  type WallNode,
} from '@pascal-app/core'
import { freezeHostMaterialCatalogItem } from './host-integration'
import {
  activeWallFaceSlotRoles,
  wallFaceSideIsAmbiguous,
  wallRoleForRoomFace,
} from './paint-scope'

export type ZoneFinishTargetKind = 'walls' | 'wall' | 'floor' | 'ceiling'
export type ZoneFinishWallFace = 'front' | 'back'
/**
 * Full wall faces retain the v1 `wallId:face` key. Partial or repeated claims
 * include their normalized interval so template mappings and selected targets
 * can distinguish disjoint spans on one physical face.
 */
export type ZoneFinishWallKey =
  | `${string}:${ZoneFinishWallFace}`
  | `${string}:${number}:${number}:${ZoneFinishWallFace}`

export type CapturedZoneFinishTarget = {
  zoneId: string
  levelId: string
  kind: ZoneFinishTargetKind
  wallKey?: ZoneFinishWallKey
  fingerprint: string
}

export type ZoneSurfaceWallFingerprint = {
  wallId: string
  face: ZoneFinishWallFace
  side?: 'interior' | 'exterior'
  start?: number
  end?: number
  segmentSignature: string
  length: number
  activeSlotRoles: string[]
}

export type ZoneSurfaceFingerprint = {
  levelId: string
  zoneId: string
  polygonSignature: string
  inwardWalls: ZoneSurfaceWallFingerprint[]
  floor: { slabId: string; polygonSignature: string } | { createFromZone: true }
  ceiling?: { ceilingId: string; polygonSignature: string } | { createFromZone: true }
}

export type PortableMaterialSnapshot = {
  label: string
  preferredRef?: `library:${string}`
  material: MaterialSchema
}

export type ZoneFinishTemplateWall = {
  sourceFace: ZoneSurfaceWallFingerprint & { key: ZoneFinishWallKey }
  slots: Array<{ role: string; material: PortableMaterialSnapshot }>
}

export type ZoneFinishTemplateSnapshot = {
  version: 1
  id: string
  name: string
  createdAt: string
  source: {
    sceneId?: string
    zoneId: string
    fingerprint: ZoneSurfaceFingerprint
  }
  walls: ZoneFinishTemplateWall[]
  floor: PortableMaterialSnapshot
  ceiling?: PortableMaterialSnapshot
}

export type HomeFinishTemplate = {
  version: 1
  id: string
  name: string
  createdAt: string
  sourceSceneId?: string
  zones: Array<{
    sourceZoneId: string
    sourceZoneName: string
    template: ZoneFinishTemplateSnapshot
  }>
}

export type ZoneFinishWallInspection = {
  key: ZoneFinishWallKey
  wallId: string
  face: ZoneFinishWallFace
  side?: 'interior' | 'exterior'
  start?: number
  end?: number
  roles: string[]
  segmentSignature: string
  length: number
}

export type ZoneFinishBoundaryError = {
  code: 'manual-zone-subsegment-unsupported' | 'curved-wall-partial-finish-unsupported'
  message: string
  conflictIds: string[]
}

export type ZoneFinishInspection = {
  target: CapturedZoneFinishTarget
  wallFaces: ReadonlyArray<ZoneFinishWallInspection>
  boundaryError?: ZoneFinishBoundaryError
  floor:
    | { status: 'existing'; slabId: string }
    | { status: 'creatable'; baseSlabId?: string }
    | { status: 'blocked'; reason: string; conflictIds: string[] }
  ceiling:
    | { status: 'existing'; ceilingId: string; explicit: boolean }
    | { status: 'creatable'; explicit: false }
    | { status: 'blocked'; reason: string; conflictIds: string[]; explicit: false }
  completion: {
    explicit: number
    total: number
    missing: ReadonlyArray<{ nodeId: string; role: string }>
  }
  materialRefs: ReadonlyArray<string>
  materialCount: number
}

export type ZoneFinishError = {
  ok: false
  code: string
  message: string
  conflictIds: string[]
  missing?: Array<{ nodeId: string; role: string }>
}

export type ZoneFinishNodePatch = {
  id: AnyNodeId
  data: Partial<AnyNode>
}

export type ZoneFinishApplyPlan = {
  target: CapturedZoneFinishTarget
  fingerprint: string
  nodePatches: ZoneFinishNodePatch[]
  createNodes: Array<{ node: AnyNode; parentId?: AnyNodeId }>
  materials: SceneMaterialType[]
  materialRef: string
  expectedNodeVersions: Record<string, string>
  expectedContextFingerprint?: string
  expectedContextZoneIds?: string[]
}

export type ZoneFinishApplyResult = { ok: true; plan: ZoneFinishApplyPlan } | ZoneFinishError

export type ZoneFinishContext = {
  nodes: Record<string, AnyNode>
  materials: Record<string, SceneMaterialType>
  spaces: Record<string, Space>
  sceneId?: string
}

type ContextArgs = Partial<ZoneFinishContext>
type ZoneNode = Extract<AnyNode, { type: 'zone' }>
type FloorResolution =
  | { status: 'existing'; slab: SlabNode }
  | { status: 'creatable'; baseSlab?: SlabNode }
  | { status: 'blocked'; reason: string; conflictIds: string[] }
type CeilingResolution =
  | { status: 'existing'; ceiling: CeilingNode }
  | { status: 'creatable' }
  | { status: 'blocked'; reason: string; conflictIds: string[] }

const POLYGON_TOLERANCE = 0.15
const POINT_EPSILON = 1e-7
const MANUAL_BOUNDARY_LINE_TOLERANCE = 0.16
const MANUAL_BOUNDARY_MIN_OVERLAP = 0.12
const MANUAL_BOUNDARY_OVERLAP_EPSILON = 0.04
const MANUAL_BOUNDARY_MESSAGE =
  '이 Zone의 벽면 경계가 하나의 연속된 벽 구간으로 확인되지 않아 마감할 수 없습니다.'
const MANUAL_CURVED_BOUNDARY_MESSAGE =
  '곡선 벽의 부분 구간은 연속적인 벽 경로를 확인할 수 있을 때만 마감할 수 있습니다.'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function materialsEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

function isZoneFinishError(value: unknown): value is ZoneFinishError {
  return Boolean(
    value && typeof value === 'object' && 'ok' in value && (value as { ok?: unknown }).ok === false,
  )
}

function validPolygon(polygon: readonly (readonly [number, number])[]): boolean {
  if (polygon.length < 3) return false
  if (polygon.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) return false
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!current || !next) return false
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) > POINT_EPSILON
}

function pointToKey(point: readonly [number, number]): string {
  return `${point[0].toFixed(4)},${point[1].toFixed(4)}`
}

function mutablePolygon(polygon: readonly (readonly [number, number])[]): [number, number][] {
  return polygon.map(([x, z]) => [x, z])
}

function polygonSignature(polygon: readonly (readonly [number, number])[]): string {
  if (!validPolygon(polygon)) return ''
  const values = polygon.map(pointToKey)
  const reversed = [...values].reverse()
  const rotations = (points: string[]) =>
    points.map((_, index) => [...points.slice(index), ...points.slice(0, index)].join(';'))
  return [...rotations(values), ...rotations(reversed)].sort()[0] ?? ''
}

export { polygonSignature as zonePolygonSignature }

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= POINT_EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz))
}

function polygonContainsWithTolerance(
  outer: readonly (readonly [number, number])[],
  inner: readonly (readonly [number, number])[],
  tolerance = POLYGON_TOLERANCE,
): boolean {
  if (!validPolygon(outer) || !validPolygon(inner)) return false
  return inner.every((point) => {
    if (pointInPolygon2D([point[0], point[1]], mutablePolygon(outer), { includeBoundary: true }))
      return true
    return outer.some((start, index) => {
      const end = outer[(index + 1) % outer.length]
      return end ? distanceToSegment(point, start, end) <= tolerance : false
    })
  })
}

function polygonEquivalent(
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[],
): boolean {
  return polygonContainsWithTolerance(left, right) && polygonContainsWithTolerance(right, left)
}

function orientation(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function properSegmentIntersection(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const ab = orientation(a, b, c)
  const ab2 = orientation(a, b, d)
  const cd = orientation(c, d, a)
  const cd2 = orientation(c, d, b)
  return (
    Math.abs(ab) > POINT_EPSILON &&
    Math.abs(ab2) > POINT_EPSILON &&
    Math.abs(cd) > POINT_EPSILON &&
    Math.abs(cd2) > POINT_EPSILON &&
    Math.sign(ab) !== Math.sign(ab2) &&
    Math.sign(cd) !== Math.sign(cd2)
  )
}

function segmentParameter(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= POINT_EPSILON) return null
  const parameter = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared
  return parameter >= -POINT_EPSILON && parameter <= 1 + POINT_EPSILON ? parameter : null
}

function collectSegmentIntersectionParameters(
  start: readonly [number, number],
  end: readonly [number, number],
  otherStart: readonly [number, number],
  otherEnd: readonly [number, number],
): number[] {
  const parameters: number[] = []
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const otherDx = otherEnd[0] - otherStart[0]
  const otherDz = otherEnd[1] - otherStart[1]
  const cross = dx * otherDz - dz * otherDx
  const fromStartX = otherStart[0] - start[0]
  const fromStartZ = otherStart[1] - start[1]

  if (Math.abs(cross) > POINT_EPSILON) {
    const parameter = (fromStartX * otherDz - fromStartZ * otherDx) / cross
    const otherParameter = (fromStartX * dz - fromStartZ * dx) / cross
    if (
      parameter >= -POINT_EPSILON &&
      parameter <= 1 + POINT_EPSILON &&
      otherParameter >= -POINT_EPSILON &&
      otherParameter <= 1 + POINT_EPSILON
    ) {
      parameters.push(Math.max(0, Math.min(1, parameter)))
    }
    return parameters
  }

  if (Math.abs(fromStartX * dz - fromStartZ * dx) > POINT_EPSILON) return parameters
  for (const point of [otherStart, otherEnd]) {
    const parameter = segmentParameter(point, start, end)
    if (parameter !== null) parameters.push(Math.max(0, Math.min(1, parameter)))
  }
  for (const [point, endpointParameter] of [
    [start, 0],
    [end, 1],
  ] as const) {
    const parameter = segmentParameter(point, otherStart, otherEnd)
    if (parameter !== null) parameters.push(endpointParameter)
  }
  return parameters
}

function polygonOverlapSampleOffsets(edgeLength: number): number[] {
  return [1e-5, 1e-4, 1e-3, 1e-2].map((factor) =>
    Math.max(POINT_EPSILON * 100, edgeLength * factor),
  )
}

function edgeSampleIsInteriorToBoth(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[],
): boolean {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= POINT_EPSILON) return false
  const normalX = -dz / length
  const normalZ = dx / length
  for (const offset of polygonOverlapSampleOffsets(length)) {
    for (const direction of [-1, 1]) {
      const candidate: [number, number] = [
        point[0] + normalX * offset * direction,
        point[1] + normalZ * offset * direction,
      ]
      if (
        pointInPolygon2D(candidate, mutablePolygon(left), { includeBoundary: false }) &&
        pointInPolygon2D(candidate, mutablePolygon(right), { includeBoundary: false })
      ) {
        return true
      }
    }
  }
  return false
}

function polygonsOverlapByArea(
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[],
): boolean {
  if (!validPolygon(left) || !validPolygon(right)) return false
  if (
    left.some((point) =>
      pointInPolygon2D([point[0], point[1]], mutablePolygon(right), { includeBoundary: false }),
    ) ||
    right.some((point) =>
      pointInPolygon2D([point[0], point[1]], mutablePolygon(left), { includeBoundary: false }),
    )
  ) {
    return true
  }
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex]
    const leftEnd = left[(leftIndex + 1) % left.length]
    if (!leftStart || !leftEnd) continue
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex]
      const rightEnd = right[(rightIndex + 1) % right.length]
      if (!rightStart || !rightEnd) continue
      if (properSegmentIntersection(leftStart, leftEnd, rightStart, rightEnd)) return true

      const parameters = [
        0,
        1,
        ...collectSegmentIntersectionParameters(leftStart, leftEnd, rightStart, rightEnd),
      ].sort((a, b) => a - b)
      const uniqueParameters = parameters.filter(
        (parameter, index) => index === 0 || parameter - parameters[index - 1]! > POINT_EPSILON,
      )
      for (
        let parameterIndex = 0;
        parameterIndex < uniqueParameters.length - 1;
        parameterIndex += 1
      ) {
        const startParameter = uniqueParameters[parameterIndex]!
        const endParameter = uniqueParameters[parameterIndex + 1]!
        if (endParameter - startParameter <= POINT_EPSILON) continue
        const parameter = (startParameter + endParameter) / 2
        const sample: [number, number] = [
          leftStart[0] + (leftEnd[0] - leftStart[0]) * parameter,
          leftStart[1] + (leftEnd[1] - leftStart[1]) * parameter,
        ]
        if (edgeSampleIsInteriorToBoth(sample, leftStart, leftEnd, left, right)) return true
      }
    }
  }
  return false
}

function holeIntersectsPolygon(
  polygon: readonly (readonly [number, number])[],
  holes: readonly (readonly (readonly [number, number])[])[],
): boolean {
  return holes.some((hole) => polygonsOverlapByArea(polygon, hole))
}

function segmentSignature(points: readonly (readonly [number, number])[]): string {
  const forward = points.map(pointToKey).join('|')
  const reverse = [...points].reverse().map(pointToKey).join('|')
  return forward < reverse ? forward : reverse
}

function segmentLength(points: readonly (readonly [number, number])[]): number {
  let length = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (start && end) length += Math.hypot(end[0] - start[0], end[1] - start[1])
  }
  return length
}

type ManualWallClaim = {
  wall: WallNode
  face: ZoneFinishWallFace
  side: 'interior' | 'exterior'
  edgeIndex: number
  intervalStart: number
  intervalEnd: number
  overlap: number
  wallLength: number
  start: number
  end: number
  curved: boolean
}

type WallNormalizedRange = { start: number; end: number }

function normalizedWallRangeForPoints(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  points: readonly (readonly [number, number])[],
): WallNormalizedRange | null {
  if (points.length === 0 || isCurvedWall(wall)) {
    return null
  }
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= POINT_EPSILON) return null
  const parameters = points.map(
    (point) => ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / lengthSquared,
  )
  const start = Math.max(0, Math.min(1, Math.min(...parameters)))
  const end = Math.max(0, Math.min(1, Math.max(...parameters)))
  return end - start > POINT_EPSILON ? { start, end } : null
}

function normalizedWallRangeForClaim(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  edgeStart: readonly [number, number],
  unit: readonly [number, number],
  edgeLength: number,
  intervalStart: number,
  intervalEnd: number,
): WallNormalizedRange | null {
  const startDistance = Math.max(0, Math.min(edgeLength, intervalStart))
  const endDistance = Math.max(0, Math.min(edgeLength, intervalEnd))
  const startPoint: [number, number] = [
    edgeStart[0] + unit[0] * startDistance,
    edgeStart[1] + unit[1] * startDistance,
  ]
  const endPoint: [number, number] = [
    edgeStart[0] + unit[0] * endDistance,
    edgeStart[1] + unit[1] * endDistance,
  ]
  return normalizedWallRangeForPoints(wall, [startPoint, endPoint])
}

function faceRange(face: Pick<ZoneFinishWallInspection, 'start' | 'end'>): WallNormalizedRange {
  return {
    start: face.start ?? 0,
    end: face.end ?? 1,
  }
}

function wallFaceKey(
  wallId: string,
  face: ZoneFinishWallFace,
  start: number,
  end: number,
): ZoneFinishWallKey {
  if (Math.abs(start) <= 1e-6 && Math.abs(end - 1) <= 1e-6) {
    return `${wallId}:${face}`
  }
  return `${wallId}:${start.toFixed(6)}:${end.toFixed(6)}:${face}`
}

function wallFaceKeyMatchesFingerprint(
  key: string,
  face: Pick<ZoneSurfaceWallFingerprint, 'wallId' | 'face' | 'start' | 'end'>,
): boolean {
  return key === wallFaceKey(face.wallId, face.face, face.start ?? 0, face.end ?? 1)
}

function isPartialWallRange(start: number, end: number): boolean {
  return start > 1e-6 || end < 1 - 1e-6
}

function hasUnsupportedCurvedPartialFinish(wall: WallNode): boolean {
  return (
    isCurvedWall(wall) &&
    (wall.finishRegions ?? []).some((region) => isPartialWallRange(region.start, region.end))
  )
}

function curvedBoundaryCoversWholeWall(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  points: readonly (readonly [number, number])[],
): boolean {
  if (points.length < 2) return false
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return false
  const endpointTolerance = 1e-4
  const near = (point: readonly [number, number], endpoint: readonly [number, number]) =>
    Math.hypot(point[0] - endpoint[0], point[1] - endpoint[1]) <= endpointTolerance
  return (
    (near(first, wall.start) && near(last, wall.end)) ||
    (near(first, wall.end) && near(last, wall.start))
  )
}

function manualBoundaryFaceForEdge(
  polygon: readonly (readonly [number, number])[],
  start: readonly [number, number],
  end: readonly [number, number],
): ZoneFinishWallFace | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= POINT_EPSILON) return null
  const midpoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const normal: [number, number] = [-dz / length, dx / length]
  const offsets = [
    Math.max(POINT_EPSILON * 100, Math.min(0.02, length * 0.02)),
    Math.max(POINT_EPSILON * 100, Math.min(0.005, length * 0.005)),
  ]
  for (const offset of offsets) {
    const frontPoint: [number, number] = [
      midpoint[0] + normal[0] * offset,
      midpoint[1] + normal[1] * offset,
    ]
    const backPoint: [number, number] = [
      midpoint[0] - normal[0] * offset,
      midpoint[1] - normal[1] * offset,
    ]
    const frontInside = pointInPolygon2D(frontPoint, mutablePolygon(polygon), {
      includeBoundary: false,
    })
    const backInside = pointInPolygon2D(backPoint, mutablePolygon(polygon), {
      includeBoundary: false,
    })
    if (frontInside === backInside) continue
    return frontInside ? 'front' : 'back'
  }
  return null
}

function manualBoundaryError(
  conflictIds: Iterable<string>,
  code: ZoneFinishBoundaryError['code'] = 'manual-zone-subsegment-unsupported',
): ZoneFinishBoundaryError {
  return {
    code,
    message:
      code === 'curved-wall-partial-finish-unsupported'
        ? MANUAL_CURVED_BOUNDARY_MESSAGE
        : MANUAL_BOUNDARY_MESSAGE,
    conflictIds: [...new Set(conflictIds)].filter(Boolean),
  }
}

function lineDistanceFromPoint(
  point: readonly [number, number],
  lineStart: readonly [number, number],
  unit: readonly [number, number],
): number {
  return Math.abs((point[0] - lineStart[0]) * unit[1] - (point[1] - lineStart[1]) * unit[0])
}

function projectedInterval(
  start: readonly [number, number],
  end: readonly [number, number],
  lineStart: readonly [number, number],
  unit: readonly [number, number],
  lineLength: number,
): { start: number; end: number; overlap: number } {
  const first = (start[0] - lineStart[0]) * unit[0] + (start[1] - lineStart[1]) * unit[1]
  const second = (end[0] - lineStart[0]) * unit[0] + (end[1] - lineStart[1]) * unit[1]
  const intervalStart = Math.min(first, second)
  const intervalEnd = Math.max(first, second)
  return {
    start: intervalStart,
    end: intervalEnd,
    overlap: Math.max(0, Math.min(lineLength, intervalEnd) - Math.max(0, intervalStart)),
  }
}

function manualWallFaces(
  zone: ZoneNode,
  context: ZoneFinishContext,
): { faces: ZoneFinishWallInspection[]; boundaryError?: ZoneFinishBoundaryError } {
  if (!validPolygon(zone.polygon)) return { faces: [] }
  const walls = Object.values(context.nodes)
    .map(asWall)
    .filter((wall): wall is WallNode => Boolean(wall && wall.parentId === zone.parentId))
  if (walls.length === 0) return { faces: [] }

  const claims: ManualWallClaim[] = []

  for (let edgeIndex = 0; edgeIndex < zone.polygon.length; edgeIndex += 1) {
    const edgeStart = zone.polygon[edgeIndex]
    const edgeEnd = zone.polygon[(edgeIndex + 1) % zone.polygon.length]
    if (!edgeStart || !edgeEnd) continue
    const edgeLength = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1])
    if (edgeLength <= POINT_EPSILON) continue
    const boundaryFace = manualBoundaryFaceForEdge(zone.polygon, edgeStart, edgeEnd)
    if (!boundaryFace) {
      return {
        faces: [],
        boundaryError: manualBoundaryError([zone.id, ...claims.map((claim) => claim.wall.id)]),
      }
    }
    const unit: [number, number] = [
      (edgeEnd[0] - edgeStart[0]) / edgeLength,
      (edgeEnd[1] - edgeStart[1]) / edgeLength,
    ]
    const candidates: ManualWallClaim[] = []
    for (const wall of walls) {
      const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      if (wallLength <= POINT_EPSILON) continue
      const interval = projectedInterval(wall.start, wall.end, edgeStart, unit, edgeLength)
      if (interval.overlap < MANUAL_BOUNDARY_MIN_OVERLAP) continue
      const lineDistance = Math.max(
        lineDistanceFromPoint(wall.start, edgeStart, unit),
        lineDistanceFromPoint(wall.end, edgeStart, unit),
      )
      if (lineDistance > MANUAL_BOUNDARY_LINE_TOLERANCE) continue
      const wallUnit: [number, number] = [
        (wall.end[0] - wall.start[0]) / wallLength,
        (wall.end[1] - wall.start[1]) / wallLength,
      ]
      const candidateFace =
        unit[0] * wallUnit[0] + unit[1] * wallUnit[1] < 0
          ? boundaryFace === 'front'
            ? 'back'
            : 'front'
          : boundaryFace
      const curved = isCurvedWall(wall)
      const range = curved
        ? { start: 0, end: 1 }
        : normalizedWallRangeForClaim(
            wall,
            edgeStart,
            unit,
            edgeLength,
            interval.start,
            interval.end,
          )
      if (!range) continue
      const side = wallRoleForRoomFace('interior', wall, candidateFace)
      if (side !== 'interior' && side !== 'exterior') continue
      candidates.push({
        wall,
        face: candidateFace,
        side,
        edgeIndex,
        intervalStart: interval.start,
        intervalEnd: interval.end,
        overlap: interval.overlap,
        wallLength,
        start: range.start,
        end: range.end,
        curved,
      })
    }

    if (candidates.length === 0) {
      continue
    }
    if (candidates.some((candidate) => candidate.curved)) {
      return {
        faces: [],
        boundaryError: manualBoundaryError(
          [zone.id, ...candidates.map((candidate) => candidate.wall.id)],
          'curved-wall-partial-finish-unsupported',
        ),
      }
    }

    for (const candidate of candidates) {
      claims.push(candidate)
    }
  }

  if (claims.length === 0) {
    return {
      faces: [],
      boundaryError: manualBoundaryError([zone.id]),
    }
  }
  const claimsByFace = new Map<string, ManualWallClaim[]>()
  for (const claim of claims) {
    const key = `${claim.wall.id}:${claim.face}`
    const entries = claimsByFace.get(key) ?? []
    entries.push(claim)
    claimsByFace.set(key, entries)
  }
  for (const [key, entries] of claimsByFace) {
    const sortedEntries = [...entries].sort((left, right) => left.start - right.start)
    for (let index = 1; index < sortedEntries.length; index += 1) {
      const previous = sortedEntries[index - 1]!
      const current = sortedEntries[index]!
      if (current.start < previous.end - MANUAL_BOUNDARY_OVERLAP_EPSILON) {
        return {
          faces: [],
          boundaryError: manualBoundaryError([
            zone.id,
            entries[0]?.wall.id ?? key,
            ...entries.map((entry) => entry.wall.id),
          ]),
        }
      }
    }
  }

  return {
    faces: claims.map((claim) => ({
      key: wallFaceKey(claim.wall.id, claim.face, claim.start, claim.end),
      wallId: claim.wall.id,
      face: claim.face,
      side: claim.side,
      start: claim.start,
      end: claim.end,
      roles: activeWallFaceSlotRoles(claim.wall, claim.face),
      segmentSignature: segmentSignature([claim.wall.start, claim.wall.end]),
      length: claim.wallLength,
    })),
  }
}

function asZone(node: AnyNode | undefined): ZoneNode | null {
  return node?.type === 'zone' ? (node as ZoneNode) : null
}

function asWall(node: AnyNode | undefined): WallNode | null {
  return node?.type === 'wall' ? (node as WallNode) : null
}

function asSlab(node: AnyNode | undefined): SlabNode | null {
  return node?.type === 'slab' ? (node as SlabNode) : null
}

function asCeiling(node: AnyNode | undefined): CeilingNode | null {
  return node?.type === 'ceiling' ? (node as CeilingNode) : null
}

function spaceIdentity(space: Space): string {
  return stableJson({
    levelId: space.levelId,
    polygon: polygonSignature(space.polygon),
    wallIds: boundaryWallSet(space.wallIds),
    boundaryFaces: space.boundaryFaces
      .map((face) => `${face.wallId}:${face.face}:${segmentSignature(face.points)}`)
      .sort(),
  })
}

function collisionSafeSpaces(values: Iterable<Space>): Record<string, Space> {
  const spaces: Record<string, Space> = {}
  const seen = new Set<string>()
  for (const space of values) {
    const identity = spaceIdentity(space)
    if (seen.has(identity)) continue
    seen.add(identity)
    const base = `space:${space.levelId}:${space.id || identity}`
    let key = base
    let suffix = 1
    while (spaces[key]) key = `${base}:${suffix++}`
    spaces[key] = space
  }
  return spaces
}

function deriveSpaces(nodes: Record<string, AnyNode>): Record<string, Space> {
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    const wall = asWall(node)
    if (!wall?.parentId) continue
    const walls = wallsByLevel.get(wall.parentId) ?? []
    walls.push(wall)
    wallsByLevel.set(wall.parentId, walls)
  }
  const detected: Space[] = []
  for (const [levelId, walls] of wallsByLevel) {
    detected.push(...detectSpacesForLevel(levelId, walls).spaces)
  }
  return collisionSafeSpaces(detected)
}

function resolveContext(args: ContextArgs): ZoneFinishContext {
  const scene = useScene.getState()
  const nodes = args.nodes ?? scene.nodes
  const derivedSpaces = deriveSpaces(nodes)
  const spaces = args.spaces
    ? collisionSafeSpaces([...Object.values(args.spaces), ...Object.values(derivedSpaces)])
    : derivedSpaces
  return {
    nodes,
    materials: args.materials ?? scene.materials,
    spaces,
    sceneId: args.sceneId,
  }
}

function boundaryWallSet(values: readonly string[]): string {
  return [...new Set(values)].sort().join(',')
}

function resolveZoneSpace(
  zone: ZoneNode,
  spaces: Record<string, Space>,
): { space: Space | null; ambiguousIds: string[] } {
  if (!validPolygon(zone.polygon)) return { space: null, ambiguousIds: [] }
  const candidates = Object.values(spaces).filter((space) => space.levelId === zone.parentId)
  const wallSet = boundaryWallSet(zone.boundaryWallIds)
  const boundaryMatches = candidates.filter(
    (space) =>
      wallSet.length > 0 &&
      boundaryWallSet(space.wallIds) === wallSet &&
      polygonEquivalent(space.polygon, zone.polygon),
  )
  if (boundaryMatches.length === 1) return { space: boundaryMatches[0]!, ambiguousIds: [] }
  if (boundaryMatches.length > 1) {
    return { space: null, ambiguousIds: boundaryMatches.map((space) => space.id) }
  }

  const polygonMatches = candidates.filter((space) =>
    polygonEquivalent(space.polygon, zone.polygon),
  )
  if (polygonMatches.length === 1) return { space: polygonMatches[0]!, ambiguousIds: [] }
  if (polygonMatches.length > 1) {
    return { space: null, ambiguousIds: polygonMatches.map((space) => space.id) }
  }
  return { space: null, ambiguousIds: [] }
}

function zoneWallFaces(
  zone: ZoneNode,
  context: ZoneFinishContext,
): {
  faces: ZoneFinishWallInspection[]
  ambiguousIds: string[]
  boundaryError?: ZoneFinishBoundaryError
} {
  const resolved = resolveZoneSpace(zone, context.spaces)
  if (!resolved.space) {
    if (resolved.ambiguousIds.length > 0) {
      return {
        faces: [],
        ambiguousIds: resolved.ambiguousIds,
        boundaryError: manualBoundaryError([zone.id, ...resolved.ambiguousIds]),
      }
    }
    const manual = manualWallFaces(zone, context)
    return { ...manual, ambiguousIds: [] }
  }

  const groupedFaces = new Map<string, ZoneFinishWallInspection[]>()
  const seen = new Set<string>()
  for (const boundary of resolved.space.boundaryFaces) {
    const wall = asWall(context.nodes[boundary.wallId])
    if (!wall || wall.parentId !== zone.parentId) continue
    if (hasUnsupportedCurvedPartialFinish(wall)) {
      return {
        faces: [],
        ambiguousIds: [],
        boundaryError: manualBoundaryError([wall.id], 'curved-wall-partial-finish-unsupported'),
      }
    }
    if (isCurvedWall(wall) && !curvedBoundaryCoversWholeWall(wall, boundary.points)) {
      return {
        faces: [],
        ambiguousIds: [],
        boundaryError: manualBoundaryError([wall.id], 'curved-wall-partial-finish-unsupported'),
      }
    }
    const signature = segmentSignature(boundary.points)
    const side = wallRoleForRoomFace('interior', wall, boundary.face)
    if (side !== 'interior' && side !== 'exterior') continue
    const range = normalizedWallRangeForPoints(wall, boundary.points) ?? {
      start: 0,
      end: 1,
    }
    const key = wallFaceKey(wall.id, boundary.face, range.start, range.end)
    const rangeKey = `${signature}:${range.start.toFixed(6)}:${range.end.toFixed(6)}`
    const seenKey = `${wall.id}:${boundary.face}:${side}:${rangeKey}`
    if (seen.has(seenKey)) continue
    seen.add(seenKey)
    const face: ZoneFinishWallInspection = {
      key,
      wallId: wall.id,
      face: boundary.face,
      side,
      start: range.start,
      end: range.end,
      roles: activeWallFaceSlotRoles(wall, boundary.face),
      segmentSignature: signature,
      length: segmentLength(boundary.points),
    }
    const groupKey = `${wall.id}:${boundary.face}:${side}:${face.roles.join('|')}`
    const group = groupedFaces.get(groupKey) ?? []
    group.push(face)
    groupedFaces.set(groupKey, group)
  }
  const faces = [...groupedFaces.values()].flatMap((entries) => {
    const merged: ZoneFinishWallInspection[] = []
    for (const face of [...entries].sort(
      (left, right) => (left.start ?? 0) - (right.start ?? 0) || (left.end ?? 1) - (right.end ?? 1),
    )) {
      const previous = merged.at(-1)
      if (!previous || (face.start ?? 0) > (previous.end ?? 1) + POINT_EPSILON) {
        merged.push(face)
        continue
      }
      const wall = asWall(context.nodes[previous.wallId])
      if (!wall) {
        merged.push(face)
        continue
      }
      const start = Math.min(previous.start ?? 0, face.start ?? 0)
      const end = Math.max(previous.end ?? 1, face.end ?? 1)
      const chordLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      merged[merged.length - 1] = {
        ...previous,
        key: wallFaceKey(previous.wallId, previous.face, start, end),
        start,
        end,
        segmentSignature: isCurvedWall(wall)
          ? previous.segmentSignature
          : segmentSignature([
              [
                wall.start[0] + (wall.end[0] - wall.start[0]) * start,
                wall.start[1] + (wall.end[1] - wall.start[1]) * start,
              ],
              [
                wall.start[0] + (wall.end[0] - wall.start[0]) * end,
                wall.start[1] + (wall.end[1] - wall.start[1]) * end,
              ],
            ]),
        length: isCurvedWall(wall) ? previous.length : chordLength * (end - start),
      }
    }
    return merged
  })
  return { faces, ambiguousIds: [] }
}

function zoneSurfaceFingerprint(
  zone: ZoneNode,
  faces: readonly ZoneFinishWallInspection[],
  floor: FloorResolution,
  ceiling?: CeilingResolution,
): ZoneSurfaceFingerprint {
  return {
    levelId: zone.parentId ?? '',
    zoneId: zone.id,
    polygonSignature: polygonSignature(zone.polygon),
    inwardWalls: faces.map((face) => ({
      wallId: face.wallId,
      face: face.face,
      ...(face.side ? { side: face.side } : {}),
      ...(face.start !== undefined ? { start: face.start } : {}),
      ...(face.end !== undefined ? { end: face.end } : {}),
      segmentSignature: face.segmentSignature,
      length: face.length,
      activeSlotRoles: [...face.roles],
    })),
    floor:
      floor.status === 'existing'
        ? { slabId: floor.slab.id, polygonSignature: polygonSignature(floor.slab.polygon) }
        : { createFromZone: true },
    ...(ceiling
      ? {
          ceiling:
            ceiling.status === 'existing'
              ? {
                  ceilingId: ceiling.ceiling.id,
                  polygonSignature: polygonSignature(ceiling.ceiling.polygon),
                }
              : { createFromZone: true },
        }
      : {}),
  }
}

function targetFingerprint(
  fingerprint: ZoneSurfaceFingerprint,
  kind: ZoneFinishTargetKind,
  wallKey?: ZoneFinishWallKey,
): string {
  return stableJson({ fingerprint, kind, wallKey: wallKey ?? null })
}

function markerMatchesZone(node: AnyNode, zoneId: string): boolean {
  const metadata = node.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const marker = (metadata as Record<string, unknown>).zoneFinish
  return Boolean(
    marker &&
      typeof marker === 'object' &&
      !Array.isArray(marker) &&
      (marker as Record<string, unknown>).version === 1 &&
      (marker as Record<string, unknown>).zoneId === zoneId,
  )
}

function resolveFloor(zone: ZoneNode, context: ZoneFinishContext): FloorResolution {
  if (!validPolygon(zone.polygon)) {
    return { status: 'blocked', reason: 'Zone polygon is invalid.', conflictIds: [zone.id] }
  }
  const levelSlabs = Object.values(context.nodes)
    .map(asSlab)
    .filter((slab): slab is SlabNode => Boolean(slab && slab.parentId === zone.parentId))
  const validSlabs = levelSlabs.filter((slab) => validPolygon(slab.polygon))
  const invalidSlabIds = levelSlabs
    .filter(
      (slab) =>
        !validPolygon(slab.polygon) || (slab.holes ?? []).some((hole) => !validPolygon(hole)),
    )
    .map((slab) => slab.id)
  if (invalidSlabIds.length > 0) {
    return {
      status: 'blocked',
      reason: 'A level Slab has an invalid polygon.',
      conflictIds: invalidSlabIds,
    }
  }

  const exact = validSlabs.filter((slab) => polygonEquivalent(slab.polygon, zone.polygon))
  if (exact.length > 1) {
    const marked = exact.filter((slab) => markerMatchesZone(slab, zone.id))
    if (marked.length === 1) {
      const slab = marked[0]!
      const holeConflicts = exact.filter((candidate) =>
        holeIntersectsPolygon(zone.polygon, candidate.holes ?? []),
      )
      if (holeConflicts.length > 0) {
        return {
          status: 'blocked',
          reason: 'The matching Slab has a hole in the Zone footprint.',
          conflictIds: holeConflicts.map((candidate) => candidate.id),
        }
      }
      const unsafe = validSlabs
        .filter(
          (candidate) =>
            candidate.id !== slab.id &&
            (polygonsOverlapByArea(candidate.polygon, zone.polygon) ||
              holeIntersectsPolygon(zone.polygon, candidate.holes ?? [])),
        )
        .filter(
          (candidate) =>
            !polygonContainsWithTolerance(candidate.polygon, zone.polygon) ||
            candidate.recessed ||
            holeIntersectsPolygon(zone.polygon, candidate.holes ?? []),
        )
      if (unsafe.length > 0) {
        return {
          status: 'blocked',
          reason: 'Overlapping Slabs must be resolved before applying a Zone floor finish.',
          conflictIds: unsafe.map((candidate) => candidate.id),
        }
      }
      return { status: 'existing', slab }
    }
    return {
      status: 'blocked',
      reason: 'More than one Slab matches this Zone footprint.',
      conflictIds: exact.map((slab) => slab.id),
    }
  }
  if (exact.length === 1) {
    const slab = exact[0]!
    if (holeIntersectsPolygon(zone.polygon, slab.holes ?? [])) {
      return {
        status: 'blocked',
        reason: 'The matching Slab has a hole in the Zone footprint.',
        conflictIds: [slab.id],
      }
    }
    const conflicting = validSlabs.filter(
      (candidate) =>
        candidate.id !== slab.id &&
        (polygonsOverlapByArea(candidate.polygon, zone.polygon) ||
          holeIntersectsPolygon(zone.polygon, candidate.holes ?? [])),
    )
    const unsafe = conflicting.filter(
      (candidate) =>
        !polygonContainsWithTolerance(candidate.polygon, zone.polygon) ||
        candidate.recessed ||
        holeIntersectsPolygon(zone.polygon, candidate.holes ?? []),
    )
    if (unsafe.length > 0) {
      return {
        status: 'blocked',
        reason: 'Overlapping Slabs must be resolved before applying a Zone floor finish.',
        conflictIds: unsafe.map((candidate) => candidate.id),
      }
    }
    return { status: 'existing', slab }
  }

  const containing = validSlabs.filter(
    (slab) =>
      polygonContainsWithTolerance(slab.polygon, zone.polygon) &&
      !slab.recessed &&
      !holeIntersectsPolygon(zone.polygon, slab.holes ?? []),
  )
  if (containing.length > 1) {
    return {
      status: 'blocked',
      reason: 'More than one containing Slab could support this Zone.',
      conflictIds: containing.map((slab) => slab.id),
    }
  }

  const overlapping = validSlabs.filter((slab) => {
    if (containing.some((candidate) => candidate.id === slab.id)) return false
    return (
      polygonsOverlapByArea(slab.polygon, zone.polygon) ||
      holeIntersectsPolygon(zone.polygon, slab.holes ?? [])
    )
  })
  if (overlapping.length > 0) {
    return {
      status: 'blocked',
      reason: 'Overlapping Slabs must be resolved before applying a Zone floor finish.',
      conflictIds: overlapping.map((slab) => slab.id),
    }
  }

  return { status: 'creatable', baseSlab: containing[0] }
}

function resolveCeiling(zone: ZoneNode, context: ZoneFinishContext): CeilingResolution {
  if (!validPolygon(zone.polygon)) {
    return { status: 'blocked', reason: 'Zone polygon is invalid.', conflictIds: [zone.id] }
  }
  const levelCeilings = Object.values(context.nodes)
    .map(asCeiling)
    .filter((ceiling): ceiling is CeilingNode =>
      Boolean(ceiling && ceiling.parentId === zone.parentId),
    )
  const invalidCeilingIds = levelCeilings
    .filter(
      (ceiling) =>
        !validPolygon(ceiling.polygon) || (ceiling.holes ?? []).some((hole) => !validPolygon(hole)),
    )
    .map((ceiling) => ceiling.id)
  if (invalidCeilingIds.length > 0) {
    return {
      status: 'blocked',
      reason: 'A level Ceiling has an invalid polygon.',
      conflictIds: invalidCeilingIds,
    }
  }

  const validCeilings = levelCeilings.filter((ceiling) => validPolygon(ceiling.polygon))
  const exact = validCeilings.filter((ceiling) => polygonEquivalent(ceiling.polygon, zone.polygon))
  if (exact.length > 1) {
    return {
      status: 'blocked',
      reason: 'More than one Ceiling matches this Zone footprint.',
      conflictIds: exact.map((ceiling) => ceiling.id),
    }
  }
  if (exact.length === 1) {
    const ceiling = exact[0]!
    if (holeIntersectsPolygon(zone.polygon, ceiling.holes ?? [])) {
      return {
        status: 'blocked',
        reason: 'The matching Ceiling has a hole in the Zone footprint.',
        conflictIds: [ceiling.id],
      }
    }
    const overlapping = validCeilings.filter(
      (candidate) =>
        candidate.id !== ceiling.id &&
        (polygonsOverlapByArea(candidate.polygon, zone.polygon) ||
          holeIntersectsPolygon(zone.polygon, candidate.holes ?? [])),
    )
    if (overlapping.length > 0) {
      return {
        status: 'blocked',
        reason: 'Overlapping Ceilings must be resolved before applying a Zone ceiling finish.',
        conflictIds: overlapping.map((candidate) => candidate.id),
      }
    }
    return { status: 'existing', ceiling }
  }

  const overlapping = validCeilings.filter(
    (ceiling) =>
      polygonsOverlapByArea(ceiling.polygon, zone.polygon) ||
      holeIntersectsPolygon(zone.polygon, ceiling.holes ?? []),
  )
  if (overlapping.length > 0) {
    return {
      status: 'blocked',
      reason: 'Overlapping Ceilings must be resolved before applying a Zone ceiling finish.',
      conflictIds: overlapping.map((ceiling) => ceiling.id),
    }
  }

  return { status: 'creatable' }
}

function explicitMaterialRef(
  node: AnyNode,
  role: string,
  materials: Record<string, SceneMaterialType>,
): string | null {
  const slots = (node as { slots?: Record<string, string> }).slots
  const ref = slots?.[role]
  if (typeof ref !== 'string' || ref.length === 0) return null
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) return materials[sceneId] ? ref : null
  const libraryId = getLibraryMaterialIdFromRef(ref)
  if (!libraryId || !getCatalogMaterialById(libraryId)) return null
  return ref
}

function explicitMaterialRefValue(
  ref: unknown,
  materials: Record<string, SceneMaterialType>,
): string | null {
  if (typeof ref !== 'string' || ref.length === 0) return null
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) return materials[sceneId] ? ref : null
  const libraryId = getLibraryMaterialIdFromRef(ref)
  if (!libraryId || !getCatalogMaterialById(libraryId)) return null
  return ref
}

function explicitWallMaterialRef(
  wall: WallNode,
  face: Pick<ZoneFinishWallInspection, 'side' | 'start' | 'end'>,
  role: string,
  materials: Record<string, SceneMaterialType>,
): string | null {
  const range = faceRange(face)
  const side = face.side ?? getWallSurfaceSideFromBandSlot(role)
  if (side) {
    const region = normalizeWallFinishRegions(wall.finishRegions ?? [])
      .filter(
        (candidate) =>
          candidate.side === side &&
          candidate.start <= range.start + POINT_EPSILON &&
          candidate.end >= range.end - POINT_EPSILON &&
          candidate.slots[role] !== undefined,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0]
    const regionRef = explicitMaterialRefValue(region?.slots[role], materials)
    if (regionRef) return regionRef
  }
  return explicitMaterialRef(wall, role, materials)
}

function makeInspection(
  zone: ZoneNode,
  kind: ZoneFinishTargetKind,
  wallKey: ZoneFinishWallKey | undefined,
  context: ZoneFinishContext,
): ZoneFinishInspection {
  const floor = resolveFloor(zone, context)
  const ceiling = resolveCeiling(zone, context)
  const wallResolution = zoneWallFaces(zone, context)
  const faces = wallResolution.faces
  const sourceFingerprint = zoneSurfaceFingerprint(
    zone,
    faces,
    floor,
    kind === 'ceiling' ? ceiling : undefined,
  )
  const target: CapturedZoneFinishTarget = {
    zoneId: zone.id,
    levelId: zone.parentId ?? '',
    kind,
    ...(wallKey ? { wallKey } : {}),
    fingerprint: targetFingerprint(sourceFingerprint, kind, wallKey),
  }

  const missing: Array<{ nodeId: string; role: string }> = []
  let explicit = 0
  const refs = new Set<string>()
  const selectedFaces =
    kind === 'wall' && wallKey
      ? faces.filter((face) => face.key === wallKey)
      : kind === 'walls'
        ? faces
        : []
  if (kind === 'wall') {
    if (!wallKey) missing.push({ nodeId: zone.id, role: 'wall-key' })
    else if (selectedFaces.length === 0) missing.push({ nodeId: zone.id, role: wallKey })
  }
  if (kind !== 'floor' && kind !== 'ceiling' && faces.length === 0) {
    if (wallResolution.boundaryError) {
      for (const nodeId of wallResolution.boundaryError.conflictIds.length > 0
        ? wallResolution.boundaryError.conflictIds
        : [zone.id]) {
        missing.push({ nodeId, role: wallResolution.boundaryError.code })
      }
    }
    const boundaryIds =
      wallResolution.ambiguousIds.length > 0 ? wallResolution.ambiguousIds : [zone.id]
    if (!wallResolution.boundaryError) {
      for (const nodeId of boundaryIds) missing.push({ nodeId, role: 'wall-boundary' })
    }
  }
  for (const face of selectedFaces) {
    const wall = asWall(context.nodes[face.wallId])
    if (!wall || wallFaceSideIsAmbiguous(wall)) {
      missing.push({ nodeId: face.wallId, role: face.key })
      continue
    }
    for (const role of face.roles) {
      const ref = explicitWallMaterialRef(wall, face, role, context.materials)
      if (ref) {
        explicit += 1
        refs.add(ref)
      } else {
        missing.push({ nodeId: face.wallId, role })
      }
    }
  }

  const floorSlab = floor.status === 'existing' ? floor.slab : null
  if (kind === 'floor') {
    if (floorSlab) {
      const ref = explicitMaterialRef(floorSlab, 'surface', context.materials)
      if (ref) {
        explicit += 1
        refs.add(ref)
      } else {
        missing.push({ nodeId: floorSlab.id, role: 'surface' })
      }
    } else {
      missing.push({
        nodeId: floor.status === 'blocked' ? (floor.conflictIds[0] ?? zone.id) : zone.id,
        role: 'floor',
      })
    }
  }
  if (kind === 'ceiling') {
    if (ceiling.status === 'existing') {
      const ref = explicitMaterialRef(ceiling.ceiling, 'surface', context.materials)
      if (ref) {
        explicit += 1
        refs.add(ref)
      } else {
        missing.push({ nodeId: ceiling.ceiling.id, role: 'surface' })
      }
    } else {
      missing.push({
        nodeId: ceiling.status === 'blocked' ? (ceiling.conflictIds[0] ?? zone.id) : zone.id,
        role: 'ceiling',
      })
    }
  }
  const wallTotal = selectedFaces.reduce((sum, face) => sum + face.roles.length, 0)
  const total = wallTotal + (kind === 'floor' || kind === 'ceiling' ? 1 : 0)
  return {
    target,
    wallFaces: faces,
    ...(wallResolution.boundaryError ? { boundaryError: wallResolution.boundaryError } : {}),
    floor:
      floor.status === 'blocked'
        ? { status: 'blocked', reason: floor.reason, conflictIds: floor.conflictIds }
        : floor.status === 'existing'
          ? { status: 'existing', slabId: floor.slab.id }
          : {
              status: 'creatable',
              ...(floor.baseSlab ? { baseSlabId: floor.baseSlab.id } : {}),
            },
    ceiling:
      ceiling.status === 'blocked'
        ? {
            status: 'blocked',
            reason: ceiling.reason,
            conflictIds: ceiling.conflictIds,
            explicit: false,
          }
        : ceiling.status === 'existing'
          ? {
              status: 'existing',
              ceilingId: ceiling.ceiling.id,
              explicit: explicitMaterialRef(ceiling.ceiling, 'surface', context.materials) !== null,
            }
          : { status: 'creatable', explicit: false },
    completion: { explicit, total, missing },
    materialRefs: [...refs],
    materialCount: refs.size,
  }
}

export function inspectZoneFinishTarget(args: {
  zoneId: string
  kind: ZoneFinishTargetKind
  wallKey?: ZoneFinishWallKey
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishInspection {
  const context = resolveContext(args)
  const zone = asZone(context.nodes[args.zoneId])
  if (!zone) {
    const target: CapturedZoneFinishTarget = {
      zoneId: args.zoneId,
      levelId: '',
      kind: args.kind,
      ...(args.wallKey ? { wallKey: args.wallKey } : {}),
      fingerprint: '',
    }
    return {
      target,
      wallFaces: [],
      floor: { status: 'blocked', reason: 'Zone not found.', conflictIds: [args.zoneId] },
      ceiling: {
        status: 'blocked',
        reason: 'Zone not found.',
        conflictIds: [args.zoneId],
        explicit: false,
      },
      completion: { explicit: 0, total: 0, missing: [{ nodeId: args.zoneId, role: 'zone' }] },
      materialRefs: [],
      materialCount: 0,
    }
  }
  return makeInspection(zone, args.kind, args.wallKey, context)
}

function materialFromCatalogRef(ref: string): PortableMaterialSnapshot | null {
  const id = getLibraryMaterialIdFromRef(ref)
  const catalog = id ? getCatalogMaterialById(id) : undefined
  if (!id || !catalog) return null
  return {
    label: catalog.label,
    preferredRef: ref as `library:${string}`,
    material: freezeHostMaterialCatalogItem(catalog),
  }
}

function portableMaterialForRef(
  ref: string,
  materials: Record<string, SceneMaterialType>,
): PortableMaterialSnapshot | null {
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) {
    const scene = materials[sceneId]
    if (!scene) return null
    return { label: scene.name, material: clone(scene.material) }
  }
  const libraryId = getLibraryMaterialIdFromRef(ref)
  if (libraryId && getCatalogMaterialById(libraryId)) return materialFromCatalogRef(ref)
  return null
}

function nodeVersion(node: AnyNode): string {
  return stableJson(node)
}

function finishContextFingerprint(
  nodes: Record<string, AnyNode>,
  zoneIds: readonly string[],
): string {
  const zones = zoneIds
    .map((zoneId) => asZone(nodes[zoneId]))
    .filter((zone): zone is ZoneNode => Boolean(zone))
    .sort((left, right) => left.id.localeCompare(right.id))
  const parentIds = [...new Set(zones.map((zone) => zone.parentId).filter(Boolean))].sort()
  const parents = parentIds.map((parentId) => ({
    id: parentId,
    version: nodeVersion(nodes[parentId as string] ?? ({ id: parentId } as AnyNode)),
  }))
  const slabs = Object.values(nodes)
    .map(asSlab)
    .filter((slab): slab is SlabNode =>
      Boolean(slab?.parentId && parentIds.includes(slab.parentId)),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((slab) => ({ id: slab.id, version: nodeVersion(slab) }))
  return stableJson({
    zones: zones.map((zone) => ({ id: zone.id, version: nodeVersion(zone) })),
    parents,
    slabs,
    ceilings: Object.values(nodes)
      .map(asCeiling)
      .filter((ceiling): ceiling is CeilingNode =>
        Boolean(ceiling?.parentId && parentIds.includes(ceiling.parentId)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((ceiling) => ({ id: ceiling.id, version: nodeVersion(ceiling) })),
  })
}

function selectedFacesForTarget(
  inspection: ZoneFinishInspection,
  target: CapturedZoneFinishTarget,
): ZoneFinishWallInspection[] | ZoneFinishError {
  if (target.kind === 'floor' || target.kind === 'ceiling') return []
  if (inspection.boundaryError) return { ok: false, ...inspection.boundaryError }
  if (target.kind === 'wall') {
    if (!target.wallKey) {
      return {
        ok: false,
        code: 'wall-key-required',
        message: 'A single wall target requires a wall face key.',
        conflictIds: [],
      }
    }
    const face = inspection.wallFaces.find((candidate) => candidate.key === target.wallKey)
    if (!face) {
      return {
        ok: false,
        code: 'wall-face-missing',
        message: 'The selected wall face is no longer part of this Zone.',
        conflictIds: [target.wallKey],
      }
    }
    return [face]
  }
  return [...inspection.wallFaces]
}

type MaterialInput = {
  material?: MaterialSchema
  materialPreset?: string
  label?: string
}

type PlanBuilder = {
  patches: Map<string, ZoneFinishNodePatch>
  creates: Array<{ node: AnyNode; parentId?: AnyNodeId }>
  materials: Map<string, SceneMaterialType>
  expected: Map<string, string>
}

function createBuilder(): PlanBuilder {
  return { patches: new Map(), creates: [], materials: new Map(), expected: new Map() }
}

function regionRangesOverlap(left: WallFinishRegion, start: number, end: number): boolean {
  return Math.min(left.end, end) - Math.max(left.start, start) > POINT_EPSILON
}

function replaceWallFinishRegionRoles(args: {
  wall: WallNode
  zoneId: string
  face: ZoneFinishWallInspection
  refs: Record<string, string>
}): ZoneFinishError | { regions: WallFinishRegion[]; full: boolean } {
  const side = args.face.side ?? wallRoleForRoomFace('interior', args.wall, args.face.face)
  if (side !== 'interior' && side !== 'exterior') {
    return templateFailure(
      'ambiguous-wall-side',
      'A wall face has no distinct semantic side for a Zone finish.',
      [args.wall.id],
    )
  }
  const range = faceRange(args.face)
  if (range.start < 0 || range.end > 1 || range.end - range.start <= POINT_EPSILON) {
    return templateFailure('wall-range-invalid', 'The Zone wall range is invalid.', [args.wall.id])
  }
  const parsed = WallFinishRegionSchema.array().safeParse(args.wall.finishRegions ?? [])
  if (!parsed.success) {
    return templateFailure('finish-region-invalid', 'The wall contains an invalid finish region.', [
      args.wall.id,
    ])
  }
  const existing = normalizeWallFinishRegions(parsed.data)
  const full = range.start <= POINT_EPSILON && range.end >= 1 - POINT_EPSILON
  if (isCurvedWall(args.wall) && !full) {
    return templateFailure(
      'curved-wall-partial-finish-unsupported',
      MANUAL_CURVED_BOUNDARY_MESSAGE,
      [args.wall.id],
    )
  }
  const targetId = `zone-finish:${args.zoneId}:${args.wall.id}:${args.face.face}:${range.start.toFixed(6)}:${range.end.toFixed(6)}`
  const next: WallFinishRegion[] = []
  let updatedTarget = false
  for (const region of existing) {
    const sameRange =
      region.side === side &&
      Math.abs(region.start - range.start) <= POINT_EPSILON &&
      Math.abs(region.end - range.end) <= POINT_EPSILON
    const matchingRoles = Object.keys(args.refs).filter((role) => region.slots[role] !== undefined)
    const overlaps =
      region.side === side &&
      matchingRoles.length > 0 &&
      regionRangesOverlap(region, range.start, range.end)
    if (region.id === targetId && !sameRange) {
      return templateFailure(
        'finish-region-conflict',
        'The Zone finish region identity is already used by another span.',
        [region.id],
      )
    }
    if (overlaps && !(region.id === targetId && sameRange)) {
      return templateFailure(
        'finish-region-conflict',
        'The Zone wall range overlaps an existing finish region.',
        [region.id, args.wall.id],
      )
    }
    if (!(region.id === targetId && sameRange)) {
      next.push(region)
      continue
    }
    updatedTarget = true
    const slots = full
      ? Object.fromEntries(
          Object.entries(region.slots).filter(([role]) => args.refs[role] === undefined),
        )
      : { ...region.slots, ...args.refs }
    if (Object.keys(slots).length > 0) next.push({ ...region, slots })
  }
  if (!full && !updatedTarget) {
    next.push({ id: targetId, side, start: range.start, end: range.end, slots: args.refs })
  }
  const normalized = normalizeWallFinishRegions(next)
  const validation = validateWallFinishRegions(normalized)
  if (!validation.ok) {
    return templateFailure(
      'finish-region-conflict',
      'The Zone wall range overlaps an existing finish region.',
      validation.regionIds,
    )
  }
  return { regions: normalized, full }
}

function builderAddPatch(
  builder: PlanBuilder,
  node: AnyNode,
  data: Partial<AnyNode>,
): ZoneFinishError | null {
  const existing = builder.patches.get(node.id)
  const nextSlots = (data as { slots?: Record<string, string> }).slots
  if (nextSlots) {
    const originalSlots = (node as { slots?: Record<string, string> }).slots ?? {}
    const existingSlots =
      (existing?.data as { slots?: Record<string, string> } | undefined)?.slots ?? originalSlots
    const updates = Object.fromEntries(
      Object.entries(nextSlots).filter(
        ([role, ref]) => originalSlots[role] !== ref || !(role in originalSlots),
      ),
    )
    for (const [role, ref] of Object.entries(updates)) {
      const previous = existingSlots[role]
      const previousWasPlanned =
        previous !== undefined &&
        (originalSlots[role] === undefined || previous !== originalSlots[role])
      if (previousWasPlanned && previous !== ref) {
        return {
          ok: false,
          code: 'slot-collision',
          message: 'Two Zone finish operations target the same slot with different materials.',
          conflictIds: [`${node.id}:${role}`],
        }
      }
    }
    builder.patches.set(node.id, {
      id: node.id as AnyNodeId,
      data: {
        ...(existing?.data as Record<string, unknown> | undefined),
        ...(data as Record<string, unknown>),
        slots: { ...originalSlots, ...existingSlots, ...updates },
      } as Partial<AnyNode>,
    })
  } else {
    builder.patches.set(node.id, {
      id: node.id as AnyNodeId,
      data: {
        ...(existing?.data as Record<string, unknown> | undefined),
        ...(data as Record<string, unknown>),
      } as Partial<AnyNode>,
    })
  }
  if (!builder.expected.has(node.id)) builder.expected.set(node.id, nodeVersion(node))
  return null
}

function builderAddWallFacePatch(
  builder: PlanBuilder,
  wall: WallNode,
  zoneId: string,
  face: ZoneFinishWallInspection,
  refs: Record<string, string>,
): ZoneFinishError | null {
  const existing = builder.patches.get(wall.id)
  const existingRegions =
    (existing?.data as { finishRegions?: WallFinishRegion[] } | undefined)?.finishRegions ??
    wall.finishRegions ??
    []
  const result = replaceWallFinishRegionRoles({
    wall: { ...wall, finishRegions: existingRegions },
    zoneId,
    face,
    refs,
  })
  if (!('regions' in result)) return result
  const slots = result.full ? refs : undefined
  return builderAddPatch(builder, wall, {
    finishRegions: result.regions,
    ...(slots ? { slots } : {}),
  })
}

function builderAddCreate(
  builder: PlanBuilder,
  node: AnyNode,
  parentId?: AnyNodeId,
): ZoneFinishError | null {
  if (builder.creates.some((entry) => entry.node.id === node.id)) {
    return {
      ok: false,
      code: 'duplicate-node',
      message: 'A Zone finish plan attempted to create the same node twice.',
      conflictIds: [node.id],
    }
  }
  builder.creates.push({ node, parentId })
  return null
}

function builderMaterialRef(
  builder: PlanBuilder,
  context: ZoneFinishContext,
  input: MaterialInput,
): { ref: string; material?: SceneMaterialType } | ZoneFinishError {
  const parsed = input.material ? MaterialSchemaSchema.safeParse(input.material) : null
  if (parsed && !parsed.success) {
    return {
      ok: false,
      code: 'material-invalid',
      message: 'The selected material snapshot is invalid.',
      conflictIds: [],
    }
  }

  const preset = input.materialPreset?.trim()
  if (preset) {
    const sceneId = getSceneMaterialIdFromRef(preset)
    if (sceneId) {
      if (context.materials[sceneId] && !parsed?.success) return { ref: preset }
      if (!parsed?.success) {
        return {
          ok: false,
          code: 'scene-material-missing',
          message: 'The selected scene material is no longer available.',
          conflictIds: [sceneId],
        }
      }
    } else {
      const libraryId = getLibraryMaterialIdFromRef(preset)
      if (libraryId) {
        if (getCatalogMaterialById(libraryId) && !parsed?.success) return { ref: preset }
        if (!parsed?.success) {
          return {
            ok: false,
            code: 'library-material-missing',
            message: 'The selected library material is no longer available.',
            conflictIds: [libraryId],
          }
        }
      } else if (getCatalogMaterialById(preset)) {
        if (!parsed?.success) return { ref: `library:${preset}` }
      } else if (!parsed?.success) {
        return {
          ok: false,
          code: 'material-ref-invalid',
          message: 'The selected material reference is invalid.',
          conflictIds: [preset],
        }
      }
    }
  }

  if (!parsed?.success) {
    return {
      ok: false,
      code: 'material-missing',
      message: 'A Zone finish material is required.',
      conflictIds: [],
    }
  }
  const existing = [
    ...Object.values(context.materials),
    ...Object.values(Object.fromEntries(builder.materials)),
  ].find((candidate) => materialsEqual(candidate.material, parsed.data))
  if (existing) return { ref: toSceneMaterialRef(existing.id), material: existing }

  const id = generateSceneMaterialId()
  const material: SceneMaterialType = {
    id,
    name:
      input.label?.trim() || parsed.data.source?.externalId || parsed.data.preset || 'Zone finish',
    material: clone(parsed.data),
  }
  builder.materials.set(id, material)
  return { ref: toSceneMaterialRef(id), material }
}

function createFinishSlab(zone: ZoneNode, baseSlab: SlabNode | undefined, ref: string): SlabNode {
  const elevation = baseSlab ? baseSlab.elevation + MIN_SLAB_THICKNESS : 0.05
  return SlabNodeSchema.parse({
    id: generateId('slab'),
    name: zone.name?.trim() ? `${zone.name.trim()} finish` : 'Zone finish',
    parentId: zone.parentId ?? null,
    polygon: clone(zone.polygon),
    holes: [],
    construction: [],
    elevation,
    thickness: MIN_SLAB_THICKNESS,
    recessed: false,
    autoFromWalls: false,
    slots: { surface: ref },
    metadata: { zoneFinish: { version: 1, zoneId: zone.id } },
  })
}

function addFloorMaterial(
  builder: PlanBuilder,
  context: ZoneFinishContext,
  zone: ZoneNode,
  floor: FloorResolution,
  ref: string,
): ZoneFinishError | null {
  if (floor.status === 'blocked') {
    return {
      ok: false,
      code: 'floor-blocked',
      message: floor.reason,
      conflictIds: floor.conflictIds,
    }
  }
  if (floor.status === 'existing') {
    return builderAddPatch(builder, floor.slab, {
      slots: { ...(floor.slab.slots ?? {}), surface: ref },
    })
  }
  const slab = createFinishSlab(zone, floor.baseSlab, ref)
  if (context.nodes[slab.id]) {
    return {
      ok: false,
      code: 'node-id-conflict',
      message: 'A generated Zone finish Slab id already exists.',
      conflictIds: [slab.id],
    }
  }
  return builderAddCreate(builder, slab, zone.parentId as AnyNodeId | undefined)
}

function createFinishCeiling(zone: ZoneNode, ref: string): CeilingNode {
  return CeilingNodeSchema.parse({
    id: generateId('ceiling'),
    name: zone.name?.trim() ? `${zone.name.trim()} finish` : 'Zone finish',
    parentId: zone.parentId ?? null,
    polygon: clone(zone.polygon),
    holes: [],
    construction: [],
    autoFromWalls: false,
    slots: { surface: ref },
    metadata: { zoneFinish: { version: 1, zoneId: zone.id } },
  })
}

function addCeilingMaterial(
  builder: PlanBuilder,
  context: ZoneFinishContext,
  zone: ZoneNode,
  ceiling: CeilingResolution,
  ref: string,
): ZoneFinishError | null {
  if (ceiling.status === 'blocked') {
    return {
      ok: false,
      code: 'ceiling-blocked',
      message: ceiling.reason,
      conflictIds: ceiling.conflictIds,
    }
  }
  if (ceiling.status === 'existing') {
    return builderAddPatch(builder, ceiling.ceiling, {
      slots: { ...(ceiling.ceiling.slots ?? {}), surface: ref },
    })
  }
  const created = createFinishCeiling(zone, ref)
  if (context.nodes[created.id]) {
    return {
      ok: false,
      code: 'node-id-conflict',
      message: 'A generated Zone finish Ceiling id already exists.',
      conflictIds: [created.id],
    }
  }
  return builderAddCreate(builder, created, zone.parentId as AnyNodeId | undefined)
}

function builderResult(
  builder: PlanBuilder,
  target: CapturedZoneFinishTarget,
  materialRef: string,
  fingerprint: string,
  expectedContextFingerprint?: string,
  expectedContextZoneIds?: string[],
): ZoneFinishApplyResult {
  return {
    ok: true,
    plan: {
      target,
      fingerprint,
      nodePatches: [...builder.patches.values()],
      createNodes: [...builder.creates],
      materials: [...builder.materials.values()],
      materialRef,
      expectedNodeVersions: Object.fromEntries(builder.expected),
      ...(expectedContextFingerprint ? { expectedContextFingerprint } : {}),
      ...(expectedContextZoneIds ? { expectedContextZoneIds: [...expectedContextZoneIds] } : {}),
    },
  }
}

export function planZoneFinishApply(args: {
  target: CapturedZoneFinishTarget
  material?: MaterialSchema
  materialPreset?: string
  materialLabel?: string
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishApplyResult {
  const context = resolveContext(args)
  const zone = asZone(context.nodes[args.target.zoneId])
  if (!zone) {
    return {
      ok: false,
      code: 'zone-missing',
      message: 'The selected Zone no longer exists.',
      conflictIds: [args.target.zoneId],
    }
  }
  const inspection = makeInspection(zone, args.target.kind, args.target.wallKey, context)
  if (inspection.target.fingerprint !== args.target.fingerprint) {
    return {
      ok: false,
      code: 'stale-target',
      message: 'The Zone finish target changed before the material was ready.',
      conflictIds: [args.target.zoneId],
    }
  }
  if (args.target.kind === 'floor' && inspection.floor.status === 'blocked') {
    return {
      ok: false,
      code: 'floor-blocked',
      message: inspection.floor.reason,
      conflictIds: inspection.floor.conflictIds,
    }
  }
  if (args.target.kind === 'ceiling' && inspection.ceiling.status === 'blocked') {
    return {
      ok: false,
      code: 'ceiling-blocked',
      message: inspection.ceiling.reason,
      conflictIds: inspection.ceiling.conflictIds,
    }
  }
  const selected = selectedFacesForTarget(inspection, args.target)
  if (!Array.isArray(selected)) return selected
  if (args.target.kind !== 'floor' && args.target.kind !== 'ceiling' && selected.length === 0) {
    return {
      ok: false,
      code: 'wall-faces-missing',
      message: 'No inward wall faces could be resolved for this Zone.',
      conflictIds: [args.target.zoneId],
    }
  }
  const builder = createBuilder()
  const material = builderMaterialRef(builder, context, {
    material: args.material,
    materialPreset: args.materialPreset,
    label: args.materialLabel,
  })
  if (isZoneFinishError(material)) return material

  for (const face of selected) {
    const wall = asWall(context.nodes[face.wallId])
    if (!wall) continue
    if (wallFaceSideIsAmbiguous(wall)) {
      return {
        ok: false,
        code: 'ambiguous-wall-side',
        message:
          'This wall reports the same semantic side on both faces; Zone finish is blocked to protect the opposite face.',
        conflictIds: [wall.id],
      }
    }
    const slots = Object.fromEntries(face.roles.map((role) => [role, material.ref]))
    const failure = builderAddWallFacePatch(builder, wall, zone.id, face, slots)
    if (failure) return failure
  }
  if (args.target.kind === 'floor') {
    const floor = resolveFloor(zone, context)
    const failure = addFloorMaterial(builder, context, zone, floor, material.ref)
    if (failure) return failure
  }
  if (args.target.kind === 'ceiling') {
    const ceiling = resolveCeiling(zone, context)
    const failure = addCeilingMaterial(builder, context, zone, ceiling, material.ref)
    if (failure) return failure
  }
  const needsSurfaceContext = args.target.kind === 'floor' || args.target.kind === 'ceiling'
  return builderResult(
    builder,
    args.target,
    material.ref,
    inspection.target.fingerprint,
    needsSurfaceContext ? finishContextFingerprint(context.nodes, [zone.id]) : undefined,
    needsSurfaceContext ? [zone.id] : undefined,
  )
}

export function applyMaterialToCapturedZoneTarget(args: {
  target: CapturedZoneFinishTarget
  material?: MaterialSchema
  materialPreset?: string
  materialLabel?: string
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishApplyResult {
  return planZoneFinishApply(args)
}

export function commitZoneFinishApply(
  plan: ZoneFinishApplyPlan,
  sceneStore: typeof useScene = useScene,
): ZoneFinishApplyResult {
  const state = sceneStore.getState()
  if (state.readOnly) {
    return {
      ok: false,
      code: 'scene-read-only',
      message: 'The current scene is read-only.',
      conflictIds: [],
    }
  }
  for (const [id, version] of Object.entries(plan.expectedNodeVersions)) {
    const node = state.nodes[id as AnyNodeId]
    if (!node || nodeVersion(node) !== version) {
      return {
        ok: false,
        code: 'stale-target',
        message: 'The Zone changed before the finish was committed.',
        conflictIds: [id],
      }
    }
  }
  if (plan.expectedContextFingerprint) {
    const zoneIds = plan.expectedContextZoneIds ?? [plan.target.zoneId]
    if (finishContextFingerprint(state.nodes, zoneIds) !== plan.expectedContextFingerprint) {
      return {
        ok: false,
        code: 'stale-target',
        message: 'The Zone floor context changed before the finish was committed.',
        conflictIds: [plan.target.zoneId],
      }
    }
  }
  const plannedMaterialIds = new Set(plan.materials.map((material) => material.id))
  const stateMaterials = state.materials as Record<string, SceneMaterialType>
  for (const material of plan.materials) {
    if (!MaterialSchemaSchema.safeParse(material.material).success) {
      return {
        ok: false,
        code: 'material-invalid',
        message: 'A Zone finish material became invalid before commit.',
        conflictIds: [material.id],
      }
    }
    const existing = stateMaterials[material.id]
    if (existing && !materialsEqual(existing.material, material.material)) {
      return {
        ok: false,
        code: 'material-id-conflict',
        message: 'A Zone finish material id is already used by a different material.',
        conflictIds: [material.id],
      }
    }
  }
  const validMaterialRef = (ref: string): boolean => {
    const sceneId = getSceneMaterialIdFromRef(ref)
    if (sceneId) return Boolean(stateMaterials[sceneId] || plannedMaterialIds.has(sceneId))
    const libraryId = getLibraryMaterialIdFromRef(ref)
    return Boolean(libraryId && getCatalogMaterialById(libraryId))
  }
  for (const patch of plan.nodePatches) {
    const slots = (patch.data as { slots?: Record<string, string> }).slots
    const finishRegions = (patch.data as { finishRegions?: WallFinishRegion[] }).finishRegions
    if (finishRegions) {
      const parsed = WallFinishRegionSchema.array().safeParse(finishRegions)
      if (!parsed.success || !validateWallFinishRegions(parsed.data).ok) {
        return {
          ok: false,
          code: 'finish-region-invalid',
          message: 'A Zone finish patch contains invalid wall regions.',
          conflictIds: [patch.id],
        }
      }
    }
    if (slots) {
      for (const ref of Object.values(slots)) {
        if (!validMaterialRef(ref)) {
          return {
            ok: false,
            code: 'material-ref-invalid',
            message: 'A Zone finish slot references an unavailable material.',
            conflictIds: [patch.id],
          }
        }
      }
    }
    /* Region refs are checked independently because their slots do not live in
       the node's fallback slot map. */
    for (const ref of (finishRegions ?? []).flatMap((region) => Object.values(region.slots))) {
      if (!validMaterialRef(ref)) {
        return {
          ok: false,
          code: 'material-ref-invalid',
          message: 'A Zone finish slot references an unavailable material.',
          conflictIds: [patch.id],
        }
      }
    }
  }
  const plannedNodeIds = new Set(plan.createNodes.map((entry) => entry.node.id))
  for (const entry of plan.createNodes) {
    if (entry.parentId && !state.nodes[entry.parentId] && !plannedNodeIds.has(entry.parentId)) {
      return {
        ok: false,
        code: 'parent-missing',
        message: 'A Zone finish node parent no longer exists.',
        conflictIds: [entry.parentId],
      }
    }
    const slots = (entry.node as { slots?: Record<string, string> }).slots
    if (slots && Object.values(slots).some((ref) => !validMaterialRef(ref))) {
      return {
        ok: false,
        code: 'material-ref-invalid',
        message: 'A generated Zone finish node references an unavailable material.',
        conflictIds: [entry.node.id],
      }
    }
    const finishRegions = (entry.node as { finishRegions?: WallFinishRegion[] }).finishRegions
    if (finishRegions) {
      const parsed = WallFinishRegionSchema.array().safeParse(finishRegions)
      if (!parsed.success || !validateWallFinishRegions(parsed.data).ok) {
        return {
          ok: false,
          code: 'finish-region-invalid',
          message: 'A generated Zone finish node contains invalid wall regions.',
          conflictIds: [entry.node.id],
        }
      }
      if (
        parsed.data.some((region) =>
          Object.values(region.slots).some((ref) => !validMaterialRef(ref)),
        )
      ) {
        return {
          ok: false,
          code: 'material-ref-invalid',
          message: 'A generated wall finish region references an unavailable material.',
          conflictIds: [entry.node.id],
        }
      }
    }
  }
  for (const entry of plan.createNodes) {
    if (state.nodes[entry.node.id]) {
      return {
        ok: false,
        code: 'node-id-conflict',
        message: 'A Zone finish node id is already in use.',
        conflictIds: [entry.node.id],
      }
    }
  }

  try {
    runAsSingleSceneHistoryStep(sceneStore, () => {
      for (const material of plan.materials) sceneStore.getState().addSceneMaterial(material)
      for (const entry of plan.createNodes)
        sceneStore.getState().createNode(entry.node, entry.parentId)
      if (plan.nodePatches.length > 0) sceneStore.getState().updateNodes(plan.nodePatches)
    })
  } catch (error) {
    return {
      ok: false,
      code: 'commit-failed',
      message: error instanceof Error ? error.message : 'Zone finish commit failed.',
      conflictIds: [],
    }
  }
  return { ok: true, plan }
}

function fingerprintObjectsEqual(
  left: ZoneSurfaceFingerprint,
  right: ZoneSurfaceFingerprint,
): boolean {
  return stableJson(left) === stableJson(right)
}

function fingerprintForInspection(
  zone: ZoneNode,
  inspection: ZoneFinishInspection,
  context: ZoneFinishContext,
  includeCeiling = false,
): ZoneSurfaceFingerprint {
  const floor = resolveFloor(zone, context)
  const ceiling = includeCeiling ? resolveCeiling(zone, context) : undefined
  const faces = inspection.wallFaces
  return zoneSurfaceFingerprint(zone, faces, floor, ceiling)
}

function portableToMaterialInput(snapshot: PortableMaterialSnapshot): MaterialInput {
  return {
    material: snapshot.material,
    materialPreset: snapshot.preferredRef,
    label: snapshot.label,
  }
}

function templateFailure(
  code: string,
  message: string,
  conflictIds: string[] = [],
): ZoneFinishError {
  return { ok: false, code, message, conflictIds }
}

function portableMaterialIsValid(snapshot: PortableMaterialSnapshot): boolean {
  if (!snapshot || typeof snapshot.label !== 'string') return false
  if (!MaterialSchemaSchema.safeParse(snapshot.material).success) return false
  return ![snapshot.material.texture?.url, snapshot.material.texture?.bumpUrl].some(
    (url) => typeof url === 'string' && url.startsWith('blob:'),
  )
}

function validateTemplateShape(template: ZoneFinishTemplateSnapshot): ZoneFinishError | null {
  if (template.version !== 1 || !template.id || !template.name || !template.source?.fingerprint) {
    return templateFailure('template-invalid', 'The Zone finish template is invalid.')
  }
  if (
    !Array.isArray(template.walls) ||
    template.walls.length === 0 ||
    template.walls.some((wall) => !Array.isArray(wall.slots) || wall.slots.length === 0)
  ) {
    return templateFailure('template-invalid', 'The Zone finish template has invalid wall slots.')
  }
  const wallIdentities = new Set<string>()
  for (const wall of template.walls) {
    const sourceFace = wall.sourceFace
    if (!wallFaceKeyMatchesFingerprint(sourceFace.key, sourceFace)) {
      return templateFailure('template-invalid', 'A template wall face key is invalid.', [
        sourceFace.key,
      ])
    }
    const range = { start: sourceFace.start ?? 0, end: sourceFace.end ?? 1 }
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.start < 0 ||
      range.end > 1 ||
      range.end - range.start <= POINT_EPSILON
    ) {
      return templateFailure('template-invalid', 'A template wall range is invalid.', [
        sourceFace.key,
      ])
    }
    const identity = templateWallIdentity(sourceFace)
    if (wallIdentities.has(identity)) {
      return templateFailure('template-invalid', 'A template wall face is duplicated.', [
        sourceFace.key,
      ])
    }
    wallIdentities.add(identity)
  }
  if (Boolean(template.source.fingerprint.ceiling) !== Boolean(template.ceiling)) {
    return templateFailure(
      'template-invalid',
      'A ceiling material snapshot and fingerprint must be provided together.',
    )
  }
  const materialSnapshots = [
    ...template.walls.flatMap((wall) => wall.slots.map((slot) => slot.material)),
    template.floor,
    ...(template.ceiling ? [template.ceiling] : []),
  ]
  for (const snapshot of materialSnapshots) {
    if (!portableMaterialIsValid(snapshot)) {
      return templateFailure(
        'template-invalid',
        'The Zone finish template contains an invalid material snapshot.',
      )
    }
  }
  return null
}

function templateWallKey(face: ZoneFinishTemplateWall['sourceFace']): ZoneFinishWallKey {
  return wallFaceKey(face.wallId, face.face, face.start ?? 0, face.end ?? 1)
}

function templateWallIdentity(
  face: Pick<ZoneSurfaceWallFingerprint, 'wallId' | 'face' | 'side' | 'start' | 'end'> & {
    activeSlotRoles?: string[]
  },
): string {
  const side =
    face.side ??
    (face.activeSlotRoles
      ? getWallSurfaceSideFromBandSlot(face.activeSlotRoles[0] ?? '')
      : undefined)
  return stableJson({
    key: `${face.wallId}:${face.face}`,
    side: side ?? null,
    start: face.start ?? 0,
    end: face.end ?? 1,
  })
}

function buildTemplatePlan(
  template: ZoneFinishTemplateSnapshot,
  targetZoneId: string,
  args: {
    wallMapping?: Record<string, string>
    uniformWallMaterial?: PortableMaterialSnapshot
    forceMapping?: boolean
  } & ContextArgs,
): ZoneFinishApplyResult {
  const shapeFailure = validateTemplateShape(template)
  if (shapeFailure) return shapeFailure
  const context = resolveContext(args)
  const zone = asZone(context.nodes[targetZoneId])
  if (!zone)
    return templateFailure('zone-missing', 'The target Zone no longer exists.', [targetZoneId])
  const inspection = makeInspection(zone, 'walls', undefined, context)
  if (inspection.boundaryError) return { ok: false, ...inspection.boundaryError }
  if (inspection.floor.status === 'blocked') {
    return templateFailure('floor-blocked', inspection.floor.reason, inspection.floor.conflictIds)
  }
  if (template.ceiling && inspection.ceiling.status === 'blocked') {
    return templateFailure(
      'ceiling-blocked',
      inspection.ceiling.reason,
      inspection.ceiling.conflictIds,
    )
  }
  const targetFaces = [...inspection.wallFaces]
  const sourceFaces = template.walls
  const sameScene =
    typeof template.source.sceneId === 'string' &&
    template.source.sceneId.length > 0 &&
    typeof context.sceneId === 'string' &&
    context.sceneId.length > 0 &&
    template.source.sceneId === context.sceneId
  const exact =
    !args.forceMapping &&
    sameScene &&
    template.source.zoneId === targetZoneId &&
    fingerprintObjectsEqual(
      template.source.fingerprint,
      fingerprintForInspection(zone, inspection, context, Boolean(template.ceiling)),
    )
  const uniform = args.uniformWallMaterial
  if (!exact && !uniform && !args.wallMapping) {
    return templateFailure(
      'mapping-required',
      'This Zone changed; map each source wall face or choose one uniform wall material.',
      [targetZoneId],
    )
  }

  const builder = createBuilder()
  const materialCache = new Map<string, string>()
  const resolveSnapshot = (snapshot: PortableMaterialSnapshot) => {
    const key = stableJson(snapshot)
    const cached = materialCache.get(key)
    if (cached) return { ref: cached }
    const material = builderMaterialRef(builder, context, portableToMaterialInput(snapshot))
    if (isZoneFinishError(material)) return material
    materialCache.set(key, material.ref)
    return material
  }

  const sourceByIdentity = new Map(
    sourceFaces.map((face) => [templateWallIdentity(face.sourceFace), face]),
  )
  const usedSourceKeys = new Set<string>()
  for (const targetFace of targetFaces) {
    let sourceFace: ZoneFinishTemplateWall | undefined
    if (exact) {
      sourceFace = sourceByIdentity.get(templateWallIdentity(targetFace))
    } else if (args.wallMapping) {
      sourceFace = sourceFaces.find(
        (candidate) =>
          (args.wallMapping![templateWallIdentity(candidate.sourceFace)] ??
            args.wallMapping![templateWallKey(candidate.sourceFace)]) === targetFace.key,
      )
    }
    if (!uniform && !sourceFace) {
      return templateFailure(
        'mapping-incomplete',
        'Every target wall face needs one source mapping.',
        [targetFace.key],
      )
    }
    if (sourceFace) {
      const sourceKey = templateWallIdentity(sourceFace.sourceFace)
      if (usedSourceKeys.has(sourceKey)) {
        return templateFailure(
          'mapping-duplicate',
          'A template wall face is mapped more than once.',
          [sourceKey],
        )
      }
      usedSourceKeys.add(sourceKey)
    }
    const wall = asWall(context.nodes[targetFace.wallId])
    if (!wall)
      return templateFailure('wall-missing', 'A target wall no longer exists.', [targetFace.wallId])
    if (wallFaceSideIsAmbiguous(wall)) {
      return templateFailure(
        'ambiguous-wall-side',
        'A target wall has the same semantic side on both faces.',
        [targetFace.wallId],
      )
    }
    const sourceSlots = new Map(sourceFace?.slots.map((slot) => [slot.role, slot.material]) ?? [])
    const roles = new Set(targetFace.roles)
    if (sourceFace && !uniform) {
      const sourceRoles = new Set(sourceFace.sourceFace.activeSlotRoles)
      if (sourceRoles.size !== roles.size || [...sourceRoles].some((role) => !roles.has(role))) {
        return templateFailure(
          'band-mismatch',
          'The source and target wall faces have different active bands.',
          [targetFace.key],
        )
      }
    }
    const slots: Record<string, string> = {}
    for (const role of targetFace.roles) {
      const snapshot = uniform ?? sourceSlots.get(role)
      if (!snapshot)
        return templateFailure(
          'template-incomplete',
          `Missing material for ${targetFace.key}:${role}.`,
          [targetFace.key],
        )
      const material = resolveSnapshot(snapshot)
      if (isZoneFinishError(material)) return material
      slots[role] = material.ref
    }
    const failure = builderAddWallFacePatch(builder, wall, targetZoneId, targetFace, slots)
    if (failure) return failure
  }
  if (!uniform && !exact && args.wallMapping) {
    if (usedSourceKeys.size !== sourceFaces.length || targetFaces.length !== sourceFaces.length) {
      return templateFailure('mapping-incomplete', 'Wall mapping must be one-to-one.', [
        targetZoneId,
      ])
    }
  }

  const floorMaterial = resolveSnapshot(template.floor)
  if (isZoneFinishError(floorMaterial)) return floorMaterial
  const floorFailure = addFloorMaterial(
    builder,
    context,
    zone,
    resolveFloor(zone, context),
    floorMaterial.ref,
  )
  if (floorFailure) return floorFailure
  if (template.ceiling) {
    if (inspection.ceiling.status === 'blocked') {
      return templateFailure(
        'ceiling-blocked',
        inspection.ceiling.reason,
        inspection.ceiling.conflictIds,
      )
    }
    const ceilingMaterial = resolveSnapshot(template.ceiling)
    if (isZoneFinishError(ceilingMaterial)) return ceilingMaterial
    const ceilingFailure = addCeilingMaterial(
      builder,
      context,
      zone,
      resolveCeiling(zone, context),
      ceilingMaterial.ref,
    )
    if (ceilingFailure) return ceilingFailure
  }
  const target = inspection.target
  return builderResult(
    builder,
    target,
    floorMaterial.ref,
    target.fingerprint,
    finishContextFingerprint(context.nodes, [zone.id]),
    [zone.id],
  )
}

export function captureZoneFinishTemplate(args: {
  zoneId: string
  name: string
  sceneId?: string
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishTemplateSnapshot | ZoneFinishError {
  const context = resolveContext(args)
  const zone = asZone(context.nodes[args.zoneId])
  if (!zone)
    return templateFailure('zone-missing', 'The selected Zone no longer exists.', [args.zoneId])
  const name = args.name.trim()
  if (!name) return templateFailure('template-name-required', 'A Zone template name is required.')
  const inspection = makeInspection(zone, 'walls', undefined, context)
  if (inspection.boundaryError) return { ok: false, ...inspection.boundaryError }
  if (inspection.wallFaces.length === 0) {
    return templateFailure(
      'wall-boundary-missing',
      'The Zone has no unique enclosed wall boundary for a finish template.',
      [zone.id],
    )
  }
  if (inspection.floor.status !== 'existing') {
    return templateFailure(
      inspection.floor.status === 'blocked' ? 'floor-blocked' : 'floor-missing',
      inspection.floor.status === 'blocked'
        ? inspection.floor.reason
        : 'A completed Zone template requires an existing floor finish.',
      inspection.floor.status === 'blocked' ? inspection.floor.conflictIds : [zone.id],
    )
  }
  if (inspection.completion.missing.length > 0) {
    return {
      ok: false,
      code: 'template-incomplete',
      message: 'Every inward wall band and the floor need an explicit material before saving.',
      conflictIds: inspection.completion.missing.map((entry) => entry.nodeId),
      missing: [...inspection.completion.missing],
    }
  }

  const faces = inspection.wallFaces
  const walls: ZoneFinishTemplateWall[] = []
  for (const face of faces) {
    const wall = asWall(context.nodes[face.wallId])
    if (!wall || wallFaceSideIsAmbiguous(wall)) {
      return templateFailure('ambiguous-wall-side', 'A wall face cannot be safely captured.', [
        face.wallId,
      ])
    }
    const slots: Array<{ role: string; material: PortableMaterialSnapshot }> = []
    for (const role of face.roles) {
      const ref = explicitWallMaterialRef(wall, face, role, context.materials)
      const snapshot = ref ? portableMaterialForRef(ref, context.materials) : null
      if (!ref || !snapshot) {
        return templateFailure(
          'material-invalid',
          `The material for ${face.key}:${role} is unavailable.`,
          [face.key],
        )
      }
      slots.push({ role, material: snapshot })
    }
    walls.push({
      sourceFace: {
        wallId: face.wallId,
        face: face.face,
        key: face.key,
        ...(face.side ? { side: face.side } : {}),
        ...(face.start !== undefined ? { start: face.start } : {}),
        ...(face.end !== undefined ? { end: face.end } : {}),
        segmentSignature: face.segmentSignature,
        length: face.length,
        activeSlotRoles: [...face.roles],
      },
      slots,
    })
  }
  const slab = asSlab(context.nodes[inspection.floor.slabId])
  if (!slab)
    return templateFailure('floor-missing', 'The Zone floor no longer exists.', [
      inspection.floor.slabId,
    ])
  const floorRef = explicitMaterialRef(slab, 'surface', context.materials)
  const floor = floorRef ? portableMaterialForRef(floorRef, context.materials) : null
  if (!floor)
    return templateFailure('template-incomplete', 'The Zone floor has no explicit material.', [
      slab.id,
    ])
  let ceilingSnapshot: PortableMaterialSnapshot | undefined
  if (inspection.ceiling.status === 'existing') {
    const ceilingRef = explicitMaterialRef(
      context.nodes[inspection.ceiling.ceilingId]!,
      'surface',
      context.materials,
    )
    if (ceilingRef) {
      ceilingSnapshot = portableMaterialForRef(ceilingRef, context.materials) ?? undefined
      if (!ceilingSnapshot) {
        return templateFailure('material-invalid', 'The Zone ceiling material is unavailable.', [
          inspection.ceiling.ceilingId,
        ])
      }
    }
  }
  const ceiling = resolveCeiling(zone, context)
  const fingerprint = zoneSurfaceFingerprint(
    zone,
    faces,
    { status: 'existing', slab },
    ceilingSnapshot ? ceiling : undefined,
  )
  return {
    version: 1,
    id: generateId('zone-template'),
    name,
    createdAt: new Date().toISOString(),
    source: {
      ...(args.sceneId || context.sceneId ? { sceneId: args.sceneId ?? context.sceneId } : {}),
      zoneId: zone.id,
      fingerprint,
    },
    walls,
    floor,
    ...(ceilingSnapshot ? { ceiling: ceilingSnapshot } : {}),
  }
}

export function applyZoneFinishTemplate(args: {
  template: ZoneFinishTemplateSnapshot
  targetZoneId: string
  wallMapping?: Record<string, string>
  uniformWallMaterial?: PortableMaterialSnapshot
  forceMapping?: boolean
  sceneId?: string
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishApplyResult {
  return buildTemplatePlan(args.template, args.targetZoneId, args)
}

function applyPlanToContext(
  context: ZoneFinishContext,
  plan: ZoneFinishApplyPlan,
): ZoneFinishContext {
  const nodes = { ...context.nodes }
  for (const entry of plan.createNodes) nodes[entry.node.id] = clone(entry.node)
  for (const patch of plan.nodePatches) {
    const node = nodes[patch.id]
    if (node) nodes[patch.id] = { ...node, ...clone(patch.data) } as AnyNode
  }
  const materials = { ...context.materials }
  for (const material of plan.materials) materials[material.id] = clone(material)
  return { ...context, nodes, materials }
}

function mergePlan(
  builder: PlanBuilder,
  context: ZoneFinishContext,
  plan: ZoneFinishApplyPlan,
): ZoneFinishError | null {
  const refMap = new Map<string, string>()
  for (const material of plan.materials) {
    const equivalent = [
      ...Object.values(context.materials),
      ...Object.values(Object.fromEntries(builder.materials)),
    ].find((candidate) => materialsEqual(candidate.material, material.material))
    const ref = equivalent ? toSceneMaterialRef(equivalent.id) : toSceneMaterialRef(material.id)
    refMap.set(toSceneMaterialRef(material.id), ref)
    if (!equivalent) builder.materials.set(material.id, clone(material))
  }
  const rewriteNode = (node: AnyNode): AnyNode => {
    const slots = (node as { slots?: Record<string, string> }).slots
    if (!slots) return node
    const next = Object.fromEntries(
      Object.entries(slots).map(([role, ref]) => [role, refMap.get(ref) ?? ref]),
    )
    return { ...node, slots: next } as AnyNode
  }
  for (const patch of plan.nodePatches) {
    const node = context.nodes[patch.id]
    if (!node)
      return templateFailure('node-missing', 'A template target node no longer exists.', [patch.id])
    const rawSlots = (patch.data as { slots?: Record<string, string> }).slots
    const data: Partial<AnyNode> = rawSlots
      ? ({
          ...(patch.data as Record<string, unknown>),
          slots: Object.fromEntries(
            Object.entries(rawSlots).map(([role, ref]) => [role, refMap.get(ref) ?? ref]),
          ),
        } as Partial<AnyNode>)
      : patch.data
    const failure = builderAddPatch(builder, node, data)
    if (failure) return failure
  }
  for (const entry of plan.createNodes) {
    const failure = builderAddCreate(builder, rewriteNode(entry.node), entry.parentId)
    if (failure) return failure
  }
  return null
}

type HomeWallSlotClaim = {
  key: string
  wallId: string
  role: string
  side: 'interior' | 'exterior'
  start: number
  end: number
  zoneId: string
}

function homeWallSlotClaims(
  plan: ZoneFinishApplyPlan,
  context: ZoneFinishContext,
): HomeWallSlotClaim[] {
  if (plan.target.kind === 'floor' || plan.target.kind === 'ceiling') return []
  const zone = asZone(context.nodes[plan.target.zoneId])
  if (!zone) return []
  const faces = zoneWallFaces(zone, context).faces.filter(
    (face) => plan.target.kind !== 'wall' || face.key === plan.target.wallKey,
  )
  return faces.flatMap((face) => {
    const side = face.side
    if (!side) return []
    const range = faceRange(face)
    return face.roles.map((role) => ({
      key: `${face.wallId}:${role}`,
      wallId: face.wallId,
      role,
      side,
      start: range.start,
      end: range.end,
      zoneId: plan.target.zoneId,
    }))
  })
}

function homeFloorSlotClaims(plan: ZoneFinishApplyPlan, context: ZoneFinishContext): string[] {
  const claims: string[] = []
  for (const patch of plan.nodePatches) {
    if (!asSlab(context.nodes[patch.id])) continue
    const slots = (patch.data as { slots?: Record<string, string> }).slots
    if (slots?.surface !== undefined) claims.push(`${patch.id}:surface`)
  }
  for (const entry of plan.createNodes) {
    const slab = asSlab(entry.node)
    if (slab?.slots?.surface !== undefined) claims.push(`${slab.id}:surface`)
  }
  return claims
}

function homeCeilingSlotClaims(plan: ZoneFinishApplyPlan, context: ZoneFinishContext): string[] {
  const claims: string[] = []
  for (const patch of plan.nodePatches) {
    if (!asCeiling(context.nodes[patch.id])) continue
    const slots = (patch.data as { slots?: Record<string, string> }).slots
    if (slots?.surface !== undefined) claims.push(`${patch.id}:surface`)
  }
  for (const entry of plan.createNodes) {
    const ceiling = asCeiling(entry.node)
    if (ceiling?.slots?.surface !== undefined) claims.push(`${ceiling.id}:surface`)
  }
  return claims
}

function claimHomeSlot(
  owners: Map<string, string>,
  key: string,
  targetZoneId: string,
  message: string,
): ZoneFinishError | null {
  const previousZoneId = owners.get(key)
  if (previousZoneId && previousZoneId !== targetZoneId) {
    return templateFailure('slot-collision', message, [key, previousZoneId, targetZoneId])
  }
  owners.set(key, targetZoneId)
  return null
}

function claimHomeWallSlot(
  owners: HomeWallSlotClaim[],
  claim: HomeWallSlotClaim,
): ZoneFinishError | null {
  for (const previous of owners) {
    if (
      previous.key === claim.key &&
      previous.side === claim.side &&
      previous.zoneId !== claim.zoneId &&
      Math.min(previous.end, claim.end) - Math.max(previous.start, claim.start) > POINT_EPSILON
    ) {
      return templateFailure(
        'slot-collision',
        'Home finish Zones claim overlapping spans of the same physical wall material slot.',
        [claim.key, previous.zoneId, claim.zoneId],
      )
    }
  }
  owners.push(claim)
  return null
}

export function applyHomeFinishTemplate(args: {
  template: HomeFinishTemplate
  zoneMapping: Record<string, string>
  wallMappings?: Record<string, Record<string, string>>
  uniformWallMaterials?: Record<string, PortableMaterialSnapshot>
  sceneId?: string
  nodes?: Record<string, AnyNode>
  materials?: Record<string, SceneMaterialType>
  spaces?: Record<string, Space>
}): ZoneFinishApplyResult {
  if (
    args.template.version !== 1 ||
    !Array.isArray(args.template.zones) ||
    args.template.zones.length === 0
  ) {
    return templateFailure('template-invalid', 'The home finish template is invalid.')
  }
  const mappedTargets = Object.values(args.zoneMapping)
  if (new Set(mappedTargets).size !== mappedTargets.length) {
    return templateFailure(
      'mapping-duplicate',
      'Each home template Zone must map to a different target Zone.',
      mappedTargets,
    )
  }
  if (args.template.zones.some((entry) => !args.zoneMapping[entry.sourceZoneId])) {
    return templateFailure(
      'mapping-incomplete',
      'Every home template Zone needs a target Zone.',
      [],
    )
  }
  let context = resolveContext(args)
  const initialContext = context
  const targetZoneIds = args.template.zones.map((entry) => args.zoneMapping[entry.sourceZoneId]!)
  const builder = createBuilder()
  const wallSlotOwners: HomeWallSlotClaim[] = []
  const floorSlotOwners = new Map<string, string>()
  const ceilingSlotOwners = new Map<string, string>()
  const homeSceneMatches =
    typeof args.template.sourceSceneId === 'string' &&
    args.template.sourceSceneId.length > 0 &&
    typeof context.sceneId === 'string' &&
    context.sceneId.length > 0 &&
    args.template.sourceSceneId === context.sceneId
  const createdPolygons: Array<{
    id: string
    parentId: string | null
    polygon: readonly (readonly [number, number])[]
  }> = []
  const createdCeilingPolygons: Array<{
    id: string
    parentId: string | null
    polygon: readonly (readonly [number, number])[]
  }> = []
  for (const entry of args.template.zones) {
    const result = applyZoneFinishTemplate({
      template: entry.template,
      targetZoneId: args.zoneMapping[entry.sourceZoneId]!,
      wallMapping: args.wallMappings?.[entry.sourceZoneId],
      uniformWallMaterial: args.uniformWallMaterials?.[entry.sourceZoneId],
      forceMapping: !homeSceneMatches,
      nodes: context.nodes,
      materials: context.materials,
      spaces: context.spaces,
      sceneId: args.sceneId,
    })
    if (!result.ok) return result
    const targetZoneId = args.zoneMapping[entry.sourceZoneId]!
    for (const claim of homeWallSlotClaims(result.plan, context)) {
      const failure = claimHomeWallSlot(wallSlotOwners, claim)
      if (failure) return failure
    }
    for (const key of homeFloorSlotClaims(result.plan, context)) {
      const failure = claimHomeSlot(
        floorSlotOwners,
        key,
        targetZoneId,
        'Home finish Zones claim the same physical floor material slot.',
      )
      if (failure) return failure
    }
    for (const key of homeCeilingSlotClaims(result.plan, context)) {
      const failure = claimHomeSlot(
        ceilingSlotOwners,
        key,
        targetZoneId,
        'Home finish Zones claim the same physical ceiling material slot.',
      )
      if (failure) return failure
    }
    const overlap = result.plan.createNodes
      .map((entryToCreate) => asSlab(entryToCreate.node))
      .filter((slab): slab is SlabNode => Boolean(slab))
      .some((slab) => {
        if (
          createdPolygons.some(
            (candidate) =>
              candidate.parentId === slab.parentId &&
              polygonsOverlapByArea(candidate.polygon, slab.polygon),
          )
        )
          return true
        return Object.values(context.nodes)
          .map(asSlab)
          .filter((candidate): candidate is SlabNode =>
            Boolean(candidate && candidate.parentId === slab.parentId),
          )
          .some(
            (candidate) =>
              polygonsOverlapByArea(candidate.polygon, slab.polygon) &&
              (!polygonContainsWithTolerance(candidate.polygon, slab.polygon) ||
                candidate.recessed ||
                holeIntersectsPolygon(slab.polygon, candidate.holes ?? [])),
          )
      })
    if (overlap) {
      return templateFailure(
        'floor-overlap',
        'Home finish floors overlap and cannot be applied atomically.',
        [entry.sourceZoneId],
      )
    }
    const ceilingOverlap = result.plan.createNodes
      .map((entryToCreate) => asCeiling(entryToCreate.node))
      .filter((ceiling): ceiling is CeilingNode => Boolean(ceiling))
      .some((ceiling) => {
        if (
          createdCeilingPolygons.some(
            (candidate) =>
              candidate.parentId === ceiling.parentId &&
              polygonsOverlapByArea(candidate.polygon, ceiling.polygon),
          )
        ) {
          return true
        }
        return Object.values(context.nodes)
          .map(asCeiling)
          .filter((candidate): candidate is CeilingNode =>
            Boolean(candidate && candidate.parentId === ceiling.parentId),
          )
          .some((candidate) => polygonsOverlapByArea(candidate.polygon, ceiling.polygon))
      })
    if (ceilingOverlap) {
      return templateFailure(
        'ceiling-overlap',
        'Home finish ceilings overlap and cannot be applied atomically.',
        [entry.sourceZoneId],
      )
    }
    for (const created of result.plan.createNodes) {
      const slab = asSlab(created.node)
      if (slab)
        createdPolygons.push({ id: slab.id, parentId: slab.parentId, polygon: slab.polygon })
      const ceiling = asCeiling(created.node)
      if (ceiling)
        createdCeilingPolygons.push({
          id: ceiling.id,
          parentId: ceiling.parentId,
          polygon: ceiling.polygon,
        })
    }
    const failure = mergePlan(builder, context, result.plan)
    if (failure) return failure
    context = applyPlanToContext(context, result.plan)
  }
  const first = args.template.zones[0]
  if (!first) return templateFailure('template-invalid', 'The home finish template has no Zones.')
  const target = inspectZoneFinishTarget({
    zoneId: args.zoneMapping[first.sourceZoneId]!,
    kind: 'walls',
    nodes: context.nodes,
    materials: context.materials,
    spaces: context.spaces,
  }).target
  return builderResult(
    builder,
    target,
    '',
    target.fingerprint,
    finishContextFingerprint(initialContext.nodes, targetZoneIds),
    targetZoneIds,
  )
}

export function createHomeFinishTemplate(args: {
  name: string
  templates: Array<{
    sourceZoneId: string
    sourceZoneName: string
    template: ZoneFinishTemplateSnapshot
  }>
  sourceSceneId?: string
}): HomeFinishTemplate | ZoneFinishError {
  const name = args.name.trim()
  if (!name) return templateFailure('template-name-required', 'A home template name is required.')
  if (args.templates.length === 0)
    return templateFailure('template-empty', 'A home template needs at least one Zone.')
  const sourceIds = new Set<string>()
  for (const entry of args.templates) {
    if (!entry.sourceZoneId || sourceIds.has(entry.sourceZoneId)) {
      return templateFailure(
        'template-invalid',
        'A home template must contain each source Zone once.',
        [entry.sourceZoneId],
      )
    }
    sourceIds.add(entry.sourceZoneId)
    const failure = validateTemplateShape(entry.template)
    if (failure) return failure
  }
  return {
    version: 1,
    id: generateId('home-template'),
    name,
    createdAt: new Date().toISOString(),
    ...(args.sourceSceneId ? { sourceSceneId: args.sourceSceneId } : {}),
    zones: clone(args.templates),
  }
}
