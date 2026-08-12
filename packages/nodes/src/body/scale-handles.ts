import { type BodyNode, emitter, type HandleDescriptor, type SceneApi } from '@pascal-app/core'
import { executeTransformBody } from '@pascal-app/core/modeling-operations'
import { bodyGeometryPatch } from './move-session'

type ScaleAxis = 'x' | 'y' | 'z'
type ScaleSide = 'min' | 'max'
type Bounds = {
  readonly min: [number, number, number]
  readonly max: [number, number, number]
}

const SCALE_HANDLE_OFFSET = 0.18
const MIN_BODY_DIMENSION = 0.001

function bodyBounds(body: BodyNode): Bounds | null {
  if (body.vertices.length === 0) return null
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  for (const vertex of body.vertices) {
    for (const index of [0, 1, 2] as const) {
      min[index] = Math.min(min[index], vertex.position[index])
      max[index] = Math.max(max[index], vertex.position[index])
    }
  }
  return { min, max }
}

function axisIndex(axis: ScaleAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

function scaleBody(
  body: BodyNode,
  axis: ScaleAxis,
  side: ScaleSide,
  nextDimension: number,
): ReturnType<typeof bodyGeometryPatch> {
  const bounds = bodyBounds(body)
  if (!bounds) return bodyGeometryPatch(body)
  const index = axisIndex(axis)
  const currentDimension = bounds.max[index] - bounds.min[index]
  if (currentDimension <= Number.EPSILON || Math.abs(nextDimension - currentDimension) < 1e-9) {
    return bodyGeometryPatch(body)
  }
  const pivot: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  pivot[index] = side === 'min' ? bounds.max[index] : bounds.min[index]
  const scale: [number, number, number] = [1, 1, 1]
  scale[index] = nextDimension / currentDimension
  const transformed = executeTransformBody(body, {
    translation: [0, 0, 0],
    rotationAxis: [0, 1, 0],
    rotationAngle: 0,
    scale,
    pivot,
  }).body
  return bodyGeometryPatch(transformed)
}

function bodyScaleHandle(axis: ScaleAxis, side: ScaleSide): HandleDescriptor<BodyNode> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: side,
    min: MIN_BODY_DIMENSION,
    gridSnap: true,
    currentValue: (body) => {
      const bounds = bodyBounds(body)
      if (!bounds) return MIN_BODY_DIMENSION
      const index = axisIndex(axis)
      return Math.max(MIN_BODY_DIMENSION, bounds.max[index] - bounds.min[index])
    },
    apply: (body, nextDimension, _sceneApi: SceneApi) => scaleBody(body, axis, side, nextDimension),
    onDragEnd: (body) => {
      emitter.emit('body:selection-action', { bodyId: body.id, action: null })
    },
    placement: {
      position: (body) => {
        const bounds = bodyBounds(body)
        if (!bounds) return [0, 0, 0]
        const index = axisIndex(axis)
        const position: [number, number, number] = [
          (bounds.min[0] + bounds.max[0]) / 2,
          (bounds.min[1] + bounds.max[1]) / 2,
          (bounds.min[2] + bounds.max[2]) / 2,
        ]
        position[index] = bounds[side][index] + (side === 'min' ? -1 : 1) * SCALE_HANDLE_OFFSET
        return position
      },
    },
  }
}

export function bodyScaleHandles(): HandleDescriptor<BodyNode>[] {
  return (['x', 'y', 'z'] as const).flatMap((axis) => [
    bodyScaleHandle(axis, 'min'),
    bodyScaleHandle(axis, 'max'),
  ])
}
