import { z } from 'zod'

export const FURNITURE_ASSEMBLY_SCHEMA_VERSION = 1 as const

const nonNegativeMetres = z.number().finite().min(0)
const positiveMetres = z.number().finite().positive()
const finiteMetres = z.number().finite()
const featureId = z.string().trim().min(1)

export const FurnitureKindSchema = z.enum([
  'wardrobe',
  'base-run',
  'upper-run',
  'tall',
  'island',
  'set',
  'sink',
])

export const FurnitureFaceSchema = z.enum(['front', 'back', 'both'])

export const FurnitureDimensionsSchema = z.object({
  width: positiveMetres,
  height: positiveMetres,
  depth: positiveMetres,
})

export const FurnitureDimensionConstraintsSchema = z.object({
  minWidth: nonNegativeMetres.optional(),
  maxWidth: positiveMetres.optional(),
  minHeight: nonNegativeMetres.optional(),
  maxHeight: positiveMetres.optional(),
  minDepth: nonNegativeMetres.optional(),
  maxDepth: positiveMetres.optional(),
  heightLocked: z.boolean().default(false),
})

export const FurnitureMarginsSchema = z
  .object({
    left: nonNegativeMetres,
    right: nonNegativeMetres,
    top: nonNegativeMetres,
    front: nonNegativeMetres,
    back: nonNegativeMetres,
  })
  .default({ left: 0, right: 0, top: 0, front: 0, back: 0 })

const furnitureSideOpening = z.object({
  enabled: z.boolean(),
  width: nonNegativeMetres,
})

export const FurnitureFillersSchema = z
  .object({
    left: furnitureSideOpening,
    right: furnitureSideOpening,
  })
  .default({
    left: { enabled: false, width: 0 },
    right: { enabled: false, width: 0 },
  })

export const FurnitureSurroundSchema = z
  .object({
    enabled: z.boolean(),
    size: nonNegativeMetres,
    top: z.boolean(),
    left: z.boolean(),
    right: z.boolean(),
  })
  .default({ enabled: false, size: 0, top: false, left: false, right: false })

export const FurnitureCurtainSchema = z
  .object({
    left: furnitureSideOpening,
    right: furnitureSideOpening,
    height: nonNegativeMetres,
    shape: z.enum(['solid', 'box']),
    includedInTotal: z.boolean(),
  })
  .default({
    left: { enabled: false, width: 0 },
    right: { enabled: false, width: 0 },
    height: 0,
    shape: 'solid',
    includedInTotal: false,
  })

export const FurnitureCeilingStepSchema = z
  .object({
    left: z.object({ enabled: z.boolean(), width: nonNegativeMetres, height: nonNegativeMetres }),
    right: z.object({ enabled: z.boolean(), width: nonNegativeMetres, height: nonNegativeMetres }),
    depth: nonNegativeMetres,
  })
  .default({
    left: { enabled: false, width: 0, height: 0 },
    right: { enabled: false, width: 0, height: 0 },
    depth: 0,
  })

export const FurnitureMaterialDefaultsSchema = z
  .object({
    carcass: z.string().trim().min(1).optional(),
    back: z.string().trim().min(1).optional(),
    front: z.string().trim().min(1).optional(),
    countertop: z.string().trim().min(1).optional(),
    edge: z.string().trim().min(1).optional(),
    hardware: z.string().trim().min(1).optional(),
  })
  .default({})

export const FurnitureSideFinishSchema = z.object({
  left: z.enum(['none', 'ep18', 'ceramic12', 'ceramic18', 'stone']),
  right: z.enum(['none', 'ep18', 'ceramic12', 'ceramic18', 'stone']),
  color: z.string().default(''),
})

export const FurnitureBaseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plinth'), height: nonNegativeMetres }),
  z.object({ type: z.literal('legs'), height: nonNegativeMetres }),
  z.object({ type: z.literal('floating'), height: nonNegativeMetres }),
  z.object({ type: z.literal('none'), height: z.literal(0).default(0) }),
])

