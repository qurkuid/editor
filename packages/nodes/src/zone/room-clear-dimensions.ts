import {
  type AnyNodeId,
  detectSpacesForLevel,
  type FloorplanDimensionEditDescriptor,
  type FloorplanDimensionEditLeaf,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallThickness,
  type SpaceBoundaryFace,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { readFloorplanContext } from '@pascal-app/editor'
import { INTERIOR_CONSTRUCTION_DIMENSION_STROKE } from '../shared/construction-dimension-standards'
import {
  type ConstructionLengthProfile,
  type ConstructionMetricNotation,
  formatConstructionLength,
} from '../shared/construction-length'

const LINE_TOLERANCE = 1e-4
const ANGLE_TOLERANCE = 1e-3
const MIN_CLEAR_SPAN = 0.3
const FIRST_DIMENSION_POSITION = 0.32
const SECOND_DIMENSION_POSITION = 0.68
const EXTENSION_OVERSHOOT = 0.08

type FaceLine = {
  start: FloorplanPoint
  end: FloorplanPoint
  wallIds: readonly AnyNodeId[]
  face: 'front' | 'back'
}

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>

export function buildRoomClearDimensions(
  node: ZoneNode,
  ctx: GeometryContext,
): FloorplanGeometry[] {
  const clearDimensionPolicy = effectiveRoomClearDimensionPolicy(node)
  if (
    node.spaceRole !== 'room' ||
    (clearDimensionPolicy !== 'inside-faces' && clearDimensionPolicy !== 'finish-faces') ||
    node.enclosureStatus === 'open' ||
    !node.autoFromWalls ||
    !node.parentId ||
    node.boundaryWallIds.length < 3
  ) {
    return []
  }

  const walls = node.boundaryWallIds.flatMap((id) => {
    const resolved = ctx.resolve(id)
    return resolved &&
      typeof resolved === 'object' &&
      'type' in resolved &&
      resolved.type === 'wall'
      ? [resolved as WallNode]
      : []
  })
  if (walls.length !== node.boundaryWallIds.length) return []

  const boundaryIds = new Set(node.boundaryWallIds)
  const space = detectSpacesForLevel(node.parentId, walls).spaces.find(
    (candidate) =>
      candidate.wallIds.length === boundaryIds.size &&
      candidate.wallIds.every((id) => boundaryIds.has(id)),
  )
  if (!space) return []

  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const faceLines = resolveClearFaceLines(space.boundaryFaces, wallsById)
  if (!faceLines) return []

  const unit = ctx.viewState?.unit ?? 'metric'
  const floorplanContext = readFloorplanContext(ctx)
  const profile: ConstructionLengthProfile =
    floorplanContext.purpose === 'document' ? 'document' : 'editor'
  const metricNotation = floorplanContext.metricNotation
  const showSelectedChrome = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : INTERIOR_CONSTRUCTION_DIMENSION_STROKE
  const rectangle = resolveClearFaceRectangle(faceLines)
  const dimensions = rectangle
    ? buildRectangleClearDimensions(
        faceLines,
        rectangle,
        node.parentId as AnyNodeId,
        node.id,
        `room-clear:${clearDimensionPolicy}`,
        unit,
        profile,
        metricNotation,
        stroke,
      )
    : buildRectilinearClearDimensions(
        faceLines,
        node.parentId as AnyNodeId,
        node.id,
        `room-clear:${clearDimensionPolicy}`,
        unit,
        profile,
        metricNotation,
        stroke,
      )
  if (dimensions.length === 0) return []
  return dimensions
}

function effectiveRoomClearDimensionPolicy(
  node: ZoneNode,
): 'inside-faces' | 'finish-faces' | 'none' {
  if (node.clearDimensionPolicy !== 'none') return node.clearDimensionPolicy
  if (node.spaceRole !== 'room' || !node.autoFromWalls || node.enclosureStatus === 'open') {
    return 'none'
  }
  const metadata =
    node.metadata !== null && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? node.metadata
      : null
  return metadata?.source === 'apt-vector' ? 'finish-faces' : 'none'
}

function resolveClearFaceLines(
  boundaryFaces: readonly SpaceBoundaryFace[],
  wallsById: ReadonlyMap<string, WallNode>,
): FaceLine[] | null {
  const faceLines: FaceLine[] = []
  for (const boundary of boundaryFaces) {
    const wall = wallsById.get(boundary.wallId)
    if (!wall || Math.abs(wall.curveOffset ?? 0) > LINE_TOLERANCE) return null
    const line = offsetBoundaryFace(boundary, wall)
    if (!line) return null
    faceLines.push(line)
  }

  const merged = mergeCollinearFaces(faceLines)
  return merged.length >= 4 ? merged : null
}

function resolveClearFaceRectangle(
  merged: readonly FaceLine[],
): [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint] | null {
  if (merged.length !== 4) return null

  const vertices = merged.map((line, index) => {
    const previous = merged[(index + merged.length - 1) % merged.length]!
    return intersectLines(previous, line)
  })
  if (vertices.some((vertex) => vertex === null)) return null
  const rectangle = vertices as [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint]
  const directions = rectangle.map((start, index) =>
    normalizedDirection(start, rectangle[(index + 1) % rectangle.length]!),
  )
  if (directions.some((direction) => direction === null)) return null
  const [first, second, third, fourth] = directions as [
    FloorplanPoint,
    FloorplanPoint,
    FloorplanPoint,
    FloorplanPoint,
  ]
  if (
    Math.abs(dot(first, second)) > ANGLE_TOLERANCE ||
    Math.abs(dot(second, third)) > ANGLE_TOLERANCE ||
    Math.abs(dot(third, fourth)) > ANGLE_TOLERANCE ||
    Math.abs(dot(fourth, first)) > ANGLE_TOLERANCE ||
    dot(first, third) > -1 + ANGLE_TOLERANCE ||
    dot(second, fourth) > -1 + ANGLE_TOLERANCE
  ) {
    return null
  }
  return rectangle
}

function buildRectangleClearDimensions(
  faceLines: readonly FaceLine[],
  rectangle: [FloorplanPoint, FloorplanPoint, FloorplanPoint, FloorplanPoint],
  levelId: AnyNodeId,
  nodeId: AnyNodeId,
  generatorKey: string,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const first = dimensionAcrossOppositeFaces(
    { ...faceLines[0]!, start: rectangle[0]!, end: rectangle[1]! },
    { ...faceLines[2]!, start: rectangle[3]!, end: rectangle[2]! },
    levelId,
    nodeId,
    generatorKey,
    FIRST_DIMENSION_POSITION,
    unit,
    profile,
    metricNotation,
    stroke,
  )
  const second = dimensionAcrossOppositeFaces(
    { ...faceLines[1]!, start: rectangle[1]!, end: rectangle[2]! },
    { ...faceLines[3]!, start: rectangle[0]!, end: rectangle[3]! },
    levelId,
    nodeId,
    generatorKey,
    SECOND_DIMENSION_POSITION,
    unit,
    profile,
    metricNotation,
    stroke,
  )
  return first && second ? [first, second] : []
}

function buildRectilinearClearDimensions(
  faceLines: readonly FaceLine[],
  levelId: AnyNodeId,
  nodeId: AnyNodeId,
  generatorKey: string,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const vertices = clearFacePolygon(faceLines)
  if (!vertices || !isRectilinearPolygon(vertices)) return []

  const dimensions: FloorplanGeometry[] = []
  const seen = new Set<string>()
  for (let firstIndex = 0; firstIndex < faceLines.length; firstIndex++) {
    const first = faceLines[firstIndex]!
    const firstDirection = normalizedDirection(first.start, first.end)
    if (!firstDirection) return []

    for (let secondIndex = firstIndex + 1; secondIndex < faceLines.length; secondIndex++) {
      const second = faceLines[secondIndex]!
      const secondDirection = normalizedDirection(second.start, second.end)
      if (!secondDirection) return []
      if (Math.abs(dot(firstDirection, secondDirection)) < 1 - ANGLE_TOLERANCE) continue

      const dimension = dimensionBetweenOverlappingParallelFaces(
        first,
        second,
        firstDirection,
        vertices,
        levelId,
        nodeId,
        generatorKey,
        unit,
        profile,
        metricNotation,
        stroke,
      )
      if (!dimension) continue
      const key = dimensionKey(dimension)
      if (seen.has(key)) continue
      seen.add(key)
      dimensions.push(dimension)
    }
  }
  return dimensions
}

function offsetBoundaryFace(boundary: SpaceBoundaryFace, wall: WallNode): FaceLine | null {
  const first = boundary.points[0]
  const last = boundary.points[boundary.points.length - 1]
  if (!(first && last)) return null

  const wallDirection = normalizedDirection(wall.start, wall.end)
  if (!wallDirection) return null
  const normal: FloorplanPoint = [-wallDirection[1], wallDirection[0]]
  const side = boundary.face === 'front' ? 1 : -1
  const offset = (getWallThickness(wall) / 2) * side
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [last[0] + normal[0] * offset, last[1] + normal[1] * offset],
    wallIds: [wall.id],
    face: boundary.face,
  }
}

