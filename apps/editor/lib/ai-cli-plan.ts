import {
  ImprintBodyFaceInputSchema,
  MODELING_OPERATION_ID_VALUES,
  OffsetBodyFaceInputSchema,
  PaintBodyFaceInputSchema,
  PushPullBodyFaceInputSchema,
  SweepBodyFaceInputSchema,
  TransformBodyInputSchema,
} from '@pascal-app/core/modeling-operations'
import { MaterialSchema, SceneMaterial } from '@pascal-app/core/schema'
import { z } from 'zod'
import { type AiModelingPlan, AiModelingPlanSchema } from './ai-contract'

export const CodexCliPatchSchema = z
  .object({
    op: z.enum([
      'create',
      'update',
      'delete',
      ...MODELING_OPERATION_ID_VALUES,
      'makeMaterialSeamless',
      'createRoundedRectangularFrameBody',
      'createFurniture',
      'setFurnitureTierInterior',
      'insertFurnitureBay',
      'deleteFurnitureBay',
      'resizeFurnitureBay',
      'insertFurnitureTier',
      'deleteFurnitureTier',
      'resizeFurnitureTier',
    ]),
    // `.default(null)` accepts patches that omit inapplicable fields entirely —
    // Claude's lean output schema only requires `op`.
    id: z.string().nullable().default(null),
    nodeJson: z.string().nullable().default(null),
    dataJson: z.string().nullable().default(null),
    parentId: z.string().nullable().default(null),
    cascade: z.boolean().nullable().default(null),
    faceId: z.string().nullable().default(null),
    profilePoints: z
      .array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]))
      .nullable()
      .default(null),
    pathPoints: z
      .array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]))
      .nullable()
      .default(null),
    distance: z.number().finite().nullable().default(null),
    translation: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .default(null),
    rotationAxis: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .default(null),
    rotationAngle: z.number().finite().nullable().default(null),
    scale: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .default(null),
    pivot: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((patch, context) => {
    if (patch.op !== 'offsetBodyFace') return
    for (const [field, value] of Object.entries(patch)) {
      if (['op', 'id', 'faceId', 'distance'].includes(field) || value === null) continue
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `Expected ${field} to be null for offsetBodyFace`,
      })
    }
  })

export const CodexCliPlanSchema = z.object({
  message: z.string().min(1),
  patches: z.array(CodexCliPatchSchema).max(100),
})

const FlatSceneMaterialSchema = MaterialSchema.extend({ id: z.string().startsWith('mat_') })

function parseJsonRecord(value: string | null): Record<string, unknown> {
  const json = z.string().parse(value)
  const decoded: unknown = JSON.parse(json)
  return z.record(z.string(), z.unknown()).parse(decoded)
}

