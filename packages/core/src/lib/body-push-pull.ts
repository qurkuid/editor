import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { subtractBodies } from './body-csg'
import { nearestInsetBlockingPlane } from './body-inset-helpers'
import { pushPullInsetBodyFace, resolveInsetFace } from './body-inset-push-pull'
import {
  createPlanarFaceBody,
  pushPullBodyFace as extrudePlanarBodyFace,
  getBodyFaceFrame,
  type PushPullBodyResult,
} from './body-topology'

const COLLAPSE_EPSILON = 1e-9

const allFeatureIds = (body: BodyNodeType) => [
  ...body.vertices.map((vertex) => vertex.id),
  ...body.halfEdges.map((edge) => edge.id),
  ...body.loops.map((loop) => loop.id),
  ...body.faces.map((face) => face.id),
  ...body.shells.map((shell) => shell.id),
  ...body.curves.map((curve) => curve.id),
]

const dot = (left: readonly [number, number, number], right: readonly [number, number, number]) =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2]

function restoreImprintSource(
  source: BodyNodeType,
  insetFaceId: string,
  resolution: NonNullable<ReturnType<typeof resolveInsetFace>>,
): { body: BodyNodeType; profilePoints: [number, number, number][]; hostFaceId: string } | null {
  const insetFace = source.faces.find((candidate) => candidate.id === insetFaceId)
  const boundaryEdge = resolution.boundaryEdges[0]
  if (!insetFace || !boundaryEdge) return null
  const innerLoop = source.loops.find((loop) => loop.id === boundaryEdge.loopId)
  if (innerLoop?.kind !== 'inner') return null
  const hostFace = source.faces.find((face) => face.innerLoopIds.includes(innerLoop.id))
  if (!hostFace) return null
  const verticesById = new Map(source.vertices.map((vertex) => [vertex.id, vertex]))
  const profilePoints = resolution.faceEdges.map((edge) => {
    const vertex = verticesById.get(edge.vertexId)
    if (!vertex) throw new RangeError('Push/pull imprint face has missing profile vertices')
    return [...vertex.position] as [number, number, number]
  })
  const removedEdgeIds = new Set([
    ...resolution.faceEdges.map((edge) => edge.id),
    ...resolution.boundaryEdges.map((edge) => edge.id),
  ])
  const removedVertexIds = new Set(resolution.faceEdges.map((edge) => edge.vertexId))
  const removedLoopIds = new Set([insetFace.outerLoopId, innerLoop.id])
  const body = BodyNode.parse({
    ...source,
    revision: Math.max(0, source.revision - 1),
    vertices: source.vertices.filter((vertex) => !removedVertexIds.has(vertex.id)),
    halfEdges: source.halfEdges.filter((edge) => !removedEdgeIds.has(edge.id)),
    loops: source.loops.filter((loop) => !removedLoopIds.has(loop.id)),
    faces: source.faces
      .filter((face) => face.id !== insetFaceId)
      .map((face) =>
        face.id === hostFace.id
          ? {
              ...face,
              innerLoopIds: face.innerLoopIds.filter((id) => id !== innerLoop.id),
            }
          : face,
      ),
    shells: source.shells.map((shell) => ({
      ...shell,
      faceIds: shell.faceIds.filter((id) => id !== insetFaceId),
    })),
  })
  return { body, profilePoints, hostFaceId: hostFace.id }
}

function tryThroughCutInsetBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
  resolution: NonNullable<ReturnType<typeof resolveInsetFace>>,
): PushPullBodyResult | null {
  if (distance >= 0) return null
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Push/pull face not found: ${faceId}`)
  const frame = getBodyFaceFrame(source, faceId)
  const movedVertexIds = new Set(resolution.faceEdges.map((edge) => edge.vertexId))
  const blockingDistance = nearestInsetBlockingPlane(
    source,
    movedVertexIds,
    frame.centroid,
    frame.normal,
    distance,
  )
  if (blockingDistance === null || Math.abs(distance) < blockingDistance - COLLAPSE_EPSILON) {
    return null
  }
  const restored = restoreImprintSource(source, faceId, resolution)
  if (!restored) return null
  const hostFace = restored.body.faces.find((candidate) => candidate.id === restored.hostFaceId)
  if (!hostFace) return null
  const profile = BodyNode.parse({
    ...createPlanarFaceBody(restored.profilePoints),
    id: `${source.id}:imprint-tool:${source.revision}`,
    parentId: source.parentId,
    bodyDefaults: {
      materialRef: hostFace.surface.materialRef ?? restored.body.bodyDefaults.materialRef,
    },
    faces: [
      {
        id: 'face:0',
        outerLoopId: 'loop:0',
        surface: { ...hostFace.surface },
      },
    ],
  })
  const prism = extrudePlanarBodyFace(profile, 'face:0', distance).body
  const tool = BodyNode.parse({
    ...prism,
    id: `${source.id}:imprint-tool:${source.revision}`,
    parentId: source.parentId,
    bodyDefaults: {
      materialRef: hostFace.surface.materialRef ?? restored.body.bodyDefaults.materialRef,
    },
    faces: prism.faces.map((candidate) => ({
      ...candidate,
      surface: { ...hostFace.surface },
    })),
  })
  const cut = subtractBodies(restored.body, tool)
  const sourceFeatureIds = new Set(allFeatureIds(source))
  const resultFeatureIds = new Set(allFeatureIds(cut.body))
  const deleted = [
    ...new Set([
      ...cut.topologyRemap.deleted,
      ...[...sourceFeatureIds].filter((id) => !resultFeatureIds.has(id)),
    ]),
  ]
  return {
    body: cut.body,
    movedFaceId: faceId,
    createdFaceIds: cut.topologyRemap.created.filter((id) => id.startsWith('face:')),
    throughCut: true,
    blockingDistance,
    remap: { ...cut.topologyRemap, deleted },
  }
}

function moveClosedBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
): PushPullBodyResult {
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Push/pull face not found: ${faceId}`)
  if (face.innerLoopIds.length > 0) {
    throw new RangeError('Push/pull currently requires a face without holes')
  }

  const faceLoopIds = new Set([face.outerLoopId, ...face.innerLoopIds])
  const faceEdges = source.halfEdges.filter((edge) => faceLoopIds.has(edge.loopId))
  if (faceEdges.length < 3 || faceEdges.some((edge) => edge.twinId === null)) {
    throw new RangeError('Push/pull requires a closed solid face')
  }
  if (faceEdges.some((edge) => edge.curveId !== undefined)) {
    throw new RangeError('Push/pull currently requires line edges')
  }

  const movedVertexIds = new Set(faceEdges.map((edge) => edge.vertexId))
  const frame = getBodyFaceFrame(source, faceId)
  const nearestBlockingPlane = source.vertices.reduce<number | null>((nearest, vertex) => {
    if (movedVertexIds.has(vertex.id)) return nearest
    const offset: [number, number, number] = [
      vertex.position[0] - frame.centroid[0],
      vertex.position[1] - frame.centroid[1],
      vertex.position[2] - frame.centroid[2],
    ]
    const projection = dot(offset, frame.normal)
    if (Math.abs(projection) <= COLLAPSE_EPSILON || projection * distance <= 0) return nearest
    return nearest === null || Math.abs(projection) < nearest ? Math.abs(projection) : nearest
  }, null)

  if (
    nearestBlockingPlane !== null &&
    Math.abs(distance) >= nearestBlockingPlane - COLLAPSE_EPSILON
  ) {
    throw new RangeError('Push/pull would collapse or invert the body')
  }

  const body = BodyNode.parse({
    ...source,
    revision: source.revision + 1,
    vertices: source.vertices.map((vertex) => {
      if (!movedVertexIds.has(vertex.id)) return vertex
      const position: [number, number, number] = [
        vertex.position[0] + frame.normal[0] * distance,
        vertex.position[1] + frame.normal[1] * distance,
        vertex.position[2] + frame.normal[2] * distance,
      ]
      return { ...vertex, position }
    }),
  })

  return {
    body,
    movedFaceId: faceId,
    createdFaceIds: [],
    remap: {
      preserved: allFeatureIds(source),
      created: [],
      deleted: [],
      split: {},
      merged: {},
    },
  }
}

export function pushPullBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
): PushPullBodyResult {
  if (!Number.isFinite(distance) || distance === 0) {
    throw new RangeError('Push/pull requires a non-zero finite distance')
  }
  const inset = resolveInsetFace(source, faceId)
  if (inset) {
    const throughCut = tryThroughCutInsetBodyFace(source, faceId, distance, inset)
    if (throughCut) return throughCut
    return pushPullInsetBodyFace(source, faceId, distance, inset)
  }
  if (source.faces.length === 1) {
    const face = source.faces.find((candidate) => candidate.id === faceId)
    if (face) {
      const faceLoopIds = new Set([face.outerLoopId, ...face.innerLoopIds])
      if (
        source.halfEdges.some((edge) => faceLoopIds.has(edge.loopId) && edge.curveId !== undefined)
      ) {
        throw new RangeError(
          'Push/pull currently requires line edges; curved planar boundaries cannot be extruded',
        )
      }
    }
    return extrudePlanarBodyFace(source, faceId, distance)
  }
  return moveClosedBodyFace(source, faceId, distance)
}
