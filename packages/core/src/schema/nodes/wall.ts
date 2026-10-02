import dedent from 'dedent'
import { z } from 'zod'
import { parseMaterialRef } from '../../material-library'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { WindowNode } from './window'

export const WallTreatmentSide = z.enum(['interior', 'exterior', 'both'])
export type WallTreatmentSide = z.infer<typeof WallTreatmentSide>

export const WallTrimProfile = z.enum([
  'flat',
  'bevel',
  'triangle',
  'cove',
  'bullnose',
  'base-modern',
  'base-colonial',
  'base-shoe',
  'base-ogee',
  'crown-cove',
  'crown-ogee',
  'crown-craftsman',
  'crown-layered',
  'rail-rounded',
  'rail-ogee',
  'rail-picture',
  'rail-stepped',
])
export type WallTrimProfile = z.infer<typeof WallTrimProfile>

export const WallTrimConfig = z.object({
  enabled: z.boolean().default(false),
  sides: WallTreatmentSide.default('both'),
  height: z.number().default(0.1),
  proud: z.number().default(0.015),
  profile: WallTrimProfile.default('flat'),
  offsetY: z.number().optional(),
})
export type WallTrimConfig = z.infer<typeof WallTrimConfig>

export const WALL_SKIRTING_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.02,
  profile: 'flat',
}

export const WALL_CROWN_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.055,
  profile: 'flat',
}

export const WALL_CHAIR_RAIL_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.055,
  proud: 0.026,
  profile: 'flat',
  offsetY: 0.9,
}

export const WALL_TRIM_DEFAULTS = {
  skirting: WALL_SKIRTING_DEFAULT,
  crown: WALL_CROWN_DEFAULT,
  chairRail: WALL_CHAIR_RAIL_DEFAULT,
} as const

export const WallConstructionLayerKind = z.enum([
  'concrete',
  'gypsum-board',
  'mdf',
  'timber-stud',
  'cavity',
  'finish',
  'custom',
  'glass',
  'masonry',
  'glass-block',
])
export type WallConstructionLayerKind = z.infer<typeof WallConstructionLayerKind>

export const WallConstructionLayer = z.object({
  kind: WallConstructionLayerKind,
  thickness: z.number().positive(),
  memberWidth: z.number().positive().optional(),
  studSpacing: z.number().positive().optional(),
  sheetWidth: z.number().positive().optional(),
  sheetHeight: z.number().positive().optional(),
  wasteFactor: z.number().min(0).max(1).default(0.1),
  productRef: z.string().optional(),
  brand: z.string().optional(),
  unitPrice: z.number().nonnegative().optional(),
})
export type WallConstructionLayer = z.infer<typeof WallConstructionLayer>

export const WallBandConstructionMode = z.enum(['finish', 'overlay', 'assembly'])
export type WallBandConstructionMode = z.infer<typeof WallBandConstructionMode>

export const WallBandConstruction = z.object({
  mode: WallBandConstructionMode.default('finish'),
  layers: z.array(WallConstructionLayer).default([]),
})
export type WallBandConstruction = z.infer<typeof WallBandConstruction>

const WallFaceBandConfigShape = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(1).max(4).default(1),
  lowerHeight: z.number().default(0.84),
  middleHeight: z.number().default(0.61),
  upperHeight: z.number().default(0.61),
  construction: z.record(z.string(), WallBandConstruction).optional(),
})

export const WallFaceBandConfig = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('count' in value)) {
    const enabled = (value as { enabled?: unknown }).enabled === true
    return { ...value, count: enabled ? 3 : 1 }
  }
  return value
}, WallFaceBandConfigShape)
export type WallFaceBandConfig = z.infer<typeof WallFaceBandConfig>

export const WALL_FACE_BAND_DEFAULT: WallFaceBandConfig = {
  enabled: false,
  count: 1,
  lowerHeight: 0.84,
  middleHeight: 0.61,
  upperHeight: 0.61,
}

