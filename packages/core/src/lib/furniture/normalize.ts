import {
  FURNITURE_ASSEMBLY_SCHEMA_VERSION,
  type FurnitureAssembly,
  FurnitureAssemblySchema,
  FurnitureBaseSchema,
  type FurnitureBay,
  FurnitureChannelSchema,
  type FurnitureFixture,
  FurnitureFixtureSchema,
  FurnitureFrontSchema,
  FurniturePanelSchema,
  type FurnitureTier,
} from '../../schema/nodes/furniture'

export { FURNITURE_ASSEMBLY_SCHEMA_VERSION }

export type FurnitureNormalizationInput = unknown
type RawRecord = Record<string, unknown>
type DimensionUnit = 'metres' | 'millimetres'

const DEFAULT_DIMENSIONS = { width: 3.6, height: 2.4, depth: 0.6 }
const DEFAULT_BAY_WIDTH = 0.9
const DEFAULT_TIER_HEIGHT = 0.7
const DEFAULT_BASE_HEIGHT = 0.05

export function millimetresToMetres(value: number): number {
  return value / 1000
}

export function metresToMillimetres(value: number): number {
  return value * 1000
}

export function normalizeFurnitureAssembly(input: FurnitureNormalizationInput): FurnitureAssembly {
  const source = unwrapFurniture(input)
  const unit = isFurnitureBuilderShape(source) ? 'millimetres' : 'metres'
  const canonical = normalizeAssemblyRecord(source, unit)
  return FurnitureAssemblySchema.parse(canonical)
}

export const normalizeFurniture = normalizeFurnitureAssembly

function unwrapFurniture(input: unknown): RawRecord {
  const record = asRecord(input)
  const nested = record?.furniture
  return asRecord(nested) ?? record ?? {}
}

function isFurnitureBuilderShape(source: RawRecord): boolean {
  return (
    Object.hasOwn(source, 'schema_version') ||
    Object.hasOwn(source, 'W') ||
    Object.hasOwn(source, 'H') ||
    Object.hasOwn(source, 'D')
  )
}

function normalizeAssemblyRecord(source: RawRecord, unit: DimensionUnit): RawRecord {
  const legacy = source.type === 'cabinet' || source.type === 'cabinet-module'
  const sourceForAssembly = legacy ? legacyCabinetToFurniture(source) : source
  const builder = isFurnitureBuilderShape(sourceForAssembly)
  const dimensions = normalizeDimensions(sourceForAssembly, builder ? 'millimetres' : unit)
  const furnitureKind = normalizeFurnitureKind(sourceForAssembly)
  const bays = normalizeBays(sourceForAssembly.bays, 'bay', builder ? 'millimetres' : unit)
  const backBays = normalizeOptionalBays(
    sourceForAssembly.backBays,
    'back-bay',
    builder ? 'millimetres' : unit,
  )
  const upperBays = normalizeOptionalBays(
    sourceForAssembly.upperBays,
    'upper-bay',
    builder ? 'millimetres' : unit,
  )
  const result: RawRecord = {
    schemaVersion: FURNITURE_ASSEMBLY_SCHEMA_VERSION,
    furnitureKind,
    location: stringValue(sourceForAssembly.location, ''),
    locationTagSync: booleanValue(sourceForAssembly.locationTagSync, true),
    dimensions,
    constraints: normalizeConstraints(sourceForAssembly, builder ? 'millimetres' : unit),
    margins: normalizeMargins(sourceForAssembly, builder ? 'millimetres' : unit),
    fillers: normalizeFillers(sourceForAssembly, builder ? 'millimetres' : unit),
    surround: normalizeSurround(sourceForAssembly, builder ? 'millimetres' : unit),
    curtain: normalizeCurtain(sourceForAssembly, builder ? 'millimetres' : unit),
    ceilingStep: normalizeCeilingStep(sourceForAssembly, builder ? 'millimetres' : unit),
    defaultFace: normalizeFace(sourceForAssembly.defaultFace ?? sourceForAssembly.face, 'front'),
    materialDefaults: normalizeMaterialDefaults(sourceForAssembly.materialDefaults),
    bays,
    fixtures: normalizeRootFixtures(sourceForAssembly, builder ? 'millimetres' : 'metres'),
  }

  const sideFinish = normalizeSideFinish(sourceForAssembly.sideFinish)
  if (sideFinish) result.sideFinish = sideFinish

  const depthSplit = normalizeDepthSplit(sourceForAssembly, builder ? 'millimetres' : unit)
  if (depthSplit) result.depthSplit = depthSplit

  const setUpper = normalizeSetUpper(sourceForAssembly.setUpper, builder ? 'millimetres' : unit)
  if (setUpper && furnitureKind === 'set') result.setUpper = setUpper

  if (backBays && furnitureKind === 'island') result.backBays = backBays
  if (upperBays && furnitureKind === 'set') result.upperBays = upperBays

  return result
}

