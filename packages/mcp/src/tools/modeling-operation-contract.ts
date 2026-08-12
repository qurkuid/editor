import {
  MODELING_OPERATION_IDS,
  ModelingOperationIdSchema,
  type ModelingOperationResult,
} from '@pascal-app/core'
import { z } from 'zod'
import { NodeIdSchema } from './schemas'

export const ModelingDiagnosticSchema = z.object({
  severity: z.enum(['error', 'info', 'warning']),
  code: z.string(),
  message: z.string(),
  featureIds: z.array(z.string()).optional(),
})

export const TopologyRemapSchema = z.object({
  preserved: z.array(z.string()),
  created: z.array(z.string()),
  deleted: z.array(z.string()),
  split: z.record(z.string(), z.array(z.string())),
  merged: z.record(z.string(), z.string()),
})

const BodyPreviewSchema = z.record(z.string(), z.unknown())
const PushPullPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.pushPullBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  movedFaceId: z.string(),
  createdFaceIds: z.array(z.string()),
  topologyRemap: TopologyRemapSchema,
})
const ImprintPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.imprintBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  insetFaceId: z.string(),
  extrusion: z
    .object({
      movedFaceId: z.string(),
      createdFaceIds: z.array(z.string()),
      topologyRemap: TopologyRemapSchema,
    })
    .nullable(),
  topologyRemap: TopologyRemapSchema,
})
const TransformPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.transformBody),
  version: z.literal(1),
  body: BodyPreviewSchema,
  topologyRemap: TopologyRemapSchema,
})
const PaintPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.paintBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  faceId: z.string(),
  material: z.record(z.string(), z.unknown()).nullable(),
  materialRef: z.string().optional(),
  topologyRemap: TopologyRemapSchema,
})
const OffsetPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.offsetBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  sourceFaceId: z.string(),
  createdFaceId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const SweepPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.sweepBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  sourceFaceId: z.string(),
  closed: z.boolean(),
  movedFaceId: z.string().nullable(),
  createdFaceIds: z.array(z.string()),
  topologyRemap: TopologyRemapSchema,
})

export const ModelingPreviewSchema = z.discriminatedUnion('operation', [
  PushPullPreviewSchema,
  ImprintPreviewSchema,
  TransformPreviewSchema,
  PaintPreviewSchema,
  OffsetPreviewSchema,
  SweepPreviewSchema,
])

export const modelingOperationToolInput = {
  operationId: ModelingOperationIdSchema,
  nodeId: NodeIdSchema,
  input: z.record(z.string(), z.unknown()),
}

export type ModelingDiagnostic = z.infer<typeof ModelingDiagnosticSchema>
export type ModelingPreview = z.infer<typeof ModelingPreviewSchema>

export const PreflightModelingOperationPayloadSchema = z.object({
  valid: z.boolean(),
  operationId: ModelingOperationIdSchema,
  operationVersion: z.number(),
  manifestVersion: z.number(),
  nodeId: z.string(),
  affectedNodeIds: z.array(z.string()),
  diagnostics: z.array(ModelingDiagnosticSchema),
  preview: ModelingPreviewSchema.nullable(),
})
export type PreflightPayload = z.infer<typeof PreflightModelingOperationPayloadSchema>

export const CommitModelingOperationPayloadSchema = z.object({
  success: z.boolean(),
  operationId: ModelingOperationIdSchema,
  operationVersion: z.number(),
  manifestVersion: z.number(),
  nodeId: z.string(),
  affectedNodeIds: z.array(z.string()),
  diagnostics: z.array(ModelingDiagnosticSchema),
  result: ModelingPreviewSchema.nullable(),
  historySteps: z.number().int().nonnegative(),
})
export type CommitPayload = z.infer<typeof CommitModelingOperationPayloadSchema>

export function toModelingPreview(result: ModelingOperationResult): ModelingPreview {
  return ModelingPreviewSchema.parse(result)
}

export function toolResult<T extends object>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}