export const WALL_SKIRTING_SLOT_DEFAULT = 'library:preset-softwhite'
export const WALL_CROWN_SLOT_DEFAULT = 'library:preset-white'
export const WALL_CHAIR_RAIL_SLOT_DEFAULT = 'library:preset-cream'
export const WALL_FACE_BAND_SOLID_SLOT_DEFAULTS = {
  lower: 'library:preset-white',
  middle: 'library:preset-lightgrey',
  upper: 'library:preset-greige',
  top: 'library:preset-softwhite',
} as const satisfies Record<WallFaceBand, string>

export const WALL_SURFACE_SLOT_DEFAULTS = {
  interior: 'library:concrete-drywall',
  exterior: 'library:concrete-drywall',
  lowerInterior: 'library:concrete-drywall',
  middleInterior: 'library:concrete-drywall',
  upperInterior: 'library:concrete-drywall',
  topInterior: 'library:concrete-drywall',
  lowerExterior: 'library:concrete-drywall',
  middleExterior: 'library:concrete-drywall',
  upperExterior: 'library:concrete-drywall',
  topExterior: 'library:concrete-drywall',
  skirtingInterior: WALL_SKIRTING_SLOT_DEFAULT,
  skirtingExterior: WALL_SKIRTING_SLOT_DEFAULT,
  crownInterior: WALL_CROWN_SLOT_DEFAULT,
  crownExterior: WALL_CROWN_SLOT_DEFAULT,
  chairRailInterior: WALL_CHAIR_RAIL_SLOT_DEFAULT,
  chairRailExterior: WALL_CHAIR_RAIL_SLOT_DEFAULT,
} as const

export type WallSurfaceSlotId = keyof typeof WALL_SURFACE_SLOT_DEFAULTS

export const WallSurfaceSideSchema = z.enum(['interior', 'exterior'])
export type WallSurfaceSide = z.infer<typeof WallSurfaceSideSchema>
export type WallFinishRegion = {
  id: string
  side: WallSurfaceSide
  start: number
  end: number
  slots: Record<string, string>
}
export type WallFaceBand = 'lower' | 'middle' | 'upper' | 'top'
export type WallBandSurfaceSlotId =
  | 'lowerInterior'
  | 'middleInterior'
  | 'upperInterior'
  | 'topInterior'
  | 'lowerExterior'
  | 'middleExterior'
  | 'upperExterior'
  | 'topExterior'

const WALL_FINISH_REGION_EPSILON = 1e-6

export const WallFinishRegionSchema = z
  .object({
    id: z.string().trim().min(1),
    side: WallSurfaceSideSchema,
    start: z.number().finite().min(0).max(1),
    end: z.number().finite().min(0).max(1),
    slots: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .refine((slots) => Object.keys(slots).length > 0, 'finish region needs at least one slot'),
  })
  .superRefine((region, ctx) => {
    if (region.end - region.start <= WALL_FINISH_REGION_EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'finish region is empty',
      })
    }
    for (const [role, ref] of Object.entries(region.slots)) {
      if (getWallSurfaceSideFromBandSlot(role) !== region.side) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', role],
          message: `finish role ${role} does not belong to ${region.side}`,
        })
      }
      if (!parseMaterialRef(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', role],
          message: 'finish material must be a library: or scene: reference',
        })
      }
    }
  })
  .transform((region) => normalizeWallFinishRegion(region))

