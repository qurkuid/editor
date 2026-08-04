import type { AnyNode } from '@pascal-app/core'

/**
 * Write a chosen product onto every build-up layer behind a takeoff line.
 *
 * The per-wall panel can already name a product on one layer of one wall. That
 * is the wrong unit of work: a takeoff line like `각재 33mm (@300mm)` is the sum
 * of every wall framed that way, and choosing the product wall by wall is the
 * same decision repeated. A line knows which nodes fed it, so one choice can
 * settle all of them — and it lands in the drawing, not in a side table, so the
 * next takeoff of the same scene already knows the answer.
 */

export type LayerMaterialChoice = {
  /** Catalogue id, e.g. `intm:<material id>`. */
  productRef: string
  brand?: string
  unitPrice?: number
  /** Product name, read for the sheet size it states. */
  name?: string
}

/**
 * The sheet size a product name states, in metres.
 *
 * Sheet goods are counted by dividing the area by the LAYER's sheet size, so
 * choosing `석고보드 9.5T 4x8 (1220x2440)` for a layer still set to 900×1800
 * would order the right product in the wrong quantity. The catalogue writes the
 * millimetres in the name; when it does, the layer is corrected to match.
 * When it does not, the layer is left exactly as the user set it.
 */
export function sheetSizeFromName(name: string | undefined): { w: number; h: number } | null {
  const match = name?.match(/(\d{3,4})\s*[x×X]\s*(\d{3,4})/)
  if (!match) return null
  const w = Number(match[1]) / 1000
  const h = Number(match[2]) / 1000
  return w > 0 && h > 0 ? { w, h } : null
}

type LayerLike = {
  kind?: string
  productRef?: string
  brand?: string
  unitPrice?: number
  sheetWidth?: number
  sheetHeight?: number
}
type BandLike = { mode?: string; layers?: LayerLike[] }

export type NodePatch = { nodeId: string; patch: Record<string, unknown> }

function stampLayers(layers: readonly LayerLike[], kind: string, choice: LayerMaterialChoice) {
  const sheet = sheetSizeFromName(choice.name)
  let changed = false
  const next = layers.map((layer) => {
    if (layer.kind !== kind) return layer
    changed = true
    return {
      ...layer,
      productRef: choice.productRef,
      ...(choice.brand === undefined ? {} : { brand: choice.brand }),
      ...(choice.unitPrice === undefined ? {} : { unitPrice: choice.unitPrice }),
      // Only for layers already counted by the sheet: framing has no sheet size
      // and must not acquire one.
      ...(sheet && layer.sheetWidth ? { sheetWidth: sheet.w, sheetHeight: sheet.h } : {}),
    }
  })
  return changed ? next : null
}

/**
 * The patches that link `choice` to every layer of `layerKind` on `nodeIds`.
 *
 * Returns only the nodes that actually carry such a layer, so a line whose
 * nodes have since been edited away updates nothing rather than inventing a
 * build-up to hold the product.
 */
export function layerMaterialPatches(
  nodes: Readonly<Record<string, AnyNode>>,
  nodeIds: readonly string[],
  layerKind: string,
  choice: LayerMaterialChoice,
): NodePatch[] {
  const patches: NodePatch[] = []

  for (const nodeId of new Set(nodeIds)) {
    const node = nodes[nodeId] as
      | (AnyNode & {
          faceBands?: { construction?: Record<string, BandLike> }
          construction?: LayerLike[]
        })
      | undefined
    if (!node) continue

    // Walls key their build-up by band; floors and ceilings hold a flat list.
    const bands = node.faceBands?.construction
    if (bands) {
      let touched = false
      const nextBands: Record<string, BandLike> = {}
      for (const [band, value] of Object.entries(bands)) {
        const next = stampLayers(value?.layers ?? [], layerKind, choice)
        nextBands[band] = next ? { ...value, layers: next } : value
        touched = touched || next !== null
      }
      if (touched) {
        patches.push({
          nodeId,
          patch: { faceBands: { ...node.faceBands, construction: nextBands } },
        })
      }
      continue
    }

    if (Array.isArray(node.construction)) {
      const next = stampLayers(node.construction, layerKind, choice)
      if (next) patches.push({ nodeId, patch: { construction: next } })
    }
  }

  return patches
}
