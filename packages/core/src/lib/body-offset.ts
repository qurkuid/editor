import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyById, bodyFeatureIds, orderedBodyLoopEdges } from './body-imprint-helpers'
import {
  createPlanarPointProjection,
  pointInPolygon,
  polygonArea,
  segmentsIntersect,
  validateImprintProfile,
} from './body-imprint-validation'
import {
  getBodyFaceFrame,
  getBodyLoopVertices,
  type TopologyRemap,
  validateBodyTopology,
} from './body-topology'

type Point2 = readonly [number, number]
type Point3 = readonly [number, number, number]

export type OffsetBodyFaceResult = {
  readonly body: BodyNodeType
  readonly sourceFaceId: string
  readonly createdFaceId: string
  readonly topologyRemap: TopologyRemap
}

const EPSILON = 1e-8

const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0]

function offsetError(
  message: string,
  featureIds: readonly (string | undefined)[] = [],
): RangeError {
  const ids = [...new Set(featureIds.filter((id): id is string => Boolean(id)))]
  return new RangeError(ids.length > 0 ? `${message}: ${ids.join(', ')}` : message)
}

function validateOffsetProfile(
  profile: readonly Point3[],
  host: readonly Point3[],
  normal: Point3,
  featureIds: readonly string[],
): void {
  try {
    validateImprintProfile(profile, host, normal)
  } catch (error) {
    if (error instanceof RangeError) throw offsetError(error.message, featureIds)
    throw error
  }
}

function intersectLines(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): Point2 | null {
  const firstDirection: Point2 = [firstEnd[0] - firstStart[0], firstEnd[1] - firstStart[1]]
  const secondDirection: Point2 = [secondEnd[0] - secondStart[0], secondEnd[1] - secondStart[1]]
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= EPSILON) return null
  const delta: Point2 = [secondStart[0] - firstStart[0], secondStart[1] - firstStart[1]]
  const parameter = cross(delta, secondDirection) / denominator
  return [
    firstStart[0] + firstDirection[0] * parameter,
    firstStart[1] + firstDirection[1] * parameter,
  ]
}

function offsetPolygon(
  points: readonly Point2[],
  distance: number,
  featureIds: readonly string[] = [],
): Point2[] {
  const area = polygonArea(points)
  const winding = Math.sign(area)
  if (winding === 0) throw offsetError('Offset requires a non-degenerate face profile', featureIds)
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]
    const next = points[(index + 1) % points.length]
    if (!previous || !next) {
      throw offsetError('Offset profile has an invalid vertex', [featureIds[index]])
    }
    const previousLength = Math.hypot(point[0] - previous[0], point[1] - previous[1])
    const nextLength = Math.hypot(next[0] - point[0], next[1] - point[1])
    if (previousLength <= EPSILON || nextLength <= EPSILON) {
      throw offsetError('Offset profile has a collapsed edge', [
        featureIds[(index - 1 + points.length) % points.length],
        featureIds[index],
      ])
    }
    const previousNormal: Point2 = [
      (winding * (point[1] - previous[1])) / previousLength,
      (-winding * (point[0] - previous[0])) / previousLength,
    ]
    const nextNormal: Point2 = [
      (winding * (next[1] - point[1])) / nextLength,
      (-winding * (next[0] - point[0])) / nextLength,
    ]
    const previousStart: Point2 = [
      previous[0] + previousNormal[0] * distance,
      previous[1] + previousNormal[1] * distance,
    ]
    const previousEnd: Point2 = [
      point[0] + previousNormal[0] * distance,
      point[1] + previousNormal[1] * distance,
    ]
    const nextStart: Point2 = [
      point[0] + nextNormal[0] * distance,
      point[1] + nextNormal[1] * distance,
    ]
    const nextEnd: Point2 = [next[0] + nextNormal[0] * distance, next[1] + nextNormal[1] * distance]
    const intersection = intersectLines(previousStart, previousEnd, nextStart, nextEnd)
    if (!intersection) {
      throw offsetError('Offset profile has a parallel or collinear join', [
        featureIds[(index - 1 + points.length) % points.length],
        featureIds[index],
      ])
    }
    return intersection
  })
}