function clearFacePolygon(faceLines: readonly FaceLine[]): FloorplanPoint[] | null {
  const vertices = faceLines.map((line, index) => {
    const previous = faceLines[(index + faceLines.length - 1) % faceLines.length]!
    return intersectLines(previous, line)
  })
  return vertices.some((vertex) => vertex === null) ? null : (vertices as FloorplanPoint[])
}

function isRectilinearPolygon(vertices: readonly FloorplanPoint[]): boolean {
  if (vertices.length < 4) return false
  const directions = vertices.map((start, index) =>
    normalizedDirection(start, vertices[(index + 1) % vertices.length]!),
  )
  if (directions.some((direction) => direction === null)) return false
  for (let index = 0; index < directions.length; index++) {
    const current = directions[index]!
    const next = directions[(index + 1) % directions.length]!
    if (Math.abs(dot(current, next)) > ANGLE_TOLERANCE) return false
  }
  return true
}

function dimensionBetweenOverlappingParallelFaces(
  first: FaceLine,
  second: FaceLine,
  direction: FloorplanPoint,
  polygon: readonly FloorplanPoint[],
  levelId: AnyNodeId,
  nodeId: AnyNodeId,
  generatorKey: string,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): DimensionGeometry | null {
  const firstStart = dot(first.start, direction)
  const firstEnd = dot(first.end, direction)
  const secondStart = dot(second.start, direction)
  const secondEnd = dot(second.end, direction)
  const overlapStart = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd))
  const overlapEnd = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd))
  if (overlapEnd - overlapStart < MIN_CLEAR_SPAN) return null

  const projection = (overlapStart + overlapEnd) / 2
  const start = projectPointToLineProjection(first, direction, projection)
  const end = projectPointToLineProjection(second, direction, projection)
  const midpoint: FloorplanPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  if (!pointInPolygon(midpoint, polygon)) return null

  const axis = normalizedDirection(start, end)
  if (!axis) return null
  const length = distance(start, end)
  if (length < MIN_CLEAR_SPAN) return null

  const wallIds = [...new Set([...first.wallIds, ...second.wallIds])].sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  const chainId = `${levelId}:room-clear:${nodeId}`
  const semanticKey = `${chainId}:span:${faceSemanticKey(first, second)}`
  const leaf: FloorplanDimensionEditLeaf = {
    id: `${levelId}:room-clear:${wallIds.join(',')}:${roundKey(start[0])}:${roundKey(start[1])}:${roundKey(end[0])}:${roundKey(end[1])}`,
    measuredStart: start,
    measuredEnd: end,
    currentLength: length,
    wallIds,
    semanticKey,
    faces: [
      ...first.wallIds.map((wallId) => ({ wallId, side: first.face })),
      ...second.wallIds.map((wallId) => ({ wallId, side: second.face })),
    ],
  }

  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal: [-axis[1], axis[0]],
    offsetDistance: 0,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(length, unit, profile, { metricNotation }),
    stroke,
    editDescriptor: {
      id: leaf.id,
      sourceNodeId: nodeId,
      chainId,
      generatorKey,
      semanticKey,
      status: wallIds.length === 2 ? 'editable' : 'read-only',
      readOnlyReasonCode: wallIds.length === 2 ? undefined : 'ambiguous-face',
      readOnlyReason:
        wallIds.length === 2
          ? undefined
          : '여러 벽이 하나의 실내 면을 이루어 이동 경계를 정할 수 없습니다.',
      levelId,
      kind: 'room-clear',
      measuredStart: start,
      measuredEnd: end,
      fixedEndOptions: ['start', 'end'],
      leaves: [leaf],
      defaultLeafId: leaf.id,
    },
  }
}

