import { type BodyHalfEdge, BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyById, bodyFeatureIds, orderedBodyLoopEdges } from './body-imprint-helpers'
import { nearestInsetBlockingPlane, resolveInsetBoundaryEdge } from './body-inset-helpers'
import {
  getBodyFaceFrame,
  type PushPullBodyResult,
  type TopologyRemap,
  validateBodyTopology,
} from './body-topology'

const COLLAPSE_EPSILON = 1e-9

type BoundaryResolution = {
  readonly faceEdges: BodyHalfEdge[]
  readonly boundaryEdges: BodyHalfEdge[]
}

export function resolveInsetFace(body: BodyNodeType, faceId: string): BoundaryResolution | null {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face || face.innerLoopIds.length > 0) return null
  const faceEdges = orderedBodyLoopEdges(body, face.outerLoopId)
  if (faceEdges.length < 3 || faceEdges.some((edge) => edge.curveId !== undefined)) return null
  const boundaryEdges = faceEdges.map((edge) => resolveInsetBoundaryEdge(body, edge))
  if (boundaryEdges.some((edge) => edge === null)) return null
  const resolved = boundaryEdges.filter((edge): edge is BodyHalfEdge => edge !== null)
  const firstLoopId = resolved[0]?.loopId
  if (!firstLoopId || resolved.some((edge) => edge.loopId !== firstLoopId)) return null
  return { faceEdges, boundaryEdges: resolved }
}

