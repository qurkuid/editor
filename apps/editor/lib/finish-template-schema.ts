import {
  MaterialPhysicalSize,
  MaterialPreset,
  MaterialProperties,
  MaterialSchema,
  MaterialSourceRef,
} from '@pascal-app/core/schema'
import type { HomeFinishTemplate, ZoneFinishTemplateSnapshot } from '@pascal-app/editor'
import { z } from 'zod'

const templateIdSchema = z.string().min(1).max(160)
const templateNameSchema = z.string().trim().min(1).max(200)

/**
 * Local persistence has historically allowed asset handles, but never keeps a
 * blob URL. The server schema below is stricter because an asset handle only
 * has meaning in the browser that created it.
 */
const localMaterialSchema = MaterialSchema.superRefine((material, ctx) => {
  const urls = [material.texture?.url, material.texture?.bumpUrl]
  for (const url of urls) {
    if (typeof url === 'string' && url.toLowerCase().startsWith('blob:')) {
      ctx.addIssue({ code: 'custom', path: ['texture'], message: 'Blob URLs are transient.' })
    }
  }
})

function isServerMaterialUrl(value: string): boolean {
  const url = value.trim()
  if (
    url.length === 0 ||
    [...url].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    return false
  }
  if (/^(?:blob|asset|file|javascript|vbscript|chrome|chrome-extension|capacitor):/i.test(url)) {
    return false
  }
  if (url.startsWith('data:image/')) return true
  if (url.startsWith('//')) return false
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const serverTextureSchema = z
  .object({
    url: z.string().max(8192).refine(isServerMaterialUrl, {
      message: 'Texture URL must be an embedded image, same-server relative path, or http(s) URL.',
    }),
    repeat: z
      .tuple([
        z.number().finite().min(-10000).max(10000),
        z.number().finite().min(-10000).max(10000),
      ])
      .optional(),
    scale: z.number().finite().min(-10000).max(10000).optional(),
    offset: z
      .tuple([
        z.number().finite().min(-10000).max(10000),
        z.number().finite().min(-10000).max(10000),
      ])
      .optional(),
    rotationDeg: z.number().finite().min(-360000).max(360000).optional(),
    bumpUrl: z
      .string()
      .max(8192)
      .refine(isServerMaterialUrl, {
        message: 'Bump URL must be an embedded image, same-server relative path, or http(s) URL.',
      })
      .optional(),
    bumpScale: z.number().finite().min(-10000).max(10000).optional(),
  })
  .strict()

const serverMaterialSchema = z
  .object({
    id: z.string().min(1).max(160).optional(),
    preset: MaterialPreset.catch('custom').optional(),
    properties: MaterialProperties.strict().optional(),
    source: MaterialSourceRef.strict()
      .extend({
        provider: z.string().min(1).max(160),
        externalId: z.string().min(1).max(300),
        revision: z.string().max(160).optional(),
      })
      .optional(),
    physicalSize: MaterialPhysicalSize.strict()
      .extend({
        widthM: z.number().finite().positive().max(100000),
        heightM: z.number().finite().positive().max(100000),
      })
      .optional(),
    texture: serverTextureSchema.optional(),
  })
  .strict()

const localPortableMaterialSchema = z
  .object({
    label: z.string().max(200),
    preferredRef: z
      .string()
      .regex(/^library:/)
      .max(300)
      .optional(),
    material: localMaterialSchema,
  })
  .strict()

const serverPortableMaterialSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    preferredRef: z
      .string()
      .regex(/^library:/)
      .max(300)
      .optional(),
    material: serverMaterialSchema,
  })
  .strict()

const wallKeySchema = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^:\r\n]+(?::[^:\r\n]+:[^:\r\n]+)?:(front|back)$/)

const wallFingerprintSchema = z
  .object({
    wallId: z.string().min(1).max(160),
    face: z.enum(['front', 'back']),
    segmentSignature: z.string().max(2000),
    length: z.number().finite().nonnegative(),
    activeSlotRoles: z.array(z.string().min(1).max(100)).max(100),
    side: z.enum(['interior', 'exterior']).optional(),
    start: z.number().finite().min(0).max(1).default(0),
    end: z.number().finite().min(0).max(1).default(1),
  })
  .strict()

const ceilingFingerprintSchema = z.union([
  z
    .object({ ceilingId: z.string().min(1).max(160), polygonSignature: z.string().max(4000) })
    .strict(),
  z.object({ createFromZone: z.literal(true) }).strict(),
])

