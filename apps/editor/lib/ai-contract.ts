import {
  type AnyNodeId,
  FurnitureKindSchema,
  SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core/schema'
import { z } from 'zod'

const AnyNodeIdSchema = z.custom<AnyNodeId>(
  (value) => typeof value === 'string' && value.length > 0,
  'Expected a non-empty node id',
)
const Point3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const SceneMaterialIdSchema = z.custom<SceneMaterialId>(
  (value) => typeof value === 'string' && value.startsWith('mat_'),
  'Expected a scene material id beginning with mat_',
)

const CreatePatchSchema = z.object({
  op: z.literal('create'),
  node: z.record(z.string(), z.unknown()),
  parentId: AnyNodeIdSchema.optional(),
})

const UpdatePatchSchema = z.object({
  op: z.literal('update'),
  id: AnyNodeIdSchema,
  data: z.record(z.string(), z.unknown()),
})

const DeletePatchSchema = z.object({
  op: z.literal('delete'),
  id: AnyNodeIdSchema,
  cascade: z.boolean().optional(),
})

const PushPullBodyFacePatchSchema = z.object({
  op: z.literal('pushPullBodyFace'),
  id: AnyNodeIdSchema,
  faceId: z.string().trim().min(1),
  distance: z
    .number()
    .finite()
    .refine((value) => value !== 0, 'Expected a non-zero distance'),
})

const TransformBodyPatchSchema = z.object({
  op: z.literal('transformBody'),
  id: AnyNodeIdSchema,
  translation: Point3Schema,
  rotationY: z.number().finite(),
  uniformScale: z.number().finite().positive(),
  pivot: Point3Schema,
})

const PaintBodyFacePatchSchema = z.object({
  op: z.literal('paintBodyFace'),
  id: AnyNodeIdSchema,
  faceId: z.string().trim().min(1),
  material: SceneMaterial.extend({ id: SceneMaterialIdSchema }),
})

const MakeMaterialSeamlessPatchSchema = z.object({
  op: z.literal('makeMaterialSeamless'),
  materialId: SceneMaterialIdSchema,
})

const UpdateSceneMaterialPatchSchema = z.object({
  op: z.literal('updateSceneMaterial'),
  material: SceneMaterial.extend({ id: SceneMaterialIdSchema }),
})

const CreateRoundedRectangularFrameBodyPatchSchema = z.object({
  op: z.literal('createRoundedRectangularFrameBody'),
  id: AnyNodeIdSchema.optional(),
  parentId: AnyNodeIdSchema.optional(),
  name: z.string().trim().min(1).optional(),
  origin: Point3Schema,
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  depth: z.number().finite().positive(),
  openingWidth: z.number().finite().positive(),
  openingHeight: z.number().finite().positive(),
  topCornerRadius: z.number().finite().nonnegative(),
})

const CreateFurniturePatchSchema = z.object({
  op: z.literal('createFurniture'),
  id: AnyNodeIdSchema.optional(),
  parentId: AnyNodeIdSchema.optional(),
  name: z.string().trim().min(1).optional(),
  position: Point3Schema,
  rotationY: z.number().finite().default(0),
  furnitureKind: FurnitureKindSchema.default('wardrobe'),
  dimensions: z.object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    depth: z.number().finite().positive(),
  }),
  bayCount: z.number().int().min(1).max(100).default(1),
})

export const SetFurnitureTierInteriorPatchSchema = z.object({
  op: z.literal('setFurnitureTierInterior'),
  id: AnyNodeIdSchema,
  bayId: z.string().trim().min(1),
  tierId: z.string().trim().min(1),
  shelfCount: z.number().int().min(0).max(8),
  hanger: z.boolean(),
})

const FurnitureNodeTargetSchema = z.object({ id: AnyNodeIdSchema })
const FurnitureBayTargetSchema = FurnitureNodeTargetSchema.extend({
  bayId: z.string().trim().min(1),
})
const FurnitureTierTargetSchema = FurnitureBayTargetSchema.extend({
  tierId: z.string().trim().min(1),
})

const InsertFurnitureBayPatchSchema = FurnitureNodeTargetSchema.extend({
  op: z.literal('insertFurnitureBay'),
  afterBayId: z.string().trim().min(1),
  newWidth: z.number().finite().positive().optional(),
})
const DeleteFurnitureBayPatchSchema = FurnitureBayTargetSchema.extend({
  op: z.literal('deleteFurnitureBay'),
})
const ResizeFurnitureBayPatchSchema = FurnitureBayTargetSchema.extend({
  op: z.literal('resizeFurnitureBay'),
  width: z.number().finite().positive(),
})
const InsertFurnitureTierPatchSchema = FurnitureBayTargetSchema.extend({
  op: z.literal('insertFurnitureTier'),
  afterTierId: z.string().trim().min(1),
  newHeight: z.number().finite().positive().optional(),
})
const DeleteFurnitureTierPatchSchema = FurnitureTierTargetSchema.extend({
  op: z.literal('deleteFurnitureTier'),
})
const ResizeFurnitureTierPatchSchema = FurnitureTierTargetSchema.extend({
  op: z.literal('resizeFurnitureTier'),
  height: z.number().finite().positive(),
})

export const AiModelingPatchSchema = z.discriminatedUnion('op', [
  CreatePatchSchema,
  UpdatePatchSchema,
  DeletePatchSchema,
  PushPullBodyFacePatchSchema,
  TransformBodyPatchSchema,
  PaintBodyFacePatchSchema,
  MakeMaterialSeamlessPatchSchema,
  UpdateSceneMaterialPatchSchema,
  CreateRoundedRectangularFrameBodyPatchSchema,
  CreateFurniturePatchSchema,
  SetFurnitureTierInteriorPatchSchema,
  InsertFurnitureBayPatchSchema,
  DeleteFurnitureBayPatchSchema,
  ResizeFurnitureBayPatchSchema,
  InsertFurnitureTierPatchSchema,
  DeleteFurnitureTierPatchSchema,
  ResizeFurnitureTierPatchSchema,
])

export const AiModelingPlanSchema = z.object({
  message: z.string().min(1),
  patches: z.array(AiModelingPatchSchema).max(100),
})

export type AiModelingPlan = z.infer<typeof AiModelingPlanSchema>
