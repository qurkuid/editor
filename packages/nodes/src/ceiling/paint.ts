import { type AnyNode, type CeilingNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { Mesh } from 'three'
import { createSlotPaintCapability } from '../shared/slot-paint'
import { createCeilingSurfaceMaterial } from './materials'

/**
 * Ceiling paint on the unified slot model. A ceiling has one paintable surface,
 * so every hit resolves to `surface`; commit writes `node.slots.surface`. The
 * preview swaps the registered underside mesh to a BackSide material so the
 * hover preview matches the committed texture when viewed from inside the room.
 */
export const ceilingPaint = createSlotPaintCapability({
  resolveRole: () => 'surface',
  applyPreview: ({ material, materialPreset, root }) => {
    const preview = createCeilingSurfaceMaterial(
      material,
      materialPreset,
      useScene.getState().materials,
      useViewer.getState().shading,
    )
    if (!preview) return () => {}
    const mesh = root as Mesh
    if (!mesh.isMesh) return null
    const previous = mesh.material
    mesh.material = preview.material
    return () => {
      mesh.material = previous
    }
  },
  legacyEffective: (node: AnyNode) => {
    const ceiling = node as CeilingNode
    if (ceiling.materialPreset || ceiling.material) {
      return { material: ceiling.material, materialPreset: ceiling.materialPreset }
    }
    return null
  },
})
