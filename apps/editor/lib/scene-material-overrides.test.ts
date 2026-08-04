import { describe, expect, test } from 'bun:test'
import type { SceneMaterial } from '@pascal-app/core'
import type { TakeoffLine } from './quantity-takeoff'
import { intmOverridesFromSceneMaterials } from './scene-material-overrides'

function line(overrides: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    category: 'finish',
    key: 'scene:mat_abc',
    label: '벽 마감 scene:mat_abc',
    unit: 'm2',
    quantity: 9.76,
    nodeIds: ['wall_a'],
    materialRef: 'scene:mat_abc',
    role: 'material',
    ...overrides,
  }
}

function sceneMaterial(source?: { provider: string; externalId: string }): SceneMaterial {
  return {
    id: 'mat_abc',
    name: 'LG 도배지 합지',
    material: { id: 'mat_abc', preset: 'custom', ...(source ? { source } : {}) },
  } as unknown as SceneMaterial
}

describe('a painted face finds the INTM product it was painted with', () => {
  // The paint panel freezes the catalogue pick into a scene copy, so the ref
  // alone says nothing — the identity lives in the copy's source.
  test('a scene copy of an INTM material resolves to its id', () => {
    const overrides = intmOverridesFromSceneMaterials(
      { mat_abc: sceneMaterial({ provider: 'intm', externalId: 'uuid-1' }) },
      [line()],
    )
    expect(overrides).toEqual({ 'finish:scene:mat_abc': 'uuid-1' })
  })

  test('floors and ceilings resolve the same way', () => {
    const overrides = intmOverridesFromSceneMaterials(
      { mat_abc: sceneMaterial({ provider: 'intm', externalId: 'uuid-1' }) },
      [line({ category: 'floor', key: 'scene:mat_abc' })],
    )
    expect(overrides).toEqual({ 'floor:scene:mat_abc': 'uuid-1' })
  })

  // A hand-mixed colour or another provider's product is genuinely unlinked —
  // resolving it to anything would name a product nobody chose.
  test('a scene material with no INTM source stays unlinked', () => {
    expect(intmOverridesFromSceneMaterials({ mat_abc: sceneMaterial() }, [line()])).toEqual({})
    expect(
      intmOverridesFromSceneMaterials(
        { mat_abc: sceneMaterial({ provider: 'rawpainter', externalId: 'x' }) },
        [line()],
      ),
    ).toEqual({})
  })

  test('a ref to a deleted scene material resolves to nothing', () => {
    expect(intmOverridesFromSceneMaterials({}, [line()])).toEqual({})
  })

  test('library refs pass through untouched — they already match by tail', () => {
    expect(
      intmOverridesFromSceneMaterials({ mat_abc: sceneMaterial({ provider: 'intm', externalId: 'u' }) }, [
        line({ materialRef: 'library:intm:u', key: 'library:intm:u' }),
      ]),
    ).toEqual({})
  })
})
