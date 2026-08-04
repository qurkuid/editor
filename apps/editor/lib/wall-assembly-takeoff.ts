import {
  calculateWallConstructionQuantities,
  getWallBandConstruction,
  type WallNode,
} from '@pascal-app/core'
import type { TakeoffLineInput } from './quantity-takeoff'

/**
 * A build-up, expanded into the materials that actually get ordered.
 *
 * "20㎡ of wall" is not something anyone buys. What gets bought is so many
 * lengths of 각재 at a given spacing and so many sheets of 석고보드 — and every
 * wall already carries that recipe, per band, in `faceBands.construction`.
 *
 * Walls delegate the arithmetic to core's own `calculateWallConstructionQuantities`,
 * which already handles bands, curved runs and plates. Floors and ceilings have
 * no core equivalent, so `surfaceAssemblyLines` does the same job for their flat
 * layer list. Both drop `cavity` layers — empty space is not a material.
 */

export type WallConstructionLayerLike = {
  kind: string
  thickness?: number
  memberWidth?: number
  studSpacing?: number
  /** Surfaces name it `memberSpacing`; walls name it `studSpacing`. */
  memberSpacing?: number
  sheetWidth?: number
  sheetHeight?: number
  wasteFactor?: number
  productRef?: string
  brand?: string
}

export type WallFace = {
  /** Face area in m², already net of whatever the caller deducted. */
  area: number
  /** Run length in m — studs are counted along this. */
  length: number
  /** Wall height in m. */
  height: number
}

const LAYER_LABEL: Record<string, string> = {
  'gypsum-board': '석고보드',
  plywood: '합판',
  mdf: 'MDF',
  'timber-stud': '각재',
  'timber-joist': '장선',
  furring: '각재',
  insulation: '단열재',
  screed: '방통',
  finish: '마감재',
  custom: '기타 자재',
}

/** Kinds framed as members at a spacing rather than laid as sheets. */
const FRAMING_KINDS = new Set(['timber-stud', 'timber-joist', 'furring'])

function layerLabel(layer: WallConstructionLayerLike): string {
  const base = LAYER_LABEL[layer.kind] ?? layer.kind
  const spec = layer.memberWidth ? ` ${Math.round(layer.memberWidth * 1000)}mm` : ''
  return `${base}${spec}`
}

/**
 * Studs run floor-to-ceiling at `studSpacing`, so the count is the number of
 * gaps that fit across the run, plus one for the closing member. Total length
 * is what gets ordered, since 각재 is bought by the metre.
 */
function studLines(
  layer: WallConstructionLayerLike,
  face: WallFace,
  nodeId: string,
  category: TakeoffLineInput['category'],
): TakeoffLineInput[] {
  const spacing = layer.studSpacing ?? layer.memberSpacing
  if (!spacing || spacing <= 0 || face.length <= 0 || face.height <= 0) return []

  const count = Math.floor(face.length / spacing) + 1
  const waste = 1 + (layer.wasteFactor ?? 0)
  return [
    {
      category,
      key: `${layer.kind}:${layer.memberWidth ?? 'std'}:length`,
      label: `${layerLabel(layer)} (@${Math.round(spacing * 1000)}mm)`,
      unit: 'm',
      quantity: count * face.height * waste,
      nodeIds: [nodeId],
      materialRef: layer.productRef,
      layerKind: layer.kind,
    },
  ]
}

/** Sheet goods are ordered by the sheet, so area is divided by sheet size. */
function sheetLines(
  layer: WallConstructionLayerLike,
  face: WallFace,
  nodeId: string,
  category: TakeoffLineInput['category'],
): TakeoffLineInput[] {
  const waste = 1 + (layer.wasteFactor ?? 0)
  const sheetArea = layer.sheetWidth && layer.sheetHeight ? layer.sheetWidth * layer.sheetHeight : 0

  if (sheetArea > 0) {
    return [
      {
        category,
        key: `${layer.kind}:${layer.sheetWidth}x${layer.sheetHeight}`,
        label: `${layerLabel(layer)} ${Math.round(layer.sheetWidth! * 1000)}×${Math.round(
          layer.sheetHeight! * 1000,
        )}`,
        unit: 'ea',
        quantity: Math.ceil((face.area * waste) / sheetArea),
        nodeIds: [nodeId],
        materialRef: layer.productRef,
        layerKind: layer.kind,
      },
    ]
  }

  // No sheet size on record — fall back to area so the layer is still visible
  // and priceable, rather than silently vanishing.
  return [
    {
      category,
      key: `${layer.kind}:area`,
      label: layerLabel(layer),
      unit: 'm2',
      quantity: face.area * waste,
      nodeIds: [nodeId],
      materialRef: layer.productRef,
      layerKind: layer.kind,
    },
  ]
}

