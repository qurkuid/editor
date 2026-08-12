import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { getBodyLoopVertices, validateBodyTopology } from './body-topology'

export type BodyFeatureKind = 'vertex' | 'edge' | 'face'
export type BodyFeatureMoveOptions = {
  readonly autofold?: boolean
}

const PLANAR_EPSILON = 1e-7

type FacePlane = {
  readonly origin: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
}

export function bodyFeatureFaceVertexIds(body: BodyNodeType, faceId: string): Set<string> {
  const face = body.faces.find(({ id }) => id === faceId)
  if (!face) throw new RangeError(`Body face not found: ${faceId}`)
  const loopIds = new Set([face.outerLoopId, ...face.innerLoopIds])
  return new Set(
    body.halfEdges.filter(({ loopId }) => loopIds.has(loopId)).map(({ vertexId }) => vertexId),
  )
}

export function resolveBodyFeatureVertexIds(
  body: BodyNodeType,
  kind: BodyFeatureKind,
  featureId: string,
): Set<string> {
  if (kind === 'vertex') {
    if (!body.vertices.some(({ id }) => id === featureId)) {
      throw new RangeError(`Body vertex not found: ${featureId}`)
    }
    return new Set([featureId])
  }
  if (kind === 'face') return bodyFeatureFaceVertexIds(body, featureId)

  const edge = body.halfEdges.find(({ id }) => id === featureId)
  if (!edge) throw new RangeError(`Body edge not found: ${featureId}`)
  const next = body.halfEdges.find(({ id }) => id === edge.nextId)
  if (!next) throw new RangeError(`Body edge has no endpoint: ${featureId}`)
  return new Set([edge.vertexId, next.vertexId])
}

export function bodyFeatureCurveIds(
  body: BodyNodeType,
  movedVertexIds: ReadonlySet<string>,
): Set<string> {
  const halfEdgesById = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  return new Set(
    body.halfEdges
      .filter((edge) => {
        const endVertexId = halfEdgesById.get(edge.nextId)?.vertexId
        return (
          movedVertexIds.has(edge.vertexId) ||
          (endVertexId !== undefined && movedVertexIds.has(endVertexId))
        )
      })
      .flatMap(({ curveId }) => (curveId ? [curveId] : [])),
  )
}

function orderedLoopHalfEdges(body: BodyNodeType, loopId: string) {
  const byId = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  const candidates = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const start = candidates[0]
  if (!start) return []
  const ordered: BodyNodeType['halfEdges'] = []
  const visited = new Set<string>()
  let current = start
  while (!visited.has(current.id)) {
    visited.add(current.id)
    ordered.push(current)
    const next = byId.get(current.nextId)
    if (!next || next.loopId !== loopId) return []
    current = next
  }
  return current.id === start.id && ordered.length === candidates.length ? ordered : []
}

function facePlane(body: BodyNodeType, face: BodyNodeType['faces'][number]): FacePlane | null {
  const points = getBodyLoopVertices(body, face.outerLoopId)
  if (points.length < 3) return null
  const origin = points[0]!
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const cross: [number, number, number] = [
      (a[1] - origin[1]) * (b[2] - origin[2]) - (a[2] - origin[2]) * (b[1] - origin[1]),
      (a[2] - origin[2]) * (b[0] - origin[0]) - (a[0] - origin[0]) * (b[2] - origin[2]),
      (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]),
    ]
    const length = Math.hypot(...cross)
    if (length > PLANAR_EPSILON) {
      return {
        origin,
        normal: cross.map((value) => value / length) as [number, number, number],
      }
    }
  }
  return null
}

export function isBodyFeatureFacePlanar(
  body: BodyNodeType,
  face: BodyNodeType['faces'][number],
): boolean {
  const plane = facePlane(body, face)
  if (!plane) return false
  const loopIds = [face.outerLoopId, ...face.innerLoopIds]
  return loopIds.every((loopId) =>
    getBodyLoopVertices(body, loopId).every(
      (point) =>
        Math.abs(
          (point[0] - plane.origin[0]) * plane.normal[0] +
            (point[1] - plane.origin[1]) * plane.normal[1] +
            (point[2] - plane.origin[2]) * plane.normal[2],
        ) <= PLANAR_EPSILON,
    ),
  )
}

