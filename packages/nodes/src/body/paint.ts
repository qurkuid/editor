import {
  type AnyNode,
  type AnyNodeId,
  type BodyNode,
  type PaintCapability,
  parseMaterialRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { executePaintBodyFace } from '@pascal-app/core/modeling-operations'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, resolvePaintMaterialRef } from '../shared/slot-paint'

function patchFaceMaterials(
  body: BodyNode,
  faceIds: readonly string[],
  materialRef: string | undefined,
) {
  const targetIds = new Set(faceIds)
  return body.faces.map((face) =>
    targetIds.has(face.id)
      ? {
          ...face,
          surface: materialRef
            ? { ...face.surface, materialRef }
            : { ...face.surface, materialRef: undefined },
        }
      : face,
  )
}

function commitBodyRoles(
  node: BodyNode,
  roles: string[],
  material: Parameters<NonNullable<PaintCapability['commit']>>[0]['material'],
  materialPreset: string | undefined,
) {
  const validRoles = roles.filter((role) => node.faces.some((face) => face.id === role))
  if (validRoles.length === 0) return
  const nodeId = node.id as AnyNodeId
  const state = useScene.getState()
  const resolution = resolvePaintMaterialRef(state.materials, material, materialPreset)
  if (!resolution) return
  const { ref, newSceneMaterial } = resolution

  const currentNode = state.nodes[nodeId]
  if (currentNode?.type !== 'body') return
  const painted = validRoles.reduce(
    (current, role) => executePaintBodyFace(current, { faceId: role, material: ref }).body,
    currentNode,
  )

  useScene.setState((current) => {
    if (current.readOnly) return current
    const currentNode = current.nodes[nodeId]
    if (currentNode?.type !== 'body') return current
    return {
      materials: newSceneMaterial
        ? { ...current.materials, [newSceneMaterial.id]: newSceneMaterial }
        : current.materials,
      nodes: {
        ...current.nodes,
        [nodeId]: { ...currentNode, faces: painted.faces },
      },
    }
  })
  useScene.getState().markDirty(nodeId)
}

export const bodyPaint: PaintCapability = {
  objectRoles: (node) => (node.type === 'body' ? node.faces.map((face) => face.id) : []),
  resolveRole: ({ node, hitObject }) => {
    if (node.type !== 'body') return null
    const hit = hitObject?.userData as { bodyId?: unknown; faceId?: unknown } | undefined
    if (hit?.bodyId !== node.id || typeof hit.faceId !== 'string') return null
    return node.faces.some((face) => face.id === hit.faceId) ? hit.faceId : null
  },
  buildPatch: ({ node, role, materialPreset }) => {
    if (node.type !== 'body') return {}
    return { faces: patchFaceMaterials(node, [role], materialPreset) } as Partial<AnyNode>
  },
  commit: ({ node, role, material, materialPreset }) => {
    if (node.type !== 'body') return
    commitBodyRoles(node, [role], material, materialPreset)
  },
  commitRoles: ({ node, roles, material, materialPreset }) => {
    if (node.type !== 'body') return
    commitBodyRoles(node, roles, material, materialPreset)
  },
  applyPreview: ({ role, root, material, materialPreset }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return () => {}
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.userData.faceId !== role) return
      const previous = mesh.material
      mesh.material = preview
      restores.push(() => {
        mesh.material = previous
      })
    })
    if (restores.length === 0) return null
    return () => {
      for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
    }
  },
  getEffectiveMaterial: ({ node, role }) => {
    if (node.type !== 'body') return null
    const ref = node.faces.find((face) => face.id === role)?.surface.materialRef
    const parsed = parseMaterialRef(ref)
    if (!parsed) return null
    if (parsed.kind === 'library') return { material: undefined, materialPreset: ref }
    const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
    return sceneMaterial ? { material: sceneMaterial.material, materialPreset: undefined } : null
  },
}
