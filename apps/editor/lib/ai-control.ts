import {
  createDefaultFurnitureAssembly,
  createDefaultWallFaceBands,
  createRoundedRectangularFrameBody,
  deleteFurnitureBay,
  deleteFurnitureTier,
  type FurnitureAssembly,
  insertFurnitureBay,
  insertFurnitureTier,
  pushPullBodyFace,
  resizeFurnitureBay,
  resizeFurnitureTier,
  runAsSingleSceneHistoryStep,
  setFurnitureTierInterior,
  toSceneMaterialRef,
} from '@pascal-app/core'
import { transformBody } from '@pascal-app/core/body-transform'
import {
  AnyNode,
  type AnyNodeId,
  BuildingNode,
  CabinetNode,
  LevelNode,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { type Patch, SceneBridge } from '@pascal-app/mcp/bridge'
import { useViewer } from '@pascal-app/viewer'
import { type AiModelingPlan, AiModelingPlanSchema } from './ai-contract'

export {
  AiModelingPatchSchema,
  type AiModelingPlan,
  AiModelingPlanSchema,
} from './ai-contract'

export type AiSceneContext = {
  coordinateSystem: {
    groundPlane: 'XZ'
    upAxis: 'Y'
    unit: 'm'
  }
  nodeCount: number
  nodes: ReturnType<typeof useScene.getState>['nodes']
  rootNodeIds: ReturnType<typeof useScene.getState>['rootNodeIds']
  materials: ReturnType<typeof useScene.getState>['materials']
  selection: {
    buildingId: string | null
    levelId: string | null
    zoneId: string | null
    selectedIds: string[]
    selectedNodes: ReturnType<typeof useScene.getState>['nodes'][AnyNodeId][]
  }
}

function resolveRoundedFrameHierarchy(
  parentId: AnyNodeId | undefined,
  simulatedNodes: Map<string, ReturnType<typeof useScene.getState>['nodes'][AnyNodeId]>,
): { parentId: AnyNodeId | undefined; patches: Patch[] } {
  if (parentId !== undefined) return { parentId, patches: [] }

  const selectedLevelId = useViewer.getState().selection.levelId as AnyNodeId | null
  if (selectedLevelId && simulatedNodes.get(selectedLevelId)?.type === 'level') {
    return { parentId: selectedLevelId, patches: [] }
  }

  const existingLevel = [...simulatedNodes.values()].find((node) => node.type === 'level')
  if (existingLevel) return { parentId: existingLevel.id, patches: [] }

  let building = [...simulatedNodes.values()].find((node) => node.type === 'building')
  const patches: Patch[] = []
  if (!building) {
    const site = [...simulatedNodes.values()].find((node) => node.type === 'site')
    if (!site) return { parentId: undefined, patches }
    building = BuildingNode.parse({ parentId: site.id, children: [] })
    simulatedNodes.set(building.id, building)
    patches.push({ op: 'create', node: building, parentId: site.id })
  }

  const level = LevelNode.parse({ parentId: building.id, level: 0, children: [], height: 2.5 })
  simulatedNodes.set(level.id, level)
  patches.push({ op: 'create', node: level, parentId: building.id })
  return { parentId: level.id, patches }
}

function normalizePatches(plan: AiModelingPlan): {
  readonly patches: Patch[]
  readonly materials: SceneMaterial[]
  readonly materialUpdates: (SceneMaterial & { readonly id: SceneMaterialId })[]
} {
  const simulatedNodes = new Map(
    Object.entries(useScene.getState().nodes).map(([id, node]) => [id, node]),
  )
  const materials: SceneMaterial[] = []
  const materialUpdates: (SceneMaterial & { readonly id: SceneMaterialId })[] = []

  const updateFurnitureNode = (
    id: AnyNodeId,
    patchIndex: number,
    operation: (furniture: FurnitureAssembly) => FurnitureAssembly,
  ): Patch[] => {
    const current = simulatedNodes.get(id)
    if (!current) {
      throw new Error(`invalid AI patch: patches[${patchIndex}] cabinet id "${id}" not found`)
    }
    if (current.type !== 'cabinet') {
      throw new RangeError(`AI furniture target is not a cabinet: ${id}`)
    }
    if (!current.furniture) {
      throw new RangeError(`AI furniture target has no furniture assembly: ${id}`)
    }
    const furniture = operation(current.furniture)
    if (furniture === current.furniture) return []
    const node = CabinetNode.parse({ ...current, furniture })
    simulatedNodes.set(node.id, node)
    return [{ op: 'update', id: node.id, data: node }]
  }

  const patches = plan.patches.flatMap<Patch>((patch, index) => {
    switch (patch.op) {
      case 'create': {
        const thickness =
          patch.node.type === 'wall' && typeof patch.node.thickness === 'number'
            ? patch.node.thickness
            : 0.1
        const node = AnyNode.parse(
          patch.node.type === 'wall' && patch.node.faceBands === undefined
            ? {
                ...patch.node,
                thickness,
                faceBands: createDefaultWallFaceBands(thickness),
              }
            : patch.node,
        )
        simulatedNodes.set(node.id, node)
        return [
          {
            op: 'create',
            node,
            ...(patch.parentId === undefined ? {} : { parentId: patch.parentId }),
          },
        ]
      }
      case 'update': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] update id "${patch.id}" not found`)
        }
        const node = AnyNode.parse({
          ...current,
          ...patch.data,
          id: current.id,
          type: current.type,
        })
        simulatedNodes.set(node.id, node)
        return [{ op: 'update', id: node.id, data: node }]
      }
      case 'delete':
        simulatedNodes.delete(patch.id)
        return [
          {
            op: 'delete',
            id: patch.id,
            ...(patch.cascade === undefined ? {} : { cascade: patch.cascade }),
          },
        ]
      case 'pushPullBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Push/Pull target is not a body: ${patch.id}`)
        }
        const result = pushPullBodyFace(current, patch.faceId, patch.distance)
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }]
      }
      case 'transformBody': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body transform target is not a body: ${patch.id}`)
        }
        const body = transformBody(current, patch)
        simulatedNodes.set(body.id, body)
        return [{ op: 'update', id: body.id, data: body }]
      }
      case 'paintBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body paint target is not a body: ${patch.id}`)
        }
        if (!current.faces.some((face) => face.id === patch.faceId)) {
          throw new RangeError(`AI Body paint face not found: ${patch.id}/${patch.faceId}`)
        }
        const existingMaterial =
          materials.find((material) => material.id === patch.material.id) ??
          useScene.getState().materials[patch.material.id]
        if (
          existingMaterial &&
          JSON.stringify(existingMaterial) !== JSON.stringify(patch.material)
        ) {
          throw new RangeError(`AI Body paint material id already exists: ${patch.material.id}`)
        }
        if (!existingMaterial) materials.push(patch.material)
        const materialRef = toSceneMaterialRef(patch.material.id)
        const body = {
          ...current,
          faces: current.faces.map((face) =>
            face.id === patch.faceId
              ? { ...face, surface: { ...face.surface, materialRef } }
              : face,
          ),
        }
        simulatedNodes.set(body.id, body)
        return [{ op: 'update', id: body.id, data: body }]
      }
      case 'updateSceneMaterial': {
        const existing = useScene.getState().materials[patch.material.id]
        if (!existing) {
          throw new RangeError(`AI scene material not found: ${patch.material.id}`)
        }
        materialUpdates.push(patch.material)
        return []
      }
      case 'makeMaterialSeamless':
        throw new RangeError('AI seamless material operation requires asset resolution')
      case 'createRoundedRectangularFrameBody': {
        const hierarchy = resolveRoundedFrameHierarchy(patch.parentId, simulatedNodes)
        const body = createRoundedRectangularFrameBody({
          ...(patch.id ? { id: patch.id } : {}),
          ...(patch.name ? { name: patch.name } : {}),
          origin: patch.origin,
          width: patch.width,
          height: patch.height,
          depth: patch.depth,
          openingWidth: patch.openingWidth,
          openingHeight: patch.openingHeight,
          topCornerRadius: patch.topCornerRadius,
        })
        simulatedNodes.set(body.id, body)
        return [
          ...hierarchy.patches,
          {
            op: 'create',
            node: body,
            ...(hierarchy.parentId === undefined ? {} : { parentId: hierarchy.parentId }),
          },
        ]
      }
      case 'setFurnitureTierInterior': {
        return updateFurnitureNode(patch.id, index, (furniture) =>
          setFurnitureTierInterior(furniture, {
            bayId: patch.bayId,
            tierId: patch.tierId,
            shelfCount: patch.shelfCount,
            hanger: patch.hanger,
          }),
        )
      }
      case 'insertFurnitureBay':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          insertFurnitureBay(furniture, {
            afterBayId: patch.afterBayId,
            ...(patch.newWidth === undefined ? {} : { newWidth: patch.newWidth }),
          }),
        )
      case 'deleteFurnitureBay':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          deleteFurnitureBay(furniture, { bayId: patch.bayId }),
        )
      case 'resizeFurnitureBay':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          resizeFurnitureBay(furniture, { bayId: patch.bayId, width: patch.width }),
        )
      case 'insertFurnitureTier':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          insertFurnitureTier(furniture, {
            bayId: patch.bayId,
            afterTierId: patch.afterTierId,
            ...(patch.newHeight === undefined ? {} : { newHeight: patch.newHeight }),
          }),
        )
      case 'deleteFurnitureTier':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          deleteFurnitureTier(furniture, { bayId: patch.bayId, tierId: patch.tierId }),
        )
      case 'resizeFurnitureTier':
        return updateFurnitureNode(patch.id, index, (furniture) =>
          resizeFurnitureTier(furniture, {
            bayId: patch.bayId,
            tierId: patch.tierId,
            height: patch.height,
          }),
        )
      case 'createFurniture': {
        const hierarchy = resolveRoundedFrameHierarchy(patch.parentId, simulatedNodes)
        const furniture = createDefaultFurnitureAssembly({
          furnitureKind: patch.furnitureKind,
          dimensions: patch.dimensions,
          bayCount: patch.bayCount,
        })
        const node = CabinetNode.parse({
          ...(patch.id ? { id: patch.id } : {}),
          ...(patch.name ? { name: patch.name } : {}),
          type: 'cabinet',
          parentId: hierarchy.parentId ?? null,
          position: patch.position,
          rotation: patch.rotationY,
          width: furniture.dimensions.width,
          depth: furniture.dimensions.depth,
          carcassHeight: furniture.dimensions.height,
          showPlinth: false,
          withCountertop: false,
          furniture,
        })
        simulatedNodes.set(node.id, node)
        return [
          ...hierarchy.patches,
          {
            op: 'create',
            node,
            ...(hierarchy.parentId === undefined ? {} : { parentId: hierarchy.parentId }),
          },
        ]
      }
      default: {
        const unreachable: never = patch
        throw new Error(`unsupported AI patch: ${String(unreachable)}`)
      }
    }
  })
  return { patches, materials, materialUpdates }
}

export function applyAiModelingPlan(input: unknown): {
  appliedOps: number
  deletedIds: string[]
  createdIds: string[]
} {
  const plan = AiModelingPlanSchema.parse(input)
  const normalized = normalizePatches(plan)
  const bridge = new SceneBridge()

  return runAsSingleSceneHistoryStep(useScene, () => {
    const result = bridge.applyPatch(normalized.patches)
    for (const material of normalized.materials) useScene.getState().addSceneMaterial(material)
    for (const material of normalized.materialUpdates) {
      useScene.getState().updateSceneMaterial(material.id, material)
    }
    return { ...result, appliedOps: result.appliedOps + normalized.materialUpdates.length }
  })
}

export function buildAiSceneContext(): AiSceneContext {
  const state = useScene.getState()
  const selection = useViewer.getState().selection
  const selectedNodes = selection.selectedIds
    .map((id) => state.nodes[id as AnyNodeId])
    .filter((node) => node !== undefined)
  return {
    coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
    nodeCount: Object.keys(state.nodes).length,
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    materials: state.materials,
    selection: {
      buildingId: selection.buildingId,
      levelId: selection.levelId,
      zoneId: selection.zoneId,
      selectedIds: selection.selectedIds,
      selectedNodes,
    },
  }
}
