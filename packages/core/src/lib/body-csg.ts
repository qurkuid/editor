import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { inspectBodySolid } from './body-solid'
import { getBodyLoopVertices, type TopologyRemap, validateBodyTopology } from './body-topology'

const EPSILON = 1e-8
const SNAP_EPSILON = 1e-8

export type BodyCsgOperation = 'union' | 'subtract' | 'intersect'

export type BodyCsgDiagnosticCode =
  | 'csg.target.invalid'
  | 'csg.tool.invalid'
  | 'csg.result.empty'
  | 'csg.result.invalid'

export type BodyCsgResult = {
  readonly body: BodyNodeType
  readonly topologyRemap: TopologyRemap
}

export type BodySplitPieceKind = 'target-only' | 'intersection' | 'tool-only'

export type BodySplitPiece = BodyCsgResult & {
  readonly kind: BodySplitPieceKind
}

export type BodySplitResult = {
  readonly pieces: readonly BodySplitPiece[]
}

export class BodyCsgError extends RangeError {
  readonly code: BodyCsgDiagnosticCode
  readonly featureIds: readonly string[]

  constructor(code: BodyCsgDiagnosticCode, message: string, featureIds: readonly string[] = []) {
    super(message)
    this.name = 'BodyCsgError'
    this.code = code
    this.featureIds = featureIds
  }
}

type Vec3 = [number, number, number]
type ReadonlyVec3 = readonly [number, number, number]

type Plane = {
  readonly normal: Vec3
  readonly w: number
}

type CsgVertex = {
  readonly pos: Vec3
}

type CsgPolygon = {
  readonly vertices: CsgVertex[]
  readonly plane: Plane
  readonly source: 'target' | 'tool'
  readonly sourceFaceId: string
  readonly surface: BodyNodeType['faces'][number]['surface']
}

function provenanceKey(polygon: CsgPolygon): string {
  return `${polygon.source}:${polygon.sourceFaceId}`
}

const clonePoint = (point: ReadonlyVec3): Vec3 => [point[0], point[1], point[2]]

function add(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(value: ReadonlyVec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount]
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function length(value: ReadonlyVec3): number {
  return Math.hypot(value[0], value[1], value[2])
}

function samePoint(a: ReadonlyVec3, b: ReadonlyVec3): boolean {
  return length(subtract(a, b)) <= EPSILON
}

function planeFromPoints(points: readonly ReadonlyVec3[]): Plane | null {
  if (points.length < 3) return null
  for (let firstIndex = 0; firstIndex < points.length - 2; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length - 1; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < points.length; thirdIndex += 1) {
        const normalRaw = cross(
          subtract(points[secondIndex]!, points[firstIndex]!),
          subtract(points[thirdIndex]!, points[firstIndex]!),
        )
        const normalLength = length(normalRaw)
        if (normalLength <= EPSILON) continue
        const normal = scale(normalRaw, 1 / normalLength)
        return { normal, w: dot(normal, points[firstIndex]!) }
      }
    }
  }
  return null
}

function reversePolygon(polygon: CsgPolygon): CsgPolygon {
  const vertices = [...polygon.vertices].reverse()
  const plane = planeFromPoints(vertices.map((vertex) => vertex.pos))
  if (!plane) return polygon
  return { ...polygon, vertices, plane }
}

