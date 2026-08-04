import type { IntmMaterial, IntmMaterialCategory } from './intm-materials'
import { applyCoverage, type CoverageUnit, resolveCoverageSpec } from './material-coverage'
import type { TakeoffLine, TakeoffReport } from './quantity-takeoff'

/**
 * Takeoff × INTM catalogue → estimate lines.
 *
 * This is the join between "what the scene contains" and "what it costs". Each
 * takeoff line is matched to a material, converted from its measured amount to
 * purchasable units, and priced. Anything that can't be resolved is reported
 * as such rather than dropped or guessed — an estimate with a visible hole is
 * fixable, one with a silently missing line is not.
 */

export type EstimateLineStatus =
  | 'priced'
  | 'measure' // 발주 대상이 아닌 산출 물량 — 값을 매기지 않음
  | 'no-material' // 씬 재질에 대응하는 INTM 자재를 못 찾음
  | 'no-coverage' // 자재는 찾았으나 환산 규격 미등록
  | 'no-price' // 환산은 됐으나 단가가 0

export type EstimateLine = {
  takeoff: TakeoffLine
  status: EstimateLineStatus
  material?: IntmMaterial
  /** Measured amount plus the waste allowance. */
  withWaste?: number
  /** Purchase units to order. */
  quantity?: number
  unitPrice?: number
  amount?: number
  wasteRate?: number
}

export type EstimateDraft = {
  lines: EstimateLine[]
  /** Sum of every priced line. Unresolved lines contribute nothing. */
  total: number
  /** Lines needing attention before the estimate can be trusted. */
  unresolved: EstimateLine[]
}

const TAKEOFF_UNIT_TO_COVERAGE: Record<TakeoffLine['unit'], CoverageUnit> = {
  m2: 'm2',
  m3: 'm3',
  m: 'm',
  ea: 'ea',
}

/**
 * Match a takeoff line to a catalogue material.
 *
 * A painted surface carries the material ref it was painted with, which is the
 * only reliable link — name matching is a fallback for lines that describe a
 * kind (board, countertop) rather than a specific product.
 */
export function matchMaterial(
  line: TakeoffLine,
  materials: readonly IntmMaterial[],
  overrides: Readonly<Record<string, string>> = {},
): IntmMaterial | undefined {
  const overridden = overrides[`${line.category}:${line.key}`]
  if (overridden) {
    const chosen = materials.find((material) => material.id === overridden)
    if (chosen) return chosen
  }

  if (line.materialRef) {
    // RawPainter refs look like `library:<externalId>` / `scene:<id>`; the
    // catalogue keys on the raw id, so compare the tail.
    const externalId = line.materialRef.split(':').pop()
    const byRef = materials.find(
      (material) => material.id === externalId || material.id === line.materialRef,
    )
    if (byRef) return byRef
  }

  const label = line.label.toLowerCase()
  return materials.find((material) => label.includes(material.name.toLowerCase()))
}

/**
 * Build the priced draft. `overrides` maps a takeoff key to a material id, for
 * when the user picks the product themselves.
 */
export function buildEstimateDraft(
  report: TakeoffReport,
  materials: readonly IntmMaterial[],
  categories: readonly IntmMaterialCategory[],
  overrides: Readonly<Record<string, string>> = {},
): EstimateDraft {
  const categoryById = new Map(categories.map((category) => [category.id, category]))

  const lines = report.lines.map<EstimateLine>((takeoff) => {
    // A measure is the input to an order, not a line on one. Pricing it would
    // bill the same wall twice — once as area, once as the board covering it.
    if (takeoff.role === 'measure') return { takeoff, status: 'measure' }

    const material = matchMaterial(takeoff, materials, overrides)
    if (!material) return { takeoff, status: 'no-material' }

    const category = material.productCategoryId
      ? categoryById.get(material.productCategoryId)
      : undefined
    const spec = resolveCoverageSpec(material, category)
    const converted = applyCoverage(takeoff.quantity, TAKEOFF_UNIT_TO_COVERAGE[takeoff.unit], spec)
    if (!converted) return { takeoff, status: 'no-coverage', material }

    const unitPrice = material.unitPrice ?? 0
    const amount = converted.quantity * unitPrice
    return {
      takeoff,
      status: unitPrice > 0 ? 'priced' : 'no-price',
      material,
      withWaste: converted.withWaste,
      quantity: converted.quantity,
      wasteRate: converted.spec.wasteRate,
      unitPrice,
      amount,
    }
  })

  return {
    lines,
    total: lines.reduce(
      (sum, line) => sum + (line.status === 'priced' ? (line.amount ?? 0) : 0),
      0,
    ),
    // Measures are complete as they are; only lines that need a decision count.
    unresolved: lines.filter(
      (line) => line.status !== 'priced' && line.status !== 'measure',
    ),
  }
}
