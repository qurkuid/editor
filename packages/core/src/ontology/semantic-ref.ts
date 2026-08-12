import { z } from 'zod'

export const SemanticIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/)
  .brand<'SemanticId'>()

export const SemanticVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .brand<'SemanticVersion'>()

export const SemanticRefSchema = z
  .object({
    packId: SemanticIdSchema,
    classId: SemanticIdSchema,
    version: SemanticVersionSchema,
  })
  .strict()
  .readonly()

export type SemanticRef = z.infer<typeof SemanticRefSchema>

export const PASCAL_ARCHITECTURE_CORE_PACK_ID = 'pascal-architecture-core'
export const PASCAL_ARCHITECTURE_CORE_VERSION = '1.0.0'

export const PASCAL_ARCHITECTURE_BODY_REF = SemanticRefSchema.parse({
  packId: PASCAL_ARCHITECTURE_CORE_PACK_ID,
  classId: 'pascal:architecture/body',
  version: PASCAL_ARCHITECTURE_CORE_VERSION,
})

export const PASCAL_ARCHITECTURE_WALL_REF = SemanticRefSchema.parse({
  packId: PASCAL_ARCHITECTURE_CORE_PACK_ID,
  classId: 'pascal:architecture/wall',
  version: PASCAL_ARCHITECTURE_CORE_VERSION,
})

export const PASCAL_ARCHITECTURE_WINDOW_REF = SemanticRefSchema.parse({
  packId: PASCAL_ARCHITECTURE_CORE_PACK_ID,
  classId: 'pascal:architecture/window',
  version: PASCAL_ARCHITECTURE_CORE_VERSION,
})

export const PASCAL_ARCHITECTURE_NODE_SEMANTIC_REFS: Readonly<Record<string, SemanticRef>> = {
  body: PASCAL_ARCHITECTURE_BODY_REF,
  wall: PASCAL_ARCHITECTURE_WALL_REF,
  window: PASCAL_ARCHITECTURE_WINDOW_REF,
}