function cleanPolygonVertices(
  vertices: readonly CsgVertex[],
  preserveCollinear = false,
): CsgVertex[] {
  const cleaned: CsgVertex[] = []
  for (const vertex of vertices) {
    if (cleaned.length === 0 || !samePoint(cleaned.at(-1)!.pos, vertex.pos)) {
      cleaned.push({ pos: clonePoint(vertex.pos) })
    }
  }
  if (cleaned.length > 1 && samePoint(cleaned[0]!.pos, cleaned.at(-1)!.pos)) cleaned.pop()
  if (preserveCollinear) return cleaned
  let changed = true
  while (changed && cleaned.length >= 3) {
    changed = false
    for (let index = 0; index < cleaned.length; index += 1) {
      const previous = cleaned[(index - 1 + cleaned.length) % cleaned.length]!.pos
      const current = cleaned[index]!.pos
      const next = cleaned[(index + 1) % cleaned.length]!.pos
      const before = subtract(current, previous)
      const after = subtract(next, current)
      if (length(cross(before, after)) <= EPSILON && dot(before, after) >= -EPSILON) {
        cleaned.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return cleaned
}

function makePolygon(
  vertices: readonly CsgVertex[],
  source: CsgPolygon['source'],
  sourceFaceId: string,
  surface: CsgPolygon['surface'],
  preserveCollinear = false,
): CsgPolygon | null {
  const cleaned = cleanPolygonVertices(vertices, preserveCollinear)
  const plane = planeFromPoints(cleaned.map((vertex) => vertex.pos))
  if (!plane) return null
  return {
    vertices: cleaned,
    plane,
    source,
    sourceFaceId,
    surface: {
      ...surface,
      uvOrigin: [...surface.uvOrigin] as Vec3,
      uvU: [...surface.uvU] as Vec3,
      uvV: [...surface.uvV] as Vec3,
    },
  }
}

function projectedCoordinates(
  points: readonly ReadonlyVec3[],
  normal: ReadonlyVec3,
): [number, number][] {
  const axis = normal.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(normal[best]!) ? index : best),
    0,
  )
  return points.map((point) => {
    if (axis === 0) return [point[1], point[2]]
    if (axis === 1) return [point[0], point[2]]
    return [point[0], point[1]]
  })
}

function cross2(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] * b[1] - a[1] * b[0]
}

function pointInTriangle(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  orientation: number,
): boolean {
  const ab = cross2([b[0] - a[0], b[1] - a[1]], [point[0] - a[0], point[1] - a[1]])
  const bc = cross2([c[0] - b[0], c[1] - b[1]], [point[0] - b[0], point[1] - b[1]])
  const ca = cross2([a[0] - c[0], a[1] - c[1]], [point[0] - c[0], point[1] - c[1]])
  return (
    ab * orientation >= -EPSILON && bc * orientation >= -EPSILON && ca * orientation >= -EPSILON
  )
}

function triangulatePolygon(polygon: CsgPolygon): CsgPolygon[] {
  if (polygon.vertices.length === 3) return [polygon]
  const points = polygon.vertices.map((vertex) => vertex.pos)
  const projected = projectedCoordinates(points, polygon.plane.normal)
  let area = 0
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]!
    const next = projected[(index + 1) % projected.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  const orientation = area >= 0 ? 1 : -1
  const remaining = Array.from({ length: polygon.vertices.length }, (_, index) => index)
  const triangles: CsgPolygon[] = []
  let guard = 0
  while (remaining.length > 3 && guard < polygon.vertices.length * polygon.vertices.length) {
    guard += 1
    let earFound = false
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index - 1 + remaining.length) % remaining.length]!
      const currentIndex = remaining[index]!
      const nextIndex = remaining[(index + 1) % remaining.length]!
      const previous = projected[previousIndex]!
      const current = projected[currentIndex]!
      const next = projected[nextIndex]!
      const turn = cross2(
        [current[0] - previous[0], current[1] - previous[1]],
        [next[0] - current[0], next[1] - current[1]],
      )
      if (turn * orientation <= EPSILON) continue
      if (
        remaining.some(
          (candidate) =>
            candidate !== previousIndex &&
            candidate !== currentIndex &&
            candidate !== nextIndex &&
            pointInTriangle(projected[candidate]!, previous, current, next, orientation),
        )
      ) {
        continue
      }
      const triangle = makePolygon(
        [
          polygon.vertices[previousIndex]!,
          polygon.vertices[currentIndex]!,
          polygon.vertices[nextIndex]!,
        ],
        polygon.source,
        polygon.sourceFaceId,
        polygon.surface,
      )
      if (!triangle)
        throw new BodyCsgError('csg.target.invalid', 'CSG triangulation produced a degenerate face')
      triangles.push(triangle)
      remaining.splice(index, 1)
      earFound = true
      break
    }
    if (!earFound) {
      throw new BodyCsgError(
        'csg.target.invalid',
        'CSG requires simple planar polygons that can be triangulated',
        [polygon.sourceFaceId],
      )
    }
  }
  if (remaining.length === 3) {
    const triangle = makePolygon(
      remaining.map((index) => polygon.vertices[index]!),
      polygon.source,
      polygon.sourceFaceId,
      polygon.surface,
    )
    if (!triangle)
      throw new BodyCsgError('csg.target.invalid', 'CSG triangulation produced a degenerate face')
    triangles.push(triangle)
  }
  return triangles
}

