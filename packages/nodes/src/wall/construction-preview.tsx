'use client'

import {
  emitter,
  getWallBandSlotId,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import type { WallConstructionDisplayMode } from '@pascal-app/editor'
import { getWallHideState, resolveMaterialRef, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, Group, Material, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { buildWallConstructionGeometry } from './construction-geometry'
import { WALL_LAYER_COLORS } from './construction-visual'

function disposeParts(group: Group) {
  for (const object of group.children) {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      if (object.material instanceof Material) object.material.dispose()
    }
  }
  group.clear()
}

function displayParts(group: Group, mode: WallConstructionDisplayMode, translucent = false) {
  for (const object of group.children) {
    object.visible = mode !== 'frame' || object.userData.constructionKind === 'timber-stud'
    if (!(object instanceof Mesh) || !(object.material instanceof Material)) continue
    const opacity = translucent ? 0.35 : object.userData.constructionOpacity
    if (object.material.opacity !== opacity) {
      object.material.opacity = opacity
      object.material.transparent = opacity < 1
      object.material.needsUpdate = true
    }
  }
}

export function WallConstructionModel({
  node,
  mode,
}: {
  node: WallNode
  mode: WallConstructionDisplayMode
}) {
  const group = useMemo(() => new Group(), [])
  const source = useRef<BufferGeometry | null>(null)
  const appearance = useRef<unknown>(null)
  const capture = useRef(false)
  const cameraDirection = useMemo(() => new Vector3(), [])
  const shading = useViewer((state) => state.shading)
  const sceneMaterials = useScene((state) => state.materials)
  const appearanceKey = useMemo(
    () => ({ node, shading, sceneMaterials }),
    [node, shading, sceneMaterials],
  )

  useFrame(({ camera }) => {
    const host = group.parent
    if (!(host instanceof Mesh)) return
    const wallMode = useViewer.getState().wallMode
    group.visible =
      capture.current ||
      wallMode === 'translucent' ||
      !getWallHideState(node, host, wallMode, camera.getWorldDirection(cameraDirection))
    displayParts(
      group,
      capture.current ? 'finish' : mode,
      !capture.current && wallMode === 'translucent',
    )
    if (host.geometry === source.current && appearance.current === appearanceKey) return
    if (!host.geometry.getAttribute('position')?.count) return
    const override = useLiveNodeOverrides.getState().get(node.id)
    const effective = override ? ({ ...node, ...override } as WallNode) : node
    const parts = buildWallConstructionGeometry(effective, host.geometry)
    const meshes = parts.map((part, index) => {
      const slot = node.faceBands?.enabled ? getWallBandSlotId('interior', part.band) : 'interior'
      const reference =
        part.kind === 'finish' || part.layerIndex === -1 ? node.slots?.[slot] : undefined
      const resolved = reference ? resolveMaterialRef(reference, sceneMaterials, shading) : null
      const material =
        resolved?.clone() ??
        new MeshStandardMaterial({
          color: WALL_LAYER_COLORS[part.kind],
          roughness: 0.82,
          transparent: part.kind === 'glass',
          opacity: part.kind === 'glass' ? 0.35 : 1,
        })
      const mesh = new Mesh(part.geometry, material)
      mesh.name = `${part.band}-${part.kind}-${part.layerIndex}-${index}`
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData = {
        constructionKind: part.kind,
        constructionBand: part.band,
        constructionLayer: part.layerIndex,
        constructionOpacity: material.opacity,
      }
      return mesh
    })
    disposeParts(group)
    if (meshes.length) group.add(...meshes)
    source.current = host.geometry
    appearance.current = appearanceKey
    displayParts(
      group,
      capture.current ? 'finish' : mode,
      !capture.current && wallMode === 'translucent',
    )
  }, 5)

  useEffect(() => displayParts(group, mode), [group, mode])
  useEffect(() => {
    const before = () => {
      capture.current = true
      group.visible = true
      displayParts(group, 'finish')
    }
    const after = () => {
      capture.current = false
      displayParts(group, mode)
    }
    emitter.on('thumbnail:before-capture', before)
    emitter.on('thumbnail:after-capture', after)
    return () => {
      emitter.off('thumbnail:before-capture', before)
      emitter.off('thumbnail:after-capture', after)
    }
  }, [group, mode])
  useEffect(() => () => disposeParts(group), [group])
  return <primitive object={group} name="wall-construction-model" />
}
