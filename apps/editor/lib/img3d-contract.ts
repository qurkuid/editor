import { z } from 'zod'
import { AI_EFFORT_LEVELS } from './ai-model-options'

export const IMG3D_MAX_PARTS = 48
export const IMG3D_MAX_MATERIALS = 16
export const IMG3D_MAX_IMAGE_BYTES = 5 * 1024 * 1024

const IMG3D_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
const MAX_BASE64_IMAGE_LENGTH = Math.ceil(IMG3D_MAX_IMAGE_BYTES / 3) * 4
const Img3dImageSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mimeType: z.enum(IMG3D_IMAGE_MIME_TYPES),
    dataUrl: z
      .string()
      .min(1)
      .max(MAX_BASE64_IMAGE_LENGTH + 32),
  })
  .strict()
  .superRefine((image, context) => {
    const prefix = `data:${image.mimeType};base64,`
    if (!image.dataUrl.startsWith(prefix)) {
      context.addIssue({
        code: 'custom',
        path: ['dataUrl'],
        message: 'Image MIME type must match its data URL.',
      })
      return
    }
    const encoded = image.dataUrl.slice(prefix.length)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      context.addIssue({
        code: 'custom',
        path: ['dataUrl'],
        message: 'Image must be valid base64.',
      })
      return
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
    const decodedBytes = (encoded.length * 3) / 4 - padding
    if (decodedBytes > IMG3D_MAX_IMAGE_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['dataUrl'],
        message: 'Image must be 5 MB or smaller.',
      })
    }
  })
  .readonly()

const metre = z.number().finite().min(0.001).max(100)
const coordinate = z.number().finite().min(-100).max(100)
const angle = z
  .number()
  .finite()
  .min(-Math.PI * 2)
  .max(Math.PI * 2)
const vector3 = z.tuple([coordinate, coordinate, coordinate])
const rotation3 = z.tuple([angle, angle, angle])
const partBase = {
  name: z.string().trim().min(1).max(64),
  material: z
    .number()
    .int()
    .min(0)
    .max(IMG3D_MAX_MATERIALS - 1),
  position: vector3,
  rotation: rotation3,
}

const BoxPartSchema = z
  .object({
    ...partBase,
    primitive: z.literal('box'),
    size: z.tuple([metre, metre, metre]),
  })
  .strict()
  .readonly()

const SpherePartSchema = z
  .object({
    ...partBase,
    primitive: z.literal('sphere'),
    radius: metre,
    widthSegments: z.number().int().min(8).max(48),
    heightSegments: z.number().int().min(4).max(24),
  })
  .strict()
  .readonly()

const CylinderPartSchema = z
  .object({
    ...partBase,
    primitive: z.literal('cylinder'),
    radius: metre,
    height: metre,
    radialSegments: z.number().int().min(6).max(48),
  })
  .strict()
  .readonly()

const CapsulePartSchema = z
  .object({
    ...partBase,
    primitive: z.literal('capsule'),
    radius: metre,
    length: metre,
    capSegments: z.number().int().min(2).max(12),
    radialSegments: z.number().int().min(6).max(32),
  })
  .strict()
  .readonly()

export const Img3dPartSchema = z.discriminatedUnion('primitive', [
  BoxPartSchema,
  SpherePartSchema,
  CylinderPartSchema,
  CapsulePartSchema,
])

export const Img3dMaterialSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    roughness: z.number().finite().min(0).max(1),
    metalness: z.number().finite().min(0).max(1),
    slot: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,31}$/)
      .nullable(),
  })
  .strict()
  .readonly()

export const Img3dSculptSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    materials: z.array(Img3dMaterialSchema).min(1).max(IMG3D_MAX_MATERIALS).readonly(),
    parts: z.array(Img3dPartSchema).min(1).max(IMG3D_MAX_PARTS).readonly(),
  })
  .strict()
  .superRefine((sculpt, context) => {
    for (const [index, part] of sculpt.parts.entries()) {
      if (part.material >= sculpt.materials.length) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'material'],
          message: 'Part material index must reference a declared material.',
        })
      }
    }
  })
  .readonly()

const Img3dDimensionsSchema = z
  .object({ width: metre, height: metre, depth: metre })
  .strict()
  .readonly()

export const Img3dRequestSchema = z
  .object({
    image: Img3dImageSchema,
    dimensions: Img3dDimensionsSchema,
    provider: z.enum(['codex', 'claude']).optional().default('codex'),
    model: z.string().trim().min(1).max(100).nullable().optional().default(null),
    effort: z.enum(AI_EFFORT_LEVELS).nullable().optional().default(null),
  })
  .strict()
  .readonly()

export type Img3dSculpt = z.infer<typeof Img3dSculptSchema>
export type Img3dRequest = z.infer<typeof Img3dRequestSchema>
export type Img3dPart = z.infer<typeof Img3dPartSchema>

export const img3dSculptJsonSchema = z.toJSONSchema(Img3dSculptSchema, {
  unrepresentable: 'throw',
})

type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject
type JsonObject = { readonly [key: string]: JsonValue }

function withCodexSchemaKeywords(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw new TypeError('JSON Schema numbers must be finite')
  }
  if (Array.isArray(value)) return value.map(withCodexSchemaKeywords)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key === 'oneOf' ? 'anyOf' : key,
        withCodexSchemaKeywords(child),
      ]),
    )
  }
  throw new TypeError(`Unsupported JSON Schema value: ${typeof value}`)
}

export const img3dCodexSculptJsonSchema = withCodexSchemaKeywords(img3dSculptJsonSchema)
