import type { TopologyRemap } from '@pascal-app/core'
import {
  type AnyNode,
  ArrayBodyCircularInputSchema,
  ArrayBodyLinearInputSchema,
  type BodyAnnotationUpdate,
  CreateComponentInputSchema,
  ExplodeComponentInputSchema,
  executeBodyContainerOperation,
  executeModelingOperation,
  GroupBodiesInputSchema,
  getModelingOperationManifestEntry,
  ImprintBodyFaceInputSchema,
  IntersectBodiesInputSchema,
  MakeComponentUniqueInputSchema,
  MODELING_OPERATION_IDS,
  MODELING_OPERATION_MANIFEST,
  type ModelingOperationRequest,
  type ModelingOperationResult,
  OffsetBodyFaceInputSchema,
  OuterShellBodiesInputSchema,
  PaintBodyFaceInputSchema,
  PushPullBodyFaceInputSchema,
  parseModelingOperationRequest,
  remapBodyFeatureAnnotations,
  runAsSingleSceneHistoryStep,
  type SceneMaterialId,
  SplitBodiesInputSchema,
  SplitBodyFaceInputSchema,
  SubtractBodiesInputSchema,
  SweepBodyFaceInputSchema,
  TransformBodyInputSchema,
  TrimBodiesInputSchema,
  UnionBodiesInputSchema,
  useScene,
} from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import type {
  CommitPayload,
  ModelingDiagnostic,
  PreflightPayload,
} from './modeling-operation-contract'

type ParsedModelingOperation =
  | { readonly success: true; readonly data: ModelingOperationRequest }
  | { readonly success: false; readonly message: string }

const PaintBodyFaceMcpInputSchema = PaintBodyFaceInputSchema

