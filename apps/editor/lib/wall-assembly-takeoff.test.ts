import { describe, expect, test } from 'bun:test'
import {
  createDefaultWallFaceBands,
  createWallBandConstructionPreset,
  type WallNode,
} from '@pascal-app/core'
import { surfaceAssemblyLines, wallAssemblyLines } from './wall-assembly-takeoff'

// A 4 m × 2.5 m wall — the shape core measures its bands against.
function wall(faceBands: unknown = createDefaultWallFaceBands(0.1)): WallNode {
  return {
    id: 'wall_a',
    type: 'wall',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    thickness: 0.1,
    faceBands,
  } as unknown as WallNode
}

// The same wall as a flat surface, for the floor/ceiling expansion.
const FACE = { area: 20, length: 4, height: 2.5 }

describe('a wall band becomes order lines', () => {
  test('the default build-up gives 각재 by the metre and 석고보드 by the sheet', () => {
    const lines = wallAssemblyLines(wall())

    expect(lines.map((l) => l.unit)).toEqual(['m', 'ea'])
    expect(lines[0]?.label).toBe('각재 33mm (@300mm)')
    expect(lines[1]?.label).toBe('석고보드 900×1800')
    expect(lines.every((l) => l.nodeIds[0] === 'wall_a')).toBe(true)
  })

  // Boarding both sides is two layers in the recipe, so it is twice the sheets
  // — and they share a key, so the takeoff sums them into one order line.
  test('a wall boarded both sides counts both skins under one key', () => {
    const lines = wallAssemblyLines(
      wall({ ...createDefaultWallFaceBands(0.1), construction: {
        upper: createWallBandConstructionPreset('gypsum-stud-gypsum', 0.1),
      } }),
    )
    const boards = lines.filter((l) => l.label.includes('석고보드'))

    expect(boards).toHaveLength(2)
    expect(new Set(boards.map((l) => l.key)).size).toBe(1)
  })

  test('a cavity is empty space, and the finish skin is priced by the slot', () => {
    const labels = wallAssemblyLines(wall()).map((l) => l.label)
    expect(labels.some((l) => l.includes('공기') || l.includes('마감재'))).toBe(false)
  })

  test('a wall with no build-up recorded expands to nothing', () => {
    const bare = wall()
    expect(wallAssemblyLines({ ...bare, faceBands: undefined })).toEqual([])
  })
})

describe('a floor or ceiling build-up', () => {
  test('furring is counted at its spacing and ordered by the metre', () => {
    // 4 m at 450 mm → 8 full bays, plus a closing member = 9 × 2.5 m.
    const [line] = surfaceAssemblyLines(
      [{ kind: 'furring', thickness: 0.03, memberWidth: 0.03, memberSpacing: 0.45, wasteFactor: 0 }],
      FACE,
      'ceiling_a',
      'ceiling',
    )

    expect(line?.unit).toBe('m')
    expect(line?.quantity).toBeCloseTo(9 * 2.5)
    expect(line?.category).toBe('ceiling')
  })

  test('screed is poured, so it is bought by volume', () => {
    const [line] = surfaceAssemblyLines(
      [{ kind: 'screed', thickness: 0.05, wasteFactor: 0 }],
      FACE,
      'slab_a',
      'floor',
    )

    expect(line?.unit).toBe('m3')
    expect(line?.quantity).toBeCloseTo(20 * 0.05)
  })

  test('sheet goods are rounded up to whole sheets, waste included', () => {
    // 20 m² over 900 × 1800 (1.62 m²) +10% = 13.58 → 14.
    const [line] = surfaceAssemblyLines(
      [{ kind: 'plywood', thickness: 0.012, sheetWidth: 0.9, sheetHeight: 1.8, wasteFactor: 0.1 }],
      FACE,
      'slab_a',
      'floor',
    )

    expect(line?.unit).toBe('ea')
    expect(line?.quantity).toBe(14)
  })

  // Better a priceable area line than a layer that silently vanishes.
  test('a sheet layer with no sheet size falls back to area', () => {
    const [line] = surfaceAssemblyLines(
      [{ kind: 'gypsum-board', thickness: 0.0095, wasteFactor: 0 }],
      FACE,
      'ceiling_a',
      'ceiling',
    )

    expect(line?.unit).toBe('m2')
    expect(line?.quantity).toBeCloseTo(20)
  })

  test('framing with no spacing recorded yields nothing rather than a guess', () => {
    expect(
      surfaceAssemblyLines([{ kind: 'timber-joist', thickness: 0.038 }], FACE, 'slab_a', 'floor'),
    ).toEqual([])
  })

  test('a cavity yields nothing — it is empty space', () => {
    expect(
      surfaceAssemblyLines([{ kind: 'cavity', thickness: 0.05 }], FACE, 'slab_a', 'floor'),
    ).toEqual([])
  })
})
