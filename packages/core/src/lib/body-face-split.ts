import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyFeatureIds, orderedBodyLoopEdges } from './body-imprint-helpers'
import {
  createPlanarPointProjection,
  pointInPolygon,
  polygonArea,
  segmentsIntersect,
} from './body-imprint-validation'
import { getBodyFaceFrame, type TopologyRemap, validateBodyTopology } from './body-topology'

type Point3 = readonly [number, number, number]
type Point2 = readonly [number, number]

const EPSILON = 1e-8
const POINT_EPSILON = 1e-7

export type SplitBodyFaceResult = {
  readonly body: BodyNodeType
  readonly splitFaceId: string
  readonly remap: TopologyRemap
}

type Endpoint = {
  readonly pathIndex: 0 | 1
  readonly point: Point3
  readonly point2: Point2
  readonly vertexId: string
  readonly edgeId?: string
  readonly edgeIndex?: number
  readonly t?: number
}

type SplitPoint = {
  readonly t: number
  readonly vertexId: string
}

function distance2(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function cross2(first: Point2, second: Point2, third: Point2): number {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
  )
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  if (Math.abs(cross2(start, end, point)) > POINT_EPSILON) return false
  return (
    point[0] >= Math.min(start[0], end[0]) - POINT_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + POINT_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - POINT_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + POINT_EPSILON
  )
}

function equalPoint(first: Point2, second: Point2): boolean {
  return distance2(first, second) <= POINT_EPSILON
}

function finitePoint(point: Point3): boolean {
  return point.length === 3 && point.every((coordinate) => Number.isFinite(coordinate))
}

function boundaryHitIsEndpoint(
  point: Point2,
  segmentStart: Point2,
  segmentEnd: Point2,
  startOnBoundary: boolean,
  endOnBoundary: boolean,
): boolean {
  return (
    (startOnBoundary && equalPoint(point, segmentStart)) ||
    (endOnBoundary && equalPoint(point, segmentEnd))
  )
}

function validatePathInsideFace(
  path: readonly Point2[],
  host: readonly Point2[],
  boundaryEndpoints: readonly [boolean, boolean],
): void {
  if (Math.abs(polygonArea(host)) <= EPSILON) {
    throw new RangeError('Split host face must enclose a non-zero area')
  }
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]
    if (!point) throw new RangeError('Split path has an invalid point')
    const isEndpoint = index === 0 || index === path.length - 1
    if (!isEndpoint && !pointInPolygon(point, host)) {
      throw new RangeError('Split path interior points must be strictly inside the host face')
    }
    if (index === 0 || index === path.length - 1) continue
    for (let hostIndex = 0; hostIndex < host.length; hostIndex += 1) {
      const start = host[hostIndex]
      const end = host[(hostIndex + 1) % host.length]
      if (start && end && pointOnSegment(point, start, end)) {
        throw new RangeError('Split path must not follow or touch the host boundary')
      }
    }
  }
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index]
    const end = path[index + 1]
    if (!start || !end || distance2(start, end) <= POINT_EPSILON) {
      throw new RangeError('Split path has a collapsed segment')
    }
    const midpoint: Point2 = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5]
    if (!pointInPolygon(midpoint, host)) {
      throw new RangeError('Split path must remain inside the host face')
    }
    const startIsBoundary = index === 0 && boundaryEndpoints[0]
    const endIsBoundary = index === path.length - 2 && boundaryEndpoints[1]
    for (let hostIndex = 0; hostIndex < host.length; hostIndex += 1) {
      const boundaryStart = host[hostIndex]
      const boundaryEnd = host[(hostIndex + 1) % host.length]
      if (!boundaryStart || !boundaryEnd) continue
      if (!segmentsIntersect(start, end, boundaryStart, boundaryEnd)) continue
      const allowedStart = startIsBoundary && pointOnSegment(start, boundaryStart, boundaryEnd)
      const allowedEnd = endIsBoundary && pointOnSegment(end, boundaryStart, boundaryEnd)
      if (allowedStart && boundaryHitIsEndpoint(start, start, end, true, false)) continue
      if (allowedEnd && boundaryHitIsEndpoint(end, start, end, false, true)) continue
      throw new RangeError('Split path must not cross or follow the host boundary')
    }
  }
  for (let first = 0; first < path.length - 1; first += 1) {
    const firstStart = path[first]
    const firstEnd = path[first + 1]
    if (!firstStart || !firstEnd) continue
    for (let second = first + 1; second < path.length - 1; second += 1) {
      const secondStart = path[second]
      const secondEnd = path[second + 1]
      if (
        !secondStart ||
        !secondEnd ||
        !segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
      ) {
        continue
      }
      const adjacent = second === first + 1
      if (!adjacent) throw new RangeError('Split path must not self-intersect')
      if (
        Math.abs(cross2(firstStart, firstEnd, secondEnd)) <= POINT_EPSILON &&
        (pointOnSegment(secondEnd, firstStart, firstEnd) ||
          pointOnSegment(firstStart, secondStart, secondEnd))
      ) {
        throw new RangeError('Split path has overlapping adjacent segments')
      }
    }
  }
}