export function pushPullInsetBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
  resolution: BoundaryResolution,
): PushPullBodyResult {
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Push/pull face not found: ${faceId}`)
  const frame = getBodyFaceFrame(source, faceId)
  const movedVertexIds = new Set(resolution.faceEdges.map((edge) => edge.vertexId))
  const blockingPlane = nearestInsetBlockingPlane(
    source,
    movedVertexIds,
    frame.centroid,
    frame.normal,
    distance,
  )
  if (blockingPlane !== null && Math.abs(distance) >= blockingPlane - COLLAPSE_EPSILON) {
    throw new RangeError('Push/pull would collapse or invert the body')
  }

  const verticesById = bodyById(source.vertices)
  const revision = source.revision + 1
  const movedIds = new Map<string, string>()
  const movedVertices = resolution.faceEdges.map((edge) => {
    const current = verticesById.get(edge.vertexId)
    if (!current) throw new RangeError('Push/pull inset face has missing vertices')
    const id = `${edge.vertexId}:push:${revision}`
    movedIds.set(edge.vertexId, id)
    return {
      id,
      position: [
        current.position[0] + frame.normal[0] * distance,
        current.position[1] + frame.normal[1] * distance,
        current.position[2] + frame.normal[2] * distance,
      ] as [number, number, number],
    }
  })
  const sideLoopIds = resolution.faceEdges.map(
    (_, index) => `${face.id}:reveal:${revision}:${index}:loop`,
  )
  const sideFaceIds = resolution.faceEdges.map(
    (_, index) => `${face.id}:reveal:${revision}:${index}:face`,
  )
  const sideEdgeIds = resolution.faceEdges.map((_, index) => ({
    top: `${face.id}:reveal:${revision}:${index}:top`,
    down: `${face.id}:reveal:${revision}:${index}:down`,
    bottom: `${face.id}:reveal:${revision}:${index}:bottom`,
    up: `${face.id}:reveal:${revision}:${index}:up`,
  }))
  const boundaryEdgeIds = new Map(resolution.boundaryEdges.map((edge, index) => [edge.id, index]))
  const rewiredEdges = source.halfEdges.map((edge) => {
    const faceIndex = resolution.faceEdges.findIndex((candidate) => candidate.id === edge.id)
    if (faceIndex >= 0) {
      const movedVertexId = movedIds.get(edge.vertexId)
      const ids = sideEdgeIds[faceIndex]
      if (!movedVertexId || !ids) throw new RangeError('Push/pull inset face remap failed')
      return { ...edge, vertexId: movedVertexId, twinId: ids.top }
    }
    const boundaryIndex = boundaryEdgeIds.get(edge.id)
    if (boundaryIndex === undefined) return edge
    const ids = sideEdgeIds[boundaryIndex]
    return ids ? { ...edge, twinId: ids.bottom } : edge
  })
  const sideEdges = resolution.faceEdges.flatMap((edge, index) => {
    const ids = sideEdgeIds[index]
    const sideLoopId = sideLoopIds[index]
    const nextEdge = resolution.faceEdges[(index + 1) % resolution.faceEdges.length]
    const currentVertexId = edge.vertexId
    const nextVertexId = nextEdge?.vertexId
    const movedCurrentVertexId = movedIds.get(currentVertexId)
    const movedNextVertexId = nextVertexId ? movedIds.get(nextVertexId) : undefined
    const previousIds =
      sideEdgeIds[(index - 1 + resolution.faceEdges.length) % resolution.faceEdges.length]
    const nextIds = sideEdgeIds[(index + 1) % resolution.faceEdges.length]
    const boundaryEdge = resolution.boundaryEdges[index]
    if (
      !ids ||
      !sideLoopId ||
      !nextVertexId ||
      !movedCurrentVertexId ||
      !movedNextVertexId ||
      !previousIds ||
      !nextIds ||
      !boundaryEdge
    ) {
      throw new RangeError('Push/pull inset face edge order failed')
    }
    return [
      {
        id: ids.top,
        vertexId: movedNextVertexId,
        twinId: edge.id,
        nextId: ids.down,
        loopId: sideLoopId,
      },
      {
        id: ids.down,
        vertexId: movedCurrentVertexId,
        twinId: previousIds.up,
        nextId: ids.bottom,
        loopId: sideLoopId,
      },
      {
        id: ids.bottom,
        vertexId: currentVertexId,
        twinId: boundaryEdge.id,
        nextId: ids.up,
        loopId: sideLoopId,
      },
      {
        id: ids.up,
        vertexId: nextVertexId,
        twinId: nextIds.down,
        nextId: ids.top,
        loopId: sideLoopId,
      },
    ]
  })
  const defaultMaterial = source.bodyDefaults.materialRef
    ? { materialRef: source.bodyDefaults.materialRef }
    : {}
  const verticesWithPosition = bodyById(source.vertices)
  const sideSurfaces = resolution.faceEdges.map((edge, index) => {
    const nextEdge = resolution.faceEdges[(index + 1) % resolution.faceEdges.length]
    const current = verticesWithPosition.get(edge.vertexId)
    const next = nextEdge ? verticesWithPosition.get(nextEdge.vertexId) : undefined
    if (!current || !next) throw new RangeError('Push/pull inset face has missing edge vertices')
    const edgeVector: [number, number, number] = [
      next.position[0] - current.position[0],
      next.position[1] - current.position[1],
      next.position[2] - current.position[2],
    ]
    const edgeLength = Math.hypot(edgeVector[0], edgeVector[1], edgeVector[2])
    if (edgeLength <= COLLAPSE_EPSILON) {
      throw new RangeError('Push/pull inset face has a collapsed edge')
    }
    return {
      ...defaultMaterial,
      uvOrigin: [...current.position] as [number, number, number],
      uvU: [edgeVector[0] / edgeLength, edgeVector[1] / edgeLength, edgeVector[2] / edgeLength] as [
        number,
        number,
        number,
      ],
      uvV: [...frame.normal] as [number, number, number],
    }
  })
  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...source.vertices, ...movedVertices],
    halfEdges: [...rewiredEdges, ...sideEdges],
    loops: [
      ...source.loops,
      ...sideLoopIds.map((id, index) => {
        const faceId = sideFaceIds[index]
        if (!faceId) throw new RangeError('Push/pull inset face loop id allocation failed')
        return { id, faceId, kind: 'outer' as const }
      }),
    ],
    faces: [
      ...source.faces,
      ...sideFaceIds.map((id, index) => {
        const outerLoopId = sideLoopIds[index]
        const surface = sideSurfaces[index]
        if (!outerLoopId || !surface) {
          throw new RangeError('Push/pull inset face allocation failed')
        }
        return { id, outerLoopId, surface }
      }),
    ],
    shells: source.shells.map((shell) =>
      shell.faceIds.includes(faceId)
        ? { ...shell, faceIds: [...shell.faceIds, ...sideFaceIds] }
        : shell,
    ),
  })
  const created = [
    ...movedVertices,
    ...sideEdges,
    ...sideLoopIds.map((id) => ({ id })),
    ...sideFaceIds.map((id) => ({ id })),
  ].map(({ id }) => id)
  const validation = validateBodyTopology(body)
  if (!validation.valid) throw new RangeError('Push/pull produced invalid Body topology')
  return {
    body,
    movedFaceId: faceId,
    createdFaceIds: sideFaceIds,
    remap: {
      preserved: bodyFeatureIds(source),
      created,
      deleted: [],
      split: {},
      merged: {},
    } satisfies TopologyRemap,
  }
}
