import { describe, expect, test } from 'bun:test'
import { buildEstimateDraft, matchMaterial } from './estimate-lines'
import type { IntmMaterial, IntmMaterialCategory } from './intm-materials'
import type { TakeoffLine, TakeoffReport } from './quantity-takeoff'

const WALLPAPER: IntmMaterial = {
  id: 'mat_wall',
  name: '실크 벽지',
  unit: '롤',
  unitPrice: 20000,
  productCategoryId: 'cat_wall',
  coverageValue: 16.5289,
  coverageUnit: 'm2',
  isDiscrete: true,
  wasteRate: 0,
}

const CATEGORY: IntmMaterialCategory = {
  id: 'cat_wall',
  name: '벽지',
  coverageValue: 16.5289,
  coverageUnit: 'm2',
  isDiscrete: true,
  wasteRate: 0.2,
}

function report(...lines: TakeoffLine[]): TakeoffReport {
  return {
    lines,
    totals: { board: 0, furniture: 0, lighting: 0, finish: 0, floor: 0, ceiling: 0 },
  }
}

function finishLine(overrides: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    category: 'finish',
    key: 'library:mat_wall',
    label: '벽 마감 실크 벽지',
    unit: 'm2',
    quantity: 33.0578,
    nodeIds: ['wall_a'],
    materialRef: 'library:mat_wall',
    role: 'material',
    ...overrides,
  }
}

describe('measures are not priced', () => {
  // 벽면 면적 and the 석고보드 covering it describe the same wall. Pricing both
  // bills it twice, and name matching would happily do exactly that.
  test('a measure is reported as such rather than matched to a material', () => {
    const draft = buildEstimateDraft(
      report(finishLine({ label: '벽면 (양면)', materialRef: undefined, role: 'measure' })),
      [{ ...WALLPAPER, name: '벽면' }],
      [CATEGORY],
    )

    expect(draft.lines[0]?.status).toBe('measure')
    expect(draft.lines[0]?.amount).toBeUndefined()
    expect(draft.total).toBe(0)
  })

  test('a measure is not something to fix, so it is not flagged unresolved', () => {
    const draft = buildEstimateDraft(
      report(finishLine({ materialRef: undefined, role: 'measure' })),
      [],
      [],
    )
    expect(draft.unresolved).toHaveLength(0)
  })
})

describe('material matching', () => {
  test('a painted surface matches by the ref it was painted with', () => {
    expect(matchMaterial(finishLine(), [WALLPAPER])?.id).toBe('mat_wall')
  })

  test('a user override beats both ref and name', () => {
    const other: IntmMaterial = { ...WALLPAPER, id: 'mat_other', name: '합지 벽지' }
    const chosen = matchMaterial(finishLine(), [WALLPAPER, other], {
      'finish:library:mat_wall': 'mat_other',
    })
    expect(chosen?.id).toBe('mat_other')
  })

  test('a kind-level line falls back to matching by name', () => {
    const board: IntmMaterial = { ...WALLPAPER, id: 'mat_mdf', name: '상판' }
    const line = finishLine({
      category: 'board',
      key: 'countertop',
      label: '상판',
      materialRef: undefined,
    })
    expect(matchMaterial(line, [board])?.id).toBe('mat_mdf')
  })

  test('no plausible match returns nothing rather than the first row', () => {
    expect(
      matchMaterial(finishLine({ materialRef: 'library:unknown', label: '???' }), [WALLPAPER]),
    ).toBeUndefined()
  })
})

describe('draft pricing', () => {
  test('10평 of wallpaper prices as 2 rolls at the material rate', () => {
    const draft = buildEstimateDraft(report(finishLine()), [WALLPAPER], [])
    const [line] = draft.lines

    expect(line?.status).toBe('priced')
    expect(line?.quantity).toBe(2)
    expect(line?.unitPrice).toBe(20000)
    expect(line?.amount).toBe(40000)
    expect(draft.total).toBe(40000)
  })

  test("the category's waste allowance applies when the material states none", () => {
    // Material has wasteRate 0 explicitly; but here it has none at all, so the
    // category's 20% applies and pushes 2 rolls to 3.
    const noWaste: IntmMaterial = { ...WALLPAPER, wasteRate: null }
    const draft = buildEstimateDraft(report(finishLine()), [noWaste], [CATEGORY])

    expect(draft.lines[0]?.wasteRate).toBeCloseTo(0.2)
    expect(draft.lines[0]?.quantity).toBe(3)
    expect(draft.total).toBe(60000)
  })
})

// An estimate with a visible hole is fixable; one with a silently dropped line
// is not. Every unresolvable line stays, flagged.
describe('unresolved lines are surfaced, never dropped', () => {
  test('no matching material', () => {
    const draft = buildEstimateDraft(
      report(finishLine({ materialRef: 'library:none', label: '???' })),
      [],
      [],
    )
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]?.status).toBe('no-material')
    expect(draft.unresolved).toHaveLength(1)
    expect(draft.total).toBe(0)
  })

  test('material found but coverage unregistered', () => {
    const unmeasured: IntmMaterial = { ...WALLPAPER, coverageValue: null, coverageUnit: null }
    const draft = buildEstimateDraft(report(finishLine()), [unmeasured], [])

    expect(draft.lines[0]?.status).toBe('no-coverage')
    expect(draft.lines[0]?.material?.id).toBe('mat_wall')
    expect(draft.total).toBe(0)
  })

  test('converted but priced at zero', () => {
    const free: IntmMaterial = { ...WALLPAPER, unitPrice: 0 }
    const draft = buildEstimateDraft(report(finishLine()), [free], [])

    expect(draft.lines[0]?.status).toBe('no-price')
    expect(draft.lines[0]?.quantity).toBe(2)
    expect(draft.total).toBe(0)
  })

  test('a mixed report totals only what is actually priced', () => {
    const draft = buildEstimateDraft(
      report(
        finishLine(),
        finishLine({ key: 'library:none', materialRef: 'library:none', label: '???' }),
      ),
      [WALLPAPER],
      [],
    )

    expect(draft.lines).toHaveLength(2)
    expect(draft.unresolved).toHaveLength(1)
    expect(draft.total).toBe(40000)
  })
})
