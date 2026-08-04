import { describe, expect, test } from 'vitest'
import type { MaterialCatalogItem } from '../material-library'
import {
  bestConstructionMaterial,
  matchScore,
  sectionFromName,
  sheetFromName,
  thicknessFromName,
} from './construction-material-match'

function product(label: string): MaterialCatalogItem {
  return { id: label, label, category: 'other', preset: {} as never }
}

// The defaults a layer starts from: 석고 9.5T 900×1800, MDF 9T 600×2400.
const GYPSUM = { kind: 'gypsum-board' as const, thickness: 0.0095, sheetWidth: 0.9, sheetHeight: 1.8 }
const MDF = { kind: 'mdf' as const, thickness: 0.009, sheetWidth: 0.6, sheetHeight: 2.4 }

describe('reading a product name', () => {
  test.each([
    ['석고보드 9.5T 3x6 (900x1800)', 0.0095],
    ['석고보드 12.5T 4x8 (1220x2440)', 0.0125],
    ['MDF 9T', 0.009],
  ])('%s states %s m thick', (name, expected) => {
    expect(thicknessFromName(name)).toBeCloseTo(expected)
  })

  test('a name with no thickness states none', () => {
    expect(thicknessFromName('방수석고')).toBeNull()
  })

  test('the sheet size is read in metres', () => {
    expect(sheetFromName('석고보드 9.5T 3x6 (900x1800)')).toEqual({ width: 0.9, height: 1.8 })
  })

  // `3x6` is the trade name in feet — the millimetres are the real size.
  test('the millimetre pair is taken, not the foot shorthand', () => {
    expect(sheetFromName('석고보드 9.5T 3x6 (900x1800)')?.width).toBeCloseTo(0.9)
  })
})

describe('picking the closest product', () => {
  test('the default gypsum layer finds 9.5T 900×1800', () => {
    const best = bestConstructionMaterial(
      [
        product('석고보드 12.5T 4x8 (1220x2440)'),
        product('석고보드 9.5T 3x6 (900x1800)'),
        product('석고보드 9.5T 4x8 (1220x2440)'),
      ],
      GYPSUM,
    )
    expect(best?.label).toBe('석고보드 9.5T 3x6 (900x1800)')
  })

  test('the default MDF layer finds 9T 600×2400', () => {
    const best = bestConstructionMaterial(
      [product('MDF 12T 4x8 (1220x2440)'), product('MDF 9T (600x2400)'), product('MDF 18T')],
      MDF,
    )
    expect(best?.label).toBe('MDF 9T (600x2400)')
  })

  // A different thickness is the wrong board, not a worse one.
  test('a mismatched thickness is refused outright', () => {
    expect(matchScore('석고보드 12.5T 3x6 (900x1800)', GYPSUM)).toBe(0)
    expect(bestConstructionMaterial([product('석고보드 12.5T 3x6 (900x1800)')], GYPSUM)).toBeUndefined()
  })

  test('the right thickness in another sheet size is still offered', () => {
    const best = bestConstructionMaterial([product('석고보드 9.5T 4x8 (1220x2440)')], GYPSUM)
    expect(best?.label).toBe('석고보드 9.5T 4x8 (1220x2440)')
  })

  // Better an empty field than a plausible-looking wrong board.
  test('a name that says nothing is never offered', () => {
    expect(bestConstructionMaterial([product('방수석고'), product('석고본드')], GYPSUM)).toBeUndefined()
  })

  test('nothing to choose from yields nothing', () => {
    expect(bestConstructionMaterial([], GYPSUM)).toBeUndefined()
  })

  test('ties break towards the plainer product name', () => {
    const best = bestConstructionMaterial(
      [product('석고보드 9.5T 3x6 (900x1800) 특판 프리미엄'), product('석고보드 9.5T (900x1800)')],
      GYPSUM,
    )
    expect(best?.label).toBe('석고보드 9.5T (900x1800)')
  })
})

// 33×33×2400, 12 to a 단 — the one standard stud.
const STUD = { kind: 'timber-stud' as const, thickness: 0.033, memberWidth: 0.033 }

describe('framing is named by its section', () => {
  test('the standard stud finds 33x33', () => {
    const best = bestConstructionMaterial(
      [
        product('각재 30x30x2400'),
        product('각재 33x33x2400 (12개/단)'),
        product('각재 40x60 3600mm'),
      ],
      STUD,
    )
    expect(best?.label).toBe('각재 33x33x2400 (12개/단)')
  })

  test('a different section is the wrong timber, not a worse one', () => {
    expect(matchScore('각재 50x50 3600mm', STUD)).toBe(0)
  })

  test('a board never reads as framing: 900x1800 is not a 900×180 section', () => {
    expect(sectionFromName('석고보드 9.5T 3x6 (900x1800)')).toBeNull()
    expect(sectionFromName('MDF 12T 4x8 (1220x2440)')).toBeNull()
  })

  test('a stud section is read in metres', () => {
    expect(sectionFromName('각재 33x33x2400')).toEqual({ width: 0.033, height: 0.033 })
  })

  // The gypsum layer has a sheet size, so its 900×1800 must never be scored as
  // a section even though the layer also states a memberWidth elsewhere.
  test('a sheet layer is unaffected by the section rule', () => {
    expect(matchScore('석고보드 9.5T 3x6 (900x1800)', GYPSUM)).toBeGreaterThan(0)
  })
})
