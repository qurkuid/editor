import { describe, expect, test } from 'bun:test'
import {
  applyCoverage,
  buildCoveragePatch,
  COVERAGE_UNIT_LABEL,
  type CoverageSpec,
  DEFAULT_WASTE_RATE,
  resolveCoverageSpec,
  resolveWasteRate,
} from './material-coverage'

// 실크 벽지 1롤 = 1060mm × 15.6m ≈ 정5평.
const WALLPAPER: CoverageSpec = {
  coverageValue: 16.5289,
  coverageUnit: 'm2',
  isDiscrete: true,
  wasteRate: 0,
  source: 'material',
}

const PYEONG = 3.305785

describe('spec resolution', () => {
  test('the material wins over its category default', () => {
    const spec = resolveCoverageSpec(
      { coverageValue: 6.6116, coverageUnit: 'm2', isDiscrete: true },
      { coverageValue: 16.5289, coverageUnit: 'm2', isDiscrete: true },
    )
    // 합지 소폭 1롤(정2평)이 카테고리의 정5평 기본값을 덮어써야 한다.
    expect(spec?.coverageValue).toBeCloseTo(6.6116)
    expect(spec?.source).toBe('material')
  })

  test('the category default carries an unregistered material', () => {
    const spec = resolveCoverageSpec(null, {
      coverageValue: 16.5289,
      coverageUnit: 'm2',
      isDiscrete: true,
    })
    expect(spec?.source).toBe('category')
  })

  test('no spec anywhere resolves to null, not a guess', () => {
    expect(resolveCoverageSpec(null, null)).toBeNull()
    expect(resolveCoverageSpec({}, {})).toBeNull()
  })

  // A half-filled row is not a spec: defaulting the unit would silently mix
  // square metres with running metres.
  test.each([
    ['no unit', { coverageValue: 5 }],
    ['no value', { coverageUnit: 'm2' }],
    ['zero coverage', { coverageValue: 0, coverageUnit: 'm2' }],
    ['negative coverage', { coverageValue: -3, coverageUnit: 'm2' }],
    ['unknown unit', { coverageValue: 5, coverageUnit: 'roll' }],
  ])('%s is rejected', (_label, fields) => {
    expect(resolveCoverageSpec(fields, null)).toBeNull()
  })

  test('an out-of-range waste rate falls back to the house default, not a distortion', () => {
    const spec = resolveCoverageSpec({ coverageValue: 5, coverageUnit: 'm2', wasteRate: 1.5 }, null)
    expect(spec?.wasteRate).toBe(DEFAULT_WASTE_RATE)
  })

  test('unstated discreteness stays splittable', () => {
    // Rounding up when unsure would over-order every continuous material.
    expect(resolveCoverageSpec({ coverageValue: 1, coverageUnit: 'm2' }, null)?.isDiscrete).toBe(
      false,
    )
  })
})

describe('conversion', () => {
  test("사장님's case: 10평 of wallpaper is 2 rolls", () => {
    const result = applyCoverage(10 * PYEONG, 'm2', WALLPAPER)
    expect(result?.quantity).toBe(2)
  })

  test('5평 is exactly one roll, and 5평 plus a sliver is two', () => {
    expect(applyCoverage(5 * PYEONG, 'm2', WALLPAPER)?.quantity).toBe(1)
    expect(applyCoverage(5 * PYEONG + 0.5, 'm2', WALLPAPER)?.quantity).toBe(2)
  })

  test('waste allowance can push it to the next whole unit', () => {
    // 10평 = 33.06㎡ → 2.00 rolls bare, but 5% cutting loss makes it 2.10 → 3.
    const bare = applyCoverage(10 * PYEONG, 'm2', WALLPAPER)
    const withWaste = applyCoverage(10 * PYEONG, 'm2', { ...WALLPAPER, wasteRate: 0.05 })
    expect(bare?.quantity).toBe(2)
    expect(withWaste?.quantity).toBe(3)
    expect(withWaste?.withWaste).toBeCloseTo(33.0578 * 1.05, 2)
  })

  test('continuous materials are not rounded up', () => {
    const result = applyCoverage(33.06, 'm2', {
      coverageValue: 1,
      coverageUnit: 'm2',
      isDiscrete: false,
      wasteRate: 0.08,
      source: 'category',
    })
    expect(result?.quantity).toBeCloseTo(35.7, 1)
  })

  test('the takeoff amount is preserved alongside the converted quantity', () => {
    const result = applyCoverage(33.06, 'm2', WALLPAPER)
    expect(result?.takeoff).toBeCloseTo(33.06)
    expect(result?.spec.coverageValue).toBeCloseTo(16.5289)
  })
})

describe('refusals', () => {
  test('a mismatched unit refuses rather than converting nonsense', () => {
    // Ordering by the metre against a per-m² spec would be a silent unit error.
    expect(applyCoverage(12, 'm', WALLPAPER)).toBeNull()
  })

  test('no spec means no quantity', () => {
    expect(applyCoverage(33.06, 'm2', null)).toBeNull()
  })

  test.each([0, -5, Number.NaN])('a takeoff of %s yields nothing', (amount) => {
    expect(applyCoverage(amount, 'm2', WALLPAPER)).toBeNull()
  })
})