function isConvexPolygon(polygon: CsgPolygon): boolean {
  const projected = projectedCoordinates(
    polygon.vertices.map((vertex) => vertex.pos),
    polygon.plane.normal,
  )
  let sign = 0
  for (let index = 0; index < projected.length; index += 1) {
    const previous = projected[(index - 1 + projected.length) % projected.length]!
    const current = projected[index]!
    const next = projected[(index + 1) % projected.length]!
    const turn = cross2(
      [current[0] - previous[0], current[1] - previous[1]],
      [next[0] - current[0], next[1] - current[1]],
    )
    if (Math.abs(turn) <= EPSILON) continue
    if (sign === 0) sign = turn > 0 ? 1 : -1
    else if (turn * sign < -EPSILON) return false
  }
  return sign !== 0
}

function bodyPolygons(body: BodyNodeType, source: CsgPolygon['source']): CsgPolygon[] {
  const inspection = inspectBodySolid(body)
  const invalidFeatures = inspection.diagnostics.flatMap((diagnostic) => diagnostic.featureIds)
  if (!inspection.validSolid || !validateBodyTopology(body).valid) {
    throw new BodyCsgError(
      source === 'target' ? 'csg.target.invalid' : 'csg.tool.invalid',
      `CSG requires a valid closed ${source} Body`,
      invalidFeatures.length > 0 ? invalidFeatures : [body.id],
    )
  }
  if (body.curves.length > 0 || body.halfEdges.some((edge) => edge.curveId)) {
    throw new BodyCsgError(
      source === 'target' ? 'csg.target.invalid' : 'csg.tool.invalid',
      'CSG supports line-edged Bodies only',
      [body.id, ...body.curves.map((curve) => curve.id)],
    )
  }
  if (body.faces.some((face) => face.innerLoopIds.length > 0)) {
    throw new BodyCsgError(
      source === 'target' ? 'csg.target.invalid' : 'csg.tool.invalid',
      'CSG does not support faces with holes',
      body.faces.flatMap((face) => [face.id, ...face.innerLoopIds]),
    )
  }
  const shouldReverse = (inspection.signedVolume ?? 0) < 0
  const polygons: CsgPolygon[] = []
  for (const face of body.faces) {
    const points = getBodyLoopVertices(body, face.outerLoopId)
    const orientedPoints = shouldReverse ? [...points].reverse() : points
    const polygon = makePolygon(
      orientedPoints.map((position) => ({ pos: clonePoint(position) })),
      source,
      face.id,
      face.surface,
    )
    if (!polygon) {
      throw new BodyCsgError(
        source === 'target' ? 'csg.target.invalid' : 'csg.tool.invalid',
        'CSG rejects degenerate planar faces',
        [body.id, face.id],
      )
    }
    polygons.push(...(isConvexPolygon(polygon) ? [polygon] : triangulatePolygon(polygon)))
  }
  return polygons
}

function samePlane(first: Plane, second: Plane): boolean {
  const normalDot = dot(first.normal, second.normal)
  if (Math.abs(Math.abs(normalDot) - 1) > EPSILON * 10) return false
  const signedW = normalDot >= 0 ? second.w : -second.w
  return Math.abs(first.w - signedW) <= EPSILON * 10
}

