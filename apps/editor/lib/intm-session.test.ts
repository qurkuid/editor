import { afterEach, describe, expect, test } from 'bun:test'
import { fetchIntmUser, intmAuthEnabled, intmLoginUrl } from './intm-session'

const ORIGINAL = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL }
})

function withIntm(url = 'https://intm.kr') {
  process.env.INTM_BASE_URL = url
  process.env.INTM_AUTH_DISABLED = undefined
}

describe('gating', () => {
  test('stays off until an INTM instance is configured', () => {
    process.env.INTM_BASE_URL = undefined
    expect(intmAuthEnabled()).toBe(false)
  })

  test('turns on once INTM_BASE_URL is set, and can be forced off', () => {
    withIntm()
    expect(intmAuthEnabled()).toBe(true)
    process.env.INTM_AUTH_DISABLED = 'true'
    expect(intmAuthEnabled()).toBe(false)
  })

  test('login URL returns the user to where they were headed', () => {
    withIntm()
    expect(intmLoginUrl('https://intm.kr/floorplan/scene/abc')).toBe(
      'https://intm.kr/login?redirect=https%3A%2F%2Fintm.kr%2Ffloorplan%2Fscene%2Fabc',
    )
  })
})

describe('session resolution', () => {
  test('forwards the inbound cookie verbatim to INTM', async () => {
    withIntm()
    let seen: { url: string; cookie?: string } | null = null
    const user = await fetchIntmUser('session_token=abc; other=1', (async (
      url: string,
      init: RequestInit,
    ) => {
      seen = { url, cookie: (init.headers as Record<string, string>).cookie }
      return new Response(JSON.stringify({ user: { email: 'a@b.c' } }), { status: 200 })
    }) as unknown as typeof fetch)

    expect(seen!.url).toBe('https://intm.kr/api/auth/session')
    expect(seen!.cookie).toBe('session_token=abc; other=1')
    expect(user?.email).toBe('a@b.c')
  })

  test('no session cookie means no INTM round trip at all', async () => {
    withIntm()
    let called = false
    const user = await fetchIntmUser('other=1', (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch)

    expect(called).toBe(false)
    expect(user).toBeNull()
  })

  // Fail closed: an INTM outage must not turn the gate into an open door.
  test.each([
    ['a rejected session', async () => new Response('{"user":null}', { status: 200 })],
    ['an error status', async () => new Response('nope', { status: 500 })],
    [
      'an unreachable INTM',
      async () => {
        throw new Error('ECONNREFUSED')
      },
    ],
  ])('%s resolves to no user', async (_label, fetcher) => {
    withIntm()
    expect(await fetchIntmUser('session_token=abc', fetcher as unknown as typeof fetch)).toBeNull()
  })

  test('an unconfigured INTM never authenticates anyone', async () => {
    process.env.INTM_BASE_URL = undefined
    expect(await fetchIntmUser('session_token=abc')).toBeNull()
  })
})
