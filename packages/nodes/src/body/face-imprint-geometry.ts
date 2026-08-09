import { type BodyNode, getBodyFaceFrame, getBodyLoopVertices } from '@pascal-app/core'
import type { BodyPrimitive } from './options'
import { resolveCircleDraft } from './primitive-draft'
import type { BodyDraftPoint } from './rectangle-draft'
import { resolveRectangleDraft } from './rectangle-draft'

const EPSILON = 1e-9
const AXES = [0, 1, 2] as const

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

function dominantAxis(normal: Point3): 0 | 1 | 2 {
  let axis: 0 | 1 | 2 = 0
  for (const candidate of AXES) {
    if (Math.abs(normal[candidate]) > Math.abs(normal[axis])) axis = candidate
  }
  return axis
}

export function createFaceProjection(body: BodyNode, faceId: string): FaceProjection | null {
  try {
    const frame = getBodyFaceFrame(body, faceId)
    const points = getBodyLoopVertices(
      body,
      body.faces.find((face) => face.id === faceId)?.outerLoopId ?? '',
    )
    const origin = points[0] ?? frame.centroid
    const axis = dominantAxis(frame.normal)
    const planeOffset =
      frame.normal[0] * origin[0] + frame.normal[1] * origin[1] + frame.normal[2] * origin[2]
    if (Math.abs(frame.normal[axis]) <= EPSILON) return null

    const toPlane = (point: Point3): BodyDraftPoint => {
      if (axis === 0) return [point[1], point[2]]
      if (axis === 1) return [point[0], point[2]]
      return [point[0], point[1]]
    }
    const fromPlane = (point: BodyDraftPoint): [number, number, number] => {
      if (axis === 0) {
        const [y, z] = point
        return [(planeOffset - frame.normal[1] * y - frame.normal[2] * z) / frame.normal[0], y, z]
      }
      if (axis === 1) {
        const [x, z] = point
        return [x, (planeOffset - frame.normal[0] * x - frame.normal[2] * z) / frame.normal[1], z]
      }
      const [x, y] = point
      return [x, y, (planeOffset - frame.normal[0] * x - frame.normal[1] * y) / frame.normal[2]]
    }
    return { toPlane, fromPlane }
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