function splitBoundaryEdge(
  edges: Map<string, BodyNodeType['halfEdges'][number]>,
  vertices: Map<string, BodyNodeType['vertices'][number]>,
  edge: BodyNodeType['halfEdges'][number],
  splitPoints: readonly SplitPoint[],
  revision: number,
): { edgeIds: string[]; vertexIds: string[]; sideEdgeIds: string[] } {
  const next = edges.get(edge.nextId)
  if (!next) throw new RangeError('Split boundary edge has no successor')
  const startVertex = vertices.get(edge.vertexId)
  const endVertex = vertices.get(next.vertexId)
  if (!startVertex || !endVertex) throw new RangeError('Split boundary edge has missing vertices')
  const sorted = [...splitPoints].sort((first, second) => first.t - second.t)
  const endpointVertices = [edge.vertexId, ...sorted.map(({ vertexId }) => vertexId), next.vertexId]
  const edgeIds = [edge.id, ...sorted.map((_, index) => `${edge.id}:split:${revision}:${index}`)]
  const twin = edge.twinId ? edges.get(edge.twinId) : undefined
  if (edge.twinId && (!twin || twin.twinId !== edge.id)) {
    throw new RangeError('Split boundary edge twin is invalid')
  }
  const sideEdgeIds = twin
    ? [twin.id, ...sorted.map((_, index) => `${twin.id}:split:${revision}:${index}`)]
    : []
  const oldNextId = edge.nextId
  const oldTwinNextId = twin?.nextId
  for (let index = 0; index < edgeIds.length; index += 1) {
    const id = edgeIds[index]
    const nextId = edgeIds[index + 1] ?? oldNextId
    if (!id || !endpointVertices[index])
      throw new RangeError('Split boundary edge allocation failed')
    edges.set(id, {
      ...(index === 0 ? edge : { ...edge, id }),
      id,
      vertexId: endpointVertices[index]!,
      twinId: twin ? sideEdgeIds[sideEdgeIds.length - 1 - index]! : null,
      nextId,
      loopId: edge.loopId,
    })
  }
  if (twin) {
    const sideVertices = [
      next.vertexId,
      ...sorted.map(({ vertexId }) => vertexId).reverse(),
      edge.vertexId,
    ]
    for (let index = 0; index < sideEdgeIds.length; index += 1) {
      const id = sideEdgeIds[index]
      const nextId = sideEdgeIds[index + 1] ?? oldTwinNextId
      if (!id || !sideVertices[index] || !nextId) {
        throw new RangeError('Split twin edge allocation failed')
      }
      edges.set(id, {
        ...(index === 0 ? twin : { ...twin, id }),
        id,
        vertexId: sideVertices[index]!,
        twinId: edgeIds[edgeIds.length - 1 - index]!,
        nextId,
        loopId: twin.loopId,
      })
    }
  }
  return { edgeIds, vertexIds: endpointVertices, sideEdgeIds }
}

