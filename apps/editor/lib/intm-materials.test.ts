import { afterEach, describe, expect, test } from 'bun:test'
import {
  canEditCoverage,
  fetchIntmCategories,
  fetchIntmMaterials,
  isSharedMaterial,
  saveIntmMaterialCoverage,
} from './intm-materials'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function withIntm() {
  process.env.INTM_BASE_URL = 'https://intm.kr'
}

function jsonFetcher(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

describe('material catalogue', () => {
  test('one call brings back company and shared materials together', async () => {
    withIntm()
    // INTM scopes with `company_id = <session> OR company_id IS NULL`, so both
    // arrive from a single request — floorplan must not re-filter them.
    const { fetcher, calls } = jsonFetcher({
      data: [
        { id: 'm1', name: '실크 벽지', unit: '롤', unitPrice: 20000, companyId: 'co_1' },
        { id: 'm2', name: '공용 석고보드', unit: '장', unitPrice: 5000, companyId: null },
      ],
    })

    const materials = await fetchIntmMaterials('session_token=abc', fetcher)

    expect(calls[0]!.url).toBe('https://intm.kr/api/materials')
    expect((calls[0]!.init.headers as Record<string, string>).cookie).toBe('session_token=abc')
    expect(materials).toHaveLength(2)
    expect(materials.map(isSharedMaterial)).toEqual([false, true])
  })

  test('coverage fields ride along so quantities can be converted', async () => {
    withIntm()
    const { fetcher } = jsonFetcher({
      data: [
        {
          id: 'm1',
          name: '실크 벽지',
          unit: '롤',
          unitPrice: 20000,
          coverageValue: 16.5289,
          coverageUnit: 'm2',
          isDiscrete: true,
          wasteRate: 0.2,
        },
      ],
    })

    const [material] = await fetchIntmMaterials('session_token=abc', fetcher)
    expect(material?.coverageValue).toBeCloseTo(16.5289)
    expect(material?.isDiscrete).toBe(true)
    expect(material?.wasteRate).toBeCloseTo(0.2)
  })

  test('a material with no coverage yet reads as unset, not as zero', async () => {
    withIntm()
    const { fetcher } = jsonFetcher({ data: [{ id: 'm1', name: '미등록 자재' }] })
    const [material] = await fetchIntmMaterials('session_token=abc', fetcher)

    // Null means "nobody has measured this"; 0 would mean "covers nothing".
    expect(material?.coverageValue).toBeNull()
    expect(material?.wasteRate).toBeNull()
  })

  test('malformed rows are skipped rather than poisoning the list', async () => {
    withIntm()
    const { fetcher } = jsonFetcher({ data: [{ id: 'm1', name: 'ok' }, { id: 5 }, null, 'nope'] })
    expect(await fetchIntmMaterials('session_token=abc', fetcher)).toHaveLength(1)
  })

  // A catalogue outage should cost prices, not the whole page.
  test.each([
    ['an error status', () => jsonFetcher({}, 500).fetcher],
    [
      'an unreachable INTM',
      () =>
        (async () => {
          throw new Error('ECONNREFUSED')
        }) as unknown as typeof fetch,
    ],
  ])('%s degrades to an empty catalogue', async (_label, makeFetcher) => {
    withIntm()
    expect(await fetchIntmMaterials('session_token=abc', makeFetcher())).toEqual([])
  })

  test('no session means no catalogue request', async () => {
    withIntm()
    let called = false
    await fetchIntmMaterials(null, (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch)
    expect(called).toBe(false)
  })
})

describe('category defaults', () => {
  test('default_* columns map onto the shared coverage shape', async () => {
    withIntm()
    const { fetcher } = jsonFetcher({
      data: [
        {
          id: 'c1',
          name: '벽지',
          defaultCoverageValue: 16.5289,
          defaultCoverageUnit: 'm2',
          defaultIsDiscrete: true,
          defaultWasteRate: 0.2,
        },
      ],
    })

    const [category] = await fetchIntmCategories('session_token=abc', fetcher)
    expect(category?.coverageValue).toBeCloseTo(16.5289)
    expect(category?.coverageUnit).toBe('m2')
    expect(category?.wasteRate).toBeCloseTo(0.2)
  })
})

describe('saving a correction', () => {
  test('writes back to INTM so both sides stay in step', async () => {
    withIntm()
    const { fetcher, calls } = jsonFetcher({ ok: true })

    const saved = await saveIntmMaterialCoverage(
      'm1',
      { coverageValue: 6.6116, coverageUnit: 'm2', isDiscrete: true, wasteRate: 0.25 },
      'session_token=abc',
      fetcher,
    )

    expect(saved).toBe(true)
    expect(calls[0]!.url).toBe('https://intm.kr/api/materials/m1')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(JSON.parse(calls[0]!.init.body as string).wasteRate).toBeCloseTo(0.25)
  })

  test('a rejected save reports failure instead of pretending', async () => {
    withIntm()
    const { fetcher } = jsonFetcher({ error: 'nope' }, 403)
    expect(
      await saveIntmMaterialCoverage('m1', { wasteRate: 0.25 }, 'session_token=abc', fetcher),
    ).toBe(false)
  })
})

// INTM rejects field updates on shared materials — one company editing a
// shared row would change it for everyone. Floorplan honours that rule instead
// of routing around it, so the UI can disable the field up front.
describe('who may correct a spec', () => {
  test('a company material is editable', () => {
    expect(canEditCoverage({ id: 'm', name: 'n', unit: '', unitPrice: 0, companyId: 'co_1' })).toBe(
      true,
    )
  })

  test('a shared material is not', () => {
    expect(canEditCoverage({ id: 'm', name: 'n', unit: '', unitPrice: 0, companyId: null })).toBe(
      false,
    )
  })
})
