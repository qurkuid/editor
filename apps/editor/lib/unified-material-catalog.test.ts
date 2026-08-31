import { describe, expect, test } from 'bun:test'
import type { MaterialCatalogItem } from '@pascal-app/core'
import {
  BUILTIN_BRAND,
  buildUnifiedCategories,
  builtinItemsForUnifiedCategory,
} from './unified-material-catalog'

const builtin = (id: string, category: MaterialCatalogItem['category']): MaterialCatalogItem =>
  ({ id, label: id, category }) as MaterialCatalogItem

const label = (local: string) => `label:${local}`

describe('buildUnifiedCategories', () => {
  test('vendor categories host the built-ins their name maps onto', () => {
    const unified = buildUnifiedCategories(
      [{ id: 7, name: '목재합판', productCount: 10 }],
      [builtin('oak', 'wood'), builtin('pine', 'wood'), builtin('white', 'colors')],
      label,
    )

    const wood = unified.find((entry) => entry.id === 7)
    expect(wood?.builtinCount).toBe(2)
    expect(wood?.productCount).toBe(12)
    expect(wood?.local).toBe('wood')
    expect(wood?.synthetic).toBe(false)
  })

  test('built-ins no vendor category covers become synthetic categories', () => {
    const unified = buildUnifiedCategories(
      [{ id: 7, name: '목재합판', productCount: 10 }],
      [builtin('oak', 'wood'), builtin('shingle', 'roofing'), builtin('tile', 'roofing')],
      label,
    )

    const synthetic = unified.filter((entry) => entry.synthetic)
    expect(synthetic).toEqual([
      {
        id: expect.any(Number),
        name: 'label:roofing',
        productCount: 2,
        builtinCount: 2,
        local: 'roofing',
        synthetic: true,
      },
    ])
    expect(synthetic[0]!.id).toBeLessThan(0)
  })

  test('the same local bucket cross-lists onto every matching vendor category', () => {
    const unified = buildUnifiedCategories(
      [
        { id: 1, name: '목재', productCount: 5 },
        { id: 2, name: '강마루', productCount: 3 },
      ],
      [builtin('oak', 'wood')],
      label,
    )

    expect(unified.filter((entry) => entry.builtinCount === 1)).toHaveLength(2)
    expect(unified.some((entry) => entry.synthetic)).toBe(false)
  })

  test("misc built-ins never attach to unrecognized vendor categories ('other' bucket)", () => {
    const unified = buildUnifiedCategories(
      [{ id: 9, name: '기타잡화', productCount: 4 }],
      [builtin('misc', 'other')],
      label,
    )

    const vendor = unified.find((entry) => entry.id === 9)
    expect(vendor?.builtinCount).toBe(0)
    expect(vendor?.productCount).toBe(4)
    const synthetic = unified.find((entry) => entry.synthetic)
    expect(synthetic?.local).toBe('other')
    expect(synthetic?.builtinCount).toBe(1)
  })

  test('builtinItemsForUnifiedCategory returns the hosted built-ins', () => {
    const items = [builtin('oak', 'wood'), builtin('white', 'colors')]
    const unified = buildUnifiedCategories([{ id: 1, name: '목재', productCount: 5 }], items, label)

    const wood = unified.find((entry) => entry.id === 1)!
    expect(builtinItemsForUnifiedCategory(wood, items).map((item) => item.id)).toEqual(['oak'])
  })

  test('the builtin pseudo-brand token starts with NUL, unrepresentable in vendor data', () => {
    expect(BUILTIN_BRAND.charCodeAt(0)).toBe(0)
  })
})