function assertSimpleProfile(
  points: readonly Point2[],
  source: readonly Point2[],
  featureIds: readonly string[] = [],
): void {
  const area = polygonArea(points)
  if (Math.abs(area) <= EPSILON || Math.sign(area) !== Math.sign(polygonArea(source))) {
    throw offsetError('Offset profile would collapse or reverse winding', featureIds)
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const next = points[(index + 1) % points.length]
    const sourcePoint = source[index]
    const sourceNext = source[(index + 1) % source.length]
    if (!point || !next || Math.hypot(next[0] - point[0], next[1] - point[1]) <= EPSILON) {
      throw offsetError('Offset profile has a collapsed edge', [featureIds[index]])
    }
    if (!sourcePoint || !sourceNext) {
      throw offsetError('Offset source profile has an invalid edge', [featureIds[index]])
    }
    const directionDot =
      (next[0] - point[0]) * (sourceNext[0] - sourcePoint[0]) +
      (next[1] - point[1]) * (sourceNext[1] - sourcePoint[1])
    if (directionDot <= 0) {
      throw offsetError('Offset profile would collapse or reverse winding', [featureIds[index]])
    }
    for (let other = index + 1; other < points.length; other += 1) {
      const otherPoint = points[other]
      const otherNext = points[(other + 1) % points.length]
      const adjacent = other === index + 1 || (index === 0 && other === points.length - 1)
      if (
        !adjacent &&
        otherPoint &&
        otherNext &&
        segmentsIntersect(point, next, otherPoint, otherNext)
      ) {
        throw offsetError('Offset profile would self-intersect', [
          featureIds[index],
          featureIds[other],
        ])
      }
    }
  }
}

function rejectObstacleContact(
  candidate: readonly Point2[],
  obstacle: readonly Point2[],
  message: string,
  featureIds: readonly string[] = [],
): void {
  for (let index = 0; index < candidate.length; index += 1) {
    const point = candidate[index]
    const next = candidate[(index + 1) % candidate.length]
    if (!point || !next) throw offsetError('Offset profile has an invalid edge', featureIds)
    if (pointInPolygon(point, obstacle)) throw offsetError(message, featureIds)
    for (let obstacleIndex = 0; obstacleIndex < obstacle.length; obstacleIndex += 1) {
      const obstacleStart = obstacle[obstacleIndex]
      const obstacleEnd = obstacle[(obstacleIndex + 1) % obstacle.length]
      if (
        obstacleStart &&
        obstacleEnd &&
        segmentsIntersect(point, next, obstacleStart, obstacleEnd)
      ) {
        throw offsetError(message, featureIds)
      }
    }
  }
  if (obstacle.some((point) => pointInPolygon(point, candidate))) {
    throw offsetError(message, featureIds)
  }
}

function resolveEnclosingHost(
  source: BodyNodeType,
  sourceFaceId: string,
  sourceEdges: readonly { readonly id: string; readonly twinId: string | null }[],
  sourcePoints: readonly Point3[],
  normal: Point3,
): { face: BodyNodeType['faces'][number]; loop: BodyNodeType['loops'][number]; outer: Point3[] } {
  const loops = bodyById(source.loops)
  const candidates = source.faces.flatMap((face) => {
    if (face.id === sourceFaceId) return []
    return face.innerLoopIds.flatMap((loopId) => {
      const loop = loops.get(loopId)
      if (loop?.kind !== 'inner') return []
      const edges = orderedBodyLoopEdges(source, loop.id)
      const seamIds = new Set(edges.map((edge) => edge.id))
      if (
        edges.length !== sourceEdges.length ||
        sourceEdges.some((edge) => edge.twinId === null || !seamIds.has(edge.twinId))
      ) {
        return []
      }
      const outer = getBodyLoopVertices(source, face.outerLoopId)
      if (outer.length < 3) return []
      try {
        validateImprintProfile(sourcePoints, outer, normal)
        return [{ face, loop, outer }]
      } catch (error) {
        if (error instanceof RangeError) return []
        throw error
      }
    })
  })
  if (candidates.length === 0) {
    throw offsetError('Offset exterior outward requires one coplanar enclosing host', [
      sourceFaceId,
    ])
  }
  if (candidates.length !== 1) {
    throw offsetError(
      'Offset outward host is ambiguous',
      candidates.map((candidate) => candidate.face.id),
    )
  }
  const candidate = candidates[0]
  if (!candidate) throw new RangeError('Offset outward host is missing')
  return candidate
}

