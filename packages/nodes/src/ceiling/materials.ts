import {
  getMaterialPresetByRef,
  type MaterialPresetPayload,
  type MaterialSchema,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPreset, type RenderShading } from '@pascal-app/viewer'
import type { Material } from 'three'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * The ceiling keeps its top placement grid separate from the underside finish.
 * RawPainter and scene textures render only on the underside so the grid keeps
 * its interaction behavior while the room-facing surface gets the real finish.
 */

const gridScale = 5
const gridX = positionWorld.x.mul(gridScale).fract()
const gridY = positionWorld.z.mul(gridScale).fract()
const lineWidth = 0.05
const lineX = smoothstep(lineWidth, 0, gridX).add(smoothstep(1.0 - lineWidth, 1.0, gridX))
const lineY = smoothstep(lineWidth, 0, gridY).add(smoothstep(1.0 - lineWidth, 1.0, gridY))
const gridPattern = lineX.max(lineY)
const gridOpacity = mix(float(0.2), float(0.6), gridPattern)

export type CeilingMaterials = {
  topMaterial: MeshBasicNodeMaterial
  bottomMaterial: MeshBasicNodeMaterial
}

function createCeilingMaterials(color = '#999999'): CeilingMaterials {
  const topMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.opacityNode = gridOpacity

  const bottomMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    side: BackSide,
  })

  return { topMaterial, bottomMaterial }
}

const ceilingMaterialCache = new Map<string, CeilingMaterials>()

export function getCeilingMaterials(color = '#999999'): CeilingMaterials {
  const cached = ceilingMaterialCache.get(color)
  if (cached) return cached
  const materials = createCeilingMaterials(color)
  ceilingMaterialCache.set(color, materials)
  return materials
}

export type CeilingSurfaceInput =
  | { readonly kind: 'material'; readonly material: MaterialSchema }
  | { readonly kind: 'preset'; readonly preset: MaterialPresetPayload }

export function resolveCeilingSurfaceInput(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
): CeilingSurfaceInput | null {
  const parsed = parseMaterialRef(materialPreset)
  if (parsed?.kind === 'scene') {
    const sceneMaterial = sceneMaterials?.[parsed.id as SceneMaterialId]
    if (!sceneMaterial) return null
    return {
      kind: 'material',
      material: {
        ...sceneMaterial.material,
        properties: { ...resolveMaterial(sceneMaterial.material), side: 'back' },
      },
    }
  }

  const preset = getMaterialPresetByRef(materialPreset)
  if (preset) {
    return {
      kind: 'preset',
      preset: {
        ...preset,
        mapProperties: { ...preset.mapProperties, side: 1 },
      },
    }
  }

  if (!material) return null
  return {
    kind: 'material',
    material: {
      ...material,
      properties: { ...resolveMaterial(material), side: 'back' },
    },
  }
}

export type CeilingRenderedSurface = {
  readonly color: string
  readonly material: Material
}

export function createCeilingSurfaceMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
  shading: RenderShading,
): CeilingRenderedSurface | null {
  const input = resolveCeilingSurfaceInput(material, materialPreset, sceneMaterials)
  if (!input) return null
  switch (input.kind) {
    case 'material':
      return {
        color: resolveMaterial(input.material).color,
        material: createMaterial(input.material, shading),
      }
    case 'preset':
      return {
        color: input.preset.mapProperties.color,
        material: createMaterialFromPreset(input.preset, shading),
      }
  }
}
