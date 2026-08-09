import {
  type BodyNode,
  closestMeasurementFeatureBinding,
  getBodyFaceFrame,
  getBodyLoopVertices,
  type MeasurementFeature,
  type MeasurementFeatureBinding,
  type MeasurementFeatureReference,
  type MeasurementPoint,
  measurementCentroid,
  measurementNormal,
} from '@pascal-app/core'
import { ShapeUtils, Vector2 } from 'three'

type Point3 = [number, number, number]

const GEOMETRY_EPSILON = 1e-9
const BODY_FACE_HIT_EPSILON = 1e-5
const BODY_FACE_NORMAL_MIN_ALIGNMENT = 0.85
const BODY_SNAP_SCREEN_APERTURE_PX = 16

const stableCoordinate = (value: number): number => {
  if (Math.abs(value) <= GEOMETRY_EPSILON) return 0
  const rounded = Math.round(value * 1e12) / 1e12
  return Math.abs(value - rounded) <= GEOMETRY_EPSILON ? rounded : value
}

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
  const holes = face.innerLoopIds
    .map((loopId) => getBodyLoopVertices(body, loopId))
    .filter((loop) => loop.length >= 3)
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
    holes,
    points,
    uAxis,
    uSpan: axisSpan(origin, uAxis, points),
    vAxis,
    vSpan: axisSpan(origin, vAxis, points),
  }
}

function projectToFace(
  frame: NonNullable<ReturnType<typeof faceFrame>>,
  point: MeasurementPoint,
): Vector2 {
  const local = subtract(point, frame.origin)
  return new Vector2(dot(local, frame.uAxis), dot(local, frame.vAxis))
}

function pointFromFace(frame: NonNullable<ReturnType<typeof faceFrame>>, point: Vector2): Point3 {
  const resolved = addScaled(frame.origin, frame.uAxis, point.x, frame.vAxis, point.y)
  return resolved.map(stableCoordinate) as Point3
}

function faceCenter(frame: NonNullable<ReturnType<typeof faceFrame>>): Point3 {
  const centroid = measurementCentroid(frame.points)
  if (centroid && pointInFaceFrame(frame, centroid)) {
    return centroid.map(stableCoordinate) as Point3
  }

  const projected = frame.points.map((point) => projectToFace(frame, point))
  const projectedHoles = frame.holes.map((hole) => hole.map((point) => projectToFace(frame, point)))
  const projectedPoints = [projected, ...projectedHoles].flat()
  const triangles = ShapeUtils.triangulateShape(projected, projectedHoles)
  const candidates = triangles
    .map((triangle, index) => {
      const first = projectedPoints[triangle[0] ?? -1]
      const second = projectedPoints[triangle[1] ?? -1]
      const third = projectedPoints[triangle[2] ?? -1]
      if (!first || !second || !third) return null
      const center = pointFromFace(
        frame,
        new Vector2((first.x + second.x + third.x) / 3, (first.y + second.y + third.y) / 3),
      )
      if (!pointInFaceFrame(frame, center)) return null
      return {
        center,
        index,
        area: Math.abs(
          first.x * (second.y - third.y) +
            second.x * (third.y - first.y) +
            third.x * (first.y - second.y),
        ),
      }
    })
    .filter((candidate) => candidate !== null)
    .sort((first, second) => second.area - first.area || first.index - second.index)
  return candidates[0]?.center ?? frame.points[0]!
}

function bodyCenter(body: BodyNode): Point3 | null {
  if (body.vertices.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const vertex of body.vertices) {
    minX = Math.min(minX, vertex.position[0])
    minY = Math.min(minY, vertex.position[1])
    minZ = Math.min(minZ, vertex.position[2])
    maxX = Math.max(maxX, vertex.position[0])
    maxY = Math.max(maxY, vertex.position[1])
    maxZ = Math.max(maxZ, vertex.position[2])
  }
  return [
    stableCoordinate((minX + maxX) / 2),
    stableCoordinate((minY + maxY) / 2),
    stableCoordinate((minZ + maxZ) / 2),
  ]
}

function pointInFace(point: MeasurementPoint, points: readonly MeasurementPoint[]) {
  const normal = measurementNormal(points)
  if (!normal) return false
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
    const segmentX = x - previousX
    const segmentY = y - previousY
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const segmentParameter =
      segmentLengthSquared <= GEOMETRY_EPSILON
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((px - previousX) * segmentX + (py - previousY) * segmentY) / segmentLengthSquared,
            ),
          )
    const closestX = previousX + segmentX * segmentParameter
    const closestY = previousY + segmentY * segmentParameter
    if (Math.hypot(px - closestX, py - closestY) <= BODY_FACE_HIT_EPSILON) return true
    if (y > py !== previousY > py && px < ((previousX - x) * (py - y)) / (previousY - y) + x) {
      inside = !inside
    }
  }
  return inside
}