function legacyCabinetToFurniture(source: RawRecord): RawRecord {
  if (source.furniture && asRecord(source.furniture)) return asRecord(source.furniture) as RawRecord

  const isModule = source.type === 'cabinet-module'
  const stack = Array.isArray(source.stack) ? source.stack : []
  const bay = {
    id: `${isModule ? 'module' : 'run'}-bay-0`,
    width: source.width,
    base: {
      type: source.showPlinth === false ? 'none' : 'plinth',
      height: source.plinthHeight,
    },
    kickplate: source.showPlinth !== false,
    tiers: stack,
  }

  return {
    ...source,
    bays: [bay],
    furnitureKind: source.runTier === 'wall' ? 'upper-run' : source.runTier ?? 'base-run',
    dimensions: {
      width: source.width,
      height: source.carcassHeight,
      depth: source.depth,
    },
  }
}

function normalizeFurnitureKind(source: RawRecord): string {
  const raw = stringValue(source.furnitureKind ?? source.type, 'wardrobe')
  const aliases: Record<string, string> = {
    base: 'base-run',
    base_run: 'base-run',
    upper: 'upper-run',
    upper_run: 'upper-run',
    wardrobe: 'wardrobe',
    'base-run': 'base-run',
    'upper-run': 'upper-run',
    tall: 'tall',
    island: 'island',
    set: 'set',
    sink: 'sink',
  }
  return aliases[raw] ?? 'wardrobe'
}

function normalizeDimensions(source: RawRecord, unit: DimensionUnit) {
  const dimensions = asRecord(source.dimensions)
  if (dimensions) {
    return {
      width: positiveDimension(dimensions.width, DEFAULT_DIMENSIONS.width, 'metres'),
      height: positiveDimension(dimensions.height, DEFAULT_DIMENSIONS.height, 'metres'),
      depth: positiveDimension(dimensions.depth, DEFAULT_DIMENSIONS.depth, 'metres'),
    }
  }

  const legacyDimensions = source.width !== undefined || source.carcassHeight !== undefined
  if (legacyDimensions) {
    return {
      width: positiveDimension(source.width, DEFAULT_DIMENSIONS.width, 'metres'),
      height: positiveDimension(source.carcassHeight, DEFAULT_DIMENSIONS.height, 'metres'),
      depth: positiveDimension(source.depth, DEFAULT_DIMENSIONS.depth, 'metres'),
    }
  }

  return {
    width: positiveDimension(source.W, DEFAULT_DIMENSIONS.width, unit),
    height: positiveDimension(source.H, DEFAULT_DIMENSIONS.height, unit),
    depth: positiveDimension(source.D, DEFAULT_DIMENSIONS.depth, unit),
  }
}

function normalizeConstraints(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.constraints) ?? {}
  return {
    minWidth: optionalDimension(raw.minWidth, unit),
    maxWidth: optionalDimension(raw.maxWidth, unit),
    minHeight: optionalDimension(raw.minHeight, unit),
    maxHeight: optionalDimension(raw.maxHeight, unit),
    minDepth: optionalDimension(raw.minDepth, unit),
    maxDepth: optionalDimension(raw.maxDepth, unit),
    heightLocked: booleanValue(raw.heightLocked ?? source.HLocked, false),
  }
}

function normalizeMargins(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.margins) ?? asRecord(source.margin) ?? {}
  return {
    left: nonNegativeDimension(raw.left, 0, unit),
    right: nonNegativeDimension(raw.right, 0, unit),
    top: nonNegativeDimension(raw.top, 0, unit),
    front: nonNegativeDimension(raw.front, 0, unit),
    back: nonNegativeDimension(raw.back, 0, unit),
  }
}

function normalizeFillers(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.fillers) ?? {}
  return {
    left: normalizeSideOpening(raw.left, raw.leftW, unit),
    right: normalizeSideOpening(raw.right, raw.rightW, unit),
  }
}

function normalizeSideOpening(enabled: unknown, width: unknown, unit: DimensionUnit) {
  const record = asRecord(enabled)
  return {
    enabled: record ? booleanValue(record.enabled, false) : booleanValue(enabled, false),
    width: nonNegativeDimension(record?.width ?? width, 0, unit),
  }
}

