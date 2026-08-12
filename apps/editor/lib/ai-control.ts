import {
  cloneComponentInstance,
  createBodyGroupFromBodies,
  createComponentFromBodies,
  createDefaultFurnitureAssembly,
  createDefaultWallFaceBands,
  createRoundedRectangularFrameBody,
  deleteFurnitureBay,
  deleteFurnitureTier,
  explodeComponent,
  type FurnitureAssembly,
  getNodeSemanticRef,
  insertFurnitureBay,
  insertFurnitureTier,
  makeComponentUnique,
  remapBodyFeatureAnnotations,
  resizeFurnitureBay,
  resizeFurnitureTier,
  runAsSingleSceneHistoryStep,
  setFurnitureTierInterior,
  type TopologyRemap,
  withDefaultConstructionMaterials,
} from '@pascal-app/core'
import {
  executeArrayBodyCircular,
  executeArrayBodyLinear,
  executeImprintBodyFace,
  executeIntersectBodies,
  executeOffsetBodyFace,
  executeOuterShellBodies,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeSplitBodies,
  executeSplitBodyFace,
  executeSubtractBodies,
  executeSweepBodyFace,
  executeTransformBody,
  executeTrimBodies,
  executeUnionBodies,
} from '@pascal-app/core/modeling-operations'
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
import { z } from 'zod'
import { type AiModelingPlan, AiModelingPlanSchema } from './ai-contract'

export {
  AiModelingPatchSchema,
  type AiModelingPlan,
  AiModelingPlanSchema,
} from './ai-contract'

const SceneMaterialIdSchema = z.custom<SceneMaterialId>(
  (value) => typeof value === 'string' && value.startsWith('mat_'),
  'Expected a scene material id beginning with mat_',
)

function parseSceneMaterialId(value: string): SceneMaterialId {
  return SceneMaterialIdSchema.parse(value)
}

type BodyAnnotationRemapSpec = {
  bodyId: AnyNodeId
  body: Extract<AnyNode, { type: 'body' }> | null
  topologyRemap: TopologyRemap
}

const EMPTY_TOPOLOGY_REMAP: TopologyRemap = {
  preserved: [],
  created: [],
  deleted: [],
  split: {},
  merged: {},
}

