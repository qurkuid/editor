import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'

export type BodyTransform = {
  readonly translation: readonly [number, number, number]
  readonly rotationY: number
  readonly uniformScale: number
  readonly pivot: readonly [number, number, number]
}

const ZERO_EPSILON = 1e-12

const snapZero = (value: number) => (Math.abs(value) < ZERO_EPSILON ? 0 : value)

function rotateY(
  value: readonly [number, number, number],
  cosine: number,
  sine: number,
): [number, number, number] {
  return [
    snapZero(value[0] * cosine + value[2] * sine),
    snapZero(value[1]),
    snapZero(-value[0] * sine + value[2] * cosine),
  ]
}

export function transformBody(source: BodyNodeType, transform: BodyTransform): BodyNodeType {
  const values = [
    ...transform.translation,
    transform.rotationY,
    transform.uniformScale,
    ...transform.pivot,
  ]
  if (values.some((value) => !Number.isFinite(value)) || transform.uniformScale <= 0) {
    throw new RangeError('Body transform requires finite values and a positive scale')
  }
  if (
    transform.translation.every((value) => value === 0) &&
    transform.rotationY === 0 &&
    transform.uniformScale === 1
  ) {
    throw new RangeError('Body transform requires a change')
  }
  if (transform.rotationY !== 0 && source.curves.some((curve) => curve.kind === 'circular-arc')) {
    throw new RangeError('Body rotation does not yet support circular arcs')
  }

  const cosine = Math.cos(transform.rotationY)
  const sine = Math.sin(transform.rotationY)
  const transformPoint = (point: readonly [number, number, number]): [number, number, number] => {
    const relative: [number, number, number] = [
      (point[0] - transform.pivot[0]) * transform.uniformScale,
      (point[1] - transform.pivot[1]) * transform.uniformScale,
      (point[2] - transform.pivot[2]) * transform.uniformScale,
    ]
    const rotated = rotateY(relative, cosine, sine)
    return [
      snapZero(rotated[0] + transform.pivot[0] + transform.translation[0]),
      snapZero(rotated[1] + transform.pivot[1] + transform.translation[1]),
      snapZero(rotated[2] + transform.pivot[2] + transform.translation[2]),
    ]
  }
  const transformDirection = (direction: readonly [number, number, number]) =>
    rotateY(direction, cosine, sine)

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
            radius: curve.radius * transform.uniformScale,
          }
        default: {
          const unreachable: never = curve
          throw new RangeError(`Unsupported Body curve: ${String(unreachable)}`)
        }
      }
    }),
  })
}