const surfaceFingerprintSchema = z
  .object({
    levelId: z.string().min(1).max(160),
    zoneId: z.string().min(1).max(160),
    polygonSignature: z.string().max(4000),
    inwardWalls: z.array(wallFingerprintSchema).max(1000),
    floor: z.union([
      z
        .object({ slabId: z.string().min(1).max(160), polygonSignature: z.string().max(4000) })
        .strict(),
      z.object({ createFromZone: z.literal(true) }).strict(),
    ]),
    ceiling: ceilingFingerprintSchema.optional(),
  })
  .strict()
  .superRefine((fingerprint, ctx) => {
    fingerprint.inwardWalls.forEach((wall, index) => {
      if (wall.end <= wall.start) {
        ctx.addIssue({
          code: 'custom',
          path: ['inwardWalls', index],
          message: 'Wall fingerprint range must have end greater than start.',
        })
      }
    })
  })

function makeZoneFinishTemplateSchema(materialSchema: z.ZodTypeAny) {
  return z
    .object({
      version: z.literal(1),
      id: templateIdSchema,
      name: templateNameSchema,
      createdAt: z.string().datetime({ offset: true }),
      source: z
        .object({
          sceneId: z.string().max(160).optional(),
          zoneId: z.string().min(1).max(160),
          fingerprint: surfaceFingerprintSchema,
        })
        .strict(),
      walls: z
        .array(
          z
            .object({
              sourceFace: wallFingerprintSchema.extend({
                key: wallKeySchema,
              }),
              slots: z
                .array(
                  z.object({ role: z.string().min(1).max(100), material: materialSchema }).strict(),
                )
                .min(1)
                .max(100),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
      floor: materialSchema,
      ceiling: materialSchema.optional(),
    })
    .strict()
    .superRefine((template, ctx) => {
      const wallRanges = new Set<string>()
      for (const [wallIndex, wall] of template.walls.entries()) {
        const key = `${wall.sourceFace.key}|${wall.sourceFace.side ?? ''}|${wall.sourceFace.start}|${wall.sourceFace.end}`
        if (wallRanges.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['walls', wallIndex, 'sourceFace'],
            message: 'A wall fingerprint range may occur only once in a template.',
          })
        }
        wallRanges.add(key)

        if (wall.sourceFace.end <= wall.sourceFace.start) {
          ctx.addIssue({
            code: 'custom',
            path: ['walls', wallIndex, 'sourceFace'],
            message: 'Wall fingerprint range must have end greater than start.',
          })
        }

        const isFullRange =
          Math.abs(wall.sourceFace.start) <= 1e-6 && Math.abs(wall.sourceFace.end - 1) <= 1e-6
        const expectedKey = isFullRange
          ? `${wall.sourceFace.wallId}:${wall.sourceFace.face}`
          : `${wall.sourceFace.wallId}:${wall.sourceFace.start.toFixed(6)}:${wall.sourceFace.end.toFixed(6)}:${wall.sourceFace.face}`
        if (wall.sourceFace.key !== expectedKey) {
          ctx.addIssue({
            code: 'custom',
            path: ['walls', wallIndex, 'sourceFace', 'key'],
            message: 'Wall fingerprint key must match wallId and face.',
          })
        }

        const roles = new Set<string>()
        for (const [slotIndex, slot] of wall.slots.entries()) {
          if (roles.has(slot.role)) {
            ctx.addIssue({
              code: 'custom',
              path: ['walls', wallIndex, 'slots', slotIndex, 'role'],
              message: 'A wall slot role may occur only once per wall face.',
            })
          }
          roles.add(slot.role)
        }
      }
    })
    .superRefine((template, ctx) => {
      if (Boolean(template.source.fingerprint.ceiling) !== Boolean(template.ceiling)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ceiling'],
          message: 'A ceiling snapshot and fingerprint must be provided together.',
        })
      }
    })
}

const localZoneFinishTemplateSchema = makeZoneFinishTemplateSchema(localPortableMaterialSchema)
const serverZoneFinishTemplateSchema = makeZoneFinishTemplateSchema(serverPortableMaterialSchema)

