import type { TakeoffLine } from './quantity-takeoff'

/**
 * A wall's build-up, expanded into the materials that actually get ordered.
 *
 * "20㎡ of wall" is not something anyone buys. What gets bought is so many
 * lengths of 각재 at a given spacing and so many sheets of 석고보드 — and the
 * wall already carries that recipe in `construction[band].layers`
 * (`WallConstructionLayer`: member width, stud spacing, sheet size, waste).
 * This turns the recipe plus the wall's dimensions into per-material lines.
 *
 * Layers with no recipe fall back to area, which is still more useful than
 * nothing; a `cavity` layer is empty space and yields nothing at all.
 */

export type WallConstructionLayerLike = {
  kind: string
  thickness?: number
  memberWidth?: number
  studSpacing?: number
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
  mdf: 'MDF',
  'timber-stud': '각재',
  finish: '마감재',
  custom: '기타 자재',
}

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
): TakeoffLine[] {
  const spacing = layer.studSpacing
  if (!spacing || spacing <= 0 || face.length <= 0 || face.height <= 0) return []

  const count = Math.floor(face.length / spacing) + 1
  const waste = 1 + (layer.wasteFactor ?? 0)
  return [
    {
      category: 'wall',
      key: `${layer.kind}:${layer.memberWidth ?? 'std'}:length`,
      label: `${layerLabel(layer)} (@${Math.round(spacing * 1000)}mm)`,
      unit: 'm',
      quantity: count * face.height * waste,
      nodeIds: [nodeId],
      materialRef: layer.productRef,
    },
  ]
}

/** Sheet goods are ordered by the sheet, so area is divided by sheet size. */
function sheetLines(
  layer: WallConstructionLayerLike,
  face: WallFace,
  nodeId: string,
): TakeoffLine[] {
  const waste = 1 + (layer.wasteFactor ?? 0)
  const sheetArea = layer.sheetWidth && layer.sheetHeight ? layer.sheetWidth * layer.sheetHeight : 0

  if (sheetArea > 0) {
    return [
      {
        category: 'wall',
        key: `${layer.kind}:${layer.sheetWidth}x${layer.sheetHeight}`,
        label: `${layerLabel(layer)} ${Math.round(layer.sheetWidth! * 1000)}×${Math.round(
          layer.sheetHeight! * 1000,
        )}`,
        unit: 'ea',
        quantity: Math.ceil((face.area * waste) / sheetArea),
        nodeIds: [nodeId],
        materialRef: layer.productRef,
      },
    ]
  }

  // No sheet size on record — fall back to area so the layer is still visible
  // and priceable, rather than silently vanishing.
  return [
    {
      category: 'wall',
      key: `${layer.kind}:area`,
      label: layerLabel(layer),
      unit: 'm2',
      quantity: face.area * waste,
      nodeIds: [nodeId],
      materialRef: layer.productRef,
    },
  ]
}

/**
 * Expand every layer of every band into takeoff lines.
 *
 * `construction` is keyed by band; a wall with no construction recorded
 * produces nothing here and is left to the plain face-area line.
 */
export function wallAssemblyLines(
  construction: Readonly<Record<string, { mode?: string; layers?: WallConstructionLayerLike[] }>>,
  face: WallFace,
  nodeId: string,
): TakeoffLine[] {
  const lines: TakeoffLine[] = []

  for (const band of Object.values(construction ?? {})) {
    // Only an `assembly` band describes a real build-up; `finish`/`overlay`
    // bands are surface treatments already counted as finishes.
    if (band?.mode !== 'assembly') continue

    for (const layer of band.layers ?? []) {
      if (layer.kind === 'cavity') continue // empty space is not a material
      lines.push(
        ...(layer.kind === 'timber-stud'
          ? studLines(layer, face, nodeId)
          : sheetLines(layer, face, nodeId)),
      )
    }
  }

  return lines
}