export function parseCodexCliPlan(input: unknown): AiModelingPlan {
  const parsed = CodexCliPlanSchema.parse(input)
  const patches = parsed.patches.map((patch) => {
    switch (patch.op) {
      case 'create':
        return {
          op: patch.op,
          node: parseJsonRecord(patch.nodeJson),
          ...(patch.parentId === null ? {} : { parentId: patch.parentId }),
        }
      case 'update': {
        // Models regularly answer an update with the whole node echoed into
        // nodeJson instead of a dataJson diff. Accept either field, minus the
        // identity keys an update must never change.
        const {
          object: _object,
          id: _id,
          type: _type,
          ...data
        } = parseJsonRecord(patch.dataJson ?? patch.nodeJson)
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          data,
        }
      }
      case 'delete':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...(patch.cascade === null ? {} : { cascade: patch.cascade }),
        }
      case 'pushPullBodyFace':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...PushPullBodyFaceInputSchema.parse({
            faceId: patch.faceId,
            distance: patch.distance,
          }),
        }
      case 'offsetBodyFace':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...OffsetBodyFaceInputSchema.parse({
            faceId: patch.faceId,
            distance: patch.distance,
          }),
        }
      case 'sweepBodyFace':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...SweepBodyFaceInputSchema.parse({
            faceId: patch.faceId,
            pathPoints: patch.pathPoints,
          }),
        }
      case 'imprintBodyFace':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...ImprintBodyFaceInputSchema.parse({
            faceId: patch.faceId,
            profilePoints: patch.profilePoints,
            ...(patch.distance === null ? {} : { distance: patch.distance }),
          }),
        }
      case 'transformBody':
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...TransformBodyInputSchema.parse({
            translation: patch.translation,
            rotationAxis: patch.rotationAxis,
            rotationAngle: patch.rotationAngle,
            scale: patch.scale,
            pivot: patch.pivot,
          }),
        }
      case 'paintBodyFace': {
        const materialRecord = parseJsonRecord(patch.dataJson)
        const completeMaterial = SceneMaterial.safeParse(materialRecord)
        const material = completeMaterial.success
          ? completeMaterial.data
          : FlatSceneMaterialSchema.transform(({ id, ...flatMaterial }) => ({
              id,
              name: `AI material ${id}`,
              material: flatMaterial,
            })).parse(materialRecord)
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...PaintBodyFaceInputSchema.parse({ faceId: patch.faceId, material }),
        }
      }
      case 'makeMaterialSeamless': {
        const data = z
          .object({ materialId: z.string().startsWith('mat_') })
          .parse(parseJsonRecord(patch.dataJson))
        return { op: patch.op, materialId: data.materialId }
      }
      case 'createRoundedRectangularFrameBody': {
        const data = z
          .object({
            name: z.string().trim().min(1).optional(),
            origin: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
            depth: z.number().finite().positive(),
            openingWidth: z.number().finite().positive(),
            openingHeight: z.number().finite().positive(),
            topCornerRadius: z.number().finite().nonnegative(),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return {
          op: patch.op,
          ...(patch.id === null ? {} : { id: z.string().min(1).parse(patch.id) }),
          ...(patch.parentId === null ? {} : { parentId: patch.parentId }),
          ...data,
        }
      }
      case 'createFurniture': {
        const data = z
          .object({
            name: z.string().trim().min(1).optional(),
            position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
            rotationY: z.number().finite().default(0),
            furnitureKind: z
              .enum(['wardrobe', 'base-run', 'upper-run', 'tall', 'island', 'set', 'sink'])
              .default('wardrobe'),
            dimensions: z.object({
              width: z.number().finite().positive(),
              height: z.number().finite().positive(),
              depth: z.number().finite().positive(),
            }),
            bayCount: z.number().int().min(1).max(100).default(1),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return {
          op: patch.op,
          ...(patch.id === null ? {} : { id: z.string().min(1).parse(patch.id) }),
          ...(patch.parentId === null ? {} : { parentId: patch.parentId }),
          ...data,
        }
      }
      case 'setFurnitureTierInterior': {
        const data = z
          .object({
            bayId: z.string().trim().min(1),
            tierId: z.string().trim().min(1),
            shelfCount: z.number().int().min(0).max(8),
            hanger: z.boolean(),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return {
          op: patch.op,
          id: z.string().min(1).parse(patch.id),
          ...data,
        }
      }
      case 'insertFurnitureBay': {
        const data = z
          .object({
            afterBayId: z.string().trim().min(1),
            newWidth: z.number().finite().positive().optional(),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return { op: patch.op, id: z.string().min(1).parse(patch.id), ...data }
      }
      case 'deleteFurnitureBay':
      case 'resizeFurnitureBay': {
        const data = z
          .object({
            bayId: z.string().trim().min(1),
            ...(patch.op === 'resizeFurnitureBay' ? { width: z.number().finite().positive() } : {}),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return { op: patch.op, id: z.string().min(1).parse(patch.id), ...data }
      }
      case 'insertFurnitureTier': {
        const data = z
          .object({
            bayId: z.string().trim().min(1),
            afterTierId: z.string().trim().min(1),
            newHeight: z.number().finite().positive().optional(),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return { op: patch.op, id: z.string().min(1).parse(patch.id), ...data }
      }
      case 'deleteFurnitureTier':
      case 'resizeFurnitureTier': {
        const data = z
          .object({
            bayId: z.string().trim().min(1),
            tierId: z.string().trim().min(1),
            ...(patch.op === 'resizeFurnitureTier'
              ? { height: z.number().finite().positive() }
              : {}),
          })
          .parse(parseJsonRecord(patch.dataJson))
        return { op: patch.op, id: z.string().min(1).parse(patch.id), ...data }
      }
      default: {
        const unreachable: never = patch.op
        throw new RangeError(`Unsupported CLI patch operation: ${unreachable}`)
      }
    }
  })
  return AiModelingPlanSchema.parse({ message: parsed.message, patches })
}