function normalizeSurround(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.surround) ?? {}
  const enabled = booleanValue(raw.enabled, false)
  return {
    enabled,
    size: nonNegativeDimension(raw.size, 0, unit),
    top: booleanValue(raw.top, enabled),
    left: booleanValue(raw.left, enabled),
    right: booleanValue(raw.right, enabled),
  }
}

function normalizeCurtain(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.curtain) ?? {}
  return {
    left: normalizeSideOpening(raw.left, raw.leftW, unit),
    right: normalizeSideOpening(raw.right, raw.rightW, unit),
    height: nonNegativeDimension(raw.height, 0, unit),
    shape: raw.shape === 'box' ? 'box' : 'solid',
    includedInTotal: booleanValue(raw.includedInTotal, false),
  }
}

function normalizeCeilingStep(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.ceilingStep) ?? asRecord(source.step) ?? {}
  return {
    left: normalizeStepSide(raw.left, raw.leftW, raw.leftH, unit),
    right: normalizeStepSide(raw.right, raw.rightW, raw.rightH, unit),
    depth: nonNegativeDimension(raw.depth ?? raw.D, 0, unit),
  }
}

function normalizeStepSide(
  enabled: unknown,
  width: unknown,
  height: unknown,
  unit: DimensionUnit,
) {
  const record = asRecord(enabled)
  return {
    enabled: record ? booleanValue(record.enabled, false) : booleanValue(enabled, false),
    width: nonNegativeDimension(record?.width ?? width, 0, unit),
    height: nonNegativeDimension(record?.height ?? height, 0, unit),
  }
}

function normalizeMaterialDefaults(input: unknown) {
  const raw = asRecord(input) ?? {}
  const result: RawRecord = {}
  for (const key of ['carcass', 'back', 'front', 'countertop', 'edge', 'hardware']) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) result[key] = value.trim()
  }
  return result
}

function normalizeSideFinish(input: unknown) {
  const raw = asRecord(input)
  if (!raw) return undefined
  const allowed = new Set(['none', 'ep18', 'ceramic12', 'ceramic18', 'stone'])
  return {
    left: allowed.has(stringValue(raw.left, 'none')) ? stringValue(raw.left, 'none') : 'none',
    right: allowed.has(stringValue(raw.right, 'none')) ? stringValue(raw.right, 'none') : 'none',
    color: stringValue(raw.color, ''),
  }
}

function normalizeDepthSplit(source: RawRecord, unit: DimensionUnit) {
  const raw = asRecord(source.depthSplit)
  const front = raw?.front ?? source.frontD
  const back = raw?.back ?? source.backD
  if (front === undefined && back === undefined) return undefined
  return {
    front: positiveDimension(front, 0.3, unit),
    back: positiveDimension(back, 0.7, unit),
  }
}

function normalizeSetUpper(input: unknown, unit: DimensionUnit) {
  const raw = asRecord(input)
  if (!raw) return undefined
  return {
    enabled: booleanValue(raw.enabled, true),
    height: positiveDimension(raw.height, 0.7, unit),
    depth: positiveDimension(raw.depth, 0.35, unit),
    gap: nonNegativeDimension(raw.gap, 0.1, unit),
    totalWidth: positiveDimension(raw.totalWidth ?? raw.totalW, DEFAULT_DIMENSIONS.width, unit),
    anchor: raw.anchor === 'upper' ? 'upper' : 'lower',
    gapLocked: booleanValue(raw.gapLocked, false),
    heightLocked: booleanValue(raw.heightLocked, false),
  }
}

function normalizeOptionalBays(input: unknown, prefix: string, unit: DimensionUnit) {
  if (!Array.isArray(input)) return undefined
  return normalizeBays(input, prefix, unit)
}

function normalizeBays(input: unknown, prefix: string, unit: DimensionUnit): FurnitureBay[] {
  if (!Array.isArray(input)) return []
  return input.map((bay, index) => normalizeBay(asRecord(bay) ?? {}, `${prefix}-${index}`, unit))
}