describe('whole-unit tolerance', () => {
  // The tolerance exists to absorb rounded catalogue figures, not to swallow a
  // genuine shortfall — a real overage must still cost another unit.
  test('a hair over an exact fit does not cost an extra unit', () => {
    expect(applyCoverage(16.5289 * 3 + 1e-5, 'm2', WALLPAPER)?.quantity).toBe(3)
  })

  test('a real overage still rounds up', () => {
    expect(applyCoverage(16.5289 * 3 + 0.5, 'm2', WALLPAPER)?.quantity).toBe(4)
  })

  test('the tolerance scales with quantity instead of vanishing', () => {
    // 100 rolls' worth of rounding noise is 100× that of one roll.
    expect(applyCoverage(16.5289 * 100 + 1e-3, 'm2', WALLPAPER)?.quantity).toBe(100)
  })
})

// Waste is a property of how a material cuts, not of how it is packaged, so it
// is managed per material independently of where the coverage came from.
describe('waste rate is managed per material', () => {
  test('a material that states only its roll size still inherits category waste', () => {
    const spec = resolveCoverageSpec(
      { coverageValue: 6.6116, coverageUnit: 'm2', isDiscrete: true },
      { coverageValue: 16.5289, coverageUnit: 'm2', isDiscrete: true, wasteRate: 0.05 },
    )
    expect(spec?.coverageValue).toBeCloseTo(6.6116) // its own roll
    expect(spec?.wasteRate).toBeCloseTo(0.05) // the category's allowance
  })

  test("a material's own waste survives a category-supplied coverage", () => {
    const spec = resolveCoverageSpec(
      { wasteRate: 0.12 },
      { coverageValue: 16.5289, coverageUnit: 'm2', isDiscrete: true, wasteRate: 0.05 },
    )
    expect(spec?.source).toBe('category')
    expect(spec?.wasteRate).toBeCloseTo(0.12)
  })

  test('a material can set waste to zero without picking up the category default', () => {
    const spec = resolveCoverageSpec(
      { coverageValue: 5, coverageUnit: 'm2', wasteRate: 0 },
      { coverageValue: 5, coverageUnit: 'm2', wasteRate: 0.1 },
    )
    expect(spec?.wasteRate).toBe(0)
  })

  test('resolves standalone, for editing a waste rate on its own', () => {
    expect(resolveWasteRate({ wasteRate: 0.08 }, { wasteRate: 0.05 })).toBeCloseTo(0.08)
    expect(resolveWasteRate(null, { wasteRate: 0.05 })).toBeCloseTo(0.05)
    expect(resolveWasteRate(null, null)).toBe(DEFAULT_WASTE_RATE)
    expect(resolveWasteRate({ wasteRate: 1.5 }, { wasteRate: 0.05 })).toBeCloseTo(0.05)
  })
})

describe('house default waste rate', () => {
  test('is 20% — an unknown material errs high rather than short', () => {
    expect(DEFAULT_WASTE_RATE).toBeCloseTo(0.2)
    expect(resolveCoverageSpec({ coverageValue: 5, coverageUnit: 'm2' }, null)?.wasteRate).toBe(0.2)
  })

  test('an explicit rate always beats it — including an explicit zero', () => {
    expect(resolveWasteRate({ wasteRate: 0 }, null)).toBe(0)
    expect(resolveWasteRate({ wasteRate: 0.35 }, null)).toBeCloseTo(0.35)
    expect(resolveWasteRate(null, { wasteRate: 0.05 })).toBeCloseTo(0.05)
  })

  test('it changes the ordered quantity, so it is worth correcting', () => {
    // 정5평 × 2 exactly: no allowance is 2 rolls, the 20% default is 3.
    const area = 16.5289 * 2
    const spec = { coverageValue: 16.5289, coverageUnit: 'm2' as const, isDiscrete: true }
    expect(
      applyCoverage(area, 'm2', resolveCoverageSpec({ ...spec, wasteRate: 0 }, null))?.quantity,
    ).toBe(2)
    expect(applyCoverage(area, 'm2', resolveCoverageSpec(spec, null))?.quantity).toBe(3)
  })
})

describe('the spec editor speaks the line\'s own unit', () => {
  // 각재 is measured by the metre, and the editor said ㎡ — inviting an area
  // for a length and reading like the quantity itself was computed by area.
  test.each([
    ['m', 'm'],
    ['m2', '㎡'],
    ['m3', '㎥'],
    ['ea', '개'],
  ] as const)('%s lines label their spec in %s', (unit, label) => {
    expect(COVERAGE_UNIT_LABEL[unit]).toBe(label)
  })

  test('saving a coverage value records which unit it measures', () => {
    expect(buildCoveragePatch('28.8', '', 'm')).toEqual({
      coverageValue: 28.8,
      coverageUnit: 'm',
    })
  })

  // Half a spec is unusable: a value with no unit is rejected downstream, so
  // the unit must ride along whenever the value is set — and only then.
  test('waste alone does not stamp a unit', () => {
    expect(buildCoveragePatch('', '15', 'm')).toEqual({ wasteRate: 0.15 })
  })

  test('both together save both', () => {
    expect(buildCoveragePatch('16.5289', '20', 'm2')).toEqual({
      coverageValue: 16.5289,
      coverageUnit: 'm2',
      wasteRate: 0.2,
    })
  })

  test.each([['0'], ['-3'], ['abc']])('coverage %s is not saved', (raw) => {
    expect(buildCoveragePatch(raw, '', 'm')).toBeNull()
  })

  test('waste outside 0–99 is dropped, not clamped', () => {
    expect(buildCoveragePatch('28.8', '150', 'm')).toEqual({
      coverageValue: 28.8,
      coverageUnit: 'm',
    })
  })

  test('nothing valid means no patch at all', () => {
    expect(buildCoveragePatch('', '', 'm')).toBeNull()
  })
})
