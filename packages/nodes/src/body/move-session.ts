import {
  type AnyNodeId,
  type BodyFeatureKind,
  type BodyNode,
  moveBodyFeature,
  remapBodyFeatureAnnotations,
  runAsSingleSceneHistoryStep,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  executeTransformBody,
  type TransformBodyOperationResult,
} from '@pascal-app/core/modeling-operations'
import type * as THREE from 'three'

const MIN_TRANSLATION = 0.000001

type BodyGeometryPatch = Pick<
  BodyNode,
  'revision' | 'vertices' | 'halfEdges' | 'loops' | 'faces' | 'shells' | 'curves' | 'bodyDefaults'
>

type BodyTopologyRemap = Parameters<typeof remapBodyFeatureAnnotations>[3]

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

export type BodyMovePreviewMode = 'transform' | 'override'

type BodyMoveSessionOptions = {
  readonly body: BodyNode
  readonly preview: BodyMovePreviewMode
  readonly autofold?: boolean
  readonly feature?: Readonly<{
    readonly bodyId: string
    readonly kind: BodyFeatureKind
    readonly featureId: string
  }> | null
}

export type BodyMoveSession = {
  readonly preview: (translation: readonly [number, number, number]) => boolean
  readonly canCommit: () => boolean
  readonly commit: () => boolean
  readonly cancel: () => void
}

export type BodyMoveEffectState = {
  readonly session: BodyMoveSession
}

export function bodyGeometryPatch(body: BodyNode): BodyGeometryPatch {
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

export function bodyPlanCenter(body: BodyNode): [number, number] {
  if (body.vertices.length === 0) return [0, 0]
  let x = 0
  let z = 0
  for (const vertex of body.vertices) {
    x += vertex.position[0]
    z += vertex.position[2]
  }
  return [x / body.vertices.length, z / body.vertices.length]
}

export function bodyMinimumVertexY(body: BodyNode): number {
  if (body.vertices.length === 0) return 0
  return body.vertices.reduce(
    (minimum, vertex) => Math.min(minimum, vertex.position[1]),
    Number.POSITIVE_INFINITY,
  )
}

export function resolveBodyMoveTranslation(options: {
  readonly body: BodyNode
  readonly planTranslation: readonly [number, number]
  readonly surfacePoint: readonly [number, number, number] | null
}): [number, number, number] {
  if (options.surfacePoint) {
    const center = bodyPlanCenter(options.body)
    return [
      options.surfacePoint[0] - center[0],
      options.surfacePoint[1] - bodyMinimumVertexY(options.body),
      options.surfacePoint[2] - center[1],
    ]
  }
  return [options.planTranslation[0], 0, options.planTranslation[1]]
}

export function resolveBodyPointMoveTranslation(options: {
  readonly basePoint: readonly [number, number, number]
  readonly targetPoint: readonly [number, number, number]
}): [number, number, number] {
  return [
    options.targetPoint[0] - options.basePoint[0],
    options.targetPoint[1] - options.basePoint[1],
    options.targetPoint[2] - options.basePoint[2],
  ]
}

export function createBodyMoveEffectState(options: BodyMoveSessionOptions): BodyMoveEffectState {
  return {
    session: createBodyMoveSession({
      body: options.body,
      preview: options.preview,
      autofold: options.autofold,
      feature: options.feature,
    }),
  }
}

function hasTranslation(translation: readonly [number, number, number]): boolean {
  return translation.some((value) => Math.abs(value) >= MIN_TRANSLATION)
}

function setMeshOffset(id: AnyNodeId, translation: readonly [number, number, number]): void {
  const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
  if (mesh) mesh.position.set(translation[0], translation[1], translation[2])
}

export function createBodyMoveSession(options: BodyMoveSessionOptions): BodyMoveSession {
  const nodeId = options.body.id
  const feature = options.feature
  const featureMove = feature !== undefined && feature !== null
  let current: BodyNode | null = null
  let currentResult: TransformBodyOperationResult | null = null
  let currentTopologyRemap: BodyTopologyRemap | null = null
  let lastTranslation: [number, number, number] = [0, 0, 0]
  let active = true

  const clearPreview = (): void => {
    useLiveNodeOverrides.getState().clear(nodeId)
    useLiveTransforms.getState().clear(nodeId)
    if (options.preview === 'transform') {
      setMeshOffset(nodeId as AnyNodeId, [0, 0, 0])
    }
    useScene.getState().markDirty(nodeId)
  }

  return {
    preview: (translation) => {
      if (!active) return false
      if (!hasTranslation(translation)) {
        current = null
        currentResult = null
        currentTopologyRemap = null
        lastTranslation = [0, 0, 0]
        clearPreview()
        return false
      }
      const normalized: [number, number, number] = [translation[0], translation[1], translation[2]]
      try {
        if (featureMove && feature.bodyId !== nodeId) throw new RangeError('Body feature mismatch')
        if (featureMove) {
          current = moveBodyFeature(options.body, feature.kind, feature.featureId, normalized, {
            autofold: options.autofold,
          })
          currentResult = null
          currentTopologyRemap = bodyTopologyRemap(options.body, current)
        } else {
          currentResult = executeTransformBody(options.body, {
            translation: normalized,
            rotationAxis: [0, 1, 0],
            rotationAngle: 0,
            scale: [1, 1, 1],
            pivot: [0, 0, 0],
          })
          current = currentResult.body
          currentTopologyRemap = currentResult.topologyRemap
        }
      } catch {
        current = null
        currentTopologyRemap = null
        lastTranslation = [0, 0, 0]
        clearPreview()
        return false
      }
      lastTranslation = normalized
      if (options.preview === 'override' || featureMove) {
        useLiveTransforms.getState().clear(nodeId)
        useLiveNodeOverrides.getState().set(nodeId, bodyGeometryPatch(current))
        useScene.getState().markDirty(nodeId)
      } else {
        useLiveNodeOverrides.getState().clear(nodeId)
        setMeshOffset(nodeId as AnyNodeId, normalized)
        useLiveTransforms.getState().set(nodeId, {
          position: normalized,
          rotation: 0,
        })
      }
      return true
    },
    canCommit: () => active && current != null && hasTranslation(lastTranslation),
    commit: () => {
      if (!(active && current && hasTranslation(lastTranslation))) return false
      const committed = current
      const committedResult = currentResult
      const committedTopologyRemap = committedResult?.topologyRemap ?? currentTopologyRemap
      active = false
      clearPreview()
      runAsSingleSceneHistoryStep(useScene, () => {
        const scene = useScene.getState()
        const updates = committedTopologyRemap
          ? remapBodyFeatureAnnotations(scene.nodes, nodeId, committed, committedTopologyRemap)
          : []
        scene.updateNodes([{ id: nodeId, data: bodyGeometryPatch(committed) }, ...updates])
      })
      return true
    },
    cancel: () => {
      if (!active) return
      active = false
      clearPreview()
    },
  }
}