export function normalizeWallFinishRegion(
  region: Omit<WallFinishRegion, 'start' | 'end'> & { start: number; end: number },
): WallFinishRegion {
  const snap = (value: number) => {
    if (Math.abs(value) <= WALL_FINISH_REGION_EPSILON) return 0
    if (Math.abs(value - 1) <= WALL_FINISH_REGION_EPSILON) return 1
    return Math.max(0, Math.min(1, value))
  }
  return {
    ...region,
    id: region.id.trim(),
    side: region.side,
    start: snap(region.start),
    end: snap(region.end),
    slots: Object.fromEntries(
      Object.entries(region.slots).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }
}

export function normalizeWallFinishRegions(
  regions: readonly (Omit<WallFinishRegion, 'start' | 'end'> & {
    start: number
    end: number
  })[],
): WallFinishRegion[] {
  return regions
    .map(normalizeWallFinishRegion)
    .sort(
      (left, right) =>
        left.side.localeCompare(right.side) ||
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    )
}

export function validateWallFinishRegions(
  regions: readonly WallFinishRegion[],
): { ok: true } | { ok: false; regionIds: string[] } {
  for (const region of regions) {
    if (
      !Number.isFinite(region.start) ||
      !Number.isFinite(region.end) ||
      region.start < 0 ||
      region.end > 1 ||
      region.end - region.start <= WALL_FINISH_REGION_EPSILON ||
      Object.keys(region.slots).length === 0 ||
      Object.entries(region.slots).some(
        ([role, ref]) =>
          getWallSurfaceSideFromBandSlot(role) !== region.side || !parseMaterialRef(ref),
      )
    ) {
      return { ok: false, regionIds: [region.id] }
    }
  }
  const normalized = normalizeWallFinishRegions(regions)
  const duplicateIds = new Set<string>()
  for (const region of normalized) {
    if (duplicateIds.has(region.id)) return { ok: false, regionIds: [region.id] }
    duplicateIds.add(region.id)
  }
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    const left = normalized[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const right = normalized[rightIndex]!
      if (right.side !== left.side) continue
      if (right.start >= left.end - WALL_FINISH_REGION_EPSILON) break
      const overlappingRoles = Object.keys(left.slots).filter(
        (role) =>
          right.slots[role] !== undefined &&
          Math.min(left.end, right.end) - Math.max(left.start, right.start) >
            WALL_FINISH_REGION_EPSILON,
      )
      if (overlappingRoles.length > 0) {
        return { ok: false, regionIds: [left.id, right.id] }
      }
    }
  }
  return { ok: true }
}

export function splitWallFinishRegions(
  regions: readonly WallFinishRegion[],
  splitAt: number,
): { first: WallFinishRegion[]; second: WallFinishRegion[] } {
  const split = Math.max(0, Math.min(1, splitAt))
  if (split <= WALL_FINISH_REGION_EPSILON) {
    return { first: [], second: normalizeWallFinishRegions(regions) }
  }
  if (split >= 1 - WALL_FINISH_REGION_EPSILON) {
    return { first: normalizeWallFinishRegions(regions), second: [] }
  }
  const first: WallFinishRegion[] = []
  const second: WallFinishRegion[] = []
  for (const region of normalizeWallFinishRegions(regions)) {
    if (region.start < split - WALL_FINISH_REGION_EPSILON) {
      const end = Math.min(region.end, split)
      if (end - region.start > WALL_FINISH_REGION_EPSILON) {
        first.push(
          normalizeWallFinishRegion({
            ...region,
            start: region.start / split,
            end: end / split,
          }),
        )
      }
    }
    if (region.end > split + WALL_FINISH_REGION_EPSILON) {
      const start = Math.max(region.start, split)
      if (region.end - start > WALL_FINISH_REGION_EPSILON) {
        second.push(
          normalizeWallFinishRegion({
            ...region,
            id: region.start < split - WALL_FINISH_REGION_EPSILON ? `${region.id}:2` : region.id,
            start: (start - split) / (1 - split),
            end: (region.end - split) / (1 - split),
          }),
        )
      }
    }
  }
  return { first, second }
}

export function remapWallFinishRegionsForMerge(
  regions: readonly WallFinishRegion[],
  segmentStart: number,
  segmentLength: number,
  totalLength: number,
  reversed = false,
): WallFinishRegion[] {
  if (segmentLength <= WALL_FINISH_REGION_EPSILON || totalLength <= WALL_FINISH_REGION_EPSILON) {
    return []
  }
  const offset = segmentStart / totalLength
  const scale = segmentLength / totalLength
  return normalizeWallFinishRegions(
    regions.map((region) => {
      const start = reversed ? 1 - region.end : region.start
      const end = reversed ? 1 - region.start : region.end
      return {
        ...region,
        start: offset + start * scale,
        end: offset + end * scale,
      }
    }),
  )
}