function normalizeBay(source: RawRecord, fallbackId: string, unit: DimensionUnit): FurnitureBay {
  const rawBase = asRecord(source.base) ?? {}
  const rawBaseBack = asRecord(source.baseBack)
  const result: RawRecord = {
    id: stringValue(source.id, fallbackId),
    width: positiveDimension(source.width, DEFAULT_BAY_WIDTH, unit),
    widthLocked: booleanValue(source.widthLocked, false),
    base: normalizeBase(rawBase, unit),
    kickplate: booleanValue(source.kickplate, true),
    endPanels: {
      left: booleanValue(asRecord(source.endPanels)?.left ?? asRecord(source.ep)?.left, false),
      right: booleanValue(asRecord(source.endPanels)?.right ?? asRecord(source.ep)?.right, false),
    },
    visible: source.visible === undefined ? !booleanValue(source.hidden, false) : booleanValue(source.visible, true),
    lowerStile:
      source.lowerStile === undefined
        ? !booleanValue(source.noLowerStile, false)
        : booleanValue(source.lowerStile, true),
    tiers: normalizeTiers(source.tiers, `${fallbackId}-tier`, unit),
  }
  if (rawBaseBack) result.baseBack = normalizeBase(rawBaseBack, unit)
  return result as FurnitureBay
}

function normalizeBase(source: RawRecord, unit: DimensionUnit) {
  const rawType = stringValue(source.type, 'plinth')
  const type = rawType === 'leg' || rawType === 'legs' ? 'legs' : rawType
  if (type === 'none') return FurnitureBaseSchema.parse({ type: 'none' })
  const normalizedType = type === 'floating' ? 'floating' : type === 'legs' ? 'legs' : 'plinth'
  return FurnitureBaseSchema.parse({
    type: normalizedType,
    height: nonNegativeDimension(source.height, normalizedType === 'plinth' ? DEFAULT_BASE_HEIGHT : 0.1, unit),
  })
}

function normalizeTiers(input: unknown, prefix: string, unit: DimensionUnit): FurnitureTier[] {
  if (!Array.isArray(input)) return []
  return input.map((tier, index) => normalizeTier(asRecord(tier) ?? {}, `${prefix}-${index}`, unit))
}

function normalizeTier(source: RawRecord, fallbackId: string, unit: DimensionUnit): FurnitureTier {
  const sourceDoor = source.door ?? source.type
  const rawDepth = asRecord(source.depth) ?? {}
  const rawExtension = asRecord(source.doorExtension) ?? asRecord(source.doorExt) ?? {}
  const rawChannels = asRecord(source.channels) ?? asRecord(source.channel) ?? {}
  const rawTopPanel = source.topPanel
  const rawBottomPanel = source.bottomPanel
  const result = {
    id: stringValue(source.id, fallbackId),
    height: positiveDimension(source.height, DEFAULT_TIER_HEIGHT, unit),
    depth: {
      value: nonNegativeDimension(rawDepth.value, 0, unit),
      reference: rawDepth.reference === 'back' ? 'back' : 'door',
    },
    face: normalizeFace(source.face, 'front'),
    front: normalizeFront(source.front ?? sourceDoor, source),
    openMethod: normalizeOpenMethod(source.openMethod ?? source.openType),
    doorExtension: {
      top: finiteDimension(rawExtension.top, 0, unit),
      bottom: finiteDimension(rawExtension.bottom, 0, unit),
    },
    visible: source.visible === undefined ? !booleanValue(source.hidden, false) : booleanValue(source.visible, true),
    heightLocked: booleanValue(source.heightLocked, false),
    shelves: normalizeCountHeights(source.shelves ?? source.shelfCount, 8, unit),
    hanger: booleanValue(source.hanger, false),
    internalDrawers: normalizeCountHeights(source.internalDrawers, 2, unit),
    channels: {
      top: normalizeChannel(rawChannels.top, 'top', unit),
      middle: normalizeChannel(rawChannels.middle, 'middle', unit),
    },
    topPanel: normalizePanel(rawTopPanel, unit),
    bottomPanel: normalizePanel(rawBottomPanel ?? (source.epBottom ? { enabled: true } : undefined), unit),
    mergeNext: booleanValue(source.mergeNext, false),
    fixtures: normalizeTierFixtures(source, fallbackId, unit),
  }
  return result as FurnitureTier
}