type BodyAnnotationSpec = {
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

function annotationPatches(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  specs: readonly BodyAnnotationSpec[],
): BodyAnnotationUpdate[] {
  const simulated: Record<AnyNodeId, AnyNode> = { ...nodes }
  const updates: BodyAnnotationUpdate[] = []
  for (const spec of specs) {
    const next = remapBodyFeatureAnnotations(simulated, spec.bodyId, spec.body, spec.topologyRemap)
    updates.push(...next)
    for (const update of next) {
      const current = simulated[update.id]
      if (current) simulated[update.id] = { ...current, ...update.data } as AnyNode
    }
  }
  return updates
}

function parseInput<T, R extends ModelingOperationRequest>(
  input: Record<string, unknown>,
  schema: z.ZodType<T>,
  operationId: R['operationId'],
): ParsedModelingOperation {
  const parsed = schema.safeParse(input)
  return parsed.success
    ? { success: true, data: parseModelingOperationRequest(operationId, parsed.data) }
    : { success: false, message: parsed.error.message }
}

export function parseModelingOperationInput(
  operationId: ModelingOperationRequest['operationId'],
  input: Record<string, unknown>,
): ParsedModelingOperation {
  switch (operationId) {
    case MODELING_OPERATION_IDS.pushPullBodyFace:
      return parseInput(input, PushPullBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.imprintBodyFace:
      return parseInput(input, ImprintBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.splitBodyFace:
      return parseInput(input, SplitBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.transformBody:
      return parseInput(input, TransformBodyInputSchema, operationId)
    case MODELING_OPERATION_IDS.paintBodyFace:
      return parseInput(input, PaintBodyFaceMcpInputSchema, operationId)
    case MODELING_OPERATION_IDS.offsetBodyFace:
      return parseInput(input, OffsetBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.sweepBodyFace:
      return parseInput(input, SweepBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.arrayBodyLinear:
      return parseInput(input, ArrayBodyLinearInputSchema, operationId)
    case MODELING_OPERATION_IDS.arrayBodyCircular:
      return parseInput(input, ArrayBodyCircularInputSchema, operationId)
    case MODELING_OPERATION_IDS.intersectBodies:
      return parseInput(input, IntersectBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.unionBodies:
      return parseInput(input, UnionBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.subtractBodies:
      return parseInput(input, SubtractBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.outerShellBodies:
      return parseInput(input, OuterShellBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.trimBodies:
      return parseInput(input, TrimBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.splitBodies:
      return parseInput(input, SplitBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.groupBodies:
      return parseInput(input, GroupBodiesInputSchema, operationId)
    case MODELING_OPERATION_IDS.createComponent:
      return parseInput(input, CreateComponentInputSchema, operationId)
    case MODELING_OPERATION_IDS.makeComponentUnique:
      return parseInput(input, MakeComponentUniqueInputSchema, operationId)
    case MODELING_OPERATION_IDS.explodeComponent:
      return parseInput(input, ExplodeComponentInputSchema, operationId)
    default: {
      return { success: false, message: 'Unsupported modeling operation' }
    }
  }
}

export function isAnyNodeId(value: string): value is AnyNodeId {
  const separatorIndex = value.indexOf('_')
  return separatorIndex > 0 && separatorIndex < value.length - 1
}

export function inputFeatureIds(input: Record<string, unknown>): string[] {
  const faceId = input.faceId
  const toolBodyId = input.toolBodyId
  return [
    ...(typeof faceId === 'string' ? [faceId] : []),
    ...(typeof toolBodyId === 'string' ? [toolBodyId] : []),
  ]
}

export function modelingOperationDiagnosticCode(
  operationId: ModelingOperationRequest['operationId'],
  fallback: string,
): string {
  return operationId === MODELING_OPERATION_IDS.offsetBodyFace ? 'operation.invalid' : fallback
}

export function operationVersion(operationId: ModelingOperationRequest['operationId']): number {
  return getModelingOperationManifestEntry(operationId).version
}

export function invalidPreflightPayload(
  operationId: PreflightPayload['operationId'],
  nodeId: string,
  diagnostic: ModelingDiagnostic,
): PreflightPayload {
  return {
    valid: false,
    operationId,
    operationVersion: operationVersion(operationId),
    manifestVersion: MODELING_OPERATION_MANIFEST.version,
    nodeId,
    affectedNodeIds: [],
    diagnostics: [diagnostic],
    preview: null,
  }
}

export function invalidCommitPayload(
  operationId: CommitPayload['operationId'],
  nodeId: string,
  diagnostic: ModelingDiagnostic,
): CommitPayload {
  return {
    success: false,
    operationId,
    operationVersion: operationVersion(operationId),
    manifestVersion: MODELING_OPERATION_MANIFEST.version,
    nodeId,
    affectedNodeIds: [],
    diagnostics: [diagnostic],
    result: null,
    historySteps: 0,
  }
}

export function evaluateModelingOperation(
  node: AnyNode,
  request: ModelingOperationRequest,
  resolveBody?: (id: string) => AnyNode | null | undefined,
): ModelingOperationResult {
  if (
    request.operationId === MODELING_OPERATION_IDS.groupBodies ||
    request.operationId === MODELING_OPERATION_IDS.createComponent ||
    request.operationId === MODELING_OPERATION_IDS.makeComponentUnique ||
    request.operationId === MODELING_OPERATION_IDS.explodeComponent
  ) {
    const nodes: Record<AnyNodeId, AnyNode> = { [node.id]: node }
    const ids =
      request.operationId === MODELING_OPERATION_IDS.groupBodies
        ? request.input.bodyIds
        : request.operationId === MODELING_OPERATION_IDS.createComponent
          ? (request.input.bodyIds ??
            (request.input.sourceComponentId ? [request.input.sourceComponentId] : []))
          : []
    for (const id of ids) {
      const candidate = resolveBody?.(id)
      if (candidate) nodes[id as AnyNodeId] = candidate
    }
    return executeBodyContainerOperation(nodes, node, request)
  }
  return executeModelingOperation(node, request, resolveBody)
}

export function commitModelingResult(
  operations: SceneOperations,
  nodeId: AnyNodeId,
  result: ModelingOperationResult,
): AnyNodeId[] {
  if (result.operation === MODELING_OPERATION_IDS.groupBodies) {
    runAsSingleSceneHistoryStep(useScene, () => {
      operations.applyPatch([
        {
          op: 'create',
          node: result.container,
          ...(result.container.parentId
            ? { parentId: result.container.parentId as AnyNodeId }
            : {}),
        },
        ...result.bodyUpdates.map((update) => ({
          op: 'update' as const,
          id: update.id,
          data: update.data,
        })),
      ])
    })
    return [result.container.id, ...result.bodyUpdates.map((update) => update.id)]
  }
  if (result.operation === MODELING_OPERATION_IDS.createComponent) {
    runAsSingleSceneHistoryStep(useScene, () => {
      if (result.createdNodes && result.createdNodes.length > 0) {
        operations.applyPatch(
          result.createdNodes.map((node) => ({
            op: 'create' as const,
            node,
            ...(node.parentId ? { parentId: node.parentId as AnyNodeId } : {}),
          })),
        )
      } else {
        operations.applyPatch([
          {
            op: 'create',
            node: result.container,
            ...(result.container.parentId
              ? { parentId: result.container.parentId as AnyNodeId }
              : {}),
          },
          ...result.bodyUpdates.map((update) => ({
            op: 'update' as const,
            id: update.id,
            data: update.data,
          })),
        ])
      }
    })
    return [result.container.id, ...result.bodyUpdates.map((update) => update.id)]
  }
  if (result.operation === MODELING_OPERATION_IDS.makeComponentUnique) {
    operations.applyPatch([{ op: 'update', id: result.id as AnyNodeId, data: result.data }])
    return [result.id as AnyNodeId]
  }
  if (result.operation === MODELING_OPERATION_IDS.explodeComponent) {
    runAsSingleSceneHistoryStep(useScene, () => {
      operations.applyPatch([
        ...result.bodyUpdates.map((update) => ({
          op: 'update' as const,
          id: update.id,
          data: update.data,
        })),
        { op: 'delete', id: result.componentId as AnyNodeId, cascade: false },
      ])
    })
    return [result.componentId as AnyNodeId, ...result.bodyUpdates.map((update) => update.id)]
  }
  if (
    result.operation === MODELING_OPERATION_IDS.arrayBodyLinear ||
    result.operation === MODELING_OPERATION_IDS.arrayBodyCircular
  ) {
    return operations.applyPatch(
      result.clones.map((node) => ({
        op: 'create' as const,
        node,
        ...(node.parentId ? { parentId: node.parentId as AnyNodeId } : {}),
      })),
    ).createdIds
  }
  if (
    result.operation === MODELING_OPERATION_IDS.intersectBodies ||
    result.operation === MODELING_OPERATION_IDS.unionBodies ||
    result.operation === MODELING_OPERATION_IDS.subtractBodies
  ) {
    runAsSingleSceneHistoryStep(useScene, () => {
      const annotationUpdates = annotationPatches(operations.getNodes(), [
        {
          bodyId: nodeId,
          body: result.body,
          topologyRemap: result.topologyRemap,
        },
        {
          bodyId: result.toolBodyId as AnyNodeId,
          body: null,
          topologyRemap: EMPTY_TOPOLOGY_REMAP,
        },
      ])
      operations.applyPatch([
        { op: 'update', id: nodeId, data: result.body },
        ...annotationUpdates.map((update) => ({
          op: 'update' as const,
          id: update.id,
          data: update.data,
        })),
        { op: 'delete', id: result.toolBodyId as AnyNodeId, cascade: false },
      ])
    })
    return [result.toolBodyId as AnyNodeId]
  }
  if (result.operation === MODELING_OPERATION_IDS.outerShellBodies) {
    runAsSingleSceneHistoryStep(useScene, () => {
      const annotationUpdates = annotationPatches(operations.getNodes(), [
        {
          bodyId: nodeId,
          body: result.body,
          topologyRemap: result.topologyRemap,
        },
        {
          bodyId: result.toolBodyId as AnyNodeId,
          body: null,
          topologyRemap: EMPTY_TOPOLOGY_REMAP,
        },
      ])
      operations.applyPatch([
        { op: 'update', id: nodeId, data: result.body },
        ...annotationUpdates.map((update) => ({
          op: 'update' as const,
          id: update.id,
          data: update.data,
        })),
        { op: 'delete', id: result.toolBodyId as AnyNodeId, cascade: false },
      ])
    })
    return [result.toolBodyId as AnyNodeId]
  }
  if (result.operation === MODELING_OPERATION_IDS.trimBodies) {
    const annotationUpdates = annotationPatches(operations.getNodes(), [
      { bodyId: nodeId, body: result.body, topologyRemap: result.topologyRemap },
    ])
    operations.applyPatch([
      { op: 'update', id: nodeId, data: result.body },
      ...annotationUpdates.map((update) => ({
        op: 'update' as const,
        id: update.id,
        data: update.data,
      })),
    ])
    return []
  }
  if (result.operation === MODELING_OPERATION_IDS.splitBodies) {
    runAsSingleSceneHistoryStep(useScene, () => {
      const targetPiece = result.pieces.find(({ body }) => body.id === nodeId)
      const toolPiece = result.pieces.find(({ body }) => body.id === result.toolBodyId)
      const annotationUpdates = annotationPatches(operations.getNodes(), [
        {
          bodyId: nodeId,
          body: targetPiece?.body ?? null,
          topologyRemap: result.topologyRemap,
        },
        {
          bodyId: result.toolBodyId as AnyNodeId,
          body: toolPiece?.body ?? null,
          topologyRemap: toolPiece?.topologyRemap ?? EMPTY_TOPOLOGY_REMAP,
        },
      ])
      operations.applyPatch([
        ...result.pieces.map(({ body }) =>
          body.id === nodeId || body.id === result.toolBodyId
            ? { op: 'update' as const, id: body.id as AnyNodeId, data: body }
            : {
                op: 'create' as const,
                node: body,
                ...(body.parentId ? { parentId: body.parentId as AnyNodeId } : {}),
              },
        ),
        ...annotationUpdates.map((update) => ({
          op: 'update' as const,
          id: update.id,
          data: update.data,
        })),
      ])
    })
    return result.pieces.map(({ body }) => body.id as AnyNodeId).filter((id) => id !== nodeId)
  }
  if (!('body' in result)) return []
  if (result.operation !== MODELING_OPERATION_IDS.paintBodyFace || result.material === null) {
    const annotationUpdates = annotationPatches(operations.getNodes(), [
      { bodyId: nodeId, body: result.body, topologyRemap: result.topologyRemap },
    ])
    operations.applyPatch([
      { op: 'update', id: nodeId, data: result.body },
      ...annotationUpdates.map((update) => ({
        op: 'update' as const,
        id: update.id,
        data: update.data,
      })),
    ])
    return []
  }

  const sceneMaterial = result.material
  const materialId = parseSceneMaterialId(sceneMaterial.id)
  const existing = useScene.getState().materials[materialId]
  if (existing && JSON.stringify(existing) !== JSON.stringify(sceneMaterial)) {
    throw new RangeError(`Scene material id already exists: ${sceneMaterial.id}`)
  }
  runAsSingleSceneHistoryStep(useScene, () => {
    const annotationUpdates = annotationPatches(operations.getNodes(), [
      { bodyId: nodeId, body: result.body, topologyRemap: result.topologyRemap },
    ])
    operations.applyPatch([
      { op: 'update', id: nodeId, data: result.body },
      ...annotationUpdates.map((update) => ({
        op: 'update' as const,
        id: update.id,
        data: update.data,
      })),
    ])
    if (!existing) useScene.getState().addSceneMaterial(sceneMaterial)
  })
  return []
}

function parseSceneMaterialId(value: string): SceneMaterialId {
  return z
    .custom<SceneMaterialId>(
      (candidate) => typeof candidate === 'string' && candidate.startsWith('mat_'),
      'Expected a scene material id beginning with mat_',
    )
    .parse(value)
}

export function invalidOperationDiagnostic(
  message: string,
  featureIds?: string[],
): ModelingDiagnostic {
  return {
    severity: 'error',
    code: 'operation.invalid',
    message,
    ...(featureIds === undefined ? {} : { featureIds }),
  }
}

export { ModelingPreviewSchema, toModelingPreview, toolResult } from './modeling-operation-contract'
