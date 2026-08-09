import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyFeatureIds, orderedBodyLoopEdges } from './body-imprint-helpers'
import { validateImprintProfile } from './body-imprint-validation'
import {
  getBodyFaceFrame,
  getBodyLoopVertices,
  type TopologyRemap,
  validateBodyTopology,
} from './body-topology'

type Point3 = readonly [number, number, number]

export type ImprintBodyFaceResult = {
  body: BodyNodeType
  insetFaceId: string
  remap: TopologyRemap
}

export function imprintBodyFace(
  source: BodyNodeType,
  faceId: string,
  profilePoints: readonly Point3[],
): ImprintBodyFaceResult {
  const topology = validateBodyTopology(source)
  if (!topology.valid) throw new RangeError('Imprint requires valid Body topology')
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Imprint face not found: ${faceId}`)
  if (face.innerLoopIds.length > 0) {
    throw new RangeError('Imprint currently rejects faces with inner loops')
  }
  const shell = source.shells.find((candidate) => candidate.faceIds.includes(faceId))
  if (!shell || shell.faceIds.length < 2) {
    throw new RangeError('Imprint requires a closed solid face')
  }
  const hostEdges = orderedBodyLoopEdges(source, face.outerLoopId)
  if (
    hostEdges.length < 3 ||
    hostEdges.some((edge) => edge.twinId === null || edge.curveId !== undefined)
  ) {
    throw new RangeError('Imprint requires a closed planar face with line edges')
  }
  const hostPoints = getBodyLoopVertices(source, face.outerLoopId)
  if (hostPoints.length !== hostEdges.length) {
    throw new RangeError('Imprint host face has an invalid outer loop')
  }
  const { normal } = getBodyFaceFrame(source, faceId)
  validateImprintProfile(profilePoints, hostPoints, normal)

  const revision = source.revision + 1
  const insetFaceId = `${face.id}:imprint:${revision}`
  const innerLoopId = `${insetFaceId}:inner`
  const outerLoopId = `${insetFaceId}:outer:${revision}`
  const profileVertexIds = profilePoints.map((_, index) => `${insetFaceId}:vertex:${index}`)
  const hostEdgeIds = profilePoints.map((_, index) => `${insetFaceId}:host-edge:${index}`)
  const insetEdgeIds = profilePoints.map((_, index) => `${insetFaceId}:edge:${index}`)
  const vertices = profilePoints.map((position, index) => {
    const id = profileVertexIds[index]
    if (!id) throw new RangeError('Imprint profile vertex id allocation failed')
    return {
      id,
      position: [position[0], position[1], position[2]] as [number, number, number],
    }
  })
  const innerEdges = profilePoints.map((_, index) => {
    const id = hostEdgeIds[index]
    const vertexId = profileVertexIds[(index + 1) % profilePoints.length]
    const twinId = insetEdgeIds[index]
    const nextId = hostEdgeIds[(index - 1 + profilePoints.length) % profilePoints.length]
    if (!id || !vertexId || !twinId || !nextId) {
      throw new RangeError('Imprint profile edge id allocation failed')
    }
    return { id, vertexId, twinId, nextId, loopId: innerLoopId }
  })
  const outerEdges = profilePoints.map((_, index) => {
    const id = insetEdgeIds[index]
    const vertexId = profileVertexIds[index]
    const twinId = hostEdgeIds[index]
    const nextId = insetEdgeIds[(index + 1) % profilePoints.length]
    if (!id || !vertexId || !twinId || !nextId) {
      throw new RangeError('Imprint profile edge id allocation failed')
    }
    return { id, vertexId, twinId, nextId, loopId: outerLoopId }
  })
  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...source.vertices, ...vertices],
    halfEdges: [...source.halfEdges, ...innerEdges, ...outerEdges],
    loops: [
      ...source.loops,
      { id: innerLoopId, faceId, kind: 'inner' },
      { id: outerLoopId, faceId: insetFaceId, kind: 'outer' },
    ],
    faces: [
      ...source.faces.map((candidate) =>
        candidate.id === faceId
          ? { ...candidate, innerLoopIds: [...candidate.innerLoopIds, innerLoopId] }
          : candidate,
      ),
      { id: insetFaceId, outerLoopId, surface: { ...face.surface } },
    ],
    shells: source.shells.map((candidate) =>
      candidate.id === shell.id
        ? { ...candidate, faceIds: [...candidate.faceIds, insetFaceId] }
        : candidate,
    ),
  })
  const created = [
    ...vertices,
    ...innerEdges,
    ...outerEdges,
    { id: innerLoopId },
    { id: outerLoopId },
    { id: insetFaceId },
  ].map(({ id }) => id)
  return {
    body,
    insetFaceId,
    remap: {
      preserved: bodyFeatureIds(source),
      created,
      deleted: [],
      split: {},
      merged: {},
    },
  }
}
