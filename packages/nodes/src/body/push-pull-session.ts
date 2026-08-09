import { type BodyNode, pushPullBodyFace, useLiveNodeOverrides, useScene } from '@pascal-app/core'
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
  let distance = 0
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
      if (Math.abs(nextDistance) < MIN_DISTANCE) {
        current = null
        distance = 0
        clearPreview()
        return false
      }
      const result = pushPullBodyFace(options.body, options.faceId, nextDistance)
      current = result.body
      distance = nextDistance
      useLiveNodeOverrides.getState().set(nodeId, bodyGeometryPatch(result.body))
      useScene.getState().markDirty(nodeId)
      return true
    },
    commit: () => {
      if (!active) return false
      const committed = current
      clear()
      if (!committed || Math.abs(distance) < MIN_DISTANCE) return false
      useScene.getState().updateNode(nodeId, bodyGeometryPatch(committed))
      return true
    },
    cancel: () => {
      if (!active) return
      clear()
    },
  }
}
