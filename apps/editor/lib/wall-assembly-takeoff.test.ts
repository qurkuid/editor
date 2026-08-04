import { describe, expect, test } from 'bun:test'
import { wallAssemblyLines } from './wall-assembly-takeoff'

// A 4 m × 2.5 m wall, both faces = 20 m².
const FACE = { area: 20, length: 4, height: 2.5 }

function assembly(...layers: Array<Record<string, unknown>>) {
  return { upper: { mode: 'assembly', layers } } as never
}

describe('timber studs', () => {
  test('counts members at their spacing and orders them by the metre', () => {
    // 4 m at 300 mm → 13 full bays covering 3.9 m, plus a closing member at
    // the end = 14 studs, 2.5 m each.
    const [line] = wallAssemblyLines(
      assembly({
        kind: 'timber-stud',
        thickness: 0.033,
        memberWidth: 0.033,
        studSpacing: 0.3,
        wasteFactor: 0,
      }),
      FACE,
      'wall_a',
    )

    expect(line?.unit).toBe('m')
    expect(line?.quantity).toBeCloseTo(14 * 2.5)
    expect(line?.label).toBe('각재 33mm (@300mm)')
  })

  test('the layer waste factor is applied', () => {
    const [line] = wallAssemblyLines(
      assembly({ kind: 'timber-stud', thickness: 0.033, studSpacing: 0.3, wasteFactor: 0.1 }),
      FACE,
      'wall_a',
    )
    expect(line?.quantity).toBeCloseTo(14 * 2.5 * 1.1)
  })

  test('a stud layer with no spacing recorded yields nothing rather than a guess', () => {
    expect(
      wallAssemblyLines(assembly({ kind: 'timber-stud', thickness: 0.033 }), FACE, 'w'),
    ).toEqual([])
  })
})

describe('sheet goods', () => {
  test('gypsum board is ordered by the sheet, rounded up', () => {
    // 20 m² over 900 × 1800 (1.62 m²) sheets = 12.35 → 13.
    const [line] = wallAssemblyLines(
      assembly({
        kind: 'gypsum-board',
        thickness: 0.0095,
        sheetWidth: 0.9,
        sheetHeight: 1.8,
        wasteFactor: 0,
      }),
      FACE,
      'wall_a',
    )

    expect(line?.unit).toBe('ea')
    expect(line?.quantity).toBe(13)
    expect(line?.label).toBe('석고보드 900×1800')
  })

  test('waste can push it to another sheet', () => {
    const [line] = wallAssemblyLines(
      assembly({
        kind: 'gypsum-board',
        thickness: 0.0095,
        sheetWidth: 0.9,
        sheetHeight: 1.8,
        wasteFactor: 0.1,
      }),
      FACE,
      'wall_a',
    )
    expect(line?.quantity).toBe(14)
  })

  // Better a priceable area line than a layer that silently vanishes.
  test('a sheet layer with no sheet size falls back to area', () => {
    const [line] = wallAssemblyLines(
      assembly({ kind: 'gypsum-board', thickness: 0.0095, wasteFactor: 0 }),
      FACE,
      'wall_a',
    )
    expect(line?.unit).toBe('m2')
    expect(line?.quantity).toBeCloseTo(20)
  })
})

describe('what is not a material', () => {
  test('a cavity yields nothing — it is empty space', () => {
    expect(wallAssemblyLines(assembly({ kind: 'cavity', thickness: 0.0565 }), FACE, 'w')).toEqual(
      [],
    )
  })

  test('finish and overlay bands are skipped — they are counted as finishes', () => {
    const construction = {
      upper: { mode: 'finish', layers: [{ kind: 'gypsum-board', thickness: 0.0095 }] },
      lower: { mode: 'overlay', layers: [{ kind: 'mdf', thickness: 0.009 }] },
    } as never
    expect(wallAssemblyLines(construction, FACE, 'w')).toEqual([])
  })

  test('a wall with no construction recorded expands to nothing', () => {
    expect(wallAssemblyLines({}, FACE, 'w')).toEqual([])
  })
})

describe('a full 33각재 + 석고 build-up', () => {
  test('expands into the pieces someone actually orders', () => {
    const lines = wallAssemblyLines(
      assembly(
        {
          kind: 'timber-stud',
          thickness: 0.033,
          memberWidth: 0.033,
          studSpacing: 0.3,
          wasteFactor: 0.1,
        },
        { kind: 'cavity', thickness: 0.0565 },
        {
          kind: 'gypsum-board',
          thickness: 0.0095,
          sheetWidth: 0.9,
          sheetHeight: 1.8,
          wasteFactor: 0.1,
        },
      ),
      FACE,
      'wall_a',
    )

    expect(lines.map((l) => l.unit)).toEqual(['m', 'ea'])
    expect(lines[0]?.label).toContain('각재')
    expect(lines[1]?.label).toContain('석고보드')
    expect(lines.every((l) => l.nodeIds[0] === 'wall_a')).toBe(true)
  })
})
