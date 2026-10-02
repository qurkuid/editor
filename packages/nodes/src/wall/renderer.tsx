'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  useRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useWallConstructionDisplay } from '@pascal-app/editor'
import {
  getVisibleWallMaterials,
  markWallMaterialOverride,
  NodeRenderer,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import { hasWallConstruction } from './construction-geometry'
import {
  resolveWallPresentation,
  type WallCaptureMode,
  WallConstructionModel,
} from './construction-preview'
import { useWallTreatmentLevelData } from './treatment-level-data'
import { createWallExtraSlotMaterials, WallTreatments } from './treatments'

/**
 * Thin wall renderer.
 *
 * Mounts a placeholder mesh, registers it with `sceneRegistry`, marks the
 * node dirty so `WallSystem` fills the geometry on the next frame, and
 * recursively renders hosted children (doors / windows / wall-mounted
 * items) inside the wall's local frame.
 *
 * Behaviorally identical to the legacy `WallRenderer` in
 * `@pascal-app/viewer/components/renderers/wall/wall-renderer.tsx`.
 * Phase 6 deletes the legacy file; until then both coexist and the Phase 0
 * shims pick which one renders based on `nodeRegistry.has('wall')`.
 *
 * No `geometry` field on the wall definition yet — wall's geometry depends
 * on level-batch miter data (see `WallSystem.calculateLevelMiters`), which
 * doesn't fit the generic `(node, ctx) => Group` shape without `ctx.levelData`.
 * That decision lands in a later milestone; for now the system retains
 * ownership of the rebuild loop.
 */
const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(() => createPlaceholderGeometry(3), [])
  const collisionPlaceholderGeometry = useMemo(() => createPlaceholderGeometry(), [])

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
      collisionPlaceholderGeometry.dispose()
    }
  }, [collisionPlaceholderGeometry, placeholderGeometry])

  const handlers = useNodeEvents(node, 'wall')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const isExporting = useViewer((s) => s.isExporting)
  const showConstruction = useViewer((s) => s.selection.selectedIds.includes(node.id))
  const constructionDisplayMode = useWallConstructionDisplay((s) => s.mode)
  const construction = hasWallConstruction(node)
  const capture = useRef<WallCaptureMode>(null)
  const presentation = resolveWallPresentation({
    hasConstruction: construction,
    mode: showConstruction ? constructionDisplayMode : 'finish',
    isExporting,
    capture: capture.current,
  })
  const childNodes = useScene(
    useShallow((state) =>
      (node.children ?? [])
        .map((childId) => state.nodes[childId as AnyNodeId])
        .filter((child): child is AnyNode => child !== undefined),
    ),
  )
  const treatmentLevelData = useWallTreatmentLevelData((state) =>
    node.parentId ? state.byLevelId.get(node.parentId) : undefined,
  )
  // Subscribe to the scene-material palette so editing a `scene:` material a
  // wall slot references re-renders the wall live (the wall-system geometry
  // dirty loop never fires for a material-only edit). `getMaterialsForWall`'s
  // content hash keeps unaffected walls on their cached materials.
  const sceneMaterials = useScene((s) => s.materials)
  const baseMaterials = getVisibleWallMaterials(
    node,
    shading,
    textures,
    colorPreset,
    sceneTheme,
    sceneMaterials,
  )
  const visibleBaseMaterials = useMemo(() => {
    if (presentation.baseVisible) return baseMaterials
    return baseMaterials.map((material) => {
      const transparentMaterial = material.clone()
      transparentMaterial.transparent = true
      transparentMaterial.opacity = 0
      transparentMaterial.colorWrite = false
      transparentMaterial.depthWrite = false
      transparentMaterial.needsUpdate = true
      return markWallMaterialOverride(transparentMaterial)
    })
  }, [baseMaterials, presentation.baseVisible])
  useEffect(
    () => () => {
      if (visibleBaseMaterials !== baseMaterials) {
        for (const material of visibleBaseMaterials) material.dispose()
      }
    },
    [baseMaterials, visibleBaseMaterials],
  )
  useEffect(() => {
    const before = () => {
      capture.current = useViewer.getState().isExporting ? 'export' : 'thumbnail'
      const current = ref.current
      if (!current) return
      const captured = resolveWallPresentation({
        hasConstruction: construction,
        mode: showConstruction ? constructionDisplayMode : 'finish',
        isExporting: useViewer.getState().isExporting,
        capture: capture.current,
      })
      current.material = captured.baseVisible ? baseMaterials : visibleBaseMaterials
    }
    const after = () => {
      capture.current = null
      if (ref.current) ref.current.material = visibleBaseMaterials
    }
    emitter.on('thumbnail:before-capture', before)
    emitter.on('thumbnail:after-capture', after)
    return () => {
      emitter.off('thumbnail:before-capture', before)
      emitter.off('thumbnail:after-capture', after)
    }
  }, [baseMaterials, construction, constructionDisplayMode, showConstruction, visibleBaseMaterials])
  const extraMaterials = useMemo(
    () => createWallExtraSlotMaterials(node, shading, sceneMaterials),
    [node, sceneMaterials, shading],
  )
  useEffect(
    () => () => {
      const baseSet = new Set(baseMaterials)
      const owned = new Set(Object.values(extraMaterials).filter((entry) => !baseSet.has(entry)))
      for (const entry of owned) entry.dispose()
    },
    [baseMaterials, extraMaterials],
  )

  return (
    <mesh
      castShadow
      geometry={placeholderGeometry}
      material={visibleBaseMaterials}
      receiveShadow
      ref={ref}
      visible={node.visible}
    >
      <mesh
        geometry={collisionPlaceholderGeometry}
        name="collision-mesh"
        visible={false}
        {...handlers}
      />

      {treatmentLevelData && (
        <WallTreatments
          childrenNodes={childNodes}
          levelData={treatmentLevelData}
          materials={extraMaterials}
          node={node}
        />
      )}

      {construction && (
        <WallConstructionModel
          mode={showConstruction ? constructionDisplayMode : 'finish'}
          node={node}
        />
      )}

      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}

export default WallRenderer