function normalizeFront(input: unknown, source: RawRecord): FurnitureTier['front'] {
  const raw = asRecord(input)
  if (raw?.kind) {
    const kind = stringValue(raw.kind, 'open')
    if (kind === 'hinged') {
      return FurnitureFrontSchema.parse({
        kind,
        leaves: integerValue(raw.leaves, 2, 1, 2),
        glass: booleanValue(raw.glass, false),
        color: stringValue(raw.color, ''),
        materialId: stringValueOrUndefined(raw.materialId),
      })
    }
    if (kind === 'drawer') {
      return FurnitureFrontSchema.parse({
        kind,
        count: integerValue(raw.count, 1, 1, 6),
        color: stringValue(raw.color, ''),
        materialId: stringValueOrUndefined(raw.materialId),
      })
    }
    if (kind === 'flap') {
      return FurnitureFrontSchema.parse({
        kind,
        direction: raw.direction === 'down' ? 'down' : 'up',
        color: stringValue(raw.color, ''),
        materialId: stringValueOrUndefined(raw.materialId),
      })
    }
    if (kind === 'sliding') {
      return FurnitureFrontSchema.parse({
        kind,
        leaves: integerValue(raw.leaves, 2, 2, 4),
        color: stringValue(raw.color, ''),
        materialId: stringValueOrUndefined(raw.materialId),
      })
    }
    if (kind === 'pull-out') {
      const style = raw.style === 'spice' || raw.style === 'pantry' ? raw.style : 'standard'
      return FurnitureFrontSchema.parse({
        kind,
        style,
        color: stringValue(raw.color, ''),
        materialId: stringValueOrUndefined(raw.materialId),
      })
    }
    return FurnitureFrontSchema.parse({
      kind: 'open',
      color: stringValue(raw.color, ''),
      materialId: stringValueOrUndefined(raw.materialId),
    })
  }

  const rawDoor = stringValue(input, 'hinged2')
  const door = rawDoor === 'door' ? 'hinged2' : rawDoor === 'shelf' ? 'open' : rawDoor
  const color = stringValue(source.doorColor, '')
  const materialId = stringValueOrUndefined(source.doorMaterial)
  if (door === 'open') return FurnitureFrontSchema.parse({ kind: 'open', color, materialId })
  if (door === 'hinged1' || door === 'single-left' || door === 'single-right') {
    return FurnitureFrontSchema.parse({ kind: 'hinged', leaves: 1, color, materialId })
  }
  if (door === 'glass') return FurnitureFrontSchema.parse({ kind: 'hinged', leaves: 2, glass: true, color, materialId })
  if (door === 'hinged2' || door === 'double') {
    return FurnitureFrontSchema.parse({ kind: 'hinged', leaves: 2, color, materialId })
  }
  if (door === 'drawer_external' || door === 'drawer_internal' || door === 'drawer') {
    return FurnitureFrontSchema.parse({
      kind: 'drawer',
      count: integerValue(source.drawerCount, 1, 1, 6),
      color,
      materialId,
    })
  }
  if (door === 'flap' || door === 'liftup' || door === 'lift-up') {
    return FurnitureFrontSchema.parse({ kind: 'flap', direction: 'up', color, materialId })
  }
  if (door === 'underflap' || door === 'under-flap') {
    return FurnitureFrontSchema.parse({ kind: 'flap', direction: 'down', color, materialId })
  }
  if (door === 'sliding2' || door === 'sliding') {
    return FurnitureFrontSchema.parse({ kind: 'sliding', leaves: 2, color, materialId })
  }
  if (door === 'sliding3' || door === 'sliding4') {
    return FurnitureFrontSchema.parse({ kind: 'sliding', leaves: Number(door.slice(-1)), color, materialId })
  }
  if (door === 'spice_pullout') {
    return FurnitureFrontSchema.parse({ kind: 'pull-out', style: 'spice', color, materialId })
  }
  if (door === 'pullout' || door === 'pull_out') {
    return FurnitureFrontSchema.parse({ kind: 'pull-out', style: 'standard', color, materialId })
  }
  return FurnitureFrontSchema.parse({ kind: 'open', color, materialId })
}

function normalizeOpenMethod(input: unknown): 'push' | 'channel' | 'jbar' {
  return input === 'channel' || input === 'jbar' ? input : 'push'
}

function normalizeFace(input: unknown, fallback: 'front' | 'back' | 'both') {
  return input === 'front' || input === 'back' || input === 'both' ? input : fallback
}

function normalizeCountHeights(input: unknown, max: 2 | 8, unit: DimensionUnit) {
  const raw = asRecord(input)
  const rawHeights = raw ? raw.heights : Array.isArray(input) ? input : []
  const heights = Array.isArray(rawHeights)
    ? rawHeights.slice(0, max).map((height) => nonNegativeDimension(height, 0, unit))
    : []
  const requestedCount = raw
    ? integerValue(raw.count, heights.length, 0, max)
    : typeof input === 'number'
      ? integerValue(input, 0, 0, max)
      : heights.length
  while (heights.length < requestedCount) heights.push(0)
  const result = { count: requestedCount, heights: heights.slice(0, requestedCount) }
  return max === 2 ? result : result
}