function remapBodyAnnotationPatches(
  simulatedNodes: Map<string, AnyNode>,
  specs: readonly BodyAnnotationRemapSpec[],
): Patch[] {
  const updates: Patch[] = []
  for (const spec of specs) {
    const next = remapBodyFeatureAnnotations(
      Object.fromEntries(simulatedNodes),
      spec.bodyId,
      spec.body,
      spec.topologyRemap,
    )
    for (const update of next) {
      updates.push({ op: 'update', id: update.id, data: update.data })
      const current = simulatedNodes.get(update.id)
      if (current) {
        simulatedNodes.set(update.id, AnyNode.parse({ ...current, ...update.data }))
      }
    }
  }
  return updates
}

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
    semanticRefs: {
      readonly nodeId: string
      readonly packId: string
      readonly classId: string
      readonly version: string
    }[]
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
                faceBands: withDefaultConstructionMaterials(createDefaultWallFaceBands(thickness)),
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
        const result = executePushPullBodyFace(current, {
          faceId: patch.faceId,
          distance: patch.distance,
        })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'offsetBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body offset target is not a body: ${patch.id}`)
        }
        const result = executeOffsetBodyFace(current, {
          faceId: patch.faceId,
          distance: patch.distance,
        })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'sweepBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body sweep target is not a body: ${patch.id}`)
        }
        const result = executeSweepBodyFace(current, {
          faceId: patch.faceId,
          pathPoints: patch.pathPoints,
        })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'imprintBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI imprint target is not a body: ${patch.id}`)
        }
        const result = executeImprintBodyFace(current, {
          faceId: patch.faceId,
          profilePoints: patch.profilePoints,
          ...(patch.distance === undefined ? {} : { distance: patch.distance }),
        })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'splitBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI split target is not a body: ${patch.id}`)
        }
        const result = executeSplitBodyFace(current, {
          faceId: patch.faceId,
          pathPoints: patch.pathPoints,
        })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'transformBody': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body transform target is not a body: ${patch.id}`)
        }
        const result = executeTransformBody(current, patch)
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
      }
      case 'arrayBodyLinear': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body linear array target is not a body: ${patch.id}`)
        }
        const result = executeArrayBodyLinear(current, patch)
        for (const clone of result.clones) simulatedNodes.set(clone.id, clone)
        return result.clones.map((node) => ({
          op: 'create' as const,
          node,
          ...(node.parentId ? { parentId: node.parentId as AnyNodeId } : {}),
        }))
      }
      case 'arrayBodyCircular': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body circular array target is not a body: ${patch.id}`)
        }
        const result = executeArrayBodyCircular(current, patch)
        for (const clone of result.clones) simulatedNodes.set(clone.id, clone)
        return result.clones.map((node) => ({
          op: 'create' as const,
          node,
          ...(node.parentId ? { parentId: node.parentId as AnyNodeId } : {}),
        }))
      }
      case 'unionBodies':
      case 'subtractBodies':
      case 'intersectBodies': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body boolean target is not a body: ${patch.id}`)
        }
        const tool = simulatedNodes.get(patch.toolBodyId)
        if (!tool) {
          throw new Error(
            `invalid AI patch: patches[${index}] tool body id "${patch.toolBodyId}" not found`,
          )
        }
        if (tool.type !== 'body') {
          throw new RangeError(`AI Body boolean tool is not a body: ${patch.toolBodyId}`)
        }
        const result =
          patch.op === 'unionBodies'
            ? executeUnionBodies(current, tool, { toolBodyId: patch.toolBodyId })
            : patch.op === 'subtractBodies'
              ? executeSubtractBodies(current, tool, { toolBodyId: patch.toolBodyId })
              : executeIntersectBodies(current, tool, {
                  toolBodyId: patch.toolBodyId,
                })
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
          { bodyId: tool.id, body: null, topologyRemap: EMPTY_TOPOLOGY_REMAP },
        ])
        simulatedNodes.set(result.body.id, result.body)
        simulatedNodes.delete(tool.id)
        return [
          { op: 'update' as const, id: result.body.id, data: result.body },
          ...annotationPatches,
          { op: 'delete' as const, id: tool.id, cascade: false },
        ]
      }
      case 'outerShellBodies':
      case 'trimBodies':
      case 'splitBodies': {
        const current = simulatedNodes.get(patch.id)
        const tool = simulatedNodes.get(patch.toolBodyId)
        if (current?.type !== 'body') {
          throw new RangeError(`AI Solid Tools target is not a body: ${patch.id}`)
        }
        if (tool?.type !== 'body') {
          throw new RangeError(`AI Solid Tools tool is not a body: ${patch.toolBodyId}`)
        }
        if (patch.op === 'outerShellBodies') {
          const result = executeOuterShellBodies(current, tool, patch)
          const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
            { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
            { bodyId: tool.id, body: null, topologyRemap: EMPTY_TOPOLOGY_REMAP },
          ])
          simulatedNodes.set(result.body.id, result.body)
          simulatedNodes.delete(tool.id)
          return [
            { op: 'update' as const, id: result.body.id, data: result.body },
            ...annotationPatches,
            { op: 'delete' as const, id: tool.id, cascade: false },
          ]
        }
        if (patch.op === 'trimBodies') {
          const result = executeTrimBodies(current, tool, patch)
          const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
            { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
          ])
          simulatedNodes.set(result.body.id, result.body)
          return [
            { op: 'update' as const, id: result.body.id, data: result.body },
            ...annotationPatches,
          ]
        }
        const result = executeSplitBodies(current, tool, patch)
        const targetPiece = result.pieces.find(({ body }) => body.id === current.id)
        const toolPiece = result.pieces.find(({ body }) => body.id === tool.id)
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          {
            bodyId: current.id,
            body: targetPiece?.body ?? null,
            topologyRemap: result.topologyRemap,
          },
          {
            bodyId: tool.id,
            body: toolPiece?.body ?? null,
            topologyRemap: toolPiece?.topologyRemap ?? EMPTY_TOPOLOGY_REMAP,
          },
        ])
        const bodyPatches = result.pieces.map(({ body }) => {
          const exists = simulatedNodes.has(body.id)
          simulatedNodes.set(body.id, body)
          return exists
            ? { op: 'update' as const, id: body.id, data: body }
            : {
                op: 'create' as const,
                node: body,
                ...(body.parentId ? { parentId: body.parentId as AnyNodeId } : {}),
              }
        })
        return [...bodyPatches, ...annotationPatches]
      }
      case 'paintBodyFace': {
        const current = simulatedNodes.get(patch.id)
        if (!current) {
          throw new Error(`invalid AI patch: patches[${index}] body id "${patch.id}" not found`)
        }
        if (current.type !== 'body') {
          throw new RangeError(`AI Body paint target is not a body: ${patch.id}`)
        }
        const result = executePaintBodyFace(current, {
          faceId: patch.faceId,
          material: patch.material,
        })
        if (!result.material) {
          throw new RangeError(`AI Body paint material is missing: ${patch.id}/${patch.faceId}`)
        }
        const existingMaterial =
          materials.find((material) => material.id === result.material?.id) ??
          useScene.getState().materials[parseSceneMaterialId(result.material.id)]
        if (
          existingMaterial &&
          JSON.stringify(existingMaterial) !== JSON.stringify(result.material)
        ) {
          throw new RangeError(`AI Body paint material id already exists: ${result.material.id}`)
        }
        if (!existingMaterial) materials.push(result.material)
        const annotationPatches = remapBodyAnnotationPatches(simulatedNodes, [
          { bodyId: current.id, body: result.body, topologyRemap: result.topologyRemap },
        ])
        simulatedNodes.set(result.body.id, result.body)
        return [{ op: 'update', id: result.body.id, data: result.body }, ...annotationPatches]
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
      case 'groupBodies': {
        const write = createBodyGroupFromBodies(
          Object.fromEntries(simulatedNodes),
          patch.bodyIds as AnyNodeId[],
        )
        simulatedNodes.set(write.container.id, write.container)
        for (const update of write.bodyUpdates) {
          const body = simulatedNodes.get(update.id)
          if (body) simulatedNodes.set(update.id, { ...body, ...update.data } as AnyNode)
        }
        return [
          {
            op: 'create' as const,
            node: write.container,
            ...(write.container.parentId
              ? { parentId: write.container.parentId as AnyNodeId }
              : {}),
          },
          ...write.bodyUpdates.map((update) => ({
            op: 'update' as const,
            id: update.id,
            data: update.data,
          })),
        ]
      }
      case 'createComponent': {
        if (patch.sourceComponentId) {
          const cloned = cloneComponentInstance(
            Object.fromEntries(simulatedNodes),
            patch.sourceComponentId as AnyNodeId,
          )
          for (const node of cloned.nodes) simulatedNodes.set(node.id, node)
          return cloned.nodes.map((node) => ({
            op: 'create' as const,
            node,
            ...(node.parentId ? { parentId: node.parentId as AnyNodeId } : {}),
          }))
        }
        const write = createComponentFromBodies(
          Object.fromEntries(simulatedNodes),
          (patch.bodyIds ?? []) as AnyNodeId[],
        )
        simulatedNodes.set(write.container.id, write.container)
        for (const update of write.bodyUpdates) {
          const body = simulatedNodes.get(update.id)
          if (body) simulatedNodes.set(update.id, { ...body, ...update.data } as AnyNode)
        }
        return [
          {
            op: 'create' as const,
            node: write.container,
            ...(write.container.parentId
              ? { parentId: write.container.parentId as AnyNodeId }
              : {}),
          },
          ...write.bodyUpdates.map((update) => ({
            op: 'update' as const,
            id: update.id,
            data: update.data,
          })),
        ]
      }
      case 'makeComponentUnique': {
        const update = makeComponentUnique(Object.fromEntries(simulatedNodes), patch.id)
        const component = simulatedNodes.get(update.id)
        if (component) simulatedNodes.set(update.id, { ...component, ...update.data } as AnyNode)
        return [{ op: 'update' as const, id: update.id, data: update.data }]
      }
      case 'explodeComponent': {
        const write = explodeComponent(Object.fromEntries(simulatedNodes), patch.id)
        simulatedNodes.delete(write.componentId)
        for (const update of write.bodyUpdates) {
          const body = simulatedNodes.get(update.id)
          if (body) simulatedNodes.set(update.id, { ...body, ...update.data } as AnyNode)
        }
        return [
          ...write.bodyUpdates.map((update) => ({
            op: 'update' as const,
            id: update.id,
            data: update.data,
          })),
          { op: 'delete' as const, id: write.componentId, cascade: false },
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
  const selectedNodes = selection.selectedIds.flatMap((id) =>
    Object.values(state.nodes).filter((node) => node.id === id),
  )
  const semanticRefs = selectedNodes.flatMap((node) => {
    const semanticRef = getNodeSemanticRef(node.type)
    return semanticRef ? [{ nodeId: node.id, ...semanticRef }] : []
  })
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
      semanticRefs,
    },
  }
}