function pointInPolygon(point: FloorplanPoint, polygon: readonly FloorplanPoint[]): boolean {
  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index++
  ) {
    const current = polygon[index]!
    const previous = polygon[previousIndex]!
    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
          current[0]
    if (intersects) inside = !inside
  }
  return inside
}

function dimensionKey(dimension: DimensionGeometry): string {
  const first = `${roundKey(dimension.start[0])},${roundKey(dimension.start[1])}`
  const second = `${roundKey(dimension.end[0])},${roundKey(dimension.end[1])}`
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

function roundKey(value: number): number {
  return Math.round(value / LINE_TOLERANCE)
}

function faceSemanticKey(...lines: readonly FaceLine[]): string {
  return [
    ...new Set(
      lines.flatMap((line) => line.wallIds.map((wallId) => `${String(wallId)}:${line.face}`)),
    ),
  ]
    .sort()
    .join('|')
}

function projectPointToLineProjection(
  line: FaceLine,
  direction: FloorplanPoint,
  projection: number,
): FloorplanPoint {
  const originProjection = dot(line.start, direction)
  return [
    line.start[0] + direction[0] * (projection - originProjection),
    line.start[1] + direction[1] * (projection - originProjection),
  ]
}

function mergeCollinearFaces(lines: readonly FaceLine[]): FaceLine[] {
  const merged: FaceLine[] = []
  for (const line of lines) {
    const previous = merged[merged.length - 1]
    if (previous && canMerge(previous, line)) {
      previous.end = line.end
      previous.wallIds = [...new Set([...previous.wallIds, ...line.wallIds])]
    } else merged.push({ ...line })
  }

  while (merged.length > 1) {
    const first = merged[0]!
    const last = merged[merged.length - 1]!
    if (!canMerge(last, first)) break
    first.start = last.start
    first.wallIds = [...new Set([...first.wallIds, ...last.wallIds])]
    merged.pop()
  }
  return merged
}

function canMerge(first: FaceLine, second: FaceLine): boolean {
  const firstDirection = normalizedDirection(first.start, first.end)
  const secondDirection = normalizedDirection(second.start, second.end)
  if (!(firstDirection && secondDirection)) return false
  return (
    dot(firstDirection, secondDirection) > 1 - ANGLE_TOLERANCE &&
    pointLineDistance(second.start, first) <= LINE_TOLERANCE
  )
}

function intersectLines(first: FaceLine, second: FaceLine): FloorplanPoint | null {
  const firstDirection: FloorplanPoint = [
    first.end[0] - first.start[0],
    first.end[1] - first.start[1],
  ]
  const secondDirection: FloorplanPoint = [
    second.end[0] - second.start[0],
    second.end[1] - second.start[1],
  ]
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= LINE_TOLERANCE) return null
  const delta: FloorplanPoint = [second.start[0] - first.start[0], second.start[1] - first.start[1]]
  const parameter = cross(delta, secondDirection) / denominator
  return [
    first.start[0] + firstDirection[0] * parameter,
    first.start[1] + firstDirection[1] * parameter,
  ]
}