function uniquePlanes(planes: readonly Plane[]): Plane[] {
  const unique: Plane[] = []
  for (const plane of planes) {
    if (!unique.some((candidate) => samePlane(candidate, plane))) unique.push(plane)
  }
  return unique
}

function splitPolygonFragments(plane: Plane, polygon: CsgPolygon): CsgPolygon[] {
  const types = polygon.vertices.map((vertex) => {
    const distance = dot(plane.normal, vertex.pos) - plane.w
    return distance < -EPSILON ? 2 : distance > EPSILON ? 1 : 0
  })
  let polygonType = 0
  for (const type of types) polygonType |= type
  if (polygonType === 0 || polygonType === 1 || polygonType === 2) return [polygon]

  const frontVertices: CsgVertex[] = []
  const backVertices: CsgVertex[] = []
  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const current = polygon.vertices[index]!
    const next = polygon.vertices[(index + 1) % polygon.vertices.length]!
    const currentType = types[index]!
    const nextType = types[(index + 1) % polygon.vertices.length]!
    if (currentType !== 2) frontVertices.push(current)
    if (currentType !== 1) backVertices.push(current)
    if ((currentType | nextType) !== 3) continue
    const direction = subtract(next.pos, current.pos)
    const denominator = dot(plane.normal, direction)
    if (Math.abs(denominator) <= EPSILON) continue
    const t = (plane.w - dot(plane.normal, current.pos)) / denominator
    const intersection: CsgVertex = { pos: add(current.pos, scale(direction, t)) }
    frontVertices.push(intersection)
    backVertices.push({ pos: clonePoint(intersection.pos) })
  }

  const fragments: CsgPolygon[] = []
  const front = makePolygon(frontVertices, polygon.source, polygon.sourceFaceId, polygon.surface)
  const back = makePolygon(backVertices, polygon.source, polygon.sourceFaceId, polygon.surface)
  if (front) fragments.push(front)
  if (back) fragments.push(back)
  return fragments
}

function coplanarEdgePlanes(candidate: CsgPolygon, polygons: readonly CsgPolygon[]): Plane[] {
  const planes: Plane[] = []
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const start = polygon.vertices[index]!.pos
      const end = polygon.vertices[(index + 1) % polygon.vertices.length]!.pos
      if (
        Math.abs(dot(candidate.plane.normal, start) - candidate.plane.w) > EPSILON * 10 ||
        Math.abs(dot(candidate.plane.normal, end) - candidate.plane.w) > EPSILON * 10
      ) {
        continue
      }
      const direction = subtract(end, start)
      const lineNormalRaw = cross(candidate.plane.normal, direction)
      const normalLength = length(lineNormalRaw)
      if (normalLength <= EPSILON) continue
      const normal = scale(lineNormalRaw, 1 / normalLength)
      planes.push({ normal, w: dot(normal, start) })
    }
  }
  return planes
}

function fragmentPolygons(
  polygons: readonly CsgPolygon[],
  allPlanes: readonly Plane[],
): CsgPolygon[] {
  return polygons.flatMap((polygon) => {
    const planes = uniquePlanes([...allPlanes, ...coplanarEdgePlanes(polygon, polygons)])
    let fragments: CsgPolygon[] = [polygon]
    for (const plane of planes) {
      fragments = fragments.flatMap((fragment) => splitPolygonFragments(plane, fragment))
    }
    return fragments
  })
}

function pointInsideSolid(point: ReadonlyVec3, triangles: readonly CsgPolygon[]): boolean {
  let winding = 0
  for (const triangle of triangles) {
    const [first, second, third] = triangle.vertices
    if (!first || !second || !third) continue
    const a = subtract(first.pos, point)
    const b = subtract(second.pos, point)
    const c = subtract(third.pos, point)
    const lengthA = length(a)
    const lengthB = length(b)
    const lengthC = length(c)
    const denominator =
      lengthA * lengthB * lengthC + dot(a, b) * lengthC + dot(b, c) * lengthA + dot(c, a) * lengthB
    const numerator = dot(a, cross(b, c))
    winding += 2 * Math.atan2(numerator, denominator)
  }
  return Math.abs(winding) > Math.PI
}