export function mergeWallFinishRegions(regions: readonly WallFinishRegion[]): WallFinishRegion[] {
  const merged: WallFinishRegion[] = []
  for (const region of normalizeWallFinishRegions(regions)) {
    const previous = merged.at(-1)
    if (
      previous &&
      previous.side === region.side &&
      JSON.stringify(previous.slots) === JSON.stringify(region.slots) &&
      Math.abs(previous.end - region.start) <= WALL_FINISH_REGION_EPSILON
    ) {
      previous.end = region.end
      continue
    }
    merged.push({ ...region })
  }
  return normalizeWallFinishRegions(merged)
}

export const WallNode = BaseNode.extend({
  id: objectId('wall'),
  type: nodeType('wall'),
  children: z
    .array(z.union([ItemNode.shape.id, DoorNode.shape.id, WindowNode.shape.id]))
    .default([]),
  // Legacy single-material wall finish. Read for backward compatibility only.
  material: MaterialSchema.optional(),
  // Legacy single-material wall finish preset. Read for backward compatibility only.
  materialPreset: z.string().optional(),
  interiorMaterial: MaterialSchema.optional(),
  interiorMaterialPreset: z.string().optional(),
  exteriorMaterial: MaterialSchema.optional(),
  exteriorMaterialPreset: z.string().optional(),
  // Per-slot material overrides on the unified slot model, mirroring
  // `SlabNode.slots`. Key = slot id (`interior` / `exterior`), value = a
  // `MaterialRef` (`library:<id>` / `scene:<id>`). Absent = the declared slot
  // default (`WALL_SLOT_DEFAULT`). The legacy `*Material*` fields above are
  // read only by the load migration that moves them into `slots`; delete them
  // in a follow-up once migrated scenes are the norm.
  slots: z.record(z.string(), z.string()).optional(),
  finishRegions: z
    .array(WallFinishRegionSchema)
    .optional()
    .superRefine((regions, ctx) => {
      if (!regions) return
      const validation = validateWallFinishRegions(regions)
      if (!validation.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['finishRegions'],
          message: `overlapping finish regions: ${validation.regionIds.join(', ')}`,
        })
      }
    })
    .transform((regions) => (regions ? normalizeWallFinishRegions(regions) : regions))
    .optional(),
  thickness: z.number().optional(),
  height: z.number().optional(),
  curveOffset: z.number().optional(),
  // Persisted slab-support host — see ItemNode.supportSlabId for the rules.
  supportSlabId: z.string().optional(),
  // Vertical offset from the elected support surface. Ground-hosted chained
  // walls use this to preserve one construction plane without copying terrain.
  supportOffset: z.number().finite().optional(),
  // Extend downward from the authored wall base to the terrain while keeping
  // the wall body height and top unchanged.
  fillToTerrain: z.boolean().optional(),
  faceBands: WallFaceBandConfig.optional(),
  skirting: WallTrimConfig.optional(),
  crown: WallTrimConfig.optional(),
  chairRail: WallTrimConfig.optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // Space detection for cutaway mode
  frontSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
  backSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: thickness in meters
  - height: height in meters
  - fillToTerrain: extends the wall downward to the terrain without changing its authored height
  - curveOffset: midpoint sagitta offset used to bend the wall into an arc
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  - size: size of the wall in grid units
  - frontSide: whether the front side faces interior, exterior, or unknown
  - backSide: whether the back side faces interior, exterior, or unknown
  `,
)
export type WallNode = z.infer<typeof WallNode>

// Declared default appearance for an unpainted wall face in colored mode —
// visual parity with the retired DEFAULT_WALL_MATERIAL. Lives in core so the
// slot declaration (nodes) and the material resolver (viewer) share one value.
// May be a `#rrggbb` colour or a `library:<id>` ref. Textures-off still
// collapses to the themed wall role (the escape hatch).
export const WALL_SLOT_DEFAULT: Record<WallSurfaceSide, string> = {
  interior: WALL_SURFACE_SLOT_DEFAULTS.interior,
  exterior: WALL_SURFACE_SLOT_DEFAULTS.exterior,
}

