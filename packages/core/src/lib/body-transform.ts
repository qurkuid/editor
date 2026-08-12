import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'

export type BodyTransform = {
  readonly translation: readonly [number, number, number]
  readonly rotationAxis: readonly [number, number, number]
  readonly rotationAngle: number
  readonly scale: readonly [number, number, number]
  readonly pivot: readonly [number, number, number]
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
  if (
    transform.translation.every((value) => value === 0) &&
    transform.rotationAngle === 0 &&
    transform.scale.every((value) => value === 1)
  ) {
    throw new RangeError('Body transform requires a change')
  }
  const hasCircularArc = source.curves.some((curve) => curve.kind === 'circular-arc')
  const uniformScale = transform.scale.every((value) => value === transform.scale[0])
  if (hasCircularArc && !uniformScale) {
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

  return BodyNode.parse({
    ...source,
    revision: source.revision + 1,
    vertices: source.vertices.map((vertex) => ({
      ...vertex,
      position: transformPoint(vertex.position),
    })),
    faces: source.faces.map((face) => ({
      ...face,
      surface: {
        ...face.surface,
        uvOrigin: transformPoint(face.surface.uvOrigin),
        uvU: transformDirection(face.surface.uvU),
        uvV: transformDirection(face.surface.uvV),
      },
    })),
    curves: source.curves.map((curve) => {
      switch (curve.kind) {
        case 'line':
          return curve
        case 'circular-arc':
          return {
            ...curve,
            center: transformPoint(curve.center),
            normal: transformDirection(curve.normal),
            radius: curve.radius * transform.scale[0],
          }
        default: {
          const unreachable: never = curve
          throw new RangeError(`Unsupported Body curve: ${String(unreachable)}`)
        }
      }
    }),
  })
}
