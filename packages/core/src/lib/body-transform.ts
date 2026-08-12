import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { rebaseCircularArcCurve } from './body-curves'
import {
  assertBodyFeatureGeometry,
  autofoldBodyFaces,
  type BodyFeatureKind,
  bodyFeatureCurveIds,
  bodyFeatureFaceVertexIds,
  isBodyFeatureFacePlanar,
  resolveBodyFeatureVertexIds,
} from './body-feature-move'
import { validateBodyTopology } from './body-topology'

export type BodyFeatureTransform = {
  readonly kind: BodyFeatureKind
  readonly featureId: string
  readonly autofold?: boolean
}

export type BodyTransform = {
  readonly translation: readonly [number, number, number]
  readonly rotationAxis: readonly [number, number, number]
  readonly rotationAngle: number
  readonly scale: readonly [number, number, number]
  readonly pivot: readonly [number, number, number]
  readonly feature?: BodyFeatureTransform | null
}

const ZERO_EPSILON = 1e-12

const snapZero = (value: number) => (Math.abs(value) < ZERO_EPSILON ? 0 : value)

function rotateAroundAxis(
  value: readonly [number, number, number],
  axis: readonly [number, number, number],
  cosine: number,
  sine: number,
): [number, number, number] {
  const crossX = axis[1] * value[2] - axis[2] * value[1]
  const crossY = axis[2] * value[0] - axis[0] * value[2]
  const crossZ = axis[0] * value[1] - axis[1] * value[0]
  const dot = axis[0] * value[0] + axis[1] * value[1] + axis[2] * value[2]
  const oneMinusCosine = 1 - cosine
  return [
    snapZero(value[0] * cosine + crossX * sine + axis[0] * dot * oneMinusCosine),
    snapZero(value[1] * cosine + crossY * sine + axis[1] * dot * oneMinusCosine),
    snapZero(value[2] * cosine + crossZ * sine + axis[2] * dot * oneMinusCosine),
  ]
}