/**
 * Expand a wall's bands into takeoff lines.
 *
 * The counting is core's: it walks the active bands at their heights, measures
 * the curved run length, and returns studs (with their top and bottom plates),
 * sheets and areas already multiplied by each layer's waste factor. All that is
 * left here is naming and grouping them for an order.
 *
 * A wall with no build-up recorded falls back, in core, to a single cavity
 * layer — so it produces nothing here and is left to its plain face-area line.
 */
export function wallAssemblyLines(wall: WallNode): TakeoffLineInput[] {
  const lines: TakeoffLineInput[] = []

  for (const quantity of calculateWallConstructionQuantities(wall)) {
    const layer = getWallBandConstruction(wall, quantity.band).layers[quantity.layerIndex]
    if (!layer || layer.kind === 'cavity') continue
    // The build-up's own `finish` skin is the same surface the wall's material
    // slots already price. Counting both would order the finish twice.
    if (layer.kind === 'finish') continue

    // Bands are deliberately absent from the key: the same board in the lower
    // and upper band is one line on the order, not two.
    if (quantity.linearM != null) {
      lines.push({
        category: 'wall',
        key: `${layer.kind}:${layer.memberWidth ?? 'std'}:${layer.studSpacing ?? 'std'}`,
        label: `${layerLabel(layer)} (@${Math.round((layer.studSpacing ?? 0) * 1000)}mm)`,
        unit: 'm',
        quantity: quantity.linearM,
        nodeIds: [wall.id],
        materialRef: layer.productRef,
        layerKind: layer.kind,
      })
      continue
    }

    if (quantity.sheetCount != null) {
      lines.push({
        category: 'wall',
        key: `${layer.kind}:${layer.sheetWidth}x${layer.sheetHeight}`,
        label: `${layerLabel(layer)} ${Math.round((layer.sheetWidth ?? 0) * 1000)}×${Math.round(
          (layer.sheetHeight ?? 0) * 1000,
        )}`,
        unit: 'ea',
        quantity: quantity.sheetCount,
        nodeIds: [wall.id],
        materialRef: layer.productRef,
        layerKind: layer.kind,
      })
      continue
    }

    // No sheet size on record — an area line is still priceable, and better
    // than a layer that silently vanishes.
    lines.push({
      category: 'wall',
      key: `${layer.kind}:area`,
      label: layerLabel(layer),
      unit: 'm2',
      quantity: quantity.areaM2 * (1 + layer.wasteFactor),
      nodeIds: [wall.id],
      materialRef: layer.productRef,
      layerKind: layer.kind,
    })
  }

  return lines
}

/**
 * The same expansion for a horizontal surface. Floors and ceilings carry a
 * flat layer list rather than bands, and report under their own category so a
 * ceiling's furring doesn't land in the wall totals.
 */
export function surfaceAssemblyLines(
  layers: readonly WallConstructionLayerLike[] | undefined,
  face: WallFace,
  nodeId: string,
  category: TakeoffLineInput['category'],
): TakeoffLineInput[] {
  const lines: TakeoffLineInput[] = []
  for (const layer of layers ?? []) {
    if (layer.kind === 'cavity') continue
    // Screed is poured, so it is bought by volume, not by area or by sheet.
    if (layer.kind === 'screed') {
      if (layer.thickness && face.area > 0) {
        lines.push({
          category,
          key: `screed:${layer.thickness}`,
          label: `${layerLabel(layer)} ${Math.round(layer.thickness * 1000)}mm`,
          unit: 'm3',
          quantity: face.area * layer.thickness * (1 + (layer.wasteFactor ?? 0)),
          nodeIds: [nodeId],
          materialRef: layer.productRef,
          layerKind: layer.kind,
        })
      }
      continue
    }
    lines.push(
      ...(FRAMING_KINDS.has(layer.kind)
        ? studLines(layer, face, nodeId, category)
        : sheetLines(layer, face, nodeId, category)),
    )
  }
  return lines
}
