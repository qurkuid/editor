import {
  BodyNode,
  emitter,
  type HandleDescriptor,
  remapBodyFeatureAnnotations,
  resolveBodyFeatureVertexIds,
  type SceneApi,
} from '@pascal-app/core'
import { executeTransformBody } from '@pascal-app/core/modeling-operations'
import { bodyGeometryPatch } from './move-session'
import { type BodyFeatureSelection, useBodyToolOptions } from './options'

type ScaleAxis = 'x' | 'y' | 'z'
type ScaleSide = 'min' | 'max'
type Bounds = {
  readonly min: [number, number, number]
  readonly max: [number, number, number]
}

type BodyTopologyRemap = Parameters<typeof remapBodyFeatureAnnotations>[3]

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

function bodyBoundsForFeature(body: BodyNode, feature: BodyFeatureSelection): Bounds | null {
  try {
    const ids = resolveBodyFeatureVertexIds(body, feature.kind, feature.featureId)
    const vertices = body.vertices.filter((vertex) => ids.has(vertex.id))
    if (vertices.length === 0) return null
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
    for (const vertex of vertices) {
      for (const index of [0, 1, 2] as const) {
        min[index] = Math.min(min[index], vertex.position[index])
        max[index] = Math.max(max[index], vertex.position[index])
      }
    }
    return { min, max }
  } catch {
    return null
  }
}

function axisIndex(axis: ScaleAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

function bodyTopologyRemap(before: BodyNode, after: BodyNode): BodyTopologyRemap {
  const beforeIds = new Set(
    [
      ...before.vertices,
      ...before.halfEdges,
      ...before.loops,
      ...before.faces,
      ...before.shells,
      ...before.curves,
    ].map(({ id }) => id),
  )
  const afterIds = new Set(
    [
      ...after.vertices,
      ...after.halfEdges,
      ...after.loops,
      ...after.faces,
      ...after.shells,
      ...after.curves,
    ].map(({ id }) => id),
  )
  return {
    preserved: [...afterIds].filter((id) => beforeIds.has(id)),
    created: [...afterIds].filter((id) => !beforeIds.has(id)),
    deleted: [...beforeIds].filter((id) => !afterIds.has(id)),
    split: {},
    merged: {},
  }
}

function scaleBody(
  body: BodyNode,
  axis: ScaleAxis,
  side: ScaleSide,
  nextDimension: number,
  feature: BodyFeatureSelection | null,
  autofold: boolean,
): ReturnType<typeof bodyGeometryPatch> {
  const featureBounds = feature ? bodyBoundsForFeature(body, feature) : null
  const index = axisIndex(axis)
  const featureDimension = featureBounds
    ? featureBounds.max[index] - featureBounds.min[index]
    : Number.NaN
  const bounds =
    Number.isFinite(featureDimension) && featureDimension > Number.EPSILON
      ? featureBounds!
      : bodyBounds(body)
  if (!bounds) return bodyGeometryPatch(body)
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
  try {
    const transformed = executeTransformBody(body, {
      translation: [0, 0, 0],
      rotationAxis: [0, 1, 0],
      rotationAngle: 0,
      scale,
      pivot,
      feature: feature ? { kind: feature.kind, featureId: feature.featureId, autofold } : undefined,
    }).body
    return bodyGeometryPatch(transformed)
  } catch {
    return bodyGeometryPatch(body)
  }
}

function bodyScaleHandle(
  axis: ScaleAxis,
  side: ScaleSide,
  boundsFor: (body: BodyNode, axis: ScaleAxis) => Bounds | null,
  snapshot: () => { feature: BodyFeatureSelection | null; autofold: boolean },
  resetSnapshot: () => void,
): HandleDescriptor<BodyNode> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: side,
    min: MIN_BODY_DIMENSION,
    gridSnap: true,
    currentValue: (body) => {
      const bounds = boundsFor(body, axis)
      if (!bounds) return MIN_BODY_DIMENSION
      const index = axisIndex(axis)
      return Math.max(MIN_BODY_DIMENSION, bounds.max[index] - bounds.min[index])
    },
    apply: (body, nextDimension, _sceneApi: SceneApi) => {
      const { feature, autofold } = snapshot()
      return scaleBody(body, axis, side, nextDimension, feature, autofold)
    },
    canCommit: (body, patch) => patch.vertices !== body.vertices,
    commit: (body, patch, sceneApi) => {
      if (patch.vertices === body.vertices) return
      let nextBody: BodyNode
      try {
        nextBody = BodyNode.parse({ ...body, ...patch })
      } catch {
        return
      }
      const nodes = sceneApi.nodes()
      const annotationUpdates = remapBodyFeatureAnnotations(
        nodes,
        body.id,
        nextBody,
        bodyTopologyRemap(body, nextBody),
      )
      sceneApi.update(body.id, patch)
      for (const update of annotationUpdates) sceneApi.update(update.id, update.data)
    },
    onDragEnd: (body) => {
      resetSnapshot()
      emitter.emit('body:selection-action', { bodyId: body.id, action: null })
    },
    placement: {
      position: (body) => {
        const bounds = boundsFor(body, axis)
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
  let featureSnapshot: BodyFeatureSelection | null | undefined
  let autofoldSnapshot: boolean | undefined
  const snapshot = () => {
    if (featureSnapshot === undefined) {
      const options = useBodyToolOptions.getState()
      featureSnapshot = options.selectedFeature
      autofoldSnapshot = options.autofold
    }
    return { feature: featureSnapshot, autofold: autofoldSnapshot === true }
  }
  const resetSnapshot = () => {
    featureSnapshot = undefined
    autofoldSnapshot = undefined
  }
  const boundsFor = (body: BodyNode, axis: ScaleAxis) => {
    const feature =
      featureSnapshot === undefined
        ? useBodyToolOptions.getState().selectedFeature
        : featureSnapshot
    if (!feature) return bodyBounds(body)
    const featureBounds = bodyBoundsForFeature(body, feature)
    const index = axisIndex(axis)
    return featureBounds && featureBounds.max[index] - featureBounds.min[index] > Number.EPSILON
      ? featureBounds
      : bodyBounds(body)
  }
  return (['x', 'y', 'z'] as const).flatMap((axis) => [
    bodyScaleHandle(axis, 'min', boundsFor, snapshot, resetSnapshot),
    bodyScaleHandle(axis, 'max', boundsFor, snapshot, resetSnapshot),
  ])
}