const furnitureFrontAppearance = {
  color: z.string().default(''),
  materialId: z.string().trim().min(1).optional(),
}

export const FurnitureFrontSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), ...furnitureFrontAppearance }),
  z.object({
    kind: z.literal('hinged'),
    leaves: z.number().int().min(1).max(2),
    glass: z.boolean().default(false),
    ...furnitureFrontAppearance,
  }),
  z.object({
    kind: z.literal('drawer'),
    count: z.number().int().min(1).max(6),
    ...furnitureFrontAppearance,
  }),
  z.object({
    kind: z.literal('flap'),
    direction: z.enum(['up', 'down']),
    ...furnitureFrontAppearance,
  }),
  z.object({
    kind: z.literal('sliding'),
    leaves: z.number().int().min(2).max(4),
    ...furnitureFrontAppearance,
  }),
  z.object({
    kind: z.literal('pull-out'),
    style: z.enum(['standard', 'spice', 'pantry']),
    ...furnitureFrontAppearance,
  }),
])

export const FurnitureDepthSchema = z.object({
  value: nonNegativeMetres,
  reference: z.enum(['door', 'back']),
})

export const FurnitureDoorExtensionSchema = z.object({
  top: finiteMetres,
  bottom: finiteMetres,
})

export const FurnitureCountHeightsSchema = z.object({
  count: z.number().int().min(0).max(8),
  heights: z.array(nonNegativeMetres).max(8),
})

export const FurnitureInternalDrawersSchema = FurnitureCountHeightsSchema.extend({
  count: z.number().int().min(0).max(2),
  heights: z.array(nonNegativeMetres).max(2),
})

export const FurnitureChannelSchema = z.object({
  enabled: z.boolean(),
  height: nonNegativeMetres,
  depth: nonNegativeMetres,
  handSpace: nonNegativeMetres,
  color: z.string().default(''),
})

export const FurniturePanelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('panel'),
    thickness: positiveMetres,
    material: z.enum(['ep', 'ceramic', 'stone', 'paint', 'mdf']),
    overhang: nonNegativeMetres,
    color: z.string().default(''),
    chamfer: z
      .object({ enabled: z.boolean(), size: nonNegativeMetres })
      .default({ enabled: false, size: 0 }),
  }),
])

const fixtureBase = {
  id: featureId,
}

export const FurnitureFixtureSchema = z.discriminatedUnion('type', [
  z.object({
    ...fixtureBase,
    type: z.literal('induction'),
    enabled: z.boolean(),
    position: z.object({ x: nonNegativeMetres, y: nonNegativeMetres }),
    size: z.object({ width: positiveMetres, depth: positiveMetres }),
    model: z.string().default(''),
  }),
  z.object({
    ...fixtureBase,
    type: z.literal('sink-bowl'),
    enabled: z.boolean(),
    position: z.object({ x: nonNegativeMetres, y: nonNegativeMetres }),
    size: z.object({ width: positiveMetres, depth: positiveMetres }),
    radius: nonNegativeMetres,
    model: z.string().default(''),
    bowlHeight: nonNegativeMetres,
  }),
  z.object({
    ...fixtureBase,
    type: z.literal('faucet'),
    enabled: z.boolean(),
    position: z.object({ x: nonNegativeMetres, y: nonNegativeMetres }),
    diameter: positiveMetres,
    componentName: z.string().default(''),
  }),
  z.object({
    ...fixtureBase,
    type: z.literal('light'),
    mount: z.enum(['left', 'right', 'top', 'bottom', 'shelf']),
    axis: z.enum(['length', 'depth', 'height']),
    shelfIndex: z.number().int().min(1).max(8),
    inset: nonNegativeMetres,
    componentName: z.string().default(''),
    rotate: z.number().finite(),
  }),
  z.object({
    ...fixtureBase,
    type: z.literal('outlet'),
    mount: z.enum(['back', 'left', 'right', 'top', 'bottom']),
    position: z.object({ x: nonNegativeMetres, z: nonNegativeMetres }),
    size: z.object({ width: positiveMetres, height: positiveMetres }),
    componentName: z.string().default(''),
  }),
  z.object({
    ...fixtureBase,
    type: z.literal('smps'),
    mount: z.enum(['back', 'left', 'right', 'top', 'bottom']),
    position: z.object({ x: nonNegativeMetres, z: nonNegativeMetres }),
    size: z.object({ width: positiveMetres, depth: positiveMetres, height: positiveMetres }),
    componentName: z.string().default(''),
  }),
])