function normalizeChannel(input: unknown, kind: 'top' | 'middle', unit: DimensionUnit) {
  const raw = asRecord(input)
  const defaults = kind === 'top' ? { height: 0.04, depth: 0.022, handSpace: 0.02 } : { height: 0.08, depth: 0.022, handSpace: 0.02 }
  if (!raw) {
    return FurnitureChannelSchema.parse({ enabled: booleanValue(input, false), ...defaults, color: '' })
  }
  return FurnitureChannelSchema.parse({
    enabled: booleanValue(raw.enabled, false),
    height: nonNegativeDimension(raw.height, defaults.height, unit),
    depth: nonNegativeDimension(raw.depth, defaults.depth, unit),
    handSpace: nonNegativeDimension(raw.handSpace, defaults.handSpace, unit),
    color: stringValue(raw.color, ''),
  })
}

function normalizePanel(input: unknown, unit: DimensionUnit) {
  const raw = asRecord(input)
  if (!raw || raw.enabled === false || raw.kind === 'none') return FurniturePanelSchema.parse({ kind: 'none' })
  const rawChamfer = asRecord(raw.chamfer) ?? {}
  const materials = new Set(['ep', 'ceramic', 'stone', 'paint', 'mdf'])
  const material = stringValue(raw.material, 'ep')
  return FurniturePanelSchema.parse({
    kind: 'panel',
    thickness: positiveDimension(raw.thickness, 0.018, unit),
    material: materials.has(material) ? material : 'ep',
    overhang: nonNegativeDimension(raw.overhang, 0, unit),
    color: stringValue(raw.color, ''),
    chamfer: {
      enabled: booleanValue(rawChamfer.enabled, false),
      size: nonNegativeDimension(rawChamfer.size, 0, unit),
    },
  })
}

function normalizeFixtures(input: unknown, prefix: string, unit: DimensionUnit): Array<FurnitureFixture | null> {
  if (!Array.isArray(input)) return []
  return input.map((fixture, index) => normalizeFixture(asRecord(fixture) ?? {}, `${prefix}-${index}`, unit))
}

function normalizeTierFixtures(source: RawRecord, prefix: string, unit: DimensionUnit): FurnitureFixture[] {
  const fixtures = normalizeFixtures(source.fixtures, `${prefix}-fixture`, unit).filter(
    (fixture): fixture is FurnitureFixture => fixture !== null,
  )
  const markers = asRecord(source.tierMarkers)
  if (markers) {
    const induction = normalizeMarkerRect(markers.induction, 'induction', `${prefix}-induction`, unit)
    const sink = normalizeMarkerRect(markers.sinkBowl, 'sink-bowl', `${prefix}-sink-bowl`, unit)
    const faucet = normalizeMarkerPoint(markers.faucet, `${prefix}-faucet`, unit)
    fixtures.push(...[induction, sink, faucet].filter((fixture): fixture is FurnitureFixture => fixture !== null))
  }
  fixtures.push(...normalizeLights(source.lights, `${prefix}-light`, unit))
  fixtures.push(...normalizeOutlets(source.outlets, `${prefix}-outlet`, unit))
  fixtures.push(...normalizeSmps(source.smps, `${prefix}-smps`, unit))
  return fixtures
}

function normalizeMarkerRect(input: unknown, type: 'induction' | 'sink-bowl', id: string, unit: DimensionUnit): FurnitureFixture | null {
  const raw = asRecord(input)
  if (!raw || !booleanValue(raw.enabled, false)) return null
  const position = { x: nonNegativeDimension(raw.x, 0, unit), y: nonNegativeDimension(raw.y, 0, unit) }
  const size = {
    width: positiveDimension(raw.w, type === 'induction' ? 0.6 : 0.828, unit),
    depth: positiveDimension(raw.d, type === 'induction' ? 0.522 : 0.432, unit),
  }
  if (type === 'induction') {
    return FurnitureFixtureSchema.parse({ type, id, enabled: true, position, size, model: stringValue(raw.model, '') })
  }
  return FurnitureFixtureSchema.parse({
    type,
    id,
    enabled: true,
    position,
    size,
    radius: nonNegativeDimension(raw.r, 0, unit),
    model: stringValue(raw.model, ''),
    bowlHeight: 0.2,
  })
}

function normalizeMarkerPoint(input: unknown, id: string, unit: DimensionUnit): FurnitureFixture | null {
  const raw = asRecord(input)
  if (!raw || !booleanValue(raw.enabled, false)) return null
  return FurnitureFixtureSchema.parse({
    type: 'faucet',
    id,
    enabled: true,
    position: { x: nonNegativeDimension(raw.x, 0, unit), y: nonNegativeDimension(raw.y, 0, unit) },
    diameter: positiveDimension(raw.dia, 0.035, unit),
    componentName: stringValue(raw.component, ''),
  })
}

