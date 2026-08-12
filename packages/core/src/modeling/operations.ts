import { z } from 'zod'
import { SceneMaterial } from '../schema/scene-material'
import type { AnyNodeType } from '../schema/types'

export const MODELING_OPERATION_IDS = {
  pushPullBodyFace: 'pushPullBodyFace',
  imprintBodyFace: 'imprintBodyFace',
  splitBodyFace: 'splitBodyFace',
  transformBody: 'transformBody',
  paintBodyFace: 'paintBodyFace',
  offsetBodyFace: 'offsetBodyFace',
  sweepBodyFace: 'sweepBodyFace',
  arrayBodyLinear: 'arrayBodyLinear',
  arrayBodyCircular: 'arrayBodyCircular',
  unionBodies: 'unionBodies',
  subtractBodies: 'subtractBodies',
  intersectBodies: 'intersectBodies',
  outerShellBodies: 'outerShellBodies',
  trimBodies: 'trimBodies',
  splitBodies: 'splitBodies',
  groupBodies: 'groupBodies',
  createComponent: 'createComponent',
  makeComponentUnique: 'makeComponentUnique',
  explodeComponent: 'explodeComponent',
} as const

export const MODELING_OPERATION_ID_VALUES = [
  MODELING_OPERATION_IDS.pushPullBodyFace,
  MODELING_OPERATION_IDS.imprintBodyFace,
  MODELING_OPERATION_IDS.splitBodyFace,
  MODELING_OPERATION_IDS.transformBody,
  MODELING_OPERATION_IDS.paintBodyFace,
  MODELING_OPERATION_IDS.offsetBodyFace,
  MODELING_OPERATION_IDS.sweepBodyFace,
  MODELING_OPERATION_IDS.arrayBodyLinear,
  MODELING_OPERATION_IDS.arrayBodyCircular,
  MODELING_OPERATION_IDS.unionBodies,
  MODELING_OPERATION_IDS.subtractBodies,
  MODELING_OPERATION_IDS.intersectBodies,
  MODELING_OPERATION_IDS.outerShellBodies,
  MODELING_OPERATION_IDS.trimBodies,
  MODELING_OPERATION_IDS.splitBodies,
  MODELING_OPERATION_IDS.groupBodies,
  MODELING_OPERATION_IDS.createComponent,
  MODELING_OPERATION_IDS.makeComponentUnique,
  MODELING_OPERATION_IDS.explodeComponent,
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
const BodyFeatureTransformSchema = z
  .object({
    kind: z.enum(['vertex', 'edge', 'face']),
    featureId: z.string().trim().min(1),
    autofold: z.boolean().optional(),
  })
  .strict()

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

export const SplitBodyFaceInputSchema = z
  .object({
    faceId: z.string().trim().min(1),
    pathPoints: z.array(Point3Schema).min(2).max(256),
  })
  .strict()

export type SplitBodyFaceInput = z.infer<typeof SplitBodyFaceInputSchema>

export const ArrayBodyLinearInputSchema = z
  .object({
    count: z.number().int().min(2).max(100),
    offset: Point3Schema,
  })
  .strict()

export type ArrayBodyLinearInput = z.infer<typeof ArrayBodyLinearInputSchema>

export const ArrayBodyCircularInputSchema = z
  .object({
    count: z.number().int().min(2).max(100),
    center: Point3Schema,
    axis: NonZeroPoint3Schema,
    angle: z.number().finite().optional(),
    fullCircle: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.fullCircle === true || input.angle !== undefined, {
    message: 'Expected angle unless fullCircle is enabled',
    path: ['angle'],
  })

export type ArrayBodyCircularInput = z.infer<typeof ArrayBodyCircularInputSchema>

export const BooleanBodiesInputSchema = z
  .object({
    toolBodyId: z.string().trim().min(1),
  })
  .strict()

export type BooleanBodiesInput = z.infer<typeof BooleanBodiesInputSchema>
export const UnionBodiesInputSchema = BooleanBodiesInputSchema
export const SubtractBodiesInputSchema = BooleanBodiesInputSchema
export const IntersectBodiesInputSchema = BooleanBodiesInputSchema
export const OuterShellBodiesInputSchema = BooleanBodiesInputSchema
export const TrimBodiesInputSchema = BooleanBodiesInputSchema
export const SplitBodiesInputSchema = BooleanBodiesInputSchema
export type UnionBodiesInput = BooleanBodiesInput
export type SubtractBodiesInput = BooleanBodiesInput
export type IntersectBodiesInput = BooleanBodiesInput
export type OuterShellBodiesInput = BooleanBodiesInput
export type TrimBodiesInput = BooleanBodiesInput
export type SplitBodiesInput = BooleanBodiesInput

export const GroupBodiesInputSchema = z
  .object({ bodyIds: z.array(z.string().trim().min(1)).min(2) })
  .strict()

export type GroupBodiesInput = z.infer<typeof GroupBodiesInputSchema>

export const CreateComponentInputSchema = z
  .object({
    bodyIds: z.array(z.string().trim().min(1)).min(1).optional(),
    sourceComponentId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((input) => (input.bodyIds ? 1 : 0) + (input.sourceComponentId ? 1 : 0) === 1, {
    message: 'Provide bodyIds or sourceComponentId',
  })

export type CreateComponentInput = z.infer<typeof CreateComponentInputSchema>

export const MakeComponentUniqueInputSchema = z.object({}).strict()
export type MakeComponentUniqueInput = z.infer<typeof MakeComponentUniqueInputSchema>

export const ExplodeComponentInputSchema = z.object({}).strict()
export type ExplodeComponentInput = z.infer<typeof ExplodeComponentInputSchema>

export const TransformBodyInputSchema = z
  .object({
    translation: Point3Schema,
    rotationAxis: NonZeroPoint3Schema,
    rotationAngle: z.number().finite(),
    scale: PositiveScaleSchema,
    pivot: Point3Schema,
    feature: BodyFeatureTransformSchema.nullable().optional(),
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
  [MODELING_OPERATION_IDS.splitBodyFace]: SplitBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.transformBody]: TransformBodyInputSchema,
  [MODELING_OPERATION_IDS.paintBodyFace]: PaintBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.offsetBodyFace]: OffsetBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.sweepBodyFace]: SweepBodyFaceInputSchema,
  [MODELING_OPERATION_IDS.arrayBodyLinear]: ArrayBodyLinearInputSchema,
  [MODELING_OPERATION_IDS.arrayBodyCircular]: ArrayBodyCircularInputSchema,
  [MODELING_OPERATION_IDS.unionBodies]: UnionBodiesInputSchema,
  [MODELING_OPERATION_IDS.subtractBodies]: SubtractBodiesInputSchema,
  [MODELING_OPERATION_IDS.intersectBodies]: IntersectBodiesInputSchema,
  [MODELING_OPERATION_IDS.outerShellBodies]: OuterShellBodiesInputSchema,
  [MODELING_OPERATION_IDS.trimBodies]: TrimBodiesInputSchema,
  [MODELING_OPERATION_IDS.splitBodies]: SplitBodiesInputSchema,
  [MODELING_OPERATION_IDS.groupBodies]: GroupBodiesInputSchema,
  [MODELING_OPERATION_IDS.createComponent]: CreateComponentInputSchema,
  [MODELING_OPERATION_IDS.makeComponentUnique]: MakeComponentUniqueInputSchema,
  [MODELING_OPERATION_IDS.explodeComponent]: ExplodeComponentInputSchema,
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
      readonly operationId: typeof MODELING_OPERATION_IDS.splitBodyFace
      readonly input: SplitBodyFaceInput
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
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.arrayBodyLinear
      readonly input: ArrayBodyLinearInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.arrayBodyCircular
      readonly input: ArrayBodyCircularInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.unionBodies
      readonly input: UnionBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.subtractBodies
      readonly input: SubtractBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.intersectBodies
      readonly input: IntersectBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.outerShellBodies
      readonly input: OuterShellBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.trimBodies
      readonly input: TrimBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.splitBodies
      readonly input: SplitBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.groupBodies
      readonly input: GroupBodiesInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.createComponent
      readonly input: CreateComponentInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.makeComponentUnique
      readonly input: MakeComponentUniqueInput
    }
  | {
      readonly operationId: typeof MODELING_OPERATION_IDS.explodeComponent
      readonly input: ExplodeComponentInput
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
  readonly type:
    | 'angle'
    | 'boolean'
    | 'count'
    | 'feature-id'
    | 'feature-transform'
    | 'length'
    | 'material'
    | 'point3'
    | 'scale'
  readonly required: boolean
  readonly canonicalUnit?: 'm' | 'rad'
  readonly nonZero?: boolean
}

export type ModelingOperationManifestEntry = {
  readonly id: ModelingOperationId
  readonly version: 1
  readonly targetNodeTypes: readonly AnyNodeType[]
  readonly targetFeatures: readonly ('body' | 'vertex' | 'edge' | 'face' | 'body-container')[]
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
      id: MODELING_OPERATION_IDS.splitBodyFace,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.splitBodyFace,
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
    {
      id: MODELING_OPERATION_IDS.transformBody,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body', 'vertex', 'edge', 'face'],
      inputSchema: MODELING_OPERATION_IDS.transformBody,
      input: {
        fields: {
          translation: { type: 'point3', required: true, canonicalUnit: 'm' },
          rotationAxis: { type: 'point3', required: true },
          rotationAngle: { type: 'angle', required: true, canonicalUnit: 'rad' },
          scale: { type: 'scale', required: true },
          pivot: { type: 'point3', required: true, canonicalUnit: 'm' },
          feature: { type: 'feature-transform', required: false },
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
      id: MODELING_OPERATION_IDS.arrayBodyLinear,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.arrayBodyLinear,
      input: {
        fields: {
          count: { type: 'count', required: true },
          offset: { type: 'point3', required: true, canonicalUnit: 'm' },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.arrayBodyCircular,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.arrayBodyCircular,
      input: {
        fields: {
          count: { type: 'count', required: true },
          center: { type: 'point3', required: true, canonicalUnit: 'm' },
          axis: { type: 'point3', required: true },
          angle: { type: 'angle', required: false, canonicalUnit: 'rad' },
          fullCircle: { type: 'boolean', required: false },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.unionBodies,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.unionBodies,
      input: { fields: { toolBodyId: { type: 'feature-id', required: true } } },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.subtractBodies,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.subtractBodies,
      input: { fields: { toolBodyId: { type: 'feature-id', required: true } } },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.intersectBodies,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body'],
      inputSchema: MODELING_OPERATION_IDS.intersectBodies,
      input: {
        fields: {
          toolBodyId: { type: 'feature-id', required: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    ...[
      MODELING_OPERATION_IDS.outerShellBodies,
      MODELING_OPERATION_IDS.trimBodies,
      MODELING_OPERATION_IDS.splitBodies,
    ].map((id) => ({
      id,
      version: 1 as const,
      targetNodeTypes: ['body'] as const,
      targetFeatures: ['body'] as const,
      inputSchema: id,
      input: { fields: { toolBodyId: { type: 'feature-id' as const, required: true } } },
      preview: { available: true as const, mutatesScene: false as const },
      commit: { available: true as const, undo: 'single' as const },
      surfaces: {
        direct: ['2d', '3d'] as const,
        internalAi: true as const,
        mcp: true as const,
      },
    })),
    {
      id: MODELING_OPERATION_IDS.groupBodies,
      version: 1,
      targetNodeTypes: ['body'],
      targetFeatures: ['body-container'],
      inputSchema: MODELING_OPERATION_IDS.groupBodies,
      input: { fields: { bodyIds: { type: 'feature-id', required: true } } },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.createComponent,
      version: 1,
      targetNodeTypes: ['body', 'component'],
      targetFeatures: ['body-container'],
      inputSchema: MODELING_OPERATION_IDS.createComponent,
      input: {
        fields: {
          bodyIds: { type: 'feature-id', required: false },
          sourceComponentId: { type: 'feature-id', required: false },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.makeComponentUnique,
      version: 1,
      targetNodeTypes: ['component'],
      targetFeatures: ['body-container'],
      inputSchema: MODELING_OPERATION_IDS.makeComponentUnique,
      input: { fields: {} },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
    },
    {
      id: MODELING_OPERATION_IDS.explodeComponent,
      version: 1,
      targetNodeTypes: ['component'],
      targetFeatures: ['body-container'],
      inputSchema: MODELING_OPERATION_IDS.explodeComponent,
      input: { fields: {} },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['2d', '3d'], internalAi: true, mcp: true },
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
  ArrayBodyCircularOperationResult,
  ArrayBodyLinearOperationResult,
  CreateComponentOperationResult,
  ExplodeComponentOperationResult,
  GroupBodiesOperationResult,
  ImprintBodyFaceOperationResult,
  IntersectBodiesOperationResult,
  MakeComponentUniqueOperationResult,
  ModelingOperationResult,
  OffsetBodyFaceOperationResult,
  OuterShellBodiesOperationResult,
  PaintBodyFaceOperationResult,
  PushPullBodyFaceOperationResult,
  SplitBodiesOperationResult,
  SplitBodyFaceOperationResult,
  SubtractBodiesOperationResult,
  SweepBodyFaceOperationResult,
  TransformBodyOperationResult,
  TrimBodiesOperationResult,
  UnionBodiesOperationResult,
} from './executors'
export {
  executeArrayBodyCircular,
  executeArrayBodyLinear,
  executeBodyContainerOperation,
  executeImprintBodyFace,
  executeIntersectBodies,
  executeModelingOperation,
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
} from './executors'