function pointInFaceFrame(
  frame: NonNullable<ReturnType<typeof faceFrame>>,
  point: MeasurementPoint,
) {
  return pointInFace(point, frame.points) && frame.holes.every((hole) => !pointInFace(point, hole))
}

export function bodyMeasurementFeatures(body: BodyNode): MeasurementFeature[] {
  const vertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex.position]))
  const edges = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  const features: MeasurementFeature[] = [
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
              id: `${edge.id}:midpoint`,
              label: 'Body edge midpoint',
              snapKind: 'midpoint',
              priority: 105,
              geometry: {
                kind: 'point',
                point: [
                  stableCoordinate((start[0] + end[0]) / 2),
                  stableCoordinate((start[1] + end[1]) / 2),
                  stableCoordinate((start[2] + end[2]) / 2),
                ],
              },
            },
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
              id: `${face.id}:center`,
              label: 'Body face center',
              snapKind: 'center',
              priority: 80,
              normal: frame.normal,
              geometry: { kind: 'point', point: faceCenter(frame) },
            },
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
  const center = bodyCenter(body)
  if (center) {
    features.push({
      id: 'body:center',
      label: 'Body center',
      snapKind: 'center',
      priority: 75,
      geometry: { kind: 'point', point: center },
    })
  }
  return features
}

export function resolveBodyMeasurementFaceId(
  body: BodyNode,
  hit: MeasurementPoint,
  normal: MeasurementPoint,
): string | null {
  let bestFaceId: string | null = null
  let bestPlaneDistance = Number.POSITIVE_INFINITY
  let bestNormalAlignment = Number.NEGATIVE_INFINITY
  for (const face of body.faces) {
    const frame = faceFrame(body, face.id)
    if (!frame) continue
    const normalAlignment = Math.abs(dot(normal, frame.normal))
    if (normalAlignment < BODY_FACE_NORMAL_MIN_ALIGNMENT) continue
    const offset = subtract(hit, frame.origin)
    const signedDistance = dot(offset, frame.normal)
    const planeDistance = Math.abs(signedDistance)
    if (planeDistance > BODY_FACE_HIT_EPSILON) continue
    const projected = addScaled(hit, frame.normal, -signedDistance, frame.vAxis, 0)
    if (!pointInFaceFrame(frame, projected)) continue
    if (
      planeDistance < bestPlaneDistance - BODY_FACE_HIT_EPSILON ||
      (Math.abs(planeDistance - bestPlaneDistance) <= BODY_FACE_HIT_EPSILON &&
        normalAlignment > bestNormalAlignment)
    ) {
      bestFaceId = face.id
      bestPlaneDistance = planeDistance
      bestNormalAlignment = normalAlignment
    }
  }
  return bestFaceId
}

