import {
  type BodyNode,
  getBodyLoopVertices,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  executeOffsetBodyFace,
  type OffsetBodyFaceOperationResult,
} from '@pascal-app/core/modeling-operations'
import { useInteractionScope } from '@pascal-app/editor'

const MIN_DISTANCE = 0.000001

type BodyGeometryPatch = Pick<
  BodyNode,
  'revision' | 'vertices' | 'halfEdges' | 'loops' | 'faces' | 'shells' | 'curves' | 'bodyDefaults'
>

type BodyOffsetSessionOptions = {
  readonly body: BodyNode
  readonly faceId: string
  readonly handle: string
}

export type BodyOffsetPreviewPoint = [number, number, number]

export function getOffsetPreviewFaceLoopPoints(
  body: BodyNode,
  faceId: string | null,
): BodyOffsetPreviewPoint[] | null {
  const face = faceId ? body.faces.find((candidate) => candidate.id === faceId) : null
  if (!face) return null
  const points = getBodyLoopVertices(body, face.outerLoopId)
  return points.length >= 3 ? points : null
}

export type BodyOffsetSession = {
  readonly preview: (distance: number) => boolean
  readonly canCommit: () => boolean
  readonly createdFaceId: () => string | null
  readonly previewFaceLoopPoints: () => BodyOffsetPreviewPoint[] | null
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

export function createBodyOffsetSession(options: BodyOffsetSessionOptions): BodyOffsetSession {
  let current: BodyNode | null = null
  let currentCreatedFaceId: string | null = null
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
    current = null
    currentCreatedFaceId = null
    distance = 0
    rejected = false
  }

  return {
    preview: (nextDistance) => {
      if (!active) return false
      if (!Number.isFinite(nextDistance) || Math.abs(nextDistance) < MIN_DISTANCE) {
        current = null
        currentCreatedFaceId = null
        distance = 0
        rejected = false
        clearPreview()
        return false
      }
      let result: OffsetBodyFaceOperationResult
      try {
        result = executeOffsetBodyFace(options.body, {
          faceId: options.faceId,
          distance: nextDistance,
        })
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        current = null
        currentCreatedFaceId = null
        distance = 0
        rejected = true
        clearPreview()
        return false
      }
      current = result.body
      currentCreatedFaceId = result.createdFaceId
      distance = nextDistance
      rejected = false
      useLiveNodeOverrides.getState().set(nodeId, bodyGeometryPatch(result.body))
      useScene.getState().markDirty(nodeId)
      return true
    },
    canCommit: () => active && current !== null && Math.abs(distance) >= MIN_DISTANCE,
    createdFaceId: () => currentCreatedFaceId,
    previewFaceLoopPoints: () =>
      current ? getOffsetPreviewFaceLoopPoints(current, currentCreatedFaceId) : null,
    commit: () => {
      if (!active) return false
      const committed = current
      if (!committed || Math.abs(distance) < MIN_DISTANCE) {
        if (rejected) return false
        clear()
        return false
      }
      clear()
      useScene.getState().updateNode(nodeId, bodyGeometryPatch(committed))
      return true
    },
    cancel: () => {
      if (!active) return
      clear()
    },
  }
}