function walkBoundary(
  edges: readonly BodyNodeType['halfEdges'][number][],
  from: number,
  to: number,
): BodyNodeType['halfEdges'][number][] {
  const walked: BodyNodeType['halfEdges'][number][] = []
  let index = from
  while (index !== to) {
    const edge = edges[index]
    if (!edge) throw new RangeError('Split boundary chain is invalid')
    walked.push(edge)
    index = (index + 1) % edges.length
    if (walked.length > edges.length) throw new RangeError('Split boundary chain did not close')
  }
  return walked
}

function splitBodyFaceOnce(
  source: BodyNodeType,
  faceId: string,
  pathPoints: readonly Point3[],
  revision: number,
): SplitBodyFaceResult {
  if (pathPoints.length < 2 || pathPoints.length > 256) {
    throw new RangeError('Split path requires between two and 256 points')
  }
  if (pathPoints.some((point) => !finitePoint(point))) {
    throw new RangeError('Split path requires finite points')
  }
  const topology = validateBodyTopology(source)
  if (!topology.valid) throw new RangeError('Split requires valid Body topology')
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Split face not found: ${faceId}`)
  if (face.innerLoopIds.length > 0)
    throw new RangeError('Split currently rejects faces with inner loops')
  const hostEdges = orderedBodyLoopEdges(source, face.outerLoopId)
  if (hostEdges.length < 3 || hostEdges.some((edge) => edge.curveId !== undefined)) {
    throw new RangeError('Split requires a planar host face with line edges')
  }
  const verticesById = new Map(source.vertices.map((vertex) => [vertex.id, vertex]))
  const hostPoints = hostEdges.map((edge) => verticesById.get(edge.vertexId)?.position)
  if (hostPoints.some((point) => !point))
    throw new RangeError('Split host face has missing vertices')
  const points = hostPoints as Point3[]
  const frame = getBodyFaceFrame(source, faceId)
  const origin = points[0]!
  const projection = createPlanarPointProjection(origin, frame.normal)
  const host2d = points.map(projection.toPlane)
  const path2d = pathPoints.map(projection.toPlane)
  for (const point of pathPoints) {
    const delta: Point3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]
    if (
      Math.abs(
        delta[0] * frame.normal[0] + delta[1] * frame.normal[1] + delta[2] * frame.normal[2],
      ) > POINT_EPSILON
    ) {
      throw new RangeError('Split path must be coplanar with the host face')
    }
  }

  const endpointCandidates: Endpoint[] = []
  const endpointVertexIds = new Set<string>()
  for (const pathIndex of [0, 1] as const) {
    const point = pathPoints[pathIndex === 0 ? 0 : pathPoints.length - 1]!
    const point2 = path2d[pathIndex === 0 ? 0 : path2d.length - 1]!
    const existingIndex = host2d.findIndex((candidate) => equalPoint(candidate, point2))
    if (existingIndex >= 0) {
      const edge = hostEdges[existingIndex]
      if (!edge) throw new RangeError('Split endpoint vertex is invalid')
      if (endpointVertexIds.has(edge.vertexId))
        throw new RangeError('Split endpoints must be distinct')
      endpointVertexIds.add(edge.vertexId)
      endpointCandidates.push({
        pathIndex,
        point,
        point2,
        vertexId: edge.vertexId,
        edgeIndex: existingIndex,
      })
      continue
    }
    const boundaryEdge = host2d.findIndex((start, index) => {
      const end = host2d[(index + 1) % host2d.length]
      return Boolean(end && pointOnSegment(point2, start, end))
    })
    if (boundaryEdge < 0)
      throw new RangeError('Split endpoints must lie on the host outer boundary')
    const start = host2d[boundaryEdge]!
    const end = host2d[(boundaryEdge + 1) % host2d.length]!
    const denominator = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (denominator <= EPSILON) throw new RangeError('Split host face has a collapsed edge')
    const t = Math.hypot(point2[0] - start[0], point2[1] - start[1]) / denominator
    if (t <= POINT_EPSILON || t >= 1 - POINT_EPSILON) {
      throw new RangeError('Split endpoint must be a host vertex or edge interior')
    }
    const vertexId = `${face.id}:split:${revision}:endpoint:${pathIndex}`
    endpointCandidates.push({
      pathIndex,
      point,
      point2,
      vertexId,
      edgeId: hostEdges[boundaryEdge]!.id,
      edgeIndex: boundaryEdge,
      t,
    })
  }
  if (!endpointCandidates[0] || !endpointCandidates[1])
    throw new RangeError('Split endpoints are missing')
  validatePathInsideFace(path2d, host2d, [true, true])

  const splitFaceId = `${face.id}:split:${revision}`
  const newLoopId = `${face.outerLoopId}:split:${revision}`
  const vertices = new Map(source.vertices.map((vertex) => [vertex.id, vertex]))
  const edges = new Map(source.halfEdges.map((edge) => [edge.id, edge]))
  const splitByEdge = new Map<string, SplitPoint[]>()
  for (const endpoint of endpointCandidates) {
    if (!endpoint.edgeId || endpoint.t === undefined) continue
    const pointsForEdge = splitByEdge.get(endpoint.edgeId) ?? []
    pointsForEdge.push({ t: endpoint.t, vertexId: endpoint.vertexId })
    splitByEdge.set(endpoint.edgeId, pointsForEdge)
    vertices.set(endpoint.vertexId, {
      id: endpoint.vertexId,
      position: [...endpoint.point] as [number, number, number],
    })
  }
  const splitRemap: Record<string, string[]> = {}
  for (const [edgeId, splitPoints] of splitByEdge) {
    const edge = edges.get(edgeId)
    if (!edge) throw new RangeError('Split endpoint edge not found')
    if (edge.curveId !== undefined)
      throw new RangeError('Split does not support curved boundary edges')
    const split = splitBoundaryEdge(edges, vertices, edge, splitPoints, revision)
    splitRemap[edge.id] = split.edgeIds
    if (edge.twinId) splitRemap[edge.twinId] = split.sideEdgeIds
  }
  const splitHostEdges = orderedBodyLoopEdges(
    { ...source, halfEdges: [...edges.values()] },
    face.outerLoopId,
  )
  if (splitHostEdges.length < 3)
    throw new RangeError('Split host loop is invalid after endpoint splitting')
  const startEndpoint = endpointCandidates[0]
  const endEndpoint = endpointCandidates[1]
  const startIndex = splitHostEdges.findIndex((edge) => edge.vertexId === startEndpoint.vertexId)
  const endIndex = splitHostEdges.findIndex((edge) => edge.vertexId === endEndpoint.vertexId)
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) {
    throw new RangeError('Split endpoints do not define two host boundary chains')
  }
  const originalChain = walkBoundary(splitHostEdges, startIndex, endIndex)
  const newChain = walkBoundary(splitHostEdges, endIndex, startIndex)
  if (originalChain.length < 1 || newChain.length < 1)
    throw new RangeError('Split boundary chain is empty')

  const internalVertices = pathPoints.slice(1, -1).map((point, index) => {
    const id = `${splitFaceId}:vertex:${index}`
    vertices.set(id, { id, position: [...point] as [number, number, number] })
    return id
  })
  const pathVertexIds = [startEndpoint.vertexId, ...internalVertices, endEndpoint.vertexId]
  const forwardSeamIds = pathVertexIds
    .slice(0, -1)
    .map((_, index) => `${splitFaceId}:seam:forward:${index}`)
  const reverseSeamIds = pathVertexIds
    .slice(0, -1)
    .map((_, index) => `${splitFaceId}:seam:reverse:${index}`)
  if (forwardSeamIds.some((id) => edges.has(id)) || reverseSeamIds.some((id) => edges.has(id))) {
    throw new RangeError('Split seam id allocation collided')
  }
  for (let index = 0; index < forwardSeamIds.length; index += 1) {
    const forwardId = forwardSeamIds[index]!
    const reverseId = reverseSeamIds[index]!
    const forwardNext = forwardSeamIds[index + 1] ?? newChain[0]!.id
    const reverseNext = index > 0 ? reverseSeamIds[index - 1]! : originalChain[0]!.id
    edges.set(forwardId, {
      id: forwardId,
      vertexId: pathVertexIds[index]!,
      twinId: reverseId,
      nextId: forwardNext,
      loopId: newLoopId,
    })
    edges.set(reverseId, {
      id: reverseId,
      vertexId: pathVertexIds[index + 1]!,
      twinId: forwardId,
      nextId: reverseNext,
      loopId: face.outerLoopId,
    })
  }
  const originalFinal = originalChain.at(-1)!
  const newFinal = newChain.at(-1)!
  edges.set(originalFinal.id, { ...edges.get(originalFinal.id)!, nextId: reverseSeamIds.at(-1)! })
  edges.set(newFinal.id, { ...edges.get(newFinal.id)!, nextId: forwardSeamIds[0]! })
  for (const edge of originalChain)
    edges.set(edge.id, { ...edges.get(edge.id)!, loopId: face.outerLoopId })
  for (const edge of newChain) edges.set(edge.id, { ...edges.get(edge.id)!, loopId: newLoopId })

  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...vertices.values()],
    halfEdges: [...edges.values()],
    loops: [...source.loops, { id: newLoopId, faceId: splitFaceId, kind: 'outer' }],
    faces: [
      ...source.faces,
      { id: splitFaceId, outerLoopId: newLoopId, surface: { ...face.surface } },
    ],
    shells: source.shells.map((shell) =>
      shell.faceIds.includes(faceId)
        ? { ...shell, faceIds: [...shell.faceIds, splitFaceId] }
        : shell,
    ),
  })
  const finalTopology = validateBodyTopology(body)
  if (!finalTopology.valid) throw new RangeError('Split produced invalid Body topology')
  const sourceIds = new Set(bodyFeatureIds(source))
  const created = bodyFeatureIds(body).filter((id) => !sourceIds.has(id))
  const remap: TopologyRemap = {
    preserved: bodyFeatureIds(body).filter((id) => sourceIds.has(id)),
    created,
    deleted: [],
    split: {
      [face.id]: [face.id, splitFaceId],
      [face.outerLoopId]: [face.outerLoopId, newLoopId],
      ...splitRemap,
    },
    merged: {},
  }
  return { body, splitFaceId, remap }
}

type Crossing = {
  readonly segmentIndex: number
  readonly t: number
  readonly point: Point3
  readonly seamEdgeId: string
}

function lineIntersection(
  start: Point2,
  end: Point2,
  seamStart: Point2,
  seamEnd: Point2,
): { t: number; u: number; point: Point2 } | null {
  const direction: Point2 = [end[0] - start[0], end[1] - start[1]]
  const seamDirection: Point2 = [seamEnd[0] - seamStart[0], seamEnd[1] - seamStart[1]]
  const denominator = direction[0] * seamDirection[1] - direction[1] * seamDirection[0]
  const offset: Point2 = [seamStart[0] - start[0], seamStart[1] - start[1]]
  if (Math.abs(denominator) <= POINT_EPSILON) {
    if (Math.abs(cross2(start, end, seamStart)) <= POINT_EPSILON) {
      throw new RangeError('Split path must not overlap or follow an existing seam')
    }
    return null
  }
  const t = (offset[0] * seamDirection[1] - offset[1] * seamDirection[0]) / denominator
  const u = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator
  if (t < -POINT_EPSILON || t > 1 + POINT_EPSILON || u < -POINT_EPSILON || u > 1 + POINT_EPSILON) {
    return null
  }
  return {
    t,
    u,
    point: [start[0] + direction[0] * t, start[1] + direction[1] * t],
  }
}

function coplanarFaceIds(source: BodyNodeType, faceId: string): string[] {
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Split face not found: ${faceId}`)
  const shell = source.shells.find((candidate) => candidate.faceIds.includes(faceId))
  if (!shell) throw new RangeError(`Split face has no shell: ${faceId}`)
  const frame = getBodyFaceFrame(source, faceId)
  const candidates: string[] = []
  for (const candidateId of shell.faceIds) {
    const candidate = source.faces.find((entry) => entry.id === candidateId)
    if (!candidate || candidate.innerLoopIds.length > 0) continue
    const candidateFrame = getBodyFaceFrame(source, candidateId)
    const parallel = Math.abs(
      candidateFrame.normal[0] * frame.normal[0] +
        candidateFrame.normal[1] * frame.normal[1] +
        candidateFrame.normal[2] * frame.normal[2],
    )
    const offset = [
      candidateFrame.centroid[0] - frame.centroid[0],
      candidateFrame.centroid[1] - frame.centroid[1],
      candidateFrame.centroid[2] - frame.centroid[2],
    ] as const
    const coplanar = Math.abs(
      offset[0] * frame.normal[0] + offset[1] * frame.normal[1] + offset[2] * frame.normal[2],
    )
    if (parallel >= 1 - POINT_EPSILON && coplanar <= POINT_EPSILON) candidates.push(candidateId)
  }
  const candidateSet = new Set(candidates)
  const visited = new Set<string>([faceId])
  const queue = [faceId]
  const loopsById = new Map(source.loops.map((loop) => [loop.id, loop]))
  const edgesById = new Map(source.halfEdges.map((edge) => [edge.id, edge]))
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const current = source.faces.find((entry) => entry.id === currentId)
    if (!current) continue
    for (const edge of orderedBodyLoopEdges(source, current.outerLoopId)) {
      const twin = edge.twinId ? edgesById.get(edge.twinId) : undefined
      const twinLoop = twin ? loopsById.get(twin.loopId) : undefined
      const neighborId = twinLoop?.faceId
      if (neighborId && candidateSet.has(neighborId) && !visited.has(neighborId)) {
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }
  }
  return candidates.filter((candidateId) => visited.has(candidateId))
}