export function matchBodyMeasurementFeature(
  body: BodyNode,
  hit: MeasurementPoint,
  maxDistance: number,
  screenDistance?: (point: MeasurementPoint) => number,
  visibleFaceId?: string | null,
): MeasurementFeatureBinding | null {
  const features = bodyMeasurementFeatures(body)
  const visibleFace =
    visibleFaceId === undefined
      ? null
      : (body.faces.find((face) => face.id === visibleFaceId) ?? null)
  const visibleFaceFeatureIds = visibleFaceId === undefined ? null : new Set<string>()
  if (visibleFace && visibleFaceFeatureIds) {
    visibleFaceFeatureIds.add(visibleFace.id)
    visibleFaceFeatureIds.add(`${visibleFace.id}:center`)
    const loopIds = new Set([visibleFace.outerLoopId, ...visibleFace.innerLoopIds])
    const edges = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
    for (const edge of body.halfEdges) {
      if (!loopIds.has(edge.loopId)) continue
      visibleFaceFeatureIds.add(edge.id)
      visibleFaceFeatureIds.add(`${edge.id}:midpoint`)
      visibleFaceFeatureIds.add(edge.vertexId)
      const next = edges.get(edge.nextId)
      if (next) visibleFaceFeatureIds.add(next.vertexId)
    }
  }
  const isVisibleFaceFeature = (feature: MeasurementFeature) =>
    visibleFaceFeatureIds === null || visibleFaceFeatureIds.has(feature.id)
  let bestBinding: MeasurementFeatureBinding | null = null
  let bestTier = Number.NEGATIVE_INFINITY
  let bestDistance = Number.POSITIVE_INFINITY
  let bestPriority = Number.NEGATIVE_INFINITY
  const snapTier = (feature: MeasurementFeature): number => {
    if (feature.snapKind === 'endpoint') return 4
    if (feature.snapKind === 'midpoint' || feature.snapKind === 'center') return 3
    if (feature.snapKind === 'edge') return 2
    if (feature.snapKind === 'face') return 1
    return 0
  }
  const consider = (
    binding: MeasurementFeatureBinding,
    feature: MeasurementFeature,
    priority = feature.priority ?? 0,
  ) => {
    const candidateScreenDistance = screenDistance?.(binding.point)
    if (
      candidateScreenDistance !== undefined &&
      (!Number.isFinite(candidateScreenDistance) ||
        candidateScreenDistance > BODY_SNAP_SCREEN_APERTURE_PX)
    ) {
      return
    }
    const tier = snapTier(feature)
    if (
      tier > bestTier ||
      (tier === bestTier &&
        (binding.distance < bestDistance - GEOMETRY_EPSILON ||
          (Math.abs(binding.distance - bestDistance) <= GEOMETRY_EPSILON &&
            priority > bestPriority)))
    ) {
      bestBinding = binding
      bestTier = tier
      bestDistance = binding.distance
      bestPriority = priority
    }
  }

  for (const snapKind of ['endpoint', 'midpoint', 'center'] as const) {
    for (const pointFeature of features.filter(
      (feature) =>
        feature.snapKind === snapKind &&
        feature.geometry.kind === 'point' &&
        isVisibleFaceFeature(feature),
    )) {
      const pointBinding = closestMeasurementFeatureBinding([pointFeature], hit, maxDistance)
      if (pointBinding) consider(pointBinding, pointFeature)
    }
  }

  const bodyCenterFeature = features.find((feature) => feature.id === 'body:center')
  if (bodyCenterFeature?.geometry.kind === 'point') {
    const bodyCenterPoint = bodyCenterFeature.geometry.point
    const bodyCenterFaces =
      visibleFaceId === undefined ? body.faces : visibleFace ? [visibleFace] : []
    for (const face of bodyCenterFaces) {
      const frame = faceFrame(body, face.id)
      if (!frame) continue
      const centerOffset = subtract(bodyCenterPoint, frame.origin)
      const centerIsBehindFace = Math.abs(dot(centerOffset, frame.normal)) > GEOMETRY_EPSILON
      const projectedCenter = addScaled(
        bodyCenterPoint,
        frame.normal,
        -dot(centerOffset, frame.normal),
        frame.vAxis,
        0,
      )
      if (!pointInFaceFrame(frame, projectedCenter)) continue
      const hitOffset = subtract(hit, frame.origin)
      const projectedHit = addScaled(
        hit,
        frame.normal,
        -dot(hitOffset, frame.normal),
        frame.vAxis,
        0,
      )
      const distance = Math.hypot(
        projectedHit[0] - projectedCenter[0],
        projectedHit[1] - projectedCenter[1],
        projectedHit[2] - projectedCenter[2],
      )
      if (distance <= maxDistance) {
        consider(
          {
            featureId: 'body:center',
            point: bodyCenterPoint,
            parameters: { t: 0 },
            distance,
          },
          bodyCenterFeature,
          (bodyCenterFeature.priority ?? 0) + (centerIsBehindFace ? 20 : 0),
        )
      }
    }
  }

  for (const edgeFeature of features.filter(
    (feature) => feature.geometry.kind === 'segment' && isVisibleFaceFeature(feature),
  )) {
    const edgeBinding = closestMeasurementFeatureBinding([edgeFeature], hit, maxDistance)
    if (edgeBinding) consider(edgeBinding, edgeFeature)
  }

  for (const face of body.faces) {
    if (visibleFaceId !== undefined && face.id !== visibleFaceId) continue
    const frame = faceFrame(body, face.id)
    if (!frame) continue
    const offset = subtract(hit, frame.origin)
    const signedDistance = dot(offset, frame.normal)
    const projected = addScaled(hit, frame.normal, -signedDistance, frame.vAxis, 0)
    const distance = Math.abs(signedDistance)
    if (distance > maxDistance || !pointInFaceFrame(frame, projected)) continue
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
    const faceFeature = features.find((feature) => feature.id === face.id)
    if (faceFeature) consider(candidate, faceFeature)
  }
  return bestBinding
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
