import { describe, expect, test } from 'bun:test'
import type { IntmMaterial } from './intm-materials'
import { constructionKindsFor, toConstructionCatalogItems } from './intm-construction-materials'

function material(name: string, overrides: Partial<IntmMaterial> = {}): IntmMaterial {
  return { id: `mat_${name}`, name, unit: '장', unitPrice: 5000, ...overrides }
}

describe('what a catalogue entry can stand in for', () => {
  test.each([
    ['석고보드 9.5T', 'gypsum-board'],
    ['방화보드 12.5T', 'gypsum-board'],
    ['다루끼 30×30', 'timber-stud'],
    ['각재 33×33', 'timber-stud'],
    ['MDF 18T', 'mdf'],
    ['실크 벽지', 'finish'],
    ['수성 페인트', 'finish'],
  ])('%s → %s', (name, kind) => {
    expect(constructionKindsFor(name)).toContain(kind)
  })

  // The same trap that made the coverage seed over-match: these read like
  // materials but are trades. Offering them as a wall layer is nonsense.
  test.each([['타일 철거'], ['도배 인건비'], ['석고보드 시공비'], ['폐기물 운반']])(
    '%s is not a material',
    (name) => {
      expect(constructionKindsFor(name)).toEqual([])
    },
  )

  // Korean compounds swallow these words whole: 수(도배)관 contains 도배, and
  // the live catalogue was offering a plumbing move as a wall finish.
  test.each([['수도배관이설'], ['전기배선 이설'], ['위생설비 교체']])(
    '%s is not swallowed by a substring match',
    (name) => {
      expect(constructionKindsFor(name)).toEqual([])
    },
  )

  test('a name that says nothing is left unclassified', () => {
    expect(constructionKindsFor('기타 잡자재')).toEqual([])
  })
})

describe('registering them for the layer picker', () => {
  test('the id is the provider-scoped INTM id, which pricing resolves by its tail', () => {
    const [item] = toConstructionCatalogItems([material('석고보드 9.5T', { id: 'mat_gyp' })])

    expect(item?.id).toBe('intm:mat_gyp')
    expect(item?.sourceRef).toEqual({ provider: 'intm', externalId: 'mat_gyp' })
  })

  test('the price rides along, so a chosen layer can be costed', () => {
    const [item] = toConstructionCatalogItems([
      material('각재 33×33', { unitPrice: 1200, unit: '본' }),
    ])
    expect(item?.commercial).toEqual({ unitPrice: 1200, unit: '본' })
  })

  // The panel filters by `constructionKinds` first, so this is what decides
  // whether a product appears on a gypsum layer at all.
  test('the kinds it can serve are carried through', () => {
    const [item] = toConstructionCatalogItems([material('석고보드 9.5T')])
    expect(item?.constructionKinds).toContain('gypsum-board')
  })

  // Unclassified entries would otherwise surface on every finish layer, and
  // the catalogue has thousands of rows.
  test('entries that match nothing are left out entirely', () => {
    expect(toConstructionCatalogItems([material('기타 잡자재'), material('도배 인건비')])).toEqual(
      [],
    )
  })

  test('they are workspace-sourced, so the paint picker keeps them separate', () => {
    const [item] = toConstructionCatalogItems([material('실크 벽지')])
    expect(item?.source).toBe('workspace')
  })
})
