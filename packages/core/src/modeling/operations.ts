import { z } from 'zod'
import { SceneMaterial } from '../schema/scene-material'

export const MODELING_OPERATION_IDS = {
  pushPullBodyFace: 'pushPullBodyFace',
  imprintBodyFace: 'imprintBodyFace',
  transformBody: 'transformBody',
  paintBodyFace: 'paintBodyFace',
  offsetBodyFace: 'offsetBodyFace',
  sweepBodyFace: 'sweepBodyFace',
} as const

export const MODELING_OPERATION_ID_VALUES = [
  MODELING_OPERATION_IDS.pushPullBodyFace,
  MODELING_OPERATION_IDS.imprintBodyFace,
  MODELING_OPERATION_IDS.transformBody,
  MODELING_OPERATION_IDS.paintBodyFace,
  MODELING_OPERATION_IDS.offsetBodyFace,
  MODELING_OPERATION_IDS.sweepBodyFace,
] as const

export type ModelingOperationId = (typeof MODELING_OPERATION_ID_VALUES)[number]

export const ModelingOperationIdSchema = z.enum(MODELING_OPERATION_ID_VALUES)

const Point3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const NonZeroPoint3Schema = Point3Schema.refine(
  (point) => Math.hypot(...point) > Number.EPSILON,
  'Expected a non-zero axis',
)
const PositiveScaleSchema = Point3Schema.refine(
  (scale) => scale.every((value) => value > 0),
  'Expected strictly positive scale components',
)

export const PushPullBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    distance: z
      .number()
      .finite()
      .refine((value) => value !== 0, 'Expected a non-zero distance'),
  })
  .strict()

export type PushPullBodyFaceInput = z.infer<typeof PushPullBodyFaceInputSchema>

export const OffsetBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    distance: z
      .number()
      .finite()
      .refine((value) => value !== 0, 'Expected a non-zero distance'),
  })
  .strict()

export type OffsetBodyFaceInput = z.infer<typeof OffsetBodyFaceInputSchema>

export const SweepBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    pathPoints: z.array(Point3Schema).min(2).max(256),
  })
  .strict()

export type SweepBodyFaceInput = z.infer<typeof SweepBodyFaceInputSchema>

export const ImprintBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    profilePoints: z.array(Point3Schema).min(3).max(512),
    distance: z
      .number()
      .finite()
      .refine((value) => value !== 0, 'Expected a non-zero distance')
      .optional(),
  })
  .strict()

export type ImprintBodyFaceInput = z.infer<typeof ImprintBodyFaceInputSchema>

export const TransformBodyInputSchema = z
  .object({
    translation: Point3Schema,
    rotationAxis: NonZeroPoint3Schema,
    rotationAngle: z.number().finite(),
    scale: PositiveScaleSchema,
    pivot: Point3Schema,
  })
  .strict()

export type TransformBodyInput = z.infer<typeof TransformBodyInputSchema>

export const PaintBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    material: SceneMaterial,
  })
  .strict()

export type PaintBodyFaceInput = z.infer<typeof PaintBodyFaceInputSchema>
export type PaintBodyFaceExecutionInput = {
  readonly faceId: string
  readonly material?: PaintBodyFaceInput['material'] | string
}

export const MODELING_OPERATION_INPUT_SCHEMAS = {
  [MODELING_OPERATION_IDS.pushPullBodyFace]: PushPullBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.imprintBodyFace]: ImprintBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.transformBody]: TransformBodyInputSchema,
  [MODELING_OPERATION_IDS.paintBodyFace]: PaintBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.offsetBodyFace]: OffsetBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.sweepBodyFace]: SweepBodyFaceInputSchema,
} as const

export function parseModelingOperationRequest(
  operationId: ModelingOperationId,
  input: unknown,
): ModelingOperationRequest {
  const parsed = MODELING_OPERATION_INPUT_SCHEMAS[operationId].parse(input)
  return { operationId, input: parsed } as ModelingOperationRequest
}

export type ModelingOperationInputById = {
  [K in ModelingOperationId]: z.infer<(typeof MODELING_OPERATION_INPUT_SCHEMAS)[K]>
}

export type ModelingOperationInput = ModelingOperationInputById[ModelingOperationId]

export type ModelingOperationRequest =
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.pushPullBodyFace
      readonly input: PushPullBodyFaceInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.imprintBodyFace
      readonly input: ImprintBodyFaceInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.transformBody
      readonly input: TransformBodyInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.paintBodyFace
      readonly input: PaintBodyFaceInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.offsetBodyFace
      readonly input: OffsetBodyFaceInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.sweepBodyFace
      readonly input: SweepBodyFaceInput
    }

export type ModelingOperationSurface = '2d' | '3d'

export type ModelingOperationInteractionContract = {
  readonly snap: {
    readonly tiers: readonly ['endpoint', 'midpoint', 'edge', 'face']
    readonly markerTokenPrefix: 'manipulation-snap:'
  }
  readonly modifiers: {
    readonly shift: 'cycle-context'
    readonly alt: 'raw-bypass'
  }
  readonly typedInput: true
  readonly commit: readonly ['click', 'enter']
  readonly cancel: 'escape'
  readonly previewEqualsCommit: true
  readonly cancelImmutable: true
  readonly history: 'single-undo'
  readonly serialization: 'round-trip'
}

