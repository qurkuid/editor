import type {
  WallBandConstruction,
  WallConstructionLayer,
  WallFaceBand,
  WallFaceBandConfig,
  WallNode,
} from '../schema/nodes/wall'
import { getWallCurveLength } from '../systems/wall/wall-curve'

export const WALL_CONSTRUCTION_LAYER_DEFAULTS: Record<
  WallConstructionLayer['kind'],
  WallConstructionLayer
> = {
  'gypsum-board': {
    kind: 'gypsum-board',
    thickness: 0.0095,
    sheetWidth: 0.9,
    sheetHeight: 1.8,
    wasteFactor: 0.1,
  },
  mdf: {
    kind: 'mdf',
    thickness: 0.009,
    // 9T 600×2400 — the stock size this trade actually orders, not the 4×8
    // sheet the generic default assumed.
    sheetWidth: 0.6,
    sheetHeight: 2.4,
    wasteFactor: 0.1,
  },
  'timber-stud': {
    kind: 'timber-stud',
    thickness: 0.033,
    memberWidth: 0.033,
    studSpacing: 0.3,
    wasteFactor: 0.1,
  },
  cavity: { kind: 'cavity', thickness: 0.01, wasteFactor: 0 },
  finish: { kind: 'finish', thickness: 0.001, wasteFactor: 0.1 },
  custom: { kind: 'custom', thickness: 0.01, wasteFactor: 0.1 },
  // 12T 강화유리 — 판유리는 m² 발주라 장수 규격 없음.
  glass: { kind: 'glass', thickness: 0.012, wasteFactor: 0.05 },
  // 시멘트벽돌 0.5B (190×57×90), sheet 규격은 줄눈 10mm 포함 → 75장/㎡.
  masonry: {
    kind: 'masonry',
    thickness: 0.09,
    sheetWidth: 0.2,
    sheetHeight: 0.067,
    wasteFactor: 0.05,
  },
  // 유리블록 190×190×80, 줄눈 10mm 포함 → 25장/㎡.
  'glass-block': {
    kind: 'glass-block',
    thickness: 0.08,
    sheetWidth: 0.2,
    sheetHeight: 0.2,
    wasteFactor: 0.05,
  },
}

export type WallConstructionPresetId =
  | 'finish-only'
  | 'gypsum'
  | 'mdf'
  | 'stud-gypsum'
  | 'stud-gypsum-finish'
  | 'gypsum-stud-gypsum'
  | 'glass'
  | 'masonry'
  | 'glass-block'

export function createDefaultWallFaceBands(targetThickness = 0.1): WallFaceBandConfig {
  return {
    enabled: false,
    count: 1,
    lowerHeight: 0.84,
    middleHeight: 0.61,
    upperHeight: 0.61,
    construction: {
      upper: createWallBandConstructionPreset('stud-gypsum-finish', targetThickness),
    },
  }
}

export function createWallBandConstructionPreset(
  preset: WallConstructionPresetId,
  targetThickness?: number,
): WallBandConstruction {
  if (preset === 'finish-only') return { mode: 'finish', layers: [] }
  if (preset === 'gypsum') {
    return { mode: 'overlay', layers: [{ ...WALL_CONSTRUCTION_LAYER_DEFAULTS['gypsum-board'] }] }
  }
  if (preset === 'mdf') {
    return { mode: 'overlay', layers: [{ ...WALL_CONSTRUCTION_LAYER_DEFAULTS.mdf }] }
  }
  if (preset === 'stud-gypsum') {
    return {
      mode: 'overlay',
      layers: [
        { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['timber-stud'] },
        { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['gypsum-board'] },
      ],
    }
  }
  if (preset === 'glass' || preset === 'masonry' || preset === 'glass-block') {
    // The material defines the wall's physical thickness — no cavity fill.
    return { mode: 'assembly', layers: [{ ...WALL_CONSTRUCTION_LAYER_DEFAULTS[preset] }] }
  }
  if (preset === 'stud-gypsum-finish') {
    const assembly: WallBandConstruction = {
      mode: 'assembly',
      layers: [
        { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['timber-stud'] },
        { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['gypsum-board'] },
        { ...WALL_CONSTRUCTION_LAYER_DEFAULTS.finish },
      ],
    }
    return targetThickness === undefined
      ? assembly
      : normalizeWallBandConstructionToThickness(assembly, targetThickness)
  }
  const assembly: WallBandConstruction = {
    mode: 'assembly',
    layers: [
      { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['gypsum-board'] },
      { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['timber-stud'] },
      { ...WALL_CONSTRUCTION_LAYER_DEFAULTS['gypsum-board'] },
    ],
  }
  return targetThickness === undefined
    ? assembly
    : normalizeWallBandConstructionToThickness(assembly, targetThickness)
}

