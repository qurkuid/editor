import {
  buildFurnitureAssembly,
  type CabinetNode,
  type FurnitureAssemblyPart,
  type GeometryContext,
} from '@pascal-app/core'
import { type ColorPreset, type RenderShading, resolveMaterialRef } from '@pascal-app/viewer'
import { CylinderGeometry, Group, type Material, Mesh } from 'three'
import { addBox, getCabinetSlotMaterials, stampSlot } from './geometry/shared'

export function buildFurnitureCabinetGeometry(
  node: CabinetNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  if (!node.furniture) return group

  const result = buildFurnitureAssembly(node.furniture, {
    carcassThickness: node.boardThickness,
  })
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)

  for (const part of result.parts) {
    const slotId =
      part.kind === 'hanger' || part.kind === 'leg'
        ? 'hardware'
        : part.kind === 'front'
          ? 'front'
          : part.kind === 'kickplate'
            ? 'plinth'
            : 'carcass'
    const material =
      resolveMaterialRef(part.materialId, ctx?.materials, shading) ?? materials[slotId]
    const mesh =
      part.shape === 'box'
        ? addBox(group, part.size, part.position, material, `furniture-part-${part.id}`, slotId)
        : addFurnitureRod(group, part, material)
    mesh.userData.furniturePartId = part.id
    mesh.userData.furniturePartKind = part.kind
    mesh.userData.furnitureBayId = part.bayId
    mesh.userData.furnitureTierId = part.tierId
  }

  group.userData.furnitureAssemblyBounds = result.bounds
  group.userData.furnitureAssemblyWarnings = result.warnings
  return group
}

function addFurnitureRod(group: Group, part: FurnitureAssemblyPart, material: Material): Mesh {
  const [length, diameter] = part.size
  const mesh = stampSlot(
    new Mesh(new CylinderGeometry(diameter / 2, diameter / 2, length, 16), material),
    'hardware',
  )
  mesh.name = `furniture-part-${part.id}`
  mesh.position.set(...part.position)
  mesh.rotation.z = Math.PI / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}