export function getWallFaceBandConfig(
  wall: Pick<WallNode, 'height' | 'faceBands'>,
  effectiveWallHeight: number,
) {
  const wallHeight = Math.max(0, effectiveWallHeight)
  const raw = { ...WALL_FACE_BAND_DEFAULT, ...(wall.faceBands ?? {}) }
  const count = raw.enabled ? Math.max(1, Math.min(4, Math.round(raw.count ?? 3))) : 1
  const lowerHeight = count >= 2 ? Math.max(0, Math.min(wallHeight, raw.lowerHeight)) : 0
  const middleHeight =
    count >= 3 ? Math.max(0, Math.min(wallHeight - lowerHeight, raw.middleHeight)) : 0
  const upperHeight =
    count >= 4 ? Math.max(0, Math.min(wallHeight - lowerHeight - middleHeight, raw.upperHeight)) : 0

  return {
    enabled: raw.enabled && count > 1,
    count,
    lowerHeight,
    middleHeight,
    upperHeight,
    lowerTop: lowerHeight,
    middleTop: lowerHeight + middleHeight,
    upperTop: lowerHeight + middleHeight + upperHeight,
  }
}

export function getWallFaceBandForHeight(
  wall: Pick<WallNode, 'height' | 'faceBands'>,
  y: number,
  effectiveWallHeight: number,
): WallFaceBand {
  const bands = getWallFaceBandConfig(wall, effectiveWallHeight)
  if (!bands.enabled) return 'upper'
  if (y < bands.lowerTop) return 'lower'
  if (y < bands.middleTop) return 'middle'
  if (bands.count >= 4 && y < bands.upperTop) return 'upper'
  if (bands.count >= 4) return 'top'
  return 'upper'
}

export function getWallBandSlotId(
  side: WallSurfaceSide,
  band: WallFaceBand,
): WallBandSurfaceSlotId {
  const suffix = side === 'interior' ? 'Interior' : 'Exterior'
  return `${band}${suffix}` as WallBandSurfaceSlotId
}

const WALL_FACE_BAND_SLOTS_BY_SIDE = {
  interior: ['lowerInterior', 'middleInterior', 'upperInterior', 'topInterior'],
  exterior: ['lowerExterior', 'middleExterior', 'upperExterior', 'topExterior'],
} as const satisfies Record<WallSurfaceSide, readonly WallBandSurfaceSlotId[]>

function getWallFaceBandSlotsForCount(
  side: WallSurfaceSide,
  count: number,
): readonly WallBandSurfaceSlotId[] {
  if (count <= 1) return []
  if (side === 'interior') {
    if (count === 2) return ['lowerInterior', 'upperInterior']
    if (count === 3) return ['lowerInterior', 'middleInterior', 'upperInterior']
    return ['lowerInterior', 'middleInterior', 'upperInterior', 'topInterior']
  }

  if (count === 2) return ['lowerExterior', 'upperExterior']
  if (count === 3) return ['lowerExterior', 'middleExterior', 'upperExterior']
  return ['lowerExterior', 'middleExterior', 'upperExterior', 'topExterior']
}

