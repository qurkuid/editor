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
      movedFaceId: z.string().nullable(),
      createdFaceIds: z.array(z.string()),
      topologyRemap: TopologyRemapSchema,
      throughCut: z.literal(true).optional(),
      blockingDistance: z.number().optional(),
    })
    .nullable(),
  topologyRemap: TopologyRemapSchema,
})
const SplitBodyFacePreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.splitBodyFace),
  version: z.literal(1),
  body: BodyPreviewSchema,
  splitFaceId: z.string(),
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
const ArrayBodyLinearPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.arrayBodyLinear),
  version: z.literal(1),
  body: BodyPreviewSchema,
  clones: z.array(BodyPreviewSchema),
  topologyRemap: TopologyRemapSchema,
})
const ArrayBodyCircularPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.arrayBodyCircular),
  version: z.literal(1),
  body: BodyPreviewSchema,
  clones: z.array(BodyPreviewSchema),
  topologyRemap: TopologyRemapSchema,
})
const IntersectBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.intersectBodies),
  version: z.literal(1),
  body: BodyPreviewSchema,
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const UnionBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.unionBodies),
  version: z.literal(1),
  body: BodyPreviewSchema,
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const SubtractBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.subtractBodies),
  version: z.literal(1),
  body: BodyPreviewSchema,
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const OuterShellBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.outerShellBodies),
  version: z.literal(1),
  body: BodyPreviewSchema,
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const TrimBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.trimBodies),
  version: z.literal(1),
  body: BodyPreviewSchema,
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
})
const SplitBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.splitBodies),
  version: z.literal(1),
  toolBodyId: z.string(),
  topologyRemap: TopologyRemapSchema,
  pieces: z.array(
    z.object({
      kind: z.enum(['target-only', 'intersection', 'tool-only']),
      body: BodyPreviewSchema,
      topologyRemap: TopologyRemapSchema,
    }),
  ),
})
const BodyContainerWritePreviewSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
})
const GroupBodiesPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.groupBodies),
  version: z.literal(1),
  container: BodyPreviewSchema,
  bodyUpdates: z.array(BodyContainerWritePreviewSchema),
})
const CreateComponentPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.createComponent),
  version: z.literal(1),
  container: BodyPreviewSchema,
  bodyUpdates: z.array(BodyContainerWritePreviewSchema),
  createdNodes: z.array(BodyPreviewSchema).optional(),
})
const MakeComponentUniquePreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.makeComponentUnique),
  version: z.literal(1),
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
})
const ExplodeComponentPreviewSchema = z.object({
  operation: z.literal(MODELING_OPERATION_IDS.explodeComponent),
  version: z.literal(1),
  componentId: z.string(),
  bodyUpdates: z.array(BodyContainerWritePreviewSchema),
})

export const ModelingPreviewSchema = z.discriminatedUnion('operation', [
  PushPullPreviewSchema,
  ImprintPreviewSchema,
  SplitBodyFacePreviewSchema,
  TransformPreviewSchema,
  PaintPreviewSchema,
  OffsetPreviewSchema,
  SweepPreviewSchema,
  ArrayBodyLinearPreviewSchema,
  ArrayBodyCircularPreviewSchema,
  UnionBodiesPreviewSchema,
  SubtractBodiesPreviewSchema,
  IntersectBodiesPreviewSchema,
  OuterShellBodiesPreviewSchema,
  TrimBodiesPreviewSchema,
  SplitBodiesPreviewSchema,
  GroupBodiesPreviewSchema,
  CreateComponentPreviewSchema,
  MakeComponentUniquePreviewSchema,
  ExplodeComponentPreviewSchema,
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