function centroid(polygon: CsgPolygon): Vec3 {
  const sum = polygon.vertices.reduce((total, vertex) => add(total, vertex.pos), [0, 0, 0] as Vec3)
  return scale(sum, 1 / polygon.vertices.length)
}

function probeDistance(
  point: ReadonlyVec3,
  normal: ReadonlyVec3,
  planes: readonly Plane[],
  scaleValue: number,
): number {
  const nearest = planes.reduce((distance, plane) => {
    if (samePlane({ normal: [...normal] as Vec3, w: dot(normal, point) }, plane)) return distance
    return Math.min(distance, Math.abs(dot(plane.normal, point) - plane.w))
  }, Number.POSITIVE_INFINITY)
  const base = Math.max(scaleValue * 1e-7, EPSILON * 20)
  const safe = Number.isFinite(nearest) ? Math.min(base, nearest * 0.25) : base
  return safe > EPSILON ? safe : EPSILON * 2
}

function evaluateOperation(
  targetInside: boolean,
  toolInside: boolean,
  operation: BodyCsgOperation,
): boolean {
  if (operation === 'union') return targetInside || toolInside
  if (operation === 'subtract') return targetInside && !toolInside
  return targetInside && toolInside
}

function applyCsg(
  target: readonly CsgPolygon[],
  tool: readonly CsgPolygon[],
  operation: BodyCsgOperation,
): CsgPolygon[] {
  const sourcePolygons = [...target, ...tool]
  const targetTriangles = target.flatMap((polygon) => triangulatePolygon(polygon))
  const toolTriangles = tool.flatMap((polygon) => triangulatePolygon(polygon))
  const planes = uniquePlanes(sourcePolygons.map((polygon) => polygon.plane))
  const fragments = fragmentPolygons(sourcePolygons, planes)
  const allPositions = fragments.flatMap((polygon) => polygon.vertices.map((vertex) => vertex.pos))
  const scaleValue = Math.max(1, Math.max(...allPositions.map((point) => length(point))))
  const result: CsgPolygon[] = []
  for (const fragment of fragments) {
    const point = centroid(fragment)
    const probe = probeDistance(point, fragment.plane.normal, planes, scaleValue)
    const plusPoint = add(point, scale(fragment.plane.normal, probe))
    const minusPoint = subtract(point, scale(fragment.plane.normal, probe))
    const plusInside = evaluateOperation(
      pointInsideSolid(plusPoint, targetTriangles),
      pointInsideSolid(plusPoint, toolTriangles),
      operation,
    )
    const minusInside = evaluateOperation(
      pointInsideSolid(minusPoint, targetTriangles),
      pointInsideSolid(minusPoint, toolTriangles),
      operation,
    )
    if (plusInside === minusInside) continue
    result.push(plusInside ? reversePolygon(fragment) : fragment)
  }
  return result
}

function coordinateKey(point: ReadonlyVec3): string {
  return point.map((value) => Math.round(value / SNAP_EPSILON)).join(':')
}

function geometryKey(polygon: CsgPolygon): string {
  const points = polygon.vertices.map((vertex) => coordinateKey(vertex.pos))
  const rotations = points.map((_, index) =>
    [...points.slice(index), ...points.slice(0, index)].join('|'),
  )
  const reversed = [...points].reverse()
  for (let index = 0; index < points.length; index += 1) {
    rotations.push([...reversed.slice(index), ...reversed.slice(0, index)].join('|'))
  }
  return `${Math.min(...rotations.map((value) => value.length))}:${rotations.sort()[0]}`
}