function makeHomeFinishTemplateSchema(zoneSchema: z.ZodTypeAny) {
  return z
    .object({
      version: z.literal(1),
      id: templateIdSchema,
      name: templateNameSchema,
      createdAt: z.string().datetime({ offset: true }),
      sourceSceneId: z.string().max(160).optional(),
      zones: z
        .array(
          z
            .object({
              sourceZoneId: z.string().min(1).max(160),
              sourceZoneName: z.string().max(200),
              template: zoneSchema,
            })
            .strict(),
        )
        .min(1)
        .max(1000),
    })
    .strict()
    .superRefine((home, ctx) => {
      const sourceZoneIds = new Set<string>()
      for (const [index, entry] of home.zones.entries()) {
        if (sourceZoneIds.has(entry.sourceZoneId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['zones', index, 'sourceZoneId'],
            message: 'A home template source zone may occur only once.',
          })
        }
        sourceZoneIds.add(entry.sourceZoneId)

        const template = entry.template
        const source =
          template && typeof template === 'object' && 'source' in template
            ? template.source
            : undefined
        const embeddedZoneId =
          source && typeof source === 'object' && 'zoneId' in source ? source.zoneId : undefined
        if (embeddedZoneId !== entry.sourceZoneId) {
          ctx.addIssue({
            code: 'custom',
            path: ['zones', index, 'template', 'source', 'zoneId'],
            message: 'Home template zone identity must match its embedded snapshot.',
          })
        }
      }
    })
}

const localHomeFinishTemplateSchema = makeHomeFinishTemplateSchema(localZoneFinishTemplateSchema)
const serverHomeFinishTemplateSchema = makeHomeFinishTemplateSchema(serverZoneFinishTemplateSchema)

export const ZoneFinishTemplateSchema = localZoneFinishTemplateSchema
export const HomeFinishTemplateSchema = localHomeFinishTemplateSchema
export const ServerZoneFinishTemplateSchema = serverZoneFinishTemplateSchema
export const ServerHomeFinishTemplateSchema = serverHomeFinishTemplateSchema

export const FinishTemplateVisibilitySchema = z.enum(['private', 'company'])
export const FinishTemplateKindSchema = z.enum(['zone', 'home'])

export const FinishTemplateCreateRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('zone'),
      visibility: FinishTemplateVisibilitySchema.default('private'),
      template: serverZoneFinishTemplateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('home'),
      visibility: FinishTemplateVisibilitySchema.default('private'),
      template: serverHomeFinishTemplateSchema,
    })
    .strict(),
])

const publicRecordBase = {
  id: templateIdSchema,
  name: templateNameSchema,
  visibility: z.enum(['private', 'company', 'local']),
  editable: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}
const publicRecordBaseSchema = z.object(publicRecordBase)

function refinePublicRecordConsistency(
  record: { id: string; name: string; template: { id: string; name: string } },
  ctx: z.RefinementCtx,
) {
  if (record.template.id !== record.id) {
    ctx.addIssue({
      code: 'custom',
      path: ['template', 'id'],
      message: 'Public template id must match the record id.',
    })
  }
  if (record.template.name !== record.name) {
    ctx.addIssue({
      code: 'custom',
      path: ['template', 'name'],
      message: 'Public template name must match the record name.',
    })
  }
}

export const FinishTemplateRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...publicRecordBase,
      kind: z.literal('zone'),
      template: serverZoneFinishTemplateSchema,
    })
    .strict()
    .superRefine(refinePublicRecordConsistency),
  z
    .object({
      ...publicRecordBase,
      kind: z.literal('home'),
      template: serverHomeFinishTemplateSchema,
    })
    .strict()
    .superRefine(refinePublicRecordConsistency),
])

export const FinishTemplateListResponseSchema = z
  .object({
    templates: z.array(FinishTemplateRecordSchema),
  })
  .strict()

export type FinishTemplateCreateRequest = z.infer<typeof FinishTemplateCreateRequestSchema>
export type FinishTemplateRecord =
  | ({
      kind: 'zone'
      template: ZoneFinishTemplateSnapshot
    } & Omit<z.infer<typeof publicRecordBaseSchema>, 'kind' | 'template'>)
  | ({
      kind: 'home'
      template: HomeFinishTemplate
    } & Omit<z.infer<typeof publicRecordBaseSchema>, 'kind' | 'template'>)

export function isZoneFinishTemplateSnapshot(value: unknown): value is ZoneFinishTemplateSnapshot {
  return localZoneFinishTemplateSchema.safeParse(value).success
}

export function isHomeFinishTemplate(value: unknown): value is HomeFinishTemplate {
  return localHomeFinishTemplateSchema.safeParse(value).success
}

export function parseZoneFinishTemplateSnapshot(value: unknown): ZoneFinishTemplateSnapshot | null {
  const parsed = localZoneFinishTemplateSchema.safeParse(value)
  return parsed.success ? (parsed.data as ZoneFinishTemplateSnapshot) : null
}

export function parseHomeFinishTemplate(value: unknown): HomeFinishTemplate | null {
  const parsed = localHomeFinishTemplateSchema.safeParse(value)
  return parsed.success ? (parsed.data as HomeFinishTemplate) : null
}