function assertFaceInput(
  source: BodyNodeType,
  faceId: string,
): {
  face: BodyNodeType['faces'][number]
  edges: ReturnType<typeof orderedBodyLoopEdges>
  points: Point3[]
  origin: Point3
  normal: Point3
} {
  const topology = validateBodyTopology(source)
  if (!topology.valid) {
    const diagnostic = topology.diagnostics[0]
    throw offsetError('Offset requires valid Body topology', diagnostic?.featureIds ?? [faceId])
  }
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Offset face not found: ${faceId}`)
  if (face.innerLoopIds.length > 0)
    throw offsetError('Offset rejects source faces with inner loops', [
      face.id,
      ...face.innerLoopIds,
    ])
  const shell = source.shells.find((candidate) => candidate.faceIds.includes(faceId))
  if (!shell || shell.faceIds.length < 2)
    throw offsetError('Offset requires a closed solid face', [face.id, shell?.id])
  const edges = orderedBodyLoopEdges(source, face.outerLoopId)
  if (edges.length < 3 || edges.some((edge) => edge.twinId === null)) {
    throw offsetError('Offset requires a closed outer loop', [
      face.outerLoopId,
      ...edges.filter((edge) => edge.twinId === null).map((edge) => edge.id),
    ])
  }
  const curves = bodyById(source.curves)
  const curvedEdge = edges.find(
    (edge) => edge.curveId !== undefined && curves.get(edge.curveId)?.kind !== 'line',
  )
  if (curvedEdge) {
    throw offsetError('Offset requires line edges', [curvedEdge.id, curvedEdge.curveId])
  }
  const points = getBodyLoopVertices(source, face.outerLoopId)
  if (points.length !== edges.length) {
    throw offsetError('Offset face has an invalid outer loop', [face.id, face.outerLoopId])
  }
  const frame = getBodyFaceFrame(source, faceId)
  const origin = points[0]
  if (!origin) throw offsetError('Offset face has no profile points', [face.id, face.outerLoopId])
  if (
    points.some(
      (point) =>
        Math.abs(
          (point[0] - origin[0]) * frame.normal[0] +
            (point[1] - origin[1]) * frame.normal[1] +
            (point[2] - origin[2]) * frame.normal[2],
        ) > EPSILON,
    )
  ) {
    throw offsetError('Offset requires a planar face', [
      face.id,
      ...points.map((_, index) => edges[index]?.id),
    ])
  }
  const projection = createPlanarPointProjection(origin, frame.normal)
  const projected = points.map(projection.toPlane)
  assertSimpleProfile(
    projected,
    projected,
    edges.map((edge) => edge.id),
  )
  return { face, edges, points, origin, normal: frame.normal }
}

function createRemap(
  source: BodyNodeType,
  created: readonly string[],
  splitFaceId: string,
  createdFaceId: string,
): TopologyRemap {
  return {
    preserved: bodyFeatureIds(source),
    created: [...created],
    deleted: [],
    split: { [splitFaceId]: [splitFaceId, createdFaceId] },
    merged: {},
  }
}

function buildInward(
  source: BodyNodeType,
  face: BodyNodeType['faces'][number],
  candidate: readonly Point3[],
): OffsetBodyFaceResult {
  const revision = source.revision + 1
  const base = `${face.id}:offset:${revision}`
  const createdFaceId = base
  const innerLoopId = `${base}:inner`
  const outerLoopId = `${base}:outer`
  const vertices = candidate.map((position, index) => ({
    id: `${base}:vertex:${index}`,
    position,
  }))
  const innerEdges = candidate.map((_, index) => ({
    id: `${base}:seam:${index}`,
    vertexId: `${base}:vertex:${(index + 1) % candidate.length}`,
    twinId: `${base}:edge:${index}`,
    nextId: `${base}:seam:${(index - 1 + candidate.length) % candidate.length}`,
    loopId: innerLoopId,
  }))
  const outerEdges = candidate.map((_, index) => ({
    id: `${base}:edge:${index}`,
    vertexId: `${base}:vertex:${index}`,
    twinId: `${base}:seam:${index}`,
    nextId: `${base}:edge:${(index + 1) % candidate.length}`,
    loopId: outerLoopId,
  }))
  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...source.vertices, ...vertices],
    halfEdges: [...source.halfEdges, ...innerEdges, ...outerEdges],
    loops: [
      ...source.loops,
      { id: innerLoopId, faceId: face.id, kind: 'inner' },
      { id: outerLoopId, faceId: createdFaceId, kind: 'outer' },
    ],
    faces: [
      ...source.faces.map((candidateFace) =>
        candidateFace.id === face.id
          ? { ...candidateFace, innerLoopIds: [...candidateFace.innerLoopIds, innerLoopId] }
          : candidateFace,
      ),
      { id: createdFaceId, outerLoopId, surface: { ...face.surface } },
    ],
    shells: source.shells.map((shell) =>
      shell.faceIds.includes(face.id)
        ? { ...shell, faceIds: [...shell.faceIds, createdFaceId] }
        : shell,
    ),
  })
  if (!validateBodyTopology(body).valid)
    throw new RangeError('Offset produced invalid Body topology')
  return {
    body,
    sourceFaceId: face.id,
    createdFaceId,
    topologyRemap: createRemap(
      source,
      [
        ...vertices,
        ...innerEdges,
        ...outerEdges,
        { id: innerLoopId },
        { id: outerLoopId },
        { id: createdFaceId },
      ].map(({ id }) => id),
      face.id,
      createdFaceId,
    ),
  }
}

function buildOutward(
  source: BodyNodeType,
  sourceFace: BodyNodeType['faces'][number],
  host: ReturnType<typeof resolveEnclosingHost>,
  candidate: readonly Point3[],
): OffsetBodyFaceResult {
  const revision = source.revision + 1
  const base = `${sourceFace.id}:offset:${revision}`
  const createdFaceId = base
  const outerLoopId = `${base}:outer`
  const hostInnerLoopId = `${base}:host-inner`
  const vertices = candidate.map((position, index) => ({
    id: `${base}:vertex:${index}`,
    position,
  }))
  const outerEdges = candidate.map((_, index) => ({
    id: `${base}:edge:${index}`,
    vertexId: `${base}:vertex:${index}`,
    twinId: `${base}:host-edge:${index}`,
    nextId: `${base}:edge:${(index + 1) % candidate.length}`,
    loopId: outerLoopId,
  }))
  const hostInnerEdges = candidate.map((_, index) => ({
    id: `${base}:host-edge:${index}`,
    vertexId: `${base}:vertex:${(index + 1) % candidate.length}`,
    twinId: `${base}:edge:${index}`,
    nextId: `${base}:host-edge:${(index - 1 + candidate.length) % candidate.length}`,
    loopId: hostInnerLoopId,
  }))
  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...source.vertices, ...vertices],
    halfEdges: [...source.halfEdges, ...outerEdges, ...hostInnerEdges],
    loops: [
      ...source.loops.map((loop) =>
        loop.id === host.loop.id ? { ...loop, faceId: createdFaceId } : loop,
      ),
      { id: outerLoopId, faceId: createdFaceId, kind: 'outer' },
      { id: hostInnerLoopId, faceId: host.face.id, kind: 'inner' },
    ],
    faces: [
      ...source.faces.map((face) =>
        face.id === host.face.id
          ? {
              ...face,
              innerLoopIds: [
                ...face.innerLoopIds.filter((id) => id !== host.loop.id),
                hostInnerLoopId,
              ],
            }
          : face,
      ),
      {
        id: createdFaceId,
        outerLoopId,
        innerLoopIds: [host.loop.id],
        surface: { ...host.face.surface },
      },
    ],
    shells: source.shells.map((shell) =>
      shell.faceIds.includes(host.face.id)
        ? { ...shell, faceIds: [...shell.faceIds, createdFaceId] }
        : shell,
    ),
  })
  if (!validateBodyTopology(body).valid)
    throw new RangeError('Offset produced invalid Body topology')
  return {
    body,
    sourceFaceId: sourceFace.id,
    createdFaceId,
    topologyRemap: createRemap(
      source,
      [
        ...vertices,
        ...outerEdges,
        ...hostInnerEdges,
        { id: outerLoopId },
        { id: hostInnerLoopId },
        { id: createdFaceId },
      ].map(({ id }) => id),
      host.face.id,
      createdFaceId,
    ),
  }
}

export function offsetBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
): OffsetBodyFaceResult {
  if (!Number.isFinite(distance) || distance === 0) {
    throw new RangeError('Offset requires a non-zero finite distance')
  }
  const input = assertFaceInput(source, faceId)
  const projection = createPlanarPointProjection(input.origin, input.normal)
  const source2d = input.points.map(projection.toPlane)
  const sourceEdgeIds = input.edges.map((edge) => edge.id)
  const candidate2d = offsetPolygon(source2d, distance, sourceEdgeIds)
  assertSimpleProfile(candidate2d, source2d, sourceEdgeIds)
  const candidate3d = candidate2d.map(projection.fromPlane)

  if (distance < 0) {
    validateOffsetProfile(candidate3d, input.points, input.normal, [
      input.face.id,
      ...sourceEdgeIds,
    ])
    return buildInward(source, input.face, candidate3d)
  }

  const host = resolveEnclosingHost(source, faceId, input.edges, input.points, input.normal)
  validateOffsetProfile(input.points, candidate3d, input.normal, sourceEdgeIds)
  validateOffsetProfile(candidate3d, host.outer, input.normal, [input.face.id, host.face.id])
  const siblingHoles = host.face.innerLoopIds
    .filter((loopId) => loopId !== host.loop.id)
    .map((loopId) => ({
      loopId,
      points: getBodyLoopVertices(source, loopId).map(projection.toPlane),
    }))
  for (const sibling of siblingHoles) {
    if (sibling.points.length < 3) {
      throw offsetError('Offset host has an invalid sibling hole', [host.face.id, sibling.loopId])
    }
    rejectObstacleContact(
      candidate2d,
      sibling.points,
      'Offset profile touches or crosses a sibling hole',
      [host.face.id, sibling.loopId],
    )
  }
  return buildOutward(source, input.face, host, candidate3d)
}