function dimensionAcrossOppositeFaces(
  first: FaceLine,
  opposite: FaceLine,
  levelId: AnyNodeId,
  nodeId: AnyNodeId,
  generatorKey: string,
  position: number,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry | null {
  const firstDirection = normalizedDirection(first.start, first.end)
  const oppositeDirection = normalizedDirection(opposite.start, opposite.end)
  if (!(firstDirection && oppositeDirection)) return null
  const orientedOpposite =
    dot(firstDirection, oppositeDirection) < 0
      ? { ...opposite, start: opposite.end, end: opposite.start }
      : opposite
  const start = interpolate(first.start, first.end, position)
  const end = interpolate(orientedOpposite.start, orientedOpposite.end, position)
  const direction = normalizedDirection(start, end)
  if (!direction) return null
  const length = distance(start, end)
  if (length < MIN_CLEAR_SPAN) return null
  const wallIds = [...new Set([...first.wallIds, ...opposite.wallIds])].sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  const chainId = `${levelId}:room-clear:${nodeId}`
  const semanticKey = `${chainId}:span:${faceSemanticKey(first, opposite)}`
  const leaves: FloorplanDimensionEditLeaf[] = [
    {
      id: `${levelId}:room-clear:${wallIds.join(',')}:${roundKey(start[0])}:${roundKey(start[1])}:${roundKey(end[0])}:${roundKey(end[1])}`,
      measuredStart: start,
      measuredEnd: end,
      currentLength: length,
      wallIds,
      semanticKey,
      faces: [
        ...first.wallIds.map((wallId) => ({ wallId, side: first.face })),
        ...opposite.wallIds.map((wallId) => ({ wallId, side: opposite.face })),
      ],
    },
  ]
  const editDescriptor: FloorplanDimensionEditDescriptor = {
    id: leaves[0]!.id,
    sourceNodeId: nodeId,
    chainId,
    generatorKey,
    semanticKey,
    status: wallIds.length === 2 ? 'editable' : 'read-only',
    readOnlyReasonCode: wallIds.length === 2 ? undefined : 'ambiguous-face',
    readOnlyReason:
      wallIds.length === 2
        ? undefined
        : '여러 벽이 하나의 실내 면을 이루어 이동 경계를 정할 수 없습니다.',
    levelId,
    kind: 'room-clear',
    measuredStart: start,
    measuredEnd: end,
    fixedEndOptions: ['start', 'end'],
    leaves,
    defaultLeafId: leaves[0]!.id,
  }
  return {
    kind: 'dimension',
    start,
    end,
    offsetNormal: [-direction[1], direction[0]],
    offsetDistance: 0,
    extensionOvershoot: EXTENSION_OVERSHOOT,
    text: formatConstructionLength(length, unit, profile, { metricNotation }),
    stroke,
    editDescriptor,
  }
}

function normalizedDirection(
  start: readonly [number, number],
  end: readonly [number, number],
): FloorplanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  return length <= LINE_TOLERANCE ? null : [dx / length, dy / length]
}

function pointLineDistance(point: FloorplanPoint, line: FaceLine): number {
  const direction = normalizedDirection(line.start, line.end)
  if (!direction) return Number.POSITIVE_INFINITY
  return Math.abs(cross(direction, [point[0] - line.start[0], point[1] - line.start[1]]))
}

function interpolate(start: FloorplanPoint, end: FloorplanPoint, t: number): FloorplanPoint {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
}

function distance(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function dot(first: FloorplanPoint, second: FloorplanPoint): number {
  return first[0] * second[0] + first[1] * second[1]
}

function cross(first: FloorplanPoint, second: FloorplanPoint): number {
  return first[0] * second[1] - first[1] * second[0]
}
