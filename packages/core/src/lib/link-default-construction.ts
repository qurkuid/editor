import { getDynamicLibraryMaterials } from '../material-library'
import type { WallBandConstruction, WallFaceBandConfig } from '../schema/nodes/wall'
import { bestConstructionMaterial } from './construction-material-match'

/**
 * Name the standard product on a freshly-built wall's layers.
 *
 * The build-up defaults already state the house standards — 각재 33×33,
 * 석고보드 9.5T 900×1800 — and the catalogue names both. Leaving the products
 * blank meant every new wall arrived at the takeoff unpriced, and the only way
 * to link them was to re-pick a layer type that was already correct.
 *
 * Kept out of `createDefaultWallFaceBands` on purpose: that factory is pure and
 * widely used in tests, whereas this reads the live material library, which is
 * empty until a host registers a catalogue. When it is empty, or when nothing
 * matches, the layers are returned untouched — a wall with no product named is
 * the state we already handle, and beats one naming the wrong board.
 */
export function withBandConstructionMaterials(
  construction: WallBandConstruction,
): WallBandConstruction {
  const catalogue = getDynamicLibraryMaterials()
  if (catalogue.length === 0) return construction

  let touched = false
  const layers = construction.layers.map((layer) => {
    if (layer.productRef || layer.kind === 'cavity') return layer
    const candidates = catalogue.filter((material) =>
      material.constructionKinds?.includes(layer.kind as never),
    )
    const fit = bestConstructionMaterial(candidates, layer)
    if (!fit) return layer
    touched = true
    return {
      ...layer,
      productRef: fit.id,
      brand: fit.commercial?.brand,
      unitPrice: fit.commercial?.unitPrice,
    }
  })

  return touched ? { ...construction, layers } : construction
}

export function withDefaultConstructionMaterials(
  faceBands: WallFaceBandConfig,
): WallFaceBandConfig {
  const construction = faceBands.construction
  if (!construction) return faceBands

  let touched = false
  const next: Record<string, WallBandConstruction> = {}
  for (const [band, value] of Object.entries(construction)) {
    const linked = withBandConstructionMaterials(value)
    next[band] = linked
    touched = touched || linked !== value
  }

  return touched ? { ...faceBands, construction: next } : faceBands
}