function findFaceAtPoint(
  source: BodyNodeType,
  faceIds: readonly string[],
  projection: ReturnType<typeof createPlanarPointProjection>,
  point: Point3,
): string | null {
  const verticesById = new Map(source.vertices.map((vertex) => [vertex.id, vertex]))
  const point2 = projection.toPlane(point)
  for (const faceId of faceIds) {
    const face = source.faces.find((candidate) => candidate.id === faceId)
    if (!face || face.innerLoopIds.length > 0) continue
    const edges = orderedBodyLoopEdges(source, face.outerLoopId)
    const polygon = edges
      .map((edge) => verticesById.get(edge.vertexId)?.position)
      .filter((vertex): vertex is [number, number, number] => Boolean(vertex))
      .map(projection.toPlane)
    if (polygon.length === edges.length && pointInPolygon(point2, polygon)) return faceId
  }
  return null
}

function mergeSplitRemaps(
  source: BodyNodeType,
  body: BodyNodeType,
  remaps: readonly TopologyRemap[],
): TopologyRemap {
  const sourceIds = new Set(bodyFeatureIds(source))
  const finalIds = new Set(bodyFeatureIds(body))
  const split: Record<string, string[]> = {}
  for (const remap of remaps) {
    for (const [id, mapped] of Object.entries(remap.split)) {
      split[id] = [...new Set([...(split[id] ?? []), ...mapped])]
    }
  }
  return {
    preserved: bodyFeatureIds(body).filter((id) => sourceIds.has(id)),
    created: bodyFeatureIds(body).filter((id) => !sourceIds.has(id)),
    deleted: bodyFeatureIds(source).filter((id) => !finalIds.has(id)),
    split,
    merged: {},
  }
}

