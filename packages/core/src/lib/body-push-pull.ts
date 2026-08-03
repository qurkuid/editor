import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import {
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
  return source.faces.length === 1
    ? extrudePlanarBodyFace(source, faceId, distance)
    : moveClosedBodyFace(source, faceId, distance)
}
