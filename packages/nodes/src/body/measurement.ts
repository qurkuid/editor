import {
  type BodyNode,
  closestMeasurementFeatureBinding,
  getBodyFaceFrame,
  getBodyLoopVertices,
  type MeasurementFeature,
  type MeasurementFeatureBinding,
  type MeasurementFeatureReference,
  type MeasurementPoint,
} from '@pascal-app/core'

type Point3 = [number, number, number]

const subtract = (a: MeasurementPoint, b: MeasurementPoint): Point3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]

const addScaled = (
  origin: MeasurementPoint,
  uAxis: MeasurementPoint,
  u: number,
  vAxis: MeasurementPoint,
  v: number,
): Point3 => [
  origin[0] + uAxis[0] * u + vAxis[0] * v,
  origin[1] + uAxis[1] * u + vAxis[1] * v,
  origin[2] + uAxis[2] * u + vAxis[2] * v,
]

const dot = (a: MeasurementPoint, b: MeasurementPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const axisSpan = (
  origin: MeasurementPoint,
  axis: MeasurementPoint,
  points: readonly MeasurementPoint[],
) =>
  points.reduce(
    (largest, point) => Math.max(largest, Math.abs(dot(subtract(point, origin), axis))),
    0,
  )

const normalize = (value: MeasurementPoint): Point3 | null => {
  const length = Math.hypot(value[0], value[1], value[2])
  return length <= 1e-9
    ? null
    : [value[0] / length || 0, value[1] / length || 0, value[2] / length || 0]
}

const cross = (a: MeasurementPoint, b: MeasurementPoint): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function faceFrame(body: BodyNode, faceId: string) {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face) return null
  const points = getBodyLoopVertices(body, face.outerLoopId)
  if (points.length < 3) return null
  const bodyFrame = getBodyFaceFrame(body, faceId)
  const normal: Point3 = [
    bodyFrame.normal[0] || 0,
    bodyFrame.normal[1] || 0,
    bodyFrame.normal[2] || 0,
  ]
  const origin = points[0]
  const next = points[1]
  if (!origin || !next) return null
  const uAxis = normalize(subtract(next, origin))
  if (!uAxis) return null
  const vAxis = normalize(cross(uAxis, normal))
  if (!vAxis) return null
  return {
    normal,
    origin,
    points,
    uAxis,
    uSpan: axisSpan(origin, uAxis, points),
    vAxis,
    vSpan: axisSpan(origin, vAxis, points),
  }
}

function pointInFace(point: MeasurementPoint, points: readonly MeasurementPoint[]) {
  const normal = getPolygonNormal(points)
  const omittedAxis = normal.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(normal[best]!) ? index : best),
    0,
  )
  const project = (candidate: MeasurementPoint) =>
    candidate.filter((_, index) => index !== omittedAxis) as [number, number]
  const [px, py] = project(point)
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x, y] = project(points[index]!)
    const [previousX, previousY] = project(points[previous]!)
    if (y > py !== previousY > py && px < ((previousX - x) * (py - y)) / (previousY - y) + x) {
      inside = !inside
    }
  }
  return inside
}

function getPolygonNormal(points: readonly MeasurementPoint[]): Point3 {
  let normal: Point3 = [0, 0, 0]
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    normal = [
      normal[0] + (current[1] - next[1]) * (current[2] + next[2]),
      normal[1] + (current[2] - next[2]) * (current[0] + next[0]),
      normal[2] + (current[0] - next[0]) * (current[1] + next[1]),
    ]
  }
  return normal
}

export function bodyMeasurementFeatures(body: BodyNode): MeasurementFeature[] {
  const vertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex.position]))
  const edges = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  return [
    ...body.vertices.map(
      (vertex) =>
        ({
          id: vertex.id,
          label: 'Body vertex',
          snapKind: 'endpoint',
          priority: 110,
          geometry: { kind: 'point', point: vertex.position },
        }) satisfies MeasurementFeature,
    ),
    ...body.halfEdges.flatMap((edge): MeasurementFeature[] => {
      const start = vertices.get(edge.vertexId)
      const end = vertices.get(edges.get(edge.nextId)?.vertexId ?? '')
      return start && end
        ? [
            {
              id: edge.id,
              label: 'Body edge',
              snapKind: 'edge',
              priority: 90,
              geometry: { kind: 'segment', start, end },
            },
          ]
        : []
    }),
    ...body.faces.flatMap((face): MeasurementFeature[] => {
      const frame = faceFrame(body, face.id)
      return frame
        ? [
            {
              id: face.id,
              label: 'Body face',
              snapKind: 'face',
              priority: 60,
              normal: frame.normal,
              geometry: { kind: 'polygon', points: frame.points },
            },
          ]
        : []
    }),
  ]
}

export function matchBodyMeasurementFeature(
  body: BodyNode,
  hit: MeasurementPoint,
  maxDistance: number,
): MeasurementFeatureBinding | null {
  const features = bodyMeasurementFeatures(body)
  const boundary = closestMeasurementFeatureBinding(
    features.filter((feature) => feature.snapKind !== 'face'),
    hit,
    maxDistance,
  )
  if (boundary) return boundary

  let best: MeasurementFeatureBinding | null = null
  for (const face of body.faces) {
    const frame = faceFrame(body, face.id)
    if (!frame) continue
    const offset = subtract(hit, frame.origin)
    const signedDistance = dot(offset, frame.normal)
    const projected = addScaled(hit, frame.normal, -signedDistance, frame.vAxis, 0)
    const distance = Math.abs(signedDistance)
    if (distance > maxDistance || !pointInFace(projected, frame.points)) continue
    const local = subtract(projected, frame.origin)
    const candidate: MeasurementFeatureBinding = {
      featureId: face.id,
      point: projected,
      parameters: {
        u: frame.uSpan <= 1e-9 ? 0 : dot(local, frame.uAxis) / frame.uSpan,
        v: frame.vSpan <= 1e-9 ? 0 : dot(local, frame.vAxis) / frame.vSpan,
      },
      distance,
    }
    if (!best || candidate.distance < best.distance) best = candidate
  }
  return best
}

export function resolveBodyMeasurementFeature(
  body: BodyNode,
  reference: MeasurementFeatureReference,
): MeasurementFeature | null {
  const feature = bodyMeasurementFeatures(body).find(
    (candidate) => candidate.id === reference.featureId,
  )
  if (!feature) return null
  const u = reference.parameters?.u
  const v = reference.parameters?.v
  if (feature.snapKind !== 'face' || typeof u !== 'number' || typeof v !== 'number') return feature
  const frame = faceFrame(body, feature.id)
  if (!frame) return null
  return {
    ...feature,
    normal: frame.normal,
    geometry: {
      kind: 'point',
      point: addScaled(frame.origin, frame.uAxis, u * frame.uSpan, frame.vAxis, v * frame.vSpan),
    },
  }
}
