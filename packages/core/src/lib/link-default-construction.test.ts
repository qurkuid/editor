import { afterEach, describe, expect, test } from 'vitest'
import {
  getDynamicLibraryMaterials,
  type MaterialCatalogItem,
  registerLibraryMaterials,
  unregisterLibraryMaterials,
} from '../material-library'
import { createDefaultWallFaceBands } from './wall-construction'
import { withDefaultConstructionMaterials } from './link-default-construction'

function product(
  id: string,
  label: string,
  kinds: MaterialCatalogItem['constructionKinds'],
): MaterialCatalogItem {
  return {
    id,
    label,
    category: 'other',
    constructionKinds: kinds,
    commercial: { unitPrice: 5200 },
    preset: {} as never,
  }
}

const CATALOGUE = [
  product('intm:stud', '각재 33x33x2400 (12개/단)', ['timber-stud']),
  product('intm:board', '석고보드 9.5T 3x6 (900x1800)', ['gypsum-board']),
  product('intm:wrong', '석고보드 12.5T 4x8 (1220x2440)', ['gypsum-board']),
]

afterEach(() => {
  unregisterLibraryMaterials(getDynamicLibraryMaterials().map((item) => item.id))
})

function layersOf(bands: ReturnType<typeof createDefaultWallFaceBands>) {
  return bands.construction?.upper?.layers ?? []
}

describe('a new wall names its standard products', () => {
  test('the house standards are linked without anyone picking them', () => {
    registerLibraryMaterials(CATALOGUE)
    const layers = layersOf(withDefaultConstructionMaterials(createDefaultWallFaceBands(0.1)))

    expect(layers.find((l) => l.kind === 'timber-stud')?.productRef).toBe('intm:stud')
    expect(layers.find((l) => l.kind === 'gypsum-board')?.productRef).toBe('intm:board')
  })

  test('the price rides along so the wall is priceable as drawn', () => {
    registerLibraryMaterials(CATALOGUE)
    const layers = layersOf(withDefaultConstructionMaterials(createDefaultWallFaceBands(0.1)))
    expect(layers.find((l) => l.kind === 'gypsum-board')?.unitPrice).toBe(5200)
  })

  test('a cavity is never given a product', () => {
    registerLibraryMaterials(CATALOGUE)
    const layers = layersOf(withDefaultConstructionMaterials(createDefaultWallFaceBands(0.1)))
    expect(layers.find((l) => l.kind === 'cavity')?.productRef).toBeUndefined()
  })

  // Local dev, or before a host registers anything: unchanged, not broken.
  test('an empty catalogue leaves the build-up exactly as it was', () => {
    const bands = createDefaultWallFaceBands(0.1)
    expect(withDefaultConstructionMaterials(bands)).toBe(bands)
  })

  test('nothing matching leaves the build-up alone', () => {
    registerLibraryMaterials([product('intm:x', '방수석고', ['gypsum-board'])])
    const bands = createDefaultWallFaceBands(0.1)
    expect(withDefaultConstructionMaterials(bands)).toBe(bands)
  })
})