function collectCrossings(
  source: BodyNodeType,
  faceId: string,
  pathPoints: readonly Point3[],
): { crossings: Crossing[]; projection: ReturnType<typeof createPlanarPointProjection> } {
  const frame = getBodyFaceFrame(source, faceId)
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Split face not found: ${faceId}`)
  const hostEdges = orderedBodyLoopEdges(source, face.outerLoopId)
  const verticesById = new Map(source.vertices.map((vertex) => [vertex.id, vertex]))
  const firstPoint = verticesById.get(hostEdges[0]?.vertexId ?? '')?.position
  if (!firstPoint) throw new RangeError('Split host face has missing vertices')
  const projection = createPlanarPointProjection(firstPoint, frame.normal)
  const coplanarIds = new Set(coplanarFaceIds(source, faceId))
  const loopsById = new Map(source.loops.map((loop) => [loop.id, loop]))
  const path2d = pathPoints.map(projection.toPlane)
  const seamEdgeIds = new Set<string>()
  for (const edge of hostEdges) {
    if (!edge.twinId) continue
    const twin = source.halfEdges.find((candidate) => candidate.id === edge.twinId)
    const twinLoop = twin ? loopsById.get(twin.loopId) : undefined
    if (twinLoop && coplanarIds.has(twinLoop.faceId)) seamEdgeIds.add(edge.id)
  }
  const connectedOuterEdges = coplanarFaceIds(source, faceId).flatMap((candidateId) => {
    const candidate = source.faces.find((entry) => entry.id === candidateId)
    return candidate ? orderedBodyLoopEdges(source, candidate.outerLoopId) : []
  })
  for (const endpoint of [path2d[0]!, path2d.at(-1)!]) {
    const onOuterBoundary = connectedOuterEdges.some((edge) => {
      if (seamEdgeIds.has(edge.id)) return false
      const twin = edge.twinId
        ? source.halfEdges.find((candidate) => candidate.id === edge.twinId)
        : undefined
      const twinLoop = twin ? loopsById.get(twin.loopId) : undefined
      if (twinLoop && coplanarIds.has(twinLoop.faceId)) return false
      const start = projection.toPlane(verticesById.get(edge.vertexId)!.position)
      const next = source.halfEdges.find((candidate) => candidate.id === edge.nextId)
      const end = next ? verticesById.get(next.vertexId)?.position : undefined
      return Boolean(end && pointOnSegment(endpoint, start, projection.toPlane(end)))
    })
    if (!onOuterBoundary) {
      throw new RangeError('Split endpoints must lie on the connected outer boundary')
    }
  }
  const crossings: Crossing[] = []
  const seenSeams = new Set<string>()
  for (let segmentIndex = 0; segmentIndex < path2d.length - 1; segmentIndex += 1) {
    const start = path2d[segmentIndex]!
    const end = path2d[segmentIndex + 1]!
    for (const edge of hostEdges) {
      if (!edge.twinId) continue
      const twin = source.halfEdges.find((candidate) => candidate.id === edge.twinId)
      const twinLoop = twin ? loopsById.get(twin.loopId) : undefined
      if (!twin || !twinLoop || !coplanarIds.has(twinLoop.faceId)) continue
      const edgeStart = verticesById.get(edge.vertexId)?.position
      const edgeEnd = verticesById.get(twin.vertexId)?.position
      if (!edgeStart || !edgeEnd) throw new RangeError('Split seam has missing vertices')
      const hit = lineIntersection(
        start,
        end,
        projection.toPlane(edgeStart),
        projection.toPlane(edgeEnd),
      )
      if (!hit) continue
      const atPathEndpoint = hit.t <= POINT_EPSILON || hit.t >= 1 - POINT_EPSILON
      const atSeamEndpoint = hit.u <= POINT_EPSILON || hit.u >= 1 - POINT_EPSILON
      if (atSeamEndpoint) {
        throw new RangeError('Split path cannot branch through an existing seam vertex')
      }
      if (atPathEndpoint) {
        throw new RangeError('Split path cannot touch an existing seam at an interior point')
      }
      if (seenSeams.has(edge.id)) {
        throw new RangeError('Split path cannot cross the same seam more than once')
      }
      seenSeams.add(edge.id)
      crossings.push({
        segmentIndex,
        t: hit.t,
        point: projection.fromPlane(hit.point),
        seamEdgeId: edge.id,
      })
    }
  }
  crossings.sort((first, second) =>
    first.segmentIndex === second.segmentIndex
      ? first.t - second.t
      : first.segmentIndex - second.segmentIndex,
  )
  for (let index = 1; index < crossings.length; index += 1) {
    const previous = crossings[index - 1]!
    const current = crossings[index]!
    if (
      distance2(projection.toPlane(previous.point), projection.toPlane(current.point)) <=
      POINT_EPSILON
    ) {
      throw new RangeError('Split path cannot branch at a seam intersection')
    }
  }
  return { crossings, projection }
}

export function splitBodyFace(
  source: BodyNodeType,
  faceId: string,
  pathPoints: readonly Point3[],
): SplitBodyFaceResult {
  if (pathPoints.length < 2 || pathPoints.length > 256) {
    throw new RangeError('Split path requires between two and 256 points')
  }
  if (pathPoints.some((point) => !finitePoint(point))) {
    throw new RangeError('Split path requires finite points')
  }
  const topology = validateBodyTopology(source)
  if (!topology.valid) throw new RangeError('Split requires valid Body topology')
  const { crossings, projection } = collectCrossings(source, faceId, pathPoints)
  if (crossings.length === 0) {
    return splitBodyFaceOnce(source, faceId, pathPoints, source.revision + 1)
  }

  const crossingsBySegment = new Map<number, Crossing[]>()
  for (const crossing of crossings) {
    crossingsBySegment.set(crossing.segmentIndex, [
      ...(crossingsBySegment.get(crossing.segmentIndex) ?? []),
      crossing,
    ])
  }
  const points: Point3[] = []
  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    points.push(pathPoints[index]!)
    for (const crossing of crossingsBySegment.get(index) ?? []) points.push(crossing.point)
  }
  points.push(pathPoints.at(-1)!)
  const revision = source.revision + 1
  const coplanarIds = coplanarFaceIds(source, faceId)
  let body = source
  const firstMidpoint: Point3 = [
    (points[0]![0] + points[1]![0]) * 0.5,
    (points[0]![1] + points[1]![1]) * 0.5,
    (points[0]![2] + points[1]![2]) * 0.5,
  ]
  let currentFaceId = findFaceAtPoint(source, coplanarIds, projection, firstMidpoint) ?? faceId
  const remaps: TopologyRemap[] = []
  let firstSplitFaceId: string | null = null
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    if (distance2(projection.toPlane(start), projection.toPlane(end)) <= POINT_EPSILON) {
      throw new RangeError('Split path has a collapsed segment')
    }
    const part = [start, end] as const
    const result = splitBodyFaceOnce(body, currentFaceId, part, revision)
    body = result.body
    remaps.push(result.remap)
    firstSplitFaceId ??= result.splitFaceId
    if (index < points.length - 2) {
      const midpoint: Point3 = [
        (end[0] + points[index + 2]![0]) * 0.5,
        (end[1] + points[index + 2]![1]) * 0.5,
        (end[2] + points[index + 2]![2]) * 0.5,
      ]
      currentFaceId = findFaceAtPoint(body, coplanarIds, projection, midpoint) ?? ''
      if (!currentFaceId) {
        throw new RangeError('Split path leaves the connected coplanar face arrangement')
      }
    }
  }
  if (!firstSplitFaceId) throw new RangeError('Split path did not create a face')
  const finalTopology = validateBodyTopology(body)
  if (!finalTopology.valid) throw new RangeError('Split produced invalid Body topology')
  return {
    body,
    splitFaceId: firstSplitFaceId,
    remap: mergeSplitRemaps(source, body, remaps),
  }
}
