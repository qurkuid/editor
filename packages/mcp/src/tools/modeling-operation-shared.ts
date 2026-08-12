import {
  executeModelingOperation,
  getModelingOperationManifestEntry,
  ImprintBodyFaceInputSchema,
  MODELING_OPERATION_IDS,
  MODELING_OPERATION_MANIFEST,
  type ModelingOperationRequest,
  type ModelingOperationResult,
  OffsetBodyFaceInputSchema,
  PaintBodyFaceInputSchema,
  PushPullBodyFaceInputSchema,
  parseModelingOperationRequest,
  runAsSingleSceneHistoryStep,
  type SceneMaterialId,
  SweepBodyFaceInputSchema,
  TransformBodyInputSchema,
  useScene,
} from '@pascal-app/core'
import type { AnyNodeId, BodyNode } from '@pascal-app/core/schema'
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
    case MODELING_OPERATION_IDS.transformBody:
      return parseInput(input, TransformBodyInputSchema, operationId)
    case MODELING_OPERATION_IDS.paintBodyFace:
      return parseInput(input, PaintBodyFaceMcpInputSchema, operationId)
    case MODELING_OPERATION_IDS.offsetBodyFace:
      return parseInput(input, OffsetBodyFaceInputSchema, operationId)
    case MODELING_OPERATION_IDS.sweepBodyFace:
      return parseInput(input, SweepBodyFaceInputSchema, operationId)
    default: {
      const unreachable: never = operationId
      return { success: false, message: `Unsupported modeling operation: ${String(unreachable)}` }
    }
  }
}

export function isAnyNodeId(value: string): value is AnyNodeId {
  const separatorIndex = value.indexOf('_')
  return separatorIndex > 0 && separatorIndex < value.length - 1
}

export function inputFeatureIds(input: Record<string, unknown>): string[] {
  const faceId = input.faceId
  return typeof faceId === 'string' ? [faceId] : []
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
  node: BodyNode,
  request: ModelingOperationRequest,
): ModelingOperationResult {
  return executeModelingOperation(node, request)
}

export function commitModelingResult(
  operations: SceneOperations,
  nodeId: AnyNodeId,
  result: ModelingOperationResult,
): void {
  if (result.operation !== MODELING_OPERATION_IDS.paintBodyFace || result.material === null) {
    operations.applyPatch([{ op: 'update', id: nodeId, data: result.body }])
    return
  }

  const sceneMaterial = result.material
  const materialId = parseSceneMaterialId(sceneMaterial.id)
  const existing = useScene.getState().materials[materialId]
  if (existing && JSON.stringify(existing) !== JSON.stringify(sceneMaterial)) {
    throw new RangeError(`Scene material id already exists: ${sceneMaterial.id}`)
  }
  runAsSingleSceneHistoryStep(useScene, () => {
    operations.applyPatch([{ op: 'update', id: nodeId, data: result.body }])
    if (!existing) useScene.getState().addSceneMaterial(sceneMaterial)
  })
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