export type ModelingOperationField = {
  readonly type: 'angle' | 'feature-id' | 'length' | 'material' | 'point3' | 'scale'
  readonly required: boolean
  readonly canonicalUnit?: 'm' | 'rad'
  readonly nonZero?: boolean
}

export type ModelingOperationManifestEntry = {
  readonly id: ModelingOperationId
  readonly version: 1
  readonly targetNodeTypes: readonly ['body']
  readonly targetFeatures: readonly ('body' | 'face')[]
  readonly inputSchema: ModelingOperationId
  readonly input: {
    readonly fields: Readonly<Record<string, ModelingOperationField>>
  }
  readonly preview: {
    readonly available: true
    readonly mutatesScene: false
  }
  readonly commit: {
    readonly available: true
    readonly undo: 'single'
  }
  readonly surfaces: {
    readonly direct: readonly ModelingOperationSurface[]
    readonly internalAi: true
    readonly mcp: true
  }
  readonly interaction?: ModelingOperationInteractionContract
}

export type ModelingOperationManifest = {
  readonly version: 1
  readonly operations: readonly ModelingOperationManifestEntry[]
}

export const MODELING_OPERATION_MANIFEST = {
  version: 1,
  operations: [
    {
      id: MODELING_OPERATION_IDS.pushPullBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.pushPullBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          distance: { type: 'length', required: true, canonicalUnit: 'm', nonZero: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['3d'], internalAi: true, mcp: true },
      interaction: {
        snap: {
          tiers: ['endpoint', 'midpoint', 'edge', 'face'],
          markerTokenPrefix: 'manipulation-snap:',
        },
        modifiers: { shift: 'cycle-context', alt: 'raw-bypass' },
        typedInput: true,
        commit: ['click', 'enter'],
        cancel: 'escape',
        previewEqualsCommit: true,
        cancelImmutable: true,
        history: 'single-undo',
        serialization: 'round-trip',
      },
    },
    {
      id: MODELING_OPERATION_IDS.imprintBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.imprintBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          profilePoints: { type: 'point3', required: true, canonicalUnit: 'm' },
          distance: { type: 'length', required: false, canonicalUnit: 'm', nonZero: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.transformBody,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.transformBody,
      input: {
        fields: {
          translation: { type: 'point3', required: true, canonicalUnit: 'm' },
          rotationAxis: { type: 'point3', required: true },
          rotationAngle: { type: 'angle', required: true, canonicalUnit: 'rad' },
          scale: { type: 'scale', required: true },
          pivot: { type: 'point3', required: true, canonicalUnit: 'm' },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
      interaction: {
        snap: {
          tiers: ['endpoint', 'midpoint', 'edge', 'face'],
          markerTokenPrefix: 'manipulation-snap:',
        },
        modifiers: { shift: 'cycle-context', alt: 'raw-bypass' },
        typedInput: true,
        commit: ['click', 'enter'],
        cancel: 'escape',
        previewEqualsCommit: true,
        cancelImmutable: true,
        history: 'single-undo',
        serialization: 'round-trip',
      },
    },
    {
      id: MODELING_OPERATION_IDS.paintBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.paintBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          material: { type: 'material', required: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.offsetBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.offsetBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          distance: { type: 'length', required: true, canonicalUnit: 'm', nonZero: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['3d'], internalAi: true, mcp: true },
      interaction: {
        snap: {
          tiers: ['endpoint', 'midpoint', 'edge', 'face'],
          markerTokenPrefix: 'manipulation-snap:',
        },
        modifiers: { shift: 'cycle-context', alt: 'raw-bypass' },
        typedInput: true,
        commit: ['click', 'enter'],
        cancel: 'escape',
        previewEqualsCommit: true,
        cancelImmutable: true,
        history: 'single-undo',
        serialization: 'round-trip',
      },
    },
    {
      id: MODELING_OPERATION_IDS.sweepBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.sweepBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          pathPoints: { type: 'point3', required: true, canonicalUnit: 'm' },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['3d'], internalAi: true, mcp: true },
      interaction: {
        snap: {
          tiers: ['endpoint', 'midpoint', 'edge', 'face'],
          markerTokenPrefix: 'manipulation-snap:',
        },
        modifiers: { shift: 'cycle-context', alt: 'raw-bypass' },
        typedInput: true,
        commit: ['click', 'enter'],
        cancel: 'escape',
        previewEqualsCommit: true,
        cancelImmutable: true,
        history: 'single-undo',
        serialization: 'round-trip',
      },
    },
  ],
} as const satisfies ModelingOperationManifest

export function getModelingOperationManifestEntry(
  operationId: ModelingOperationId,
): ModelingOperationManifestEntry {
  const operation = MODELING_OPERATION_MANIFEST.operations.find(
    (candidate) => candidate.id === operationId,
  )
  if (!operation) {
    throw new RangeError(`Unknown modeling operation: ${operationId}`)
  }
  return operation
}

export type {
  ImprintBodyFaceOperationResult,
  ModelingOperationResult,
  OffsetBodyFaceOperationResult,
  PaintBodyFaceOperationResult,
  PushPullBodyFaceOperationResult,
  SweepBodyFaceOperationResult,
  TransformBodyOperationResult,
} from './executors'
export {
  executeImprintBodyFace,
  executeModelingOperation,
  executeOffsetBodyFace,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  executeTransformBody,
} from './executors'