function normalizeLights(input: unknown, prefix: string, unit: DimensionUnit): FurnitureFixture[] {
  if (!Array.isArray(input)) return []
  return input.map((value, index) => {
    const raw = asRecord(value) ?? {}
    const mount = normalizeLightMount(raw.mount)
    const defaultAxis = mount === 'left' || mount === 'right' ? 'height' : 'length'
    const axis = ['length', 'depth', 'height'].includes(stringValue(raw.axis, defaultAxis))
      ? stringValue(raw.axis, defaultAxis)
      : defaultAxis
    return FurnitureFixtureSchema.parse({
      type: 'light',
      id: stringValue(raw.id, `${prefix}-${index}`),
      mount,
      axis,
      shelfIndex: integerValue(raw.shelf_idx ?? raw.shelfIndex, 1, 1, 8),
      inset: nonNegativeDimension(raw.inset, 0.03, unit),
      componentName: stringValue(raw.componentName, ''),
      rotate: finiteNumber(raw.rotate, 0),
    })
  })
}

function normalizeOutlets(input: unknown, prefix: string, unit: DimensionUnit): FurnitureFixture[] {
  if (!Array.isArray(input)) return []
  return input.map((value, index) => {
    const raw = asRecord(value) ?? {}
    return FurnitureFixtureSchema.parse({
      type: 'outlet',
      id: stringValue(raw.id, `${prefix}-${index}`),
      mount: normalizeMount(raw.mount),
      position: { x: nonNegativeDimension(raw.x, 0.1, unit), z: nonNegativeDimension(raw.z, 0.1, unit) },
      size: {
        width: positiveDimension(raw.w, 0.086, unit),
        height: positiveDimension(raw.h, 0.086, unit),
      },
      componentName: stringValue(raw.componentName, ''),
    })
  })
}

function normalizeSmps(input: unknown, prefix: string, unit: DimensionUnit): FurnitureFixture[] {
  if (!Array.isArray(input)) return []
  return input.map((value, index) => {
    const raw = asRecord(value) ?? {}
    return FurnitureFixtureSchema.parse({
      type: 'smps',
      id: stringValue(raw.id, `${prefix}-${index}`),
      mount: normalizeMount(raw.mount),
      position: { x: nonNegativeDimension(raw.x, 0.05, unit), z: nonNegativeDimension(raw.z, 0.05, unit) },
      size: {
        width: positiveDimension(raw.w, 0.2, unit),
        depth: positiveDimension(raw.d, 0.04, unit),
        height: positiveDimension(raw.h, 0.03, unit),
      },
      componentName: stringValue(raw.componentName, ''),
    })
  })
}

function normalizeMount(input: unknown) {
  return ['back', 'left', 'right', 'top', 'bottom'].includes(stringValue(input, 'back'))
    ? stringValue(input, 'back')
    : 'back'
}

function normalizeLightMount(input: unknown) {
  return ['left', 'right', 'top', 'bottom', 'shelf'].includes(stringValue(input, 'top'))
    ? stringValue(input, 'top')
    : 'top'
}