function polygonKey(polygon: CsgPolygon): string {
  return `${geometryKey(polygon)}:${polygon.source}:${polygon.sourceFaceId}`
}

function uniquePolygons(polygons: readonly CsgPolygon[]): CsgPolygon[] {
  const seen = new Map<string, CsgPolygon>()
  for (const polygon of polygons) {
    const cleaned = makePolygon(
      polygon.vertices,
      polygon.source,
      polygon.sourceFaceId,
      polygon.surface,
    )
    if (!cleaned) continue
    for (const candidate of isConvexPolygon(cleaned) ? [cleaned] : triangulatePolygon(cleaned)) {
      const key = geometryKey(candidate)
      const previous = seen.get(key)
      if (!previous || (previous.source === 'tool' && candidate.source === 'target'))
        seen.set(key, candidate)
    }
  }
  return [...seen.values()].sort((left, right) => polygonKey(left).localeCompare(polygonKey(right)))
}

function pointOnSegment(point: ReadonlyVec3, start: ReadonlyVec3, end: ReadonlyVec3): boolean {
  const direction = subtract(end, start)
  const offset = subtract(point, start)
  const directionLengthSquared = dot(direction, direction)
  if (directionLengthSquared <= EPSILON * EPSILON) return samePoint(point, start)
  if (length(cross(direction, offset)) > EPSILON * Math.sqrt(directionLengthSquared)) return false
  const parameter = dot(offset, direction) / directionLengthSquared
  return parameter > EPSILON && parameter < 1 - EPSILON
}

function subdividePolygonEdges(polygons: readonly CsgPolygon[]): CsgPolygon[] {
  const points = [
    ...new Map(
      polygons.flatMap((polygon) =>
        polygon.vertices.map((vertex) => [coordinateKey(vertex.pos), vertex.pos] as const),
      ),
    ).values(),
  ]
  return polygons.flatMap((polygon) => {
    const vertices: CsgVertex[] = []
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const start = polygon.vertices[index]!.pos
      const end = polygon.vertices[(index + 1) % polygon.vertices.length]!.pos
      const pointsOnEdge = points
        .filter((point) => pointOnSegment(point, start, end))
        .map((point) => ({
          point,
          parameter:
            dot(subtract(point, start), subtract(end, start)) /
            dot(subtract(end, start), subtract(end, start)),
        }))
        .sort((left, right) => left.parameter - right.parameter)
      vertices.push({ pos: clonePoint(start) })
      vertices.push(...pointsOnEdge.map(({ point }) => ({ pos: clonePoint(point) })))
    }
    const cleaned = cleanPolygonVertices(vertices, true)
    return cleaned.length >= 3 ? [{ ...polygon, vertices: cleaned }] : []
  })
}

function sourceFeatureIds(body: BodyNodeType): string[] {
  return [
    ...body.vertices,
    ...body.halfEdges,
    ...body.loops,
    ...body.faces,
    ...body.shells,
    ...body.curves,
  ].map(({ id }) => id)
}