function getWallFaceBandDefaultSlot(slotId: WallBandSurfaceSlotId): string {
  if (slotId.startsWith('lower')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower
  if (slotId.startsWith('middle')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle
  if (slotId.startsWith('top')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.top
  return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper
}

function getWallFaceTopBandSlot(
  side: WallSurfaceSide,
  count: number,
): WallBandSurfaceSlotId | null {
  const slots = getWallFaceBandSlotsForCount(side, count)
  return slots[slots.length - 1] ?? null
}

export function buildWallFaceBandCountPatch(
  wall: Pick<WallNode, 'faceBands' | 'slots'>,
  count: number,
): Pick<WallNode, 'faceBands' | 'slots'> {
  const slots = { ...(wall.slots ?? {}) }
  const nextCount = Math.max(1, Math.min(4, Math.round(count)))
  const previousCount = wall.faceBands?.enabled
    ? Math.max(1, Math.min(4, Math.round(wall.faceBands.count ?? 3)))
    : 1

  for (const side of ['interior', 'exterior'] as const) {
    const nextSlots = getWallFaceBandSlotsForCount(side, nextCount)
    const activeSlots = new Set(nextSlots)
    const previouslyActiveSlots = new Set(getWallFaceBandSlotsForCount(side, previousCount))
    const previousTopSlot = getWallFaceTopBandSlot(side, previousCount)
    const nextTopSlot = getWallFaceTopBandSlot(side, nextCount)
    const topMaterial =
      (previousTopSlot ? slots[previousTopSlot] : undefined) ??
      slots[side] ??
      WALL_SURFACE_SLOT_DEFAULTS[side]
    for (const slotId of WALL_FACE_BAND_SLOTS_BY_SIDE[side]) {
      if (activeSlots.has(slotId)) {
        if (slotId === nextTopSlot) {
          slots[slotId] = topMaterial
          continue
        }
        const wasActive = previouslyActiveSlots.has(slotId)
        const wasPreviousTop = slotId === previousTopSlot
        if (!wasActive || wasPreviousTop || !slots[slotId]) {
          slots[slotId] = getWallFaceBandDefaultSlot(slotId)
        }
      } else {
        delete slots[slotId]
      }
    }
  }

  return {
    faceBands: {
      ...WALL_FACE_BAND_DEFAULT,
      ...(wall.faceBands ?? {}),
      enabled: nextCount > 1,
      count: nextCount,
      lowerHeight: wall.faceBands?.lowerHeight ?? WALL_FACE_BAND_DEFAULT.lowerHeight,
      middleHeight: wall.faceBands?.middleHeight ?? WALL_FACE_BAND_DEFAULT.middleHeight,
      upperHeight: wall.faceBands?.upperHeight ?? WALL_FACE_BAND_DEFAULT.upperHeight,
    },
    slots,
  }
}

export function buildEnabledWallFaceBandPatch(
  wall: Pick<WallNode, 'faceBands' | 'slots'>,
): Pick<WallNode, 'faceBands' | 'slots'> {
  return buildWallFaceBandCountPatch(wall, 2)
}

// A wall kind is never stored up front — it is derived from what the wall is
// built of. The band construction layers decide first (a band constructed of
// glass makes a 유리벽, of masonry brick a 조적벽); walls without such a
// build fall back to the painted slot refs (bottom band first, then the two
// faces). One shared table so the panel, the AI modeling prompt, and scene
// data all mean the same thing by 유리벽/조적벽/유리벽돌 벽.
export const WALL_KIND_SLOT_REFS = {
  glass: 'library:preset-glass',
  masonry: 'library:flooring-rusticbrick',
  'glass-block': 'library:preset-glass-block',
} as const
export type WallMaterialKind = keyof typeof WALL_KIND_SLOT_REFS
export type WallKind = 'solid' | WallMaterialKind

export const WALL_GLASS_SLOT_REF = WALL_KIND_SLOT_REFS.glass

const WALL_KIND_BAND_ORDER = [
  'lower',
  'middle',
  'upper',
  'top',
] as const satisfies readonly WallFaceBand[]

function getWallKindByRef(ref: string | undefined): WallMaterialKind | null {
  if (!ref) return null
  for (const [kind, kindRef] of Object.entries(WALL_KIND_SLOT_REFS)) {
    if (ref === kindRef) return kind as WallMaterialKind
  }
  return null
}

// The kind a construction is built of: the first structural layer whose kind
// is itself a wall material kind (glass / masonry / glass-block).
export function getWallConstructionMaterialKind(
  construction: Pick<WallBandConstruction, 'layers'> | undefined,
): WallMaterialKind | null {
  for (const layer of construction?.layers ?? []) {
    if (layer.kind in WALL_KIND_SLOT_REFS) return layer.kind as WallMaterialKind
  }
  return null
}

// The bands a wall's construction actually uses — mirrors the band count
// rules, so stale construction entries on inactive bands are ignored.
function getActiveWallKindBands(faceBands: WallNode['faceBands']): readonly WallFaceBand[] {
  const count = faceBands?.enabled ? Math.max(1, Math.min(4, faceBands.count ?? 3)) : 1
  if (count === 1) return ['upper']
  if (count === 2) return ['lower', 'upper']
  if (count === 3) return ['lower', 'middle', 'upper']
  return WALL_KIND_BAND_ORDER
}

export function getWallKind(wall: Pick<WallNode, 'slots' | 'faceBands'>): WallKind {
  // The build decides first: a band constructed of a kind material makes the
  // wall that kind, bottom band first.
  for (const band of getActiveWallKindBands(wall.faceBands)) {
    const kind = getWallConstructionMaterialKind(wall.faceBands?.construction?.[band])
    if (kind) return kind
  }

  const slots = wall.slots ?? {}
  for (const band of WALL_KIND_BAND_ORDER) {
    const kind = getWallKindByRef(slots[getWallBandSlotId('interior', band)])
    if (kind && slots[getWallBandSlotId('exterior', band)] === WALL_KIND_SLOT_REFS[kind]) {
      return kind
    }
  }
  const faceKind = getWallKindByRef(slots.interior)
  if (faceKind && slots.exterior === WALL_KIND_SLOT_REFS[faceKind]) return faceKind
  return 'solid'
}

export function isGlassWall(wall: Pick<WallNode, 'slots' | 'faceBands'>): boolean {
  return getWallKind(wall) === 'glass'
}

// A band's build-material slot pair: the band slots when bands are enabled,
// the whole faces when the wall is a single band.
function getWallBandKindSlotIds(
  wall: Pick<WallNode, 'faceBands'>,
  band: WallFaceBand,
): readonly ['interior' | WallBandSurfaceSlotId, 'exterior' | WallBandSurfaceSlotId] {
  if (wall.faceBands?.enabled !== true) return ['interior', 'exterior']
  return [getWallBandSlotId('interior', band), getWallBandSlotId('exterior', band)]
}

export function buildWallBandKindPatch(
  wall: Pick<WallNode, 'slots' | 'faceBands'>,
  band: WallFaceBand,
  kind: WallKind,
): Pick<WallNode, 'slots'> {
  const slots = { ...(wall.slots ?? {}) }
  const kindRefs = new Set<string>(Object.values(WALL_KIND_SLOT_REFS))
  for (const slotId of getWallBandKindSlotIds(wall, band)) {
    if (kind === 'solid') {
      // Only unwind refs this table wrote — custom paint is not ours to reset.
      // Band slots return to the band palette; faces to the declared default.
      const ref = slots[slotId]
      if (ref && kindRefs.has(ref)) {
        if (slotId === 'interior' || slotId === 'exterior') delete slots[slotId]
        else slots[slotId] = getWallFaceBandDefaultSlot(slotId)
      }
    } else {
      slots[slotId] = WALL_KIND_SLOT_REFS[kind]
    }
  }
  return { slots }
}

export function getWallSurfaceSideFromBandSlot(slotId: string): WallSurfaceSide | null {
  if (slotId === 'interior' || slotId === 'exterior') return slotId
  if (
    slotId === 'lowerInterior' ||
    slotId === 'middleInterior' ||
    slotId === 'upperInterior' ||
    slotId === 'topInterior'
  ) {
    return 'interior'
  }
  if (
    slotId === 'lowerExterior' ||
    slotId === 'middleExterior' ||
    slotId === 'upperExterior' ||
    slotId === 'topExterior'
  ) {
    return 'exterior'
  }
  return null
}

export type WallSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

type WallSurfaceMaterialSource = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
  interiorMaterial?: z.infer<typeof MaterialSchema>
  interiorMaterialPreset?: string
  exteriorMaterial?: z.infer<typeof MaterialSchema>
  exteriorMaterialPreset?: string
}

function getConfiguredWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  if (side === 'interior') {
    return {
      material: wall.interiorMaterial,
      materialPreset: wall.interiorMaterialPreset,
    }
  }

  return {
    material: wall.exteriorMaterial,
    materialPreset: wall.exteriorMaterialPreset,
  }
}

function hasSurfaceMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return spec.material !== undefined || typeof spec.materialPreset === 'string'
}

export function getEffectiveWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  const configured = getConfiguredWallSurfaceMaterial(wall, side)
  if (hasSurfaceMaterial(configured)) {
    return configured
  }

  return {
    material: wall.material,
    materialPreset: wall.materialPreset,
  }
}

export function getWallSurfaceMaterialSignature(spec: WallSurfaceMaterialSpec): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}