export function transformBody(source: BodyNodeType, transform: BodyTransform): BodyNodeType {
  const values = [
    ...transform.translation,
    ...transform.rotationAxis,
    transform.rotationAngle,
    ...transform.scale,
    ...transform.pivot,
  ]
  if (
    values.some((value) => !Number.isFinite(value)) ||
    transform.scale.some((value) => value <= 0)
  ) {
    throw new RangeError('Body transform requires finite values and a positive scale')
  }
  const axisLength = Math.hypot(...transform.rotationAxis)
  if (axisLength <= ZERO_EPSILON) throw new RangeError('Body transform requires a non-zero axis')
  const axis: [number, number, number] = [
    transform.rotationAxis[0] / axisLength,
    transform.rotationAxis[1] / axisLength,
    transform.rotationAxis[2] / axisLength,
  ]
  const feature = transform.feature ?? null
  const movedVertexIds = feature
    ? resolveBodyFeatureVertexIds(source, feature.kind, feature.featureId)
    : null
  const fullyMovedFaceIds = feature
    ? new Set(
        source.faces
          .filter((face) =>
            [...bodyFeatureFaceVertexIds(source, face.id)].every((id) => movedVertexIds?.has(id)),
          )
          .map(({ id }) => id),
      )
    : null
  if (
    transform.translation.every((value) => value === 0) &&
    transform.rotationAngle === 0 &&
    transform.scale.every((value) => value === 1)
  ) {
    throw new RangeError('Body transform requires a change')
  }
  if (feature && !validateBodyTopology(source).valid) {
    throw new RangeError('Body feature transform requires valid topology')
  }
  if (feature) {
    const movedCurveIds = bodyFeatureCurveIds(source, movedVertexIds!)
    if (source.curves.some(({ id, kind }) => movedCurveIds.has(id) && kind !== 'line')) {
      throw new RangeError('Body feature transform currently supports line edges only')
    }
  }
  const hasCircularArc = source.curves.some((curve) => curve.kind === 'circular-arc')
  const uniformScale = transform.scale.every((value) => value === transform.scale[0])
  if (!feature && hasCircularArc && !uniformScale) {
    throw new RangeError('Body transform with non-uniform scale cannot preserve circular arcs')
  }

  const cosine = Math.cos(transform.rotationAngle)
  const sine = Math.sin(transform.rotationAngle)
  const transformPoint = (point: readonly [number, number, number]): [number, number, number] => {
    const relative: [number, number, number] = [
      (point[0] - transform.pivot[0]) * transform.scale[0],
      (point[1] - transform.pivot[1]) * transform.scale[1],
      (point[2] - transform.pivot[2]) * transform.scale[2],
    ]
    const rotated = rotateAroundAxis(relative, axis, cosine, sine)
    return [
      snapZero(rotated[0] + transform.pivot[0] + transform.translation[0]),
      snapZero(rotated[1] + transform.pivot[1] + transform.translation[1]),
      snapZero(rotated[2] + transform.pivot[2] + transform.translation[2]),
    ]
  }
  const transformDirection = (direction: readonly [number, number, number]) =>
    rotateAroundAxis(direction, axis, cosine, sine)

  let body = BodyNode.parse({
    ...source,
    revision: source.revision + 1,
    vertices: source.vertices.map((vertex) =>
      !feature || movedVertexIds?.has(vertex.id)
        ? { ...vertex, position: transformPoint(vertex.position) }
        : vertex,
    ),
    faces: source.faces.map((face) => ({
      ...face,
      surface: {
        ...face.surface,
        ...(feature && !fullyMovedFaceIds?.has(face.id)
          ? {}
          : {
              uvOrigin: transformPoint(face.surface.uvOrigin),
              uvU: transformDirection(face.surface.uvU),
              uvV: transformDirection(face.surface.uvV),
            }),
      },
    })),
    curves: feature
      ? source.curves.map((curve) => curve)
      : source.curves.map((curve) => {
          switch (curve.kind) {
            case 'line':
              return curve
            case 'circular-arc': {
              const transformedCenter = transformPoint(curve.center)
              const transformedNormal = transformDirection(curve.normal)
              const transformedRadius = curve.radius * transform.scale[0]
              const sourceEdge = source.halfEdges.find((edge) => edge.curveId === curve.id)
              const sourceNextEdge = sourceEdge
                ? source.halfEdges.find((edge) => edge.id === sourceEdge.nextId)
                : undefined
              const sourceStart = sourceEdge
                ? source.vertices.find((vertex) => vertex.id === sourceEdge.vertexId)
                : undefined
              const sourceEnd = sourceNextEdge
                ? source.vertices.find((vertex) => vertex.id === sourceNextEdge.vertexId)
                : undefined
              if (sourceStart && sourceEnd) {
                return rebaseCircularArcCurve(
                  curve,
                  transformPoint(sourceStart.position),
                  transformPoint(sourceEnd.position),
                  transformedCenter,
                  transformedNormal,
                  transformedRadius,
                )
              }
              return {
                ...curve,
                center: transformedCenter,
                normal: transformedNormal,
                radius: transformedRadius,
              }
            }
            default: {
              const unreachable: never = curve
              throw new RangeError(`Unsupported Body curve: ${String(unreachable)}`)
            }
          }
        }),
  })
  if (!feature) return body
  const affectedFaceIds = new Set(
    source.faces
      .filter((face) =>
        [...bodyFeatureFaceVertexIds(source, face.id)].some((id) => movedVertexIds!.has(id)),
      )
      .filter((face) => !isBodyFeatureFacePlanar(body, face))
      .map(({ id }) => id),
  )
  let result = body
  if (affectedFaceIds.size > 0 && feature.autofold === true) {
    result = autofoldBodyFaces(result, affectedFaceIds)
  }
  assertBodyFeatureGeometry(result)
  if (!validateBodyTopology(result).valid) {
    throw new RangeError('Body feature transform produced invalid topology')
  }
  return result
}