function buildBody(
  target: BodyNodeType,
  tool: BodyNodeType,
  polygons: readonly CsgPolygon[],
  operation: BodyCsgOperation,
  targetSource: readonly CsgPolygon[],
): BodyCsgResult {
  const orderedPolygons = subdividePolygonEdges(uniquePolygons(polygons))
  if (orderedPolygons.length === 0) {
    throw new BodyCsgError('csg.result.empty', `CSG ${operation} produced an empty result`, [
      target.id,
    ])
  }
  const vertices: BodyNodeType['vertices'] = []
  const vertexIds = new Map<string, string>()
  const vertexFor = (point: ReadonlyVec3): string => {
    const key = coordinateKey(point)
    const existing = vertexIds.get(key)
    if (existing) return existing
    const id = `vertex:csg:${String(vertices.length).padStart(5, '0')}`
    vertexIds.set(key, id)
    vertices.push({ id, position: clonePoint(point) })
    return id
  }
  const loops: BodyNodeType['loops'] = []
  const faces: BodyNodeType['faces'] = []
  const halfEdges: BodyNodeType['halfEdges'] = []
  const split: Record<string, string[]> = {}
  const faceIdsForSource = new Map<string, string[]>()
  for (const [index, polygon] of orderedPolygons.entries()) {
    const faceId = `face:csg:${operation}:${String(index).padStart(5, '0')}`
    const loopId = `loop:csg:${operation}:${String(index).padStart(5, '0')}`
    const edgeIds = polygon.vertices.map(
      (_, edgeIndex) => `edge:csg:${operation}:${String(index).padStart(5, '0')}:${edgeIndex}`,
    )
    loops.push({ id: loopId, faceId, kind: 'outer' })
    faces.push({
      id: faceId,
      outerLoopId: loopId,
      innerLoopIds: [],
      surface: {
        ...polygon.surface,
        uvOrigin: [...polygon.surface.uvOrigin] as Vec3,
        uvU: [...polygon.surface.uvU] as Vec3,
        uvV: [...polygon.surface.uvV] as Vec3,
      },
    })
    for (let edgeIndex = 0; edgeIndex < edgeIds.length; edgeIndex += 1) {
      halfEdges.push({
        id: edgeIds[edgeIndex]!,
        vertexId: vertexFor(polygon.vertices[edgeIndex]!.pos),
        twinId: null,
        nextId: edgeIds[(edgeIndex + 1) % edgeIds.length]!,
        loopId,
      })
    }
    const key = provenanceKey(polygon)
    faceIdsForSource.set(key, [...(faceIdsForSource.get(key) ?? []), faceId])
  }
  const edgesByUndirected = new Map<string, BodyNodeType['halfEdges'][number][]>()
  const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex]))
  for (const edge of halfEdges) {
    const next = halfEdges.find((candidate) => candidate.id === edge.nextId)
    const from = vertexById.get(edge.vertexId)?.position
    const to = next ? vertexById.get(next.vertexId)?.position : undefined
    if (!from || !to) continue
    const fromKey = coordinateKey(from)
    const toKey = coordinateKey(to)
    const undirectedKey = [fromKey, toKey].sort().join('|')
    edgesByUndirected.set(undirectedKey, [...(edgesByUndirected.get(undirectedKey) ?? []), edge])
  }
  for (const [key, edges] of edgesByUndirected) {
    if (edges.length !== 2) {
      throw new BodyCsgError(
        'csg.result.invalid',
        `CSG generated a non-manifold edge ${key}`,
        edges.map(({ id }) => id),
      )
    }
    const first = edges[0]!
    const firstNext = halfEdges.find((candidate) => candidate.id === first.nextId)
    if (!firstNext)
      throw new BodyCsgError('csg.result.invalid', 'CSG generated a broken edge cycle', [first.id])
    const firstFrom = vertexById.get(first.vertexId)?.position
    const firstTo = vertexById.get(firstNext.vertexId)?.position
    if (!firstFrom || !firstTo)
      throw new BodyCsgError('csg.result.invalid', 'CSG generated a missing edge vertex', [
        first.id,
      ])
    const opposite = edges.find((edge) => {
      const next = halfEdges.find((candidate) => candidate.id === edge.nextId)
      return (
        next &&
        coordinateKey(vertexById.get(edge.vertexId)!.position) === coordinateKey(firstTo) &&
        coordinateKey(vertexById.get(next.vertexId)!.position) === coordinateKey(firstFrom)
      )
    })
    if (!opposite || opposite.id === first.id) {
      throw new BodyCsgError('csg.result.invalid', 'CSG generated same-direction adjacent faces', [
        first.id,
      ])
    }
    first.twinId = opposite.id
    opposite.twinId = first.id
  }
  const shellId = target.shells[0]?.id ?? 'shell:csg:0'
  const body = BodyNode.parse({
    ...target,
    revision: target.revision + 1,
    vertices,
    halfEdges,
    loops,
    faces,
    curves: [],
    shells: [{ id: shellId, faceIds: faces.map((face) => face.id) }],
  })
  const inspection = inspectBodySolid(body)
  if (!inspection.validSolid || !validateBodyTopology(body).valid) {
    throw new BodyCsgError(
      'csg.result.invalid',
      `CSG ${operation} generated invalid topology`,
      inspection.diagnostics.flatMap((diagnostic) => diagnostic.featureIds),
    )
  }
  for (const polygon of targetSource) {
    const ids = faceIdsForSource.get(provenanceKey(polygon)) ?? []
    if (ids.length > 0) split[polygon.sourceFaceId] = [...new Set(ids)].sort()
  }
  const resultIds = sourceFeatureIds(body)
  const sourceIds = new Set(sourceFeatureIds(target))
  const remap: TopologyRemap = {
    preserved: [shellId],
    created: resultIds.filter((id) => id !== shellId),
    deleted: [...sourceIds].filter((id) => !resultIds.includes(id)),
    split,
    merged: {},
  }
  return { body, topologyRemap: remap }
}