export function assertBodyFeatureGeometry(body: BodyNodeType): void {
  const vertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex.position]))
  const edges = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  for (const edge of body.halfEdges) {
    const start = vertices.get(edge.vertexId)
    const end = vertices.get(edges.get(edge.nextId)?.vertexId ?? '')
    if (
      !start ||
      !end ||
      Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) <= PLANAR_EPSILON
    ) {
      throw new RangeError(`Body feature move would collapse edge: ${edge.id}`)
    }
  }
  for (const face of body.faces) {
    if (!facePlane(body, face)) throw new RangeError(`Body face is degenerate: ${face.id}`)
    if (!isBodyFeatureFacePlanar(body, face)) {
      throw new RangeError(`Body feature move would make face non-planar: ${face.id}`)
    }
  }
}

function triangleArea(body: BodyNodeType, vertexIds: readonly [string, string, string]): number {
  const vertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex.position]))
  const a = vertices.get(vertexIds[0])
  const b = vertices.get(vertexIds[1])
  const c = vertices.get(vertexIds[2])
  if (!a || !b || !c) return 0
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return Math.hypot(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  )
}

export function autofoldBodyFaces(
  source: BodyNodeType,
  faceIds: ReadonlySet<string>,
): BodyNodeType {
  let halfEdges = source.halfEdges.map((edge) => ({ ...edge }))
  let loops = source.loops.map((loop) => ({ ...loop }))
  let faces = source.faces.map((face) => ({
    ...face,
    innerLoopIds: [...face.innerLoopIds],
    surface: {
      ...face.surface,
      uvOrigin: [...face.surface.uvOrigin] as [number, number, number],
      uvU: [...face.surface.uvU] as [number, number, number],
      uvV: [...face.surface.uvV] as [number, number, number],
    },
  }))
  let shells = source.shells.map((shell) => ({ ...shell, faceIds: [...shell.faceIds] }))
  const vertices = source.vertices.map((vertex) => ({
    ...vertex,
    position: [...vertex.position] as [number, number, number],
  }))
  const curves = source.curves.map((curve) => ({ ...curve }))

  for (const faceId of faceIds) {
    const face = faces.find((candidate) => candidate.id === faceId)
    if (!face) throw new RangeError(`Body autofold face not found: ${faceId}`)
    if (face.innerLoopIds.length > 0) {
      throw new RangeError(`Body autofold does not support holes: ${face.id}`)
    }

    const current: BodyNodeType = BodyNode.parse({
      ...source,
      vertices,
      halfEdges,
      loops,
      faces,
      shells,
      curves,
    })
    const boundary = orderedLoopHalfEdges(current, face.outerLoopId)
    if (boundary.length < 3)
      throw new RangeError(`Body autofold face has an invalid loop: ${face.id}`)
    if (
      boundary.some((edge) => {
        if (!edge.curveId) return false
        return current.curves.find((curve) => curve.id === edge.curveId)?.kind !== 'line'
      })
    ) {
      throw new RangeError(`Body autofold does not support curved edges: ${face.id}`)
    }

    const vertexIds = boundary.map((edge) => edge.vertexId)
    const diagonalCount = boundary.length - 3
    const stem = `${face.id}:autofold:${source.revision}`
    const diagonalPairs = Array.from({ length: diagonalCount }, (_, index) => ({
      forwardId: `${stem}:diagonal:${index}:forward`,
      reverseId: `${stem}:diagonal:${index}:reverse`,
    }))
    const triangleVertexIds: Array<[string, string, string]> = []
    const triangleEdgeIds: string[][] = []
    const triangleLoopIds = [
      face.outerLoopId,
      ...Array.from({ length: diagonalCount }, (_, index) => `${stem}:loop:${index + 1}`),
    ]
    const triangleFaceIds = [
      face.id,
      ...Array.from({ length: diagonalCount }, (_, index) => `${stem}:face:${index + 1}`),
    ]

    for (let index = 0; index < boundary.length - 2; index += 1) {
      const triangle: [string, string, string] = [
        vertexIds[0]!,
        vertexIds[index + 1]!,
        vertexIds[index + 2]!,
      ]
      if (triangleArea(current, triangle) <= PLANAR_EPSILON) {
        throw new RangeError(`Body autofold would create a degenerate triangle: ${face.id}`)
      }
      triangleVertexIds.push(triangle)
      triangleEdgeIds.push(
        index === 0
          ? [boundary[0]!.id, boundary[1]!.id, diagonalPairs[0]!.reverseId]
          : index === boundary.length - 3
            ? [
                diagonalPairs[index - 1]!.forwardId,
                boundary[index + 1]!.id,
                boundary[index + 2]!.id,
              ]
            : [
                diagonalPairs[index - 1]!.forwardId,
                boundary[index + 1]!.id,
                diagonalPairs[index]!.reverseId,
              ],
      )
    }

    const edgeUpdates = new Map<string, { nextId: string; loopId: string }>()
    triangleEdgeIds.forEach((edgeIds, index) => {
      edgeIds.forEach((edgeId, edgeIndex) => {
        edgeUpdates.set(edgeId, {
          nextId: edgeIds[(edgeIndex + 1) % edgeIds.length]!,
          loopId: triangleLoopIds[index]!,
        })
      })
    })
    halfEdges = halfEdges.map((edge) => {
      const update = edgeUpdates.get(edge.id)
      return update ? { ...edge, nextId: update.nextId, loopId: update.loopId } : edge
    })
    for (let index = 0; index < diagonalPairs.length; index += 1) {
      const pair = diagonalPairs[index]!
      halfEdges.push(
        {
          id: pair.forwardId,
          vertexId: vertexIds[0]!,
          twinId: pair.reverseId,
          nextId: triangleEdgeIds[index + 1]![1]!,
          loopId: triangleLoopIds[index + 1]!,
        },
        {
          id: pair.reverseId,
          vertexId: vertexIds[index + 2]!,
          twinId: pair.forwardId,
          nextId: triangleEdgeIds[index]![0]!,
          loopId: triangleLoopIds[index]!,
        },
      )
    }

    loops = loops.concat(
      triangleLoopIds.slice(1).map((loopId, index) => ({
        id: loopId,
        faceId: triangleFaceIds[index + 1]!,
        kind: 'outer' as const,
      })),
    )
    const additionalFaces = triangleFaceIds.slice(1).map((id, index) => ({
      id,
      outerLoopId: triangleLoopIds[index + 1]!,
      innerLoopIds: [],
      surface: {
        ...face.surface,
        uvOrigin: [...face.surface.uvOrigin] as [number, number, number],
        uvU: [...face.surface.uvU] as [number, number, number],
        uvV: [...face.surface.uvV] as [number, number, number],
      },
    }))
    faces = faces.concat(additionalFaces)
    shells = shells.map((shell) => {
      const index = shell.faceIds.indexOf(face.id)
      if (index === -1) return shell
      return {
        ...shell,
        faceIds: [...shell.faceIds, ...triangleFaceIds.slice(1)],
      }
    })
  }

  return BodyNode.parse({ ...source, vertices, halfEdges, loops, faces, shells, curves })
}

