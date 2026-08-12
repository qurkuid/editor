import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { cloneSceneGraph } from '../utils/clone-scene-graph'
import { validateBodyTopology } from './body-topology'
import { transformBody } from './body-transform'

export type BodyArrayPoint = readonly [number, number, number]

export type BodyLinearArrayInput = {
  readonly count: number
  readonly offset: BodyArrayPoint
}

export type BodyCircularArrayInput = {
  readonly count: number
  readonly center: BodyArrayPoint
  readonly axis: BodyArrayPoint
  readonly angle?: number
  readonly fullCircle?: boolean
}

const ARRAY_MIN_COUNT = 2
const ARRAY_MAX_COUNT = 100
const AXIS_EPSILON = 1e-12

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < ARRAY_MIN_COUNT || count > ARRAY_MAX_COUNT) {
    throw new RangeError('Body array count must be an integer from 2 to 100')
  }
}

function assertFinitePoint(point: BodyArrayPoint, label: string): void {
  if (point.length !== 3 || point.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`Body array ${label} must contain three finite metres`)
  }
}

function normalizeAxis(axis: BodyArrayPoint): [number, number, number] {
  assertFinitePoint(axis, 'axis')
  const length = Math.hypot(...axis)
  if (length <= AXIS_EPSILON) throw new RangeError('Body circular array axis must be non-zero')
  return [axis[0] / length, axis[1] / length, axis[2] / length]
}

function assertSource(body: BodyNodeType): void {
  if (!validateBodyTopology(body).valid) {
    throw new RangeError('Body array requires valid topology')
  }
}

function cloneBodyWithTransform(
  source: BodyNodeType,
  transform: {
    readonly translation: BodyArrayPoint
    readonly rotationAxis: BodyArrayPoint
    readonly rotationAngle: number
    readonly pivot: BodyArrayPoint
  },
): BodyNodeType {
  const cloneGraph = cloneSceneGraph({ nodes: { [source.id]: source }, rootNodeIds: [source.id] })
  const cloneId = cloneGraph.rootNodeIds[0]
  if (!cloneId) throw new RangeError('Body array could not create a fresh clone id')
  const clonedSource = cloneGraph.nodes[cloneId]
  if (clonedSource?.type !== 'body') throw new RangeError('Body array clone is not a Body')
  const isIdentity =
    transform.translation.every((value) => value === 0) && transform.rotationAngle === 0
  const transformed = isIdentity
    ? clonedSource
    : transformBody(clonedSource, {
        ...transform,
        scale: [1, 1, 1],
      })
  return BodyNode.parse({ ...transformed, id: clonedSource.id, parentId: source.parentId })
}

export function createBodyLinearArray(
  source: BodyNodeType,
  input: BodyLinearArrayInput,
): BodyNodeType[] {
  assertSource(source)
  assertCount(input.count)
  assertFinitePoint(input.offset, 'offset')

  return Array.from({ length: input.count - 1 }, (_, index) => {
    const step = index + 1
    return cloneBodyWithTransform(source, {
      translation: [input.offset[0] * step, input.offset[1] * step, input.offset[2] * step],
      rotationAxis: [0, 1, 0],
      rotationAngle: 0,
      pivot: [0, 0, 0],
    })
  })
}

export function createBodyCircularArray(
  source: BodyNodeType,
  input: BodyCircularArrayInput,
): BodyNodeType[] {
  assertSource(source)
  assertCount(input.count)
  assertFinitePoint(input.center, 'center')
  const axis = normalizeAxis(input.axis)
  const fullCircle = input.fullCircle === true
  const angle = input.angle ?? (fullCircle ? Math.PI * 2 : undefined)
  if (angle === undefined || !Number.isFinite(angle)) {
    throw new RangeError('Body circular array angle must be finite')
  }
  const denominator = fullCircle ? input.count : input.count - 1

  return Array.from({ length: input.count - 1 }, (_, index) => {
    const step = index + 1
    return cloneBodyWithTransform(source, {
      translation: [0, 0, 0],
      rotationAxis: axis,
      rotationAngle: (angle * step) / denominator,
      pivot: input.center,
    })
  })
}
