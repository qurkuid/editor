import { afterEach, describe, expect, test } from 'bun:test'
import type { EstimateDraft, EstimateLine } from './estimate-lines'
import { submitEstimate, toEstimateItems } from './estimate-submit'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function line(overrides: Partial<EstimateLine> = {}): EstimateLine {
  return {
    takeoff: {
      category: 'finish',
      key: 'library:mat_wall',
      label: '벽 마감',
      unit: 'm2',
      quantity: 33.0578,
      nodeIds: ['wall_a', 'wall_b'],
    },
    status: 'priced',
    material: { id: 'mat_wall', name: '실크 벽지', unit: '롤', unitPrice: 20000 },
    quantity: 3,
    unitPrice: 20000,
    amount: 60000,
    wasteRate: 0.2,
    ...overrides,
  }
}

function draft(...lines: EstimateLine[]): EstimateDraft {
  return {
    lines,
    total: lines.reduce((sum, l) => sum + (l.status === 'priced' ? (l.amount ?? 0) : 0), 0),
    unresolved: lines.filter((l) => l.status !== 'priced'),
  }
}

describe('line items', () => {
  // Field names follow INTM's own item contract, not a shape of our own.
  test('a priced line becomes an INTM item with its converted quantity', () => {
    const [item] = toEstimateItems(draft(line()))

    expect(item?.quantity).toBe(3)
    expect(item?.unitPrice).toBe(20000)
    expect(item?.materialId).toBe('mat_wall')
  })

  test('the description traces the line back to the drawing', () => {
    const [item] = toEstimateItems(draft(line()))
    expect(item?.description).toBe('실크 벽지 · 도면 산출 33.06㎡ · 손실 20% · 2곳')
  })

  // An unresolved line is a question for the user. Carrying it into a
  // customer-facing document as a zero would bury that question.
  test.each([
    ['no-material' as const],
    ['no-coverage' as const],
    ['no-price' as const],
  ])('a %s line is left out', (status) => {
    expect(toEstimateItems(draft(line({ status })))).toHaveLength(0)
  })

  test('a priced line with zero quantity is left out too', () => {
    expect(toEstimateItems(draft(line({ quantity: 0 })))).toHaveLength(0)
  })

  test('a mixed draft submits only what is resolved', () => {
    const items = toEstimateItems(draft(line(), line({ status: 'no-coverage' }), line()))
    expect(items).toHaveLength(2)
  })
})

describe('submission', () => {
  function withIntm() {
    process.env.INTM_BASE_URL = 'https://intm.kr'
  }

  test('posts the items to INTM with the caller session', async () => {
    withIntm()
    let seen: { url: string; init: RequestInit } | null = null
    const result = await submitEstimate(
      draft(line()),
      { projectId: 'prj_1', title: '방배동 견적' },
      'session_token=abc',
      (async (url: string, init: RequestInit) => {
        seen = { url, init }
        return new Response(JSON.stringify({ id: 'est_1' }), { status: 200 })
      }) as unknown as typeof fetch,
    )

    expect(seen!.url).toBe('https://intm.kr/api/estimates/est_1/items')
    expect((seen!.init.headers as Record<string, string>).cookie).toBe('session_token=abc')
    expect(result).toEqual({ ok: true, estimateId: 'est_1', itemCount: 1, failedItems: 0 })
  })

  // Two calls, because that is INTM's shape: the document, then each item.
  test('creates the document first, then posts each item to it', async () => {
    withIntm()
    const urls: string[] = []
    await submitEstimate(
      draft(line(), line()),
      { projectId: 'prj_1', title: '방배동 견적' },
      'session_token=abc',
      (async (url: string) => {
        urls.push(url)
        return new Response(JSON.stringify({ id: 'est_1' }), { status: 200 })
      }) as unknown as typeof fetch,
    )

    expect(urls[0]).toBe('https://intm.kr/api/estimates')
    expect(urls.slice(1)).toEqual([
      'https://intm.kr/api/estimates/est_1/items',
      'https://intm.kr/api/estimates/est_1/items',
    ])
  })

  // INTM has no batch item endpoint, so a partial failure is reported rather
  // than rolled back — a half-filled estimate is finishable, a discarded one
  // is just lost work.
  test('counts item failures instead of discarding the estimate', async () => {
    withIntm()
    let call = 0
    const result = await submitEstimate(
      draft(line(), line()),
      { projectId: 'prj_1', title: 't' },
      'session_token=abc',
      (async () => {
        call += 1
        if (call === 1) return new Response(JSON.stringify({ id: 'est_1' }), { status: 200 })
        return new Response('nope', { status: call === 2 ? 200 : 500 })
      }) as unknown as typeof fetch,
    )

    expect(result).toEqual({ ok: true, estimateId: 'est_1', itemCount: 1, failedItems: 1 })
  })

  test.each([
    ['no project', { projectId: '', title: 't' }],
    ['no title', { projectId: 'prj_1', title: '' }],
  ])('refuses with %s before any request', async (_label, input) => {
    withIntm()
    let called = false
    const result = await submitEstimate(draft(line()), input, 'session_token=abc', (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch)

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
  })

  // A blank estimate is a document someone has to notice and delete.
  test('refuses to create an estimate with nothing resolved', async () => {
    withIntm()
    let called = false
    const result = await submitEstimate(
      draft(line({ status: 'no-coverage' })),
      { projectId: 'prj_1', title: 't' },
      'session_token=abc',
      (async () => {
        called = true
        return new Response('{}')
      }) as unknown as typeof fetch,
    )

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
  })

  test('reports a refusal instead of pretending it worked', async () => {
    withIntm()
    const result = await submitEstimate(
      draft(line()),
      { projectId: 'prj_1', title: 't' },
      'session_token=abc',
      (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, error: 'INTM이 견적 생성을 거부했습니다 (403)' })
  })

  test('a 200 with no estimate id is still a failure', async () => {
    withIntm()
    const result = await submitEstimate(
      draft(line()),
      { projectId: 'prj_1', title: 't' },
      'session_token=abc',
      (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    )
    expect(result.ok).toBe(false)
  })

  test('no session and no INTM both refuse before any request', async () => {
    withIntm()
    const input = { projectId: 'prj_1', title: 't' }
    expect((await submitEstimate(draft(line()), input, null)).ok).toBe(false)
    process.env.INTM_BASE_URL = undefined
    expect((await submitEstimate(draft(line()), input, 'session_token=abc')).ok).toBe(false)
  })
})
