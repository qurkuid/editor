import {
  type AnyNodeId,
  type BodyNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { transformBody } from '@pascal-app/core/body-transform'
import type * as THREE from 'three'

const MIN_TRANSLATION = 0.000001

type BodyGeometryPatch = Pick<
  BodyNode,
  'revision' | 'vertices' | 'halfEdges' | 'loops' | 'faces' | 'shells' | 'curves' | 'bodyDefaults'
>

export type BodyMovePreviewMode = 'transform' | 'override'

type BodyMoveSessionOptions = {
  readonly body: BodyNode
  readonly preview: BodyMovePreviewMode
}

type BodyMoveEffectStateOptions = BodyMoveSessionOptions & {
  readonly placementDragMode: boolean
}

export type BodyMoveSession = {
  readonly preview: (translation: readonly [number, number, number]) => boolean
  readonly canCommit: () => boolean
  readonly commit: () => boolean
  readonly cancel: () => void
}

export type BodyMoveEffectState = {
  readonly anchor: [number, number] | null
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

export function createBodyMoveInitialDragAnchor(
  body: BodyNode,
  placementDragMode: boolean,
): [number, number] | null {
  return placementDragMode ? null : bodyPlanCenter(body)
}

export function createBodyMoveEffectState(
  options: BodyMoveEffectStateOptions,
): BodyMoveEffectState {
  return {
    anchor: createBodyMoveInitialDragAnchor(options.body, options.placementDragMode),
    session: createBodyMoveSession({ body: options.body, preview: options.preview }),
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
  let current: BodyNode | null = null
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
        lastTranslation = [0, 0, 0]
        clearPreview()
        return false
      }
      const normalized: [number, number, number] = [translation[0], translation[1], translation[2]]
      current = transformBody(options.body, {
        translation: normalized,
        rotationY: 0,
        uniformScale: 1,
        pivot: [0, 0, 0],
      })
      lastTranslation = normalized
      if (options.preview === 'override') {
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
      active = false
      useScene.getState().updateNode(nodeId, bodyGeometryPatch(committed))
      clearPreview()
      return true
    },
    cancel: () => {
      if (!active) return
      active = false
      clearPreview()
    },
  }
}