export function booleanBodies(
  target: BodyNodeType,
  tool: BodyNodeType,
  operation: BodyCsgOperation,
): BodyCsgResult {
  if (target.parentId !== tool.parentId) {
    throw new BodyCsgError(
      'csg.tool.invalid',
      'CSG requires target and tool Bodies to share a parent coordinate frame',
      [target.id, tool.id],
    )
  }
  const targetPolygons = bodyPolygons(target, 'target')
  const toolPolygons = bodyPolygons(tool, 'tool')
  const polygons = applyCsg(targetPolygons, toolPolygons, operation)
  return buildBody(target, tool, polygons, operation, targetPolygons)
}

export function intersectBodies(target: BodyNodeType, tool: BodyNodeType): BodyCsgResult {
  return booleanBodies(target, tool, 'intersect')
}

export function unionBodies(target: BodyNodeType, tool: BodyNodeType): BodyCsgResult {
  return booleanBodies(target, tool, 'union')
}

export function subtractBodies(target: BodyNodeType, tool: BodyNodeType): BodyCsgResult {
  return booleanBodies(target, tool, 'subtract')
}

export function outerShellBodies(target: BodyNodeType, tool: BodyNodeType): BodyCsgResult {
  return unionBodies(target, tool)
}

export function trimBodies(target: BodyNodeType, tool: BodyNodeType): BodyCsgResult {
  return subtractBodies(target, tool)
}

function omitEmptyResult(operation: () => BodyCsgResult): BodyCsgResult | null {
  try {
    return operation()
  } catch (error) {
    if (error instanceof BodyCsgError && error.code === 'csg.result.empty') return null
    throw error
  }
}

export function splitBodies(target: BodyNodeType, tool: BodyNodeType): BodySplitResult {
  const candidates = [
    { kind: 'target-only' as const, result: omitEmptyResult(() => subtractBodies(target, tool)) },
    { kind: 'intersection' as const, result: omitEmptyResult(() => intersectBodies(target, tool)) },
    { kind: 'tool-only' as const, result: omitEmptyResult(() => subtractBodies(tool, target)) },
  ]
  const nonEmpty = candidates.filter(
    (
      candidate,
    ): candidate is { readonly kind: BodySplitPieceKind; readonly result: BodyCsgResult } =>
      candidate.result !== null,
  )
  if (nonEmpty.length < 2) {
    throw new BodyCsgError(
      'csg.result.invalid',
      'CSG split requires at least two non-empty pieces',
      [target.id, tool.id],
    )
  }
  const ids = [target.id, tool.id, `${target.id}:split:${tool.id}`]
  return {
    pieces: nonEmpty.map(({ kind, result }, index) => ({
      kind,
      body: BodyNode.parse({ ...result.body, id: ids[index] }),
      topologyRemap: result.topologyRemap,
    })),
  }
}