export function moveBodyFeature(
  source: BodyNodeType,
  kind: BodyFeatureKind,
  featureId: string,
  translation: readonly [number, number, number],
  options: BodyFeatureMoveOptions = {},
): BodyNodeType {
  if (
    translation.some((value) => !Number.isFinite(value)) ||
    translation.every((value) => value === 0)
  ) {
    throw new RangeError('Body feature move requires a non-zero finite translation')
  }
  if (!validateBodyTopology(source).valid)
    throw new RangeError('Body feature move requires valid topology')
  const movedVertexIds = resolveBodyFeatureVertexIds(source, kind, featureId)
  const fullyMovedFaceIds = new Set(
    source.faces
      .filter((face) =>
        [...bodyFeatureFaceVertexIds(source, face.id)].every((id) => movedVertexIds.has(id)),
      )
      .map(({ id }) => id),
  )
  const movedCurveIds = bodyFeatureCurveIds(source, movedVertexIds)
  if (
    source.curves.some(({ id, kind: curveKind }) => movedCurveIds.has(id) && curveKind !== 'line')
  ) {
    throw new RangeError('Body feature move currently supports line edges only')
  }

  const add = (point: readonly [number, number, number]): [number, number, number] => [
    point[0] + translation[0],
    point[1] + translation[1],
    point[2] + translation[2],
  ]
  let body = BodyNode.parse({
    ...source,
    revision: source.revision + 1,
    vertices: source.vertices.map((vertex) =>
      movedVertexIds.has(vertex.id) ? { ...vertex, position: add(vertex.position) } : vertex,
    ),
    faces: source.faces.map((face) =>
      fullyMovedFaceIds.has(face.id)
        ? { ...face, surface: { ...face.surface, uvOrigin: add(face.surface.uvOrigin) } }
        : face,
    ),
  })
  const autofoldFaceIds = new Set(
    body.faces
      .filter(
        (face) =>
          [...bodyFeatureFaceVertexIds(body, face.id)].some((id) => movedVertexIds.has(id)) &&
          !isBodyFeatureFacePlanar(body, face),
      )
      .map(({ id }) => id),
  )
  if (autofoldFaceIds.size > 0 && options.autofold === true) {
    body = autofoldBodyFaces(body, autofoldFaceIds)
  }
  assertBodyFeatureGeometry(body)
  if (!validateBodyTopology(body).valid) {
    throw new RangeError('Body feature move produced invalid topology')
  }
  return body
}
