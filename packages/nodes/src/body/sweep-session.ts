import { type BodyNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  executeSweepBodyFace,
  type SweepBodyFaceOperationResult,
} from '@pascal-app/core/modeling-operations'
import { useInteractionScope } from '@pascal-app/editor'

type BodyGeometryPatch = Pick<
  BodyNode,
  'revision' | 'vertices' | 'halfEdges' | 'loops' | 'faces' | 'shells' | 'curves' | 'bodyDefaults'
>

type BodySweepSessionOptions = {
  readonly body: BodyNode
  readonly faceId: string
}

export type BodySweepSession = {
  readonly preview: (pathPoints: readonly [number, number, number][]) => boolean
  readonly canCommit: () => boolean
  readonly result: () => SweepBodyFaceOperationResult | null
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

function endSweepScope(nodeId: BodyNode['id']): void {
  useInteractionScope
    .getState()
    .endIf(
      (scope) => scope.kind === 'reshaping' && scope.nodeId === nodeId && scope.reshape === 'sweep',
    )
}

export function createBodySweepSession(options: BodySweepSessionOptions): BodySweepSession {
  let current: SweepBodyFaceOperationResult | null = null
  let active = true
  const nodeId = options.body.id

  useInteractionScope.getState().begin({
    kind: 'reshaping',
    nodeId,
    reshape: 'sweep',
    driver: 'tool',
  })

  const clearPreview = () => {
    useLiveNodeOverrides.getState().clear(nodeId)
    useScene.getState().markDirty(nodeId)
  }
  const clear = () => {
    clearPreview()
    endSweepScope(nodeId)
    active = false
  }

  return {
    preview: (pathPoints) => {
      if (!active || pathPoints.length < 2) {
        current = null
        clearPreview()
        return false
      }
      try {
        current = executeSweepBodyFace(options.body, {
          faceId: options.faceId,
          pathPoints: pathPoints.map((point) => [...point] as [number, number, number]),
        })
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        current = null
        clearPreview()
        return false
      }
      useLiveNodeOverrides.getState().set(nodeId, bodyGeometryPatch(current.body))
      useScene.getState().markDirty(nodeId)
      return true
    },
    canCommit: () => active && current !== null,
    result: () => current,
    commit: () => {
      if (!active || !current) return false
      const committed = current.body
      clear()
      useScene.getState().updateNode(nodeId, bodyGeometryPatch(committed))
      return true
    },
    cancel: () => {
      if (active) clear()
    },
  }
}