export const FurnitureTierSchema = z.object({
  id: featureId,
  height: positiveMetres,
  depth: FurnitureDepthSchema,
  face: FurnitureFaceSchema,
  front: FurnitureFrontSchema,
  openMethod: z.enum(['push', 'channel', 'jbar']),
  doorExtension: FurnitureDoorExtensionSchema,
  visible: z.boolean(),
  heightLocked: z.boolean().default(false),
  shelves: FurnitureCountHeightsSchema,
  hanger: z.boolean(),
  internalDrawers: FurnitureInternalDrawersSchema,
  channels: z.object({ top: FurnitureChannelSchema, middle: FurnitureChannelSchema }),
  topPanel: FurniturePanelSchema,
  bottomPanel: FurniturePanelSchema,
  mergeNext: z.boolean(),
  fixtures: z.array(FurnitureFixtureSchema),
})

export const FurnitureBaySchema = z.object({
  id: featureId,
  width: positiveMetres,
  widthLocked: z.boolean().default(false),
  base: FurnitureBaseSchema,
  baseBack: FurnitureBaseSchema.optional(),
  kickplate: z.boolean(),
  endPanels: z.object({ left: z.boolean(), right: z.boolean() }),
  visible: z.boolean(),
  lowerStile: z.boolean(),
  tiers: z.array(FurnitureTierSchema),
})

export const FurnitureSetUpperSchema = z.object({
  enabled: z.boolean(),
  height: positiveMetres,
  depth: positiveMetres,
  gap: nonNegativeMetres,
  totalWidth: positiveMetres,
  anchor: z.enum(['lower', 'upper']),
  gapLocked: z.boolean().default(false),
  heightLocked: z.boolean().default(false),
})

export const FurnitureAssemblySchema = z.object({
  schemaVersion: z.literal(FURNITURE_ASSEMBLY_SCHEMA_VERSION),
  furnitureKind: FurnitureKindSchema,
  location: z.string().default(''),
  locationTagSync: z.boolean().default(true),
  dimensions: FurnitureDimensionsSchema,
  constraints: FurnitureDimensionConstraintsSchema.default({ heightLocked: false }),
  margins: FurnitureMarginsSchema,
  fillers: FurnitureFillersSchema,
  surround: FurnitureSurroundSchema,
  curtain: FurnitureCurtainSchema,
  ceilingStep: FurnitureCeilingStepSchema,
  defaultFace: FurnitureFaceSchema,
  materialDefaults: FurnitureMaterialDefaultsSchema,
  sideFinish: FurnitureSideFinishSchema.optional(),
  depthSplit: z.object({ front: positiveMetres, back: positiveMetres }).optional(),
  setUpper: FurnitureSetUpperSchema.optional(),
  bays: z.array(FurnitureBaySchema),
  backBays: z.array(FurnitureBaySchema).optional(),
  upperBays: z.array(FurnitureBaySchema).optional(),
  fixtures: z.array(FurnitureFixtureSchema),
})

export type FurnitureKind = z.infer<typeof FurnitureKindSchema>
export type FurnitureAssembly = z.infer<typeof FurnitureAssemblySchema>
export type FurnitureBay = z.infer<typeof FurnitureBaySchema>
export type FurnitureTier = z.infer<typeof FurnitureTierSchema>
export type FurnitureFront = z.infer<typeof FurnitureFrontSchema>
export type FurnitureFixture = z.infer<typeof FurnitureFixtureSchema>
