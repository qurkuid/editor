import {
  type BodyNode,
  createPlanarPointProjection,
  getBodyFaceFrame,
  getBodyLoopVertices,
  validateBodyTopology,
} from '@pascal-app/core'
import type { BodyPrimitive } from './options'
import { resolveCircleDraft } from './primitive-draft'
import type { BodyDraftPoint } from './rectangle-draft'
import { resolveRectangleDraft } from './rectangle-draft'

type Point3 = readonly [number, number, number]

export type FaceProjection = {
  readonly toPlane: (point: Point3) => BodyDraftPoint
  readonly fromPlane: (point: BodyDraftPoint) => [number, number, number]
}

export function resolveFaceDraftPolygon(
  primitive: BodyPrimitive,
  points: readonly BodyDraftPoint[],
  hover: BodyDraftPoint | null,
  exactLength: number | null,
): BodyDraftPoint[] | null {
  if (!hover) return null
  const first = points[0]
  const second = points[1]
  if (primitive === 'rectangle' && first && second) {
    return resolveRectangleDraft(first, second, hover, exactLength)
  }
  return primitive === 'circle' && first && !second
    ? resolveCircleDraft(first, hover, exactLength)
    : null
}

export function createFaceProjection(body: BodyNode, faceId: string): FaceProjection | null {
  try {
    const frame = getBodyFaceFrame(body, faceId)
    const points = getBodyLoopVertices(
      body,
      body.faces.find((face) => face.id === faceId)?.outerLoopId ?? '',
    )
    const origin = points[0] ?? frame.centroid
    const projection = createPlanarPointProjection(origin, frame.normal)
    return {
      toPlane: (point) => {
        const projected = projection.toPlane(point)
        return [projected[0], projected[1]]
      },
      fromPlane: projection.fromPlane,
    }
  } catch {
    return null
  }
}

export function isBodyFaceImprintEligible(body: BodyNode, faceId: string): boolean {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face || face.innerLoopIds.length > 0) return false
  const shell = body.shells.find((candidate) => candidate.faceIds.includes(faceId))
  if (!shell || shell.faceIds.length < 2) return false
  const edges = body.halfEdges.filter((edge) => edge.loopId === face.outerLoopId)
  return (
    edges.length >= 3 && edges.every((edge) => edge.twinId !== null && edge.curveId === undefined)
  )
}

export function isBodyFacePushPullEligible(body: BodyNode, faceId: string): boolean {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  return Boolean(
    face &&
      face.innerLoopIds.length === 0 &&
      body.halfEdges
        .filter((edge) => edge.loopId === face.outerLoopId)
        .every((edge) => edge.curveId === undefined),
  )
}

export function isBodyFaceOffsetEligible(body: BodyNode, faceId: string): boolean {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face || face.innerLoopIds.length > 0) return false
  const shell = body.shells.find((candidate) => candidate.faceIds.includes(faceId))
  if (!shell || shell.faceIds.length < 2) return false
  const edges = body.halfEdges.filter((edge) => edge.loopId === face.outerLoopId)
  const curves = new Map(body.curves.map((curve) => [curve.id, curve]))
  return (
    edges.length >= 3 &&
    createFaceProjection(body, faceId) !== null &&
    edges.every(
      (edge) =>
        edge.twinId !== null &&
        (edge.curveId === undefined || curves.get(edge.curveId)?.kind === 'line'),
    )
  )
}

export function isBodyFaceSweepEligible(body: BodyNode, faceId: string): boolean {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face || body.faces.length !== 1 || body.shells.length !== 1) return false
  if (body.shells[0]?.faceIds.length !== 1 || body.shells[0]?.faceIds[0] !== faceId) return false
  if (face.innerLoopIds.length > 0 || !validateBodyTopology(body).valid) return false
  const edges = body.halfEdges.filter((edge) => edge.loopId === face.outerLoopId)
  const curves = new Map(body.curves.map((curve) => [curve.id, curve]))
  return (
    edges.length >= 3 &&
    edges.length <= 64 &&
    edges.every(
      (edge) =>
        edge.twinId === null &&
        (edge.curveId === undefined || curves.get(edge.curveId)?.kind === 'line'),
    ) &&
    createFaceProjection(body, faceId) !== null
  )
}

export function bodyGeometryPatch(body: BodyNode): Partial<BodyNode> {
  return {
    revision: body.revision,
    vertices: body.vertices,
    halfEdges: body.halfEdges,
    loops: body.loops,
    faces: body.faces,
    shells: body.shells,
    curves: body.curves,
    bodyDefaults: body.bodyDefaults,
  }
}
