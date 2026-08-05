import { type MaterialCatalogItem, MaterialPresetPayloadSchema } from '@pascal-app/core'
import type { IntmMaterial } from './intm-materials'

/**
 * INTM catalogue entries offered as build-up materials.
 *
 * The wall panel already lets each construction layer name a product, storing
 * it as `productRef`; the takeoff already carries that ref through to pricing.
 * The missing piece was the list itself — nothing ever put INTM's catalogue in
 * front of the picker, so every wall priced as "자재 미연결".
 *
 * Registering them under the `intm` provider makes the catalogue id
 * `intm:<material id>`, which `matchMaterial` resolves by its tail. Choosing a
 * product therefore writes the link into the drawing itself: the same wall
 * prices the same way next time, without anyone re-picking.
 */

export const INTM_MATERIAL_PROVIDER = 'intm'

type ConstructionKind = NonNullable<MaterialCatalogItem['constructionKinds']>[number]

/**
 * Which layer a catalogue entry can stand in for, read off its name.
 *
 * INTM has no field for this, so the name is all there is. Kept deliberately
 * narrow: a product that matches nothing is left out rather than offered
 * everywhere, because the picker's fallback shows unclassified materials on
 * every `finish` layer.
 */
const KIND_PATTERNS: Array<[ConstructionKind, RegExp]> = [
  ['gypsum-board', /석고|방화보드|내수보드/],
  ['timber-stud', /각재|다루끼|투바이|스터드|구조재/],
  ['mdf', /mdf|엠디에프|중밀도/i],
  ['finish', /벽지|도배|페인트|도장|필름|타일|몰딩/],
]

/**
 * Lines that are not a build-up material, however their name reads.
 *
 * Three traps. `타일 철거` and `도배 인건비` name a trade rather than a thing.
 * Korean compounds swallow these words whole: `수도배관이설` — a plumbing move —
 * contains 도배. And fittings borrow finish words: `스위치 높이조절 필름` is an
 * electrical accessory, not the 인테리어 필름 a wall is finished in.
 */
const NOT_A_MATERIAL = /인건비|철거|시공비|노무|출장|운반|폐기물|배관|설비|이설|전기|스위치|콘센트|조명/

const CATEGORY_BY_KIND: Record<ConstructionKind, MaterialCatalogItem['category']> = {
  'gypsum-board': 'other',
  'timber-stud': 'wood',
  mdf: 'wood',
  finish: 'wallpaper',
  glass: 'glass',
  'glass-block': 'glass',
  masonry: 'brick',
  custom: 'other',
}

export function constructionKindsFor(name: string): ConstructionKind[] {
  if (NOT_A_MATERIAL.test(name)) return []
  return KIND_PATTERNS.filter(([, pattern]) => pattern.test(name)).map(([kind]) => kind)
}

/** A flat, untextured appearance — these are order lines, not finishes. */
function plainAppearance(color: string) {
  return MaterialPresetPayloadSchema.parse({
    maps: {},
    mapProperties: { color, roughness: 0.9 },
  })
}

const COLOR_BY_KIND: Record<ConstructionKind, string> = {
  'gypsum-board': '#ece9e4',
  'timber-stud': '#c8a273',
  mdf: '#c9a880',
  finish: '#f2f0ec',
  glass: '#bcd6e2',
  'glass-block': '#cfe3ea',
  masonry: '#b56a4f',
  custom: '#d8d5d0',
}

/**
 * The subset of the catalogue that can serve as a build-up layer. Materials
 * whose names say nothing about what they are are omitted, so the per-layer
 * picker stays short enough to read.
 */
export function toConstructionCatalogItems(
  materials: readonly IntmMaterial[],
): MaterialCatalogItem[] {
  const items: MaterialCatalogItem[] = []
  for (const material of materials) {
    const kinds = constructionKindsFor(material.name)
    if (kinds.length === 0) continue

    const primary = kinds[0]!
    items.push({
      id: `${INTM_MATERIAL_PROVIDER}:${material.id}`,
      label: material.name,
      category: CATEGORY_BY_KIND[primary],
      source: 'workspace',
      sourceRef: { provider: INTM_MATERIAL_PROVIDER, externalId: material.id },
      commercial: { unitPrice: material.unitPrice, unit: material.unit },
      constructionKinds: kinds,
      preset: plainAppearance(COLOR_BY_KIND[primary]),
    })
  }
  return items
}
