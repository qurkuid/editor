import type { MaterialCatalogItem, MaterialCategory } from '@pascal-app/core'
import { MATERIAL_CATEGORIES } from '@pascal-app/core'
import { matchMaterialCategoryFromText } from './rawpainter-adapter'
import type { RawPainterCategory } from './rawpainter-contract'

/**
 * One catalog, two sources: the built-in Pascal materials are filed INTO the
 * RawPainter drill-down instead of living beside it. Each vendor category
 * hosts the built-ins whose local taxonomy bucket its name maps onto (as a
 * pinned "built-in" pseudo-brand), and local buckets no vendor category
 * covers become synthetic categories so every built-in stays reachable.
 */

/**
 * Sentinel brand id for the built-in pseudo-brand inside the drill-down.
 * The NUL prefix cannot occur in a real vendor brand name.
 */
export const BUILTIN_BRAND = '\u0000builtin'

export type UnifiedCategory = {
  /** Vendor category id, or a negative synthetic id for builtin-only rows. */
  readonly id: number
  readonly name: string
  /** Vendor products plus hosted built-ins — what the category row shows. */
  readonly productCount: number
  readonly builtinCount: number
  /** The local taxonomy bucket whose built-ins this category hosts. */
  readonly local: MaterialCategory | null
  /** True for a builtin-only category — no vendor products, no brand level. */
  readonly synthetic: boolean
}

function groupBuiltinsByLocal(
  builtinItems: readonly MaterialCatalogItem[],
): Map<MaterialCategory, number> {
  const counts = new Map<MaterialCategory, number>()
  for (const item of builtinItems) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }
  return counts
}

export function buildUnifiedCategories(
  vendorCategories: readonly RawPainterCategory[],
  builtinItems: readonly MaterialCatalogItem[],
  labelForLocal: (local: MaterialCategory) => string,
): readonly UnifiedCategory[] {
  const builtinCounts = groupBuiltinsByLocal(builtinItems)
  const covered = new Set<MaterialCategory>()

  const vendorEntries = vendorCategories.map((category): UnifiedCategory => {
    const matched = matchMaterialCategoryFromText(category.name)
    // 'other' is the mapper's miss bucket — hosting the misc built-ins on
    // every unrecognized vendor category would scatter them everywhere.
    const local = matched === 'other' ? null : matched
    const builtinCount = local ? (builtinCounts.get(local) ?? 0) : 0
    if (local && builtinCount > 0) covered.add(local)
    return {
      id: category.id,
      name: category.name,
      productCount: category.productCount + builtinCount,
      builtinCount,
      local,
      synthetic: false,
    }
  })

  const syntheticEntries = MATERIAL_CATEGORIES.filter(
    (local) => (builtinCounts.get(local) ?? 0) > 0 && !covered.has(local),
  ).map((local): UnifiedCategory => {
    const count = builtinCounts.get(local) ?? 0
    return {
      id: -(MATERIAL_CATEGORIES.indexOf(local) + 1),
      name: labelForLocal(local),
      productCount: count,
      builtinCount: count,
      local,
      synthetic: true,
    }
  })

  return [...vendorEntries, ...syntheticEntries]
}

/** The built-ins a unified category hosts (its 기본 자재 pseudo-brand). */
export function builtinItemsForUnifiedCategory(
  category: UnifiedCategory,
  builtinItems: readonly MaterialCatalogItem[],
): readonly MaterialCatalogItem[] {
  if (!category.local) return []
  return builtinItems.filter((item) => item.category === category.local)
}
