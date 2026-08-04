import type { MaterialCatalogItem } from '../material-library'
import type { WallConstructionLayer } from '../schema/nodes/wall'

/**
 * The catalogue product that best fits a build-up layer.
 *
 * Choosing a layer type should not then require hunting the matching product
 * out of a few thousand catalogue rows — the layer already states its thickness
 * and sheet size, and the catalogue writes both into its product names
 * (`석고보드 9.5T 3x6 (900x1800)`). Reading them back closes the loop.
 *
 * Deliberately conservative: a product is only offered when it agrees with the
 * layer on something specific. Nothing is guessed from a name that states
 * neither thickness nor size, because a plausible-looking wrong board is worse
 * than an empty field someone fills in.
 */

/** Thickness a product name states, in metres — `9.5T` / `12.5t`. */
export function thicknessFromName(name: string): number | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*T\b/i)
  if (!match) return null
  const mm = Number(match[1])
  return Number.isFinite(mm) && mm > 0 ? mm / 1000 : null
}

/**
 * Section a framing product name states, in metres — `각재 33x33x2400`.
 *
 * The lookarounds matter: without them `(900x1800)` on a board would read as a
 * 900×180 section, and every sheet good would look like framing.
 */
export function sectionFromName(name: string): { width: number; height: number } | null {
  const match = name.match(/(?<!\d)(\d{2,3})\s*[x*×X]\s*(\d{2,3})(?!\d)/)
  if (!match) return null
  const width = Number(match[1]) / 1000
  const height = Number(match[2]) / 1000
  return width > 0 && height > 0 ? { width, height } : null
}

/** Sheet size a product name states, in metres — `(900x1800)`. */
export function sheetFromName(name: string): { width: number; height: number } | null {
  const match = name.match(/(\d{3,4})\s*[x×X]\s*(\d{3,4})/)
  if (!match) return null
  const width = Number(match[1]) / 1000
  const height = Number(match[2]) / 1000
  return width > 0 && height > 0 ? { width, height } : null
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}

/**
 * How well a product fits the layer. Higher is better; 0 means "says nothing
 * in common with this layer" and is never offered.
 */
export function matchScore(name: string, layer: Partial<WallConstructionLayer>): number {
  let score = 0

  const thickness = thicknessFromName(name)
  if (thickness !== null && layer.thickness) {
    // Half a millimetre — enough to separate 9.5T from 12.5T, not so tight that
    // a rounded catalogue figure misses.
    if (near(thickness, layer.thickness, 0.0005)) score += 4
    else return 0 // a different board thickness is the wrong product, not a worse one
  }

  const sheet = sheetFromName(name)
  if (sheet && layer.sheetWidth && layer.sheetHeight) {
    const fits =
      (near(sheet.width, layer.sheetWidth, 0.005) && near(sheet.height, layer.sheetHeight, 0.005)) ||
      (near(sheet.height, layer.sheetWidth, 0.005) && near(sheet.width, layer.sheetHeight, 0.005))
    if (fits) score += 3
  }

  // Framing is named by its section, not its thickness: 각재 33x33x2400. Only
  // consulted for layers that are actually framed, so a board's sheet size is
  // never read as a stud section.
  if (layer.memberWidth && !layer.sheetWidth) {
    const section = sectionFromName(name)
    if (section) {
      if (near(section.width, layer.memberWidth, 0.001)) score += 4
      else return 0 // a 50×50 stud is the wrong timber, not a worse one
    }
  }

  return score
}

/**
 * Pick the closest product, or undefined when nothing agrees with the layer.
 *
 * `materials` should already be narrowed to those that can serve the layer's
 * kind; this only ranks them. Ties break towards the shorter name, which in
 * this catalogue is the plainer, more standard product.
 */
export function bestConstructionMaterial(
  materials: readonly MaterialCatalogItem[],
  layer: Partial<WallConstructionLayer>,
): MaterialCatalogItem | undefined {
  let best: MaterialCatalogItem | undefined
  let bestScore = 0

  for (const material of materials) {
    const score = matchScore(material.label, layer)
    if (score === 0) continue
    if (score > bestScore || (score === bestScore && best && material.label.length < best.label.length)) {
      best = material
      bestScore = score
    }
  }

  return best
}
