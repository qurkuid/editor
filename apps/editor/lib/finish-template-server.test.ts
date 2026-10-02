import { afterEach, describe, expect, test } from 'bun:test'
import { resolveFinishTemplatePrincipal } from './finish-template-server'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = globalThis.fetch

function request(cookie?: string, url = 'https://editor.example/api/finish-templates'): Request {
  const headers = new Headers({ host: new URL(url).host })
  if (cookie) headers.set('cookie', cookie)
  return new Request(url, { headers })
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  globalThis.fetch = ORIGINAL_FETCH
})

describe('finish template principal resolution', () => {
  test('uses the loopback local shared scope when auth is unconfigured', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED

    await expect(
      resolveFinishTemplatePrincipal(
        request(undefined, 'http://127.0.0.1:3000/api/finish-templates'),
      ),
    ).resolves.toEqual({
      principal: { ownerId: 'local', companyId: null, local: true },
    })
  })

  test('does not create an anonymous production scope', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED

    await expect(resolveFinishTemplatePrincipal(request())).resolves.toEqual({
      error: 'unavailable',
    })
  })

  test('requires a verified session and rejects malformed identity fields', async () => {
    process.env.INTM_BASE_URL = 'https://intm.kr'
    delete process.env.INTM_AUTH_DISABLED

    await expect(resolveFinishTemplatePrincipal(request())).resolves.toEqual({
      error: 'unauthorized',
    })

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ user: { id: 123, companyId: 'company-a' } }), {
        status: 200,
      })) as typeof fetch
    await expect(
      resolveFinishTemplatePrincipal(request('session_token=verified')),
    ).resolves.toEqual({
      error: 'unauthorized',
    })
  })

  test('returns only the verified principal identity', async () => {
    process.env.INTM_BASE_URL = 'https://intm.kr'
    delete process.env.INTM_AUTH_DISABLED
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ user: { id: ' user-a ', companyId: ' company-a ' } }), {
        status: 200,
      })) as typeof fetch

    await expect(
      resolveFinishTemplatePrincipal(request('session_token=verified')),
    ).resolves.toEqual({
      principal: { ownerId: 'user-a', companyId: 'company-a', local: false },
    })
  })
})