function normalizeFixture(source: RawRecord, fallbackId: string, unit: DimensionUnit): FurnitureFixture | null {
  const type = stringValue(source.type, '')
  if (!type) return null
  const id = stringValue(source.id, fallbackId)
  if (type === 'induction' || type === 'sink-bowl') {
    const position = asRecord(source.position) ?? {}
    const size = asRecord(source.size) ?? {}
    if (type === 'induction') {
      return FurnitureFixtureSchema.parse({
        type,
        id,
        enabled: booleanValue(source.enabled, true),
        position: { x: nonNegativeDimension(position.x, 0, unit), y: nonNegativeDimension(position.y, 0, unit) },
        size: { width: positiveDimension(size.width, 0.6, unit), depth: positiveDimension(size.depth, 0.522, unit) },
        model: stringValue(source.model, ''),
      })
    }
    return FurnitureFixtureSchema.parse({
      type,
      id,
      enabled: booleanValue(source.enabled, true),
      position: { x: nonNegativeDimension(position.x, 0, unit), y: nonNegativeDimension(position.y, 0, unit) },
      size: { width: positiveDimension(size.width, 0.828, unit), depth: positiveDimension(size.depth, 0.432, unit) },
      radius: nonNegativeDimension(source.radius, 0, unit),
      model: stringValue(source.model, ''),
      bowlHeight: nonNegativeDimension(source.bowlHeight, 0.2, unit),
    })
  }
  if (type === 'faucet') {
    const position = asRecord(source.position) ?? {}
    return FurnitureFixtureSchema.parse({
      type,
      id,
      enabled: booleanValue(source.enabled, true),
      position: { x: nonNegativeDimension(position.x, 0, unit), y: nonNegativeDimension(position.y, 0, unit) },
      diameter: positiveDimension(source.diameter, 0.035, unit),
      componentName: stringValue(source.componentName, ''),
    })
  }
  if (type === 'light') {
    return FurnitureFixtureSchema.parse({
      type,
      id,
      mount: normalizeLightMount(source.mount),
      axis: ['length', 'depth', 'height'].includes(stringValue(source.axis, 'length'))
        ? stringValue(source.axis, 'length')
        : 'length',
      shelfIndex: integerValue(source.shelfIndex, 1, 1, 8),
      inset: nonNegativeDimension(source.inset, 0, unit),
      componentName: stringValue(source.componentName, ''),
      rotate: finiteNumber(source.rotate, 0),
    })
  }
  if (type === 'outlet' || type === 'smps') {
    const position = asRecord(source.position) ?? {}
    const size = asRecord(source.size) ?? {}
    const common = {
      type,
      id,
      mount: normalizeMount(source.mount),
      position: { x: nonNegativeDimension(position.x, 0, unit), z: nonNegativeDimension(position.z, 0, unit) },
      componentName: stringValue(source.componentName, ''),
    }
    if (type === 'outlet') {
      return FurnitureFixtureSchema.parse({
        ...common,
        size: { width: positiveDimension(size.width, 0.086, unit), height: positiveDimension(size.height, 0.086, unit) },
      })
    }
    return FurnitureFixtureSchema.parse({
      ...common,
      size: {
        width: positiveDimension(size.width, 0.2, unit),
        depth: positiveDimension(size.depth, 0.04, unit),
        height: positiveDimension(size.height, 0.03, unit),
      },
    })
  }
  return null
}

function normalizeRootFixtures(source: RawRecord, unit: DimensionUnit): FurnitureFixture[] {
  const fixtures = normalizeFixtures(source.fixtures, 'fixture', unit).filter(
    (fixture): fixture is FurnitureFixture => fixture !== null,
  )
  const sink = asRecord(source.sink)
  if (sink?.enabled) {
    fixtures.push(
      FurnitureFixtureSchema.parse({
        type: 'sink-bowl',
        id: 'fixture-sink-bowl',
        enabled: true,
        position: { x: 0, y: 0 },
        size: {
          width: positiveDimension(sink.cutoutW, 0.828, unit),
          depth: positiveDimension(sink.cutoutD, 0.432, unit),
        },
        radius: nonNegativeDimension(sink.cutoutR, 0.024, unit),
        model: stringValue(sink.preset, ''),
        bowlHeight: nonNegativeDimension(sink.bowlH, 0.2, unit),
      }),
    )
  }
  const induction = asRecord(source.induction)
  if (induction?.enabled) {
    fixtures.push(
      FurnitureFixtureSchema.parse({
        type: 'induction',
        id: 'fixture-induction',
        enabled: true,
        position: { x: 0, y: 0 },
        size: {
          width: positiveDimension(induction.width, 0.6, unit),
          depth: positiveDimension(induction.depth, 0.522, unit),
        },
        model: stringValue(induction.preset, ''),
      }),
    )
  }
  return fixtures
}

function asRecord(value: unknown): RawRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function stringValueOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(finiteNumber(value, fallback)), min), max)
}

function optionalDimension(value: unknown, unit: DimensionUnit): number | undefined {
  return value === undefined ? undefined : positiveDimension(value, 0.001, unit)
}

function positiveDimension(value: unknown, fallback: number, unit: DimensionUnit): number {
  const numeric = finiteNumber(value, fallback)
  const metres = unit === 'millimetres' ? millimetresToMetres(numeric) : numeric
  return Math.max(metres, 0.001)
}

function nonNegativeDimension(value: unknown, fallback: number, unit: DimensionUnit): number {
  const numeric = finiteNumber(value, fallback)
  const metres = unit === 'millimetres' ? millimetresToMetres(numeric) : numeric
  return Math.max(metres, 0)
}

function finiteDimension(value: unknown, fallback: number, unit: DimensionUnit): number {
  const numeric = finiteNumber(value, fallback)
  return unit === 'millimetres' ? millimetresToMetres(numeric) : numeric
}