export function normalizeWallBandConstructionToThickness(
  construction: WallBandConstruction,
  targetThickness: number,
): WallBandConstruction {
  if (construction.mode !== 'assembly' || construction.layers.length === 0) return construction
  const materialLayers = construction.layers.filter((layer) => layer.kind !== 'cavity')
  const materialThickness = materialLayers.reduce((sum, layer) => sum + layer.thickness, 0)
  const cavityThickness = targetThickness - materialThickness
  if (cavityThickness <= 0.0001) return { ...construction, layers: materialLayers }
  const surfaceKinds = new Set<WallConstructionLayer['kind']>([
    'gypsum-board',
    'mdf',
    'finish',
    'custom',
  ])
  let insertionIndex = materialLayers.length
  while (insertionIndex > 0 && surfaceKinds.has(materialLayers[insertionIndex - 1]!.kind)) {
    insertionIndex -= 1
  }
  return {
    ...construction,
    layers: [
      ...materialLayers.slice(0, insertionIndex),
      { ...WALL_CONSTRUCTION_LAYER_DEFAULTS.cavity, thickness: cavityThickness },
      ...materialLayers.slice(insertionIndex),
    ],
  }
}

export function detectWallConstructionPreset(
  construction: WallBandConstruction,
): WallConstructionPresetId | 'custom' {
  const kinds = construction.layers
    .filter((layer) => layer.kind !== 'cavity')
    .map((layer) => layer.kind)
    .join(',')
  if (construction.mode === 'finish' && kinds === '') return 'finish-only'
  if (construction.mode === 'overlay' && kinds === 'gypsum-board') return 'gypsum'
  if (construction.mode === 'overlay' && kinds === 'mdf') return 'mdf'
  if (construction.mode === 'overlay' && kinds === 'timber-stud,gypsum-board') {
    return 'stud-gypsum'
  }
  if (construction.mode === 'assembly' && kinds === 'timber-stud,gypsum-board,finish') {
    return 'stud-gypsum-finish'
  }
  if (construction.mode === 'assembly' && kinds === 'gypsum-board,timber-stud,gypsum-board') {
    return 'gypsum-stud-gypsum'
  }
  if (construction.mode === 'assembly' && kinds === 'glass') return 'glass'
  if (construction.mode === 'assembly' && kinds === 'masonry') return 'masonry'
  if (construction.mode === 'assembly' && kinds === 'glass-block') return 'glass-block'
  return 'custom'
}

export function getWallBandConstruction(
  wall: Pick<WallNode, 'thickness' | 'faceBands'>,
  band: WallFaceBand,
): WallBandConstruction {
  return (
    wall.faceBands?.construction?.[band] ?? {
      mode: 'assembly',
      layers: [{ ...WALL_CONSTRUCTION_LAYER_DEFAULTS.cavity, thickness: wall.thickness ?? 0.1 }],
    }
  )
}

export function getWallBandPhysicalThickness(
  wall: Pick<WallNode, 'thickness' | 'faceBands'>,
  band: WallFaceBand,
  baseThickness = wall.thickness ?? 0.1,
): number {
  const construction = getWallBandConstruction(wall, band)
  const layerThickness =
    Math.round(
      construction.layers.reduce((sum, layer) => sum + layer.thickness, 0) * 1_000_000_000,
    ) / 1_000_000_000
  if (construction.mode === 'assembly' && layerThickness > 0) return layerThickness
  if (construction.mode === 'overlay') return baseThickness + layerThickness
  return baseThickness
}

