import {
  type BodyNode,
  remapBodyFeatureAnnotations,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  executePushPullBodyFace,
  type PushPullBodyFaceOperationResult,
} from '@pascal-app/core/modeling-operations'
import { useInteractionScope } from '@pascal-app/editor'

const MIN_DISTANCE = 0.000001

type BodyGeometryPatch = Pick<
  BodyNode,
  'revision' | 'vertices' | 'halfEdges' | 'loops' | 'faces' | 'shells' | 'curves' | 'bodyDefaults'
>

type BodyPushPullSessionOptions = {
  readonly body: BodyNode
  readonly faceId: string
  readonly handle: string
}

export type BodyPushPullSession = {
  readonly preview: (distance: number) => boolean
  readonly canCommit: () => boolean
  readonly commit: () => boolean
  readonly cancel: () => void
}

function bodyGeometryPatch(body: BodyNode): BodyGeometryPatch {
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

function endHandleDrag(nodeId: BodyNode['id'], handle: string): void {
  useInteractionScope
    .getState()
    .endIf(
      (scope) => scope.kind === 'handle-drag' && scope.nodeId === nodeId && scope.handle === handle,
    )
}

export function createBodyPushPullSession(
  options: BodyPushPullSessionOptions,
): BodyPushPullSession {
  let current: BodyNode | null = null
  let currentResult: PushPullBodyFaceOperationResult | null = null
  let distance = 0
  let rejected = false
  let active = true
  const nodeId = options.body.id

  useInteractionScope.getState().begin({
    kind: 'handle-drag',
    nodeId,
    handle: options.handle,
  })

  const clearPreview = (): void => {
    useLiveNodeOverrides.getState().clear(nodeId)
    useScene.getState().markDirty(nodeId)
  }

  const clear = (): void => {
    clearPreview()
    endHandleDrag(nodeId, options.handle)
    active = false
  }

  return {
    preview: (nextDistance) => {
      if (!active) return false
      if (!Number.isFinite(nextDistance) || Math.abs(nextDistance) < MIN_DISTANCE) {
        current = null
        distance = 0
        rejected = false
        clearPreview()
        return false
      }
      let result: PushPullBodyFaceOperationResult
      try {
        result = executePushPullBodyFace(options.body, {
          faceId: options.faceId,
          distance: nextDistance,
        })
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        current = null
        distance = 0
        rejected = true
        clearPreview()
        return false
      }
      current = result.body
      currentResult = result
      distance = nextDistance
      rejected = false
      useLiveNodeOverrides.getState().set(nodeId, bodyGeometryPatch(result.body))
      useScene.getState().markDirty(nodeId)
      return true
    },
    canCommit: () => active && current !== null && Math.abs(distance) >= MIN_DISTANCE,
    commit: () => {
      if (!active) return false
      const committed = current
      const committedResult = currentResult
      if (!committed || Math.abs(distance) < MIN_DISTANCE) {
        if (rejected) return false
        clear()
        return false
      }
      clear()
      runAsSingleSceneHistoryStep(useScene, () => {
        const scene = useScene.getState()
        const updates = committedResult
          ? remapBodyFeatureAnnotations(
              scene.nodes,
              nodeId,
              committed,
              committedResult.topologyRemap,
            )
          : []
        scene.updateNodes([{ id: nodeId, data: bodyGeometryPatch(committed) }, ...updates])
      })
      return true
    },
    cancel: () => {
      if (!active) return
      clear()
    },
  }
}
