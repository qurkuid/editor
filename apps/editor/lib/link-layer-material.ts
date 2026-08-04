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
}

type LayerLike = { kind?: string; productRef?: string; brand?: string; unitPrice?: number }
type BandLike = { mode?: string; layers?: LayerLike[] }

export type NodePatch = { nodeId: string; patch: Record<string, unknown> }

function stampLayers(layers: readonly LayerLike[], kind: string, choice: LayerMaterialChoice) {
  let changed = false
  const next = layers.map((layer) => {
    if (layer.kind !== kind) return layer
    changed = true
    return {
      ...layer,
      productRef: choice.productRef,
      ...(choice.brand === undefined ? {} : { brand: choice.brand }),
      ...(choice.unitPrice === undefined ? {} : { unitPrice: choice.unitPrice }),
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