export function getWallConstructionEnvelopeThickness(
  wall: Pick<WallNode, 'thickness' | 'faceBands'>,
): number {
  const baseThickness = wall.thickness ?? 0.1
  const count = wall.faceBands?.enabled ? Math.max(1, Math.min(4, wall.faceBands.count ?? 3)) : 1
  const bands: WallFaceBand[] =
    count === 1
      ? ['upper']
      : count === 2
        ? ['lower', 'upper']
        : count === 3
          ? ['lower', 'middle', 'upper']
          : ['lower', 'middle', 'upper', 'top']
  return Math.max(...bands.map((band) => getWallBandPhysicalThickness(wall, band, baseThickness)))
}

export type WallConstructionQuantity = {
  band: WallFaceBand
  layerIndex: number
  kind: WallConstructionLayer['kind']
  areaM2: number
  volumeM3: number
  sheetCount?: number
  studCount?: number
  linearM?: number
  estimatedCost?: number
}

export type WallConstructionLayerSpan = {
  kind: WallConstructionLayer['kind']
  layerIndex: number
  start: number
  end: number
  center: number
  thickness: number
}

export function buildWallConstructionLayerSpans(
  construction: WallBandConstruction,
): WallConstructionLayerSpan[] {
  const total = construction.layers.reduce((sum, layer) => sum + layer.thickness, 0)
  let cursor = -total / 2
  return construction.layers.map((layer, layerIndex) => {
    const start = cursor
    const end = start + layer.thickness
    cursor = end
    return {
      kind: layer.kind,
      layerIndex,
      start,
      end,
      center: (start + end) / 2,
      thickness: layer.thickness,
    }
  })
}

function activeBandHeights(wall: Pick<WallNode, 'height' | 'faceBands'>, height: number) {
  const count = wall.faceBands?.enabled ? Math.max(1, Math.min(4, wall.faceBands.count ?? 3)) : 1
  const lower = count >= 2 ? Math.min(height, wall.faceBands?.lowerHeight ?? 0.84) : 0
  const middle = count >= 3 ? Math.min(height - lower, wall.faceBands?.middleHeight ?? 0.61) : 0
  const upper =
    count >= 4 ? Math.min(height - lower - middle, wall.faceBands?.upperHeight ?? 0.61) : 0
  const top = Math.max(0, height - lower - middle - upper)
  if (count === 1) return [['upper', height] as const]
  if (count === 2) return [['lower', lower] as const, ['upper', top] as const]
  if (count === 3) {
    return [['lower', lower] as const, ['middle', middle] as const, ['upper', top] as const]
  }
  return [
    ['lower', lower] as const,
    ['middle', middle] as const,
    ['upper', upper] as const,
    ['top', top] as const,
  ]
}

export function calculateWallConstructionQuantities(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset' | 'height' | 'faceBands'>,
  effectiveHeight = wall.height ?? 2.5,
): WallConstructionQuantity[] {
  const length = getWallCurveLength(wall as WallNode)
  return activeBandHeights(wall, effectiveHeight).flatMap(([band, bandHeight]) => {
    const construction = getWallBandConstruction(wall, band)
    const areaM2 = length * bandHeight
    return construction.layers.map((layer, layerIndex) => {
      const wasteMultiplier = 1 + layer.wasteFactor
      const volumeM3 = areaM2 * layer.thickness * wasteMultiplier
      if (layer.kind === 'timber-stud') {
        const spacing = layer.studSpacing ?? 0.3
        const memberWidth = layer.memberWidth ?? 0.033
        const studCount = Math.ceil(length / spacing) + 1
        const linearM = (studCount * bandHeight + length * 2) * wasteMultiplier
        return {
          band,
          layerIndex,
          kind: layer.kind,
          areaM2,
          volumeM3: memberWidth * memberWidth * linearM,
          studCount,
          linearM,
          estimatedCost: layer.unitPrice === undefined ? undefined : linearM * layer.unitPrice,
        }
      }
      const sheetArea = (layer.sheetWidth ?? 0) * (layer.sheetHeight ?? 0)
      const sheetCount =
        sheetArea > 0 ? Math.ceil((areaM2 * wasteMultiplier) / sheetArea) : undefined
      const billable = sheetCount ?? areaM2 * wasteMultiplier
      return {
        band,
        layerIndex,
        kind: layer.kind,
        areaM2,
        volumeM3,
        sheetCount,
        estimatedCost: layer.unitPrice === undefined ? undefined : billable * layer.unitPrice,
      }
    })
  })
}
