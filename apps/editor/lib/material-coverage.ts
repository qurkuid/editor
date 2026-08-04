/**
 * Takeoff quantity → purchasable quantity.
 *
 * A takeoff says "33 m² of wallpaper". A purchase order needs "3 rolls". The
 * bridge is a coverage spec per material: how much one purchase unit covers,
 * whether it can be split, and how much is lost to cutting.
 *
 * Specs come from INTM (`materials.coverage_*`, falling back to
 * `product_categories.default_coverage_*` — see
 * `database/migrations/20260804_material_coverage.sql`). A material with no
 * spec anywhere yields `null` rather than a guess: showing the raw area and
 * asking for the spec beats quoting a number that is quietly wrong.
 */

export type CoverageUnit = 'm2' | 'm' | 'm3' | 'ea'

export type CoverageSpec = {
  /** How much one purchase unit covers, in `coverageUnit`. */
  coverageValue: number
  coverageUnit: CoverageUnit
  /** Rolls/sheets/boxes can't be split, so their quantity rounds up. */
  isDiscrete: boolean
  /** Cutting loss, 0–1. 0.2 = 20%. */
  wasteRate: number
  /** Where the spec came from, so the UI can show what to correct. */
  source: 'material' | 'category'
}

/** The INTM fields this reads, in either shape the API might return. */
export type CoverageFields = {
  coverageValue?: number | null
  coverageUnit?: string | null
  isDiscrete?: boolean | null
  wasteRate?: number | null
}

const COVERAGE_UNITS: readonly string[] = ['m2', 'm', 'm3', 'ea']

function isCoverageUnit(value: unknown): value is CoverageUnit {
  return typeof value === 'string' && COVERAGE_UNITS.includes(value)
}

/**
 * Resolve a usable spec, material first then category.
 *
 * Coverage (value + unit + discreteness) resolves as one group — those three
 * only mean anything together, and a partial row is rejected rather than
 * half-defaulted, since a coverage value with no unit would silently mix m²
 * with running metres.
 *
 * Waste is resolved SEPARATELY. It is a property of how a material cuts, not
 * of how it is packaged, so it is managed per material in its own right: a
 * material that states only its roll size still inherits its category's waste
 * allowance, and a material that states only its own waste keeps it even when
 * the roll size comes from the category.
 */
export function resolveCoverageSpec(
  material: CoverageFields | null | undefined,
  categoryDefault: CoverageFields | null | undefined,
): CoverageSpec | null {
  const coverage =
    resolveCoverage(material, 'material') ?? resolveCoverage(categoryDefault, 'category')
  if (!coverage) return null
  return { ...coverage, wasteRate: resolveWasteRate(material, categoryDefault) }
}

type ResolvedCoverage = Omit<CoverageSpec, 'wasteRate'>

function resolveCoverage(
  fields: CoverageFields | null | undefined,
  source: CoverageSpec['source'],
): ResolvedCoverage | null {
  if (!fields) return null
  const { coverageValue, coverageUnit } = fields
  if (typeof coverageValue !== 'number' || !Number.isFinite(coverageValue)) return null
  if (coverageValue <= 0 || !isCoverageUnit(coverageUnit)) return null
  return {
    coverageValue,
    coverageUnit,
    // Unstated discreteness defaults to splittable: rounding up when we
    // aren't sure would over-order on every continuous material.
    isDiscrete: fields.isDiscrete === true,
    source,
  }
}

function validWasteRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
    ? value
    : null
}

/**
 * House default cutting allowance, used when neither the material nor its
 * category states one. Deliberately generous: under-ordering stops a job,
 * over-ordering leaves offcuts, so an unknown material errs high until someone
 * corrects it.
 */
export const DEFAULT_WASTE_RATE = 0.2

/**
 * The material's own cutting allowance, falling back to its category's, then
 * to the house default. Managed independently of coverage so each can be
 * corrected without disturbing the other — and editable from both floorplan
 * and INTM, since either may be where the user notices it is wrong.
 */
export function resolveWasteRate(
  material: CoverageFields | null | undefined,
  categoryDefault: CoverageFields | null | undefined,
): number {
  return (
    validWasteRate(material?.wasteRate) ??
    validWasteRate(categoryDefault?.wasteRate) ??
    DEFAULT_WASTE_RATE
  )
}

export type CoverageResult = {
  /** Takeoff amount before any allowance. */
  takeoff: number
  /** Takeoff plus cutting loss. */
  withWaste: number
  /** Purchase units needed — rounded up when the material is discrete. */
  quantity: number
  spec: CoverageSpec
}

/**
 * Convert a takeoff amount into purchase units.
 *
 * Returns null when there is no spec, or when the spec measures something
 * other than what was taken off (ordering rolls by the metre when the spec is
 * per m² would be a silent unit error, so it refuses instead).
 */
// Catalogue figures are themselves rounded (1평 = 3.305785…, 정5평 = 16.5289),
// so an exact fit doesn't divide exactly: 10평 ÷ 정5평 comes out 2.0000030, and
// a bare ceil() would order a third roll to cover 0.00005 m². Snap to the
// nearest whole unit when the gap is only that rounding noise — a relative
// tolerance, because the absolute error grows with the quantity. A real
// shortfall (a 5% waste allowance, say) is far outside it and still rounds up.
const WHOLE_UNIT_TOLERANCE = 1e-4

function ceilWholeUnits(raw: number): number {
  const nearest = Math.round(raw)
  const tolerance = Math.max(1e-9, nearest * WHOLE_UNIT_TOLERANCE)
  return Math.abs(raw - nearest) < tolerance ? nearest : Math.ceil(raw)
}

export function applyCoverage(
  takeoff: number,
  takeoffUnit: CoverageUnit,
  spec: CoverageSpec | null,
): CoverageResult | null {
  if (!spec || spec.coverageUnit !== takeoffUnit) return null
  if (!Number.isFinite(takeoff) || takeoff <= 0) return null

  const withWaste = takeoff * (1 + spec.wasteRate)
  const raw = withWaste / spec.coverageValue
  return {
    takeoff,
    withWaste,
    quantity: spec.isDiscrete ? ceilWholeUnits(raw) : raw,
    spec,
  }
}

/**
 * How a coverage unit reads next to an input field. The editor used to say ㎡
 * for every material — for 각재, measured by the metre, that read as though
 * the quantity itself were computed by area.
 */
export const COVERAGE_UNIT_LABEL: Record<CoverageUnit, string> = {
  m2: '㎡',
  m: 'm',
  m3: '㎥',
  ea: '개',
}

/**
 * The INTM patch for the spec editor's raw inputs, or null when nothing in
 * them is usable.
 *
 * The unit rides along whenever the value is set — a value with no unit is
 * half a spec, rejected downstream as unusable — and it is the unit the
 * TAKEOFF measures in, because that is the only dimension a conversion from
 * that line can mean. Waste alone never stamps a unit.
 */
export function buildCoveragePatch(
  coverage: string,
  waste: string,
  takeoffUnit: CoverageUnit,
): Record<string, number | string> | null {
  const patch: Record<string, number | string> = {}

  const coverageValue = Number(coverage)
  if (coverage.trim() !== '' && Number.isFinite(coverageValue) && coverageValue > 0) {
    patch.coverageValue = coverageValue
    patch.coverageUnit = takeoffUnit
  }

  const wastePercent = Number(waste)
  if (waste.trim() !== '' && Number.isFinite(wastePercent) && wastePercent >= 0 && wastePercent < 100) {
    patch.wasteRate = wastePercent / 100
  }

  return Object.keys(patch).length > 0 ? patch : null
}
