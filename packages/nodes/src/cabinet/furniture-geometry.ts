import {
  buildFurnitureAssembly,
  type CabinetNode,
  type FurnitureAssemblyPart,
  type GeometryContext,
} from '@pascal-app/core'
import { type ColorPreset, type RenderShading, resolveMaterialRef } from '@pascal-app/viewer'
import { CylinderGeometry, Group, type Material, Mesh } from 'three'
import { addBox, getCabinetSlotMaterials, stampSlot } from './geometry/shared'
import type { CabinetSlotId } from './slots'

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
  const operationState = node.operationState ?? 0

  for (const part of result.parts) {
    const slotId =
      part.kind === 'hanger' || part.kind === 'leg'
        ? 'hardware'
        : part.kind === 'front'
          ? 'front'
          : part.kind === 'kickplate'
            ? 'plinth'
            : part.kind === 'countertop'
              ? 'countertop'
              : 'carcass'
    const material =
      resolveMaterialRef(part.materialId, ctx?.materials, shading) ?? materials[slotId]
    const mesh =
      part.shape === 'box'
        ? addFurnitureFront(group, part, material, slotId, operationState)
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

// Poses a `front` part per `part.frontPose` so it opens/closes with
// `operationState`, reusing the cabinet stack's `userData.cabinetPose`
// animation mechanism (`packages/nodes/src/cabinet/animation.ts` /
// `system.tsx`) instead of a second one. A `hinge` pose needs a wrapping
// group positioned at the hinge line — rotating the mesh itself would spin
// it about its own center rather than swing it about the edge — so the
// group carries `cabinetPose` and the mesh sits offset inside it, mirroring
// `addDoorLeaf` in `geometry/fronts.ts`.
function addFurnitureFront(
  group: Group,
  part: FurnitureAssemblyPart,
  material: Material,
  slotId: CabinetSlotId,
  operationState: number,
): Mesh {
  const pose = part.frontPose
  if (!pose) {
    return addBox(group, part.size, part.position, material, `furniture-part-${part.id}`, slotId)
  }

  if (pose.kind === 'hinge') {
    const axisIndex = pose.axis === 'y' ? 0 : 1
    const hingePosition: [number, number, number] = [...part.position]
    hingePosition[axisIndex] += pose.hingeOffset
    const hingeGroup = new Group()
    hingeGroup.name = `furniture-part-${part.id}-hinge`
    hingeGroup.position.set(...hingePosition)
    hingeGroup.rotation[pose.axis] = pose.angle * operationState
    hingeGroup.userData.cabinetPose = { type: 'rotate', axis: pose.axis, angle: pose.angle }
    group.add(hingeGroup)

    const localPosition: [number, number, number] = [0, 0, 0]
    localPosition[axisIndex] = -pose.hingeOffset
    return addBox(
      hingeGroup,
      part.size,
      localPosition,
      material,
      `furniture-part-${part.id}`,
      slotId,
    )
  }

  // `poseCabinetMovingParts` *assigns* `position[axis]`, so the posed object
  // has to sit at 0 on that axis or the part's own offset is wiped out (a
  // drawer would jump to the carcass centre). Same fix the stack system uses
  // for its drawer/pull-out slides: an origin group carries the pose and the
  // mesh keeps its real position inside.
  const slideGroup = new Group()
  slideGroup.name = `furniture-part-${part.id}-slide`
  slideGroup.position[pose.axis] = pose.distance * operationState
  slideGroup.userData.cabinetPose = { type: 'translate', axis: pose.axis, distance: pose.distance }
  group.add(slideGroup)

  return addBox(slideGroup, part.size, part.position, material, `furniture-part-${part.id}`, slotId)
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
