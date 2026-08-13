import { afterEach, expect, test } from 'bun:test'
import { guardSceneApiRequest, readSceneApiJson, sceneApiPreflight } from './scene-api-security'

const OLD_ENV = { ...process.env }

afterEach(() => {
  restoreEnv('PASCAL_SCENE_API_TOKEN')
  restoreEnv('PASCAL_SCENE_API_ORIGINS')
  restoreEnv('PASCAL_SCENE_API_RATE_LIMIT')
  restoreEnv('INTM_BASE_URL')
  restoreEnv('INTM_AUTH_DISABLED')
})

function restoreEnv(key: keyof NodeJS.ProcessEnv): void {
  if (OLD_ENV[key] === undefined) delete process.env[key]
  else process.env[key] = OLD_ENV[key]
}

test('reads gzip-compressed JSON request bodies', async () => {
  const payload = { graph: { nodes: {}, rootNodeIds: [] } }
  const request = new Request('http://127.0.0.1:3000/api/scenes', {
    method: 'PUT',
    headers: { 'Content-Encoding': 'gzip' },
    body: Bun.gzipSync(JSON.stringify(payload)),
  })

  expect(await readSceneApiJson(request)).toEqual(payload)
})

test('allows loopback scene API requests without a token', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  const request = new Request('http://127.0.0.1:3000/api/scenes', {
    headers: { host: '127.0.0.1:3000' },
  })

  expect(guardSceneApiRequest(request)).toBeNull()
})

test('requires a token for non-loopback scene API requests', async () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  const request = new Request('https://editor.example/api/scenes', {
    headers: { host: 'editor.example' },
  })

  const response = guardSceneApiRequest(request)

  expect(response?.status).toBe(503)
  expect(await response?.json()).toEqual({ error: 'scene_api_token_required' })
})

test('accepts an INTM session cookie when INTM auth is enabled', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  process.env.INTM_BASE_URL = 'https://intm.kr'
  delete process.env.INTM_AUTH_DISABLED
  const request = new Request('https://editor.example/api/scenes', {
    headers: {
      cookie: 'session_token=verified-by-middleware',
      host: 'editor.example',
    },
  })

  expect(guardSceneApiRequest(request)).toBeNull()
})

test('still rejects an INTM-enabled request without a session cookie', async () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  process.env.INTM_BASE_URL = 'https://intm.kr'
  delete process.env.INTM_AUTH_DISABLED
  const request = new Request('https://editor.example/api/scenes', {
    headers: { host: 'editor.example' },
  })

  const response = guardSceneApiRequest(request)

  expect(response?.status).toBe(503)
  expect(await response?.json()).toEqual({ error: 'scene_api_token_required' })
})

test('accepts bearer token auth when configured', () => {
  process.env.PASCAL_SCENE_API_TOKEN = 'secret'
  const request = new Request('https://editor.example/api/scenes', {
    headers: {
      authorization: 'Bearer secret',
      host: 'editor.example',
    },
  })

  expect(guardSceneApiRequest(request)).toBeNull()
})

test('allows same-origin requests through a reverse proxy', () => {
  process.env.PASCAL_SCENE_API_TOKEN = 'secret'
  const request = new Request('http://127.0.0.1:3022/floorplan/api/scenes', {
    headers: {
      authorization: 'Bearer secret',
      origin: 'https://intm.kr',
      'x-forwarded-host': 'intm.kr',
      'x-forwarded-proto': 'https',
    },
  })

  expect(guardSceneApiRequest(request)).toBeNull()
})

test('applies configured CORS origins for preflight', () => {
  process.env.PASCAL_SCENE_API_ORIGINS = 'https://app.example'
  const request = new Request('https://editor.example/api/scenes', {
    method: 'OPTIONS',
    headers: {
      host: 'editor.example',
      origin: 'https://app.example',
    },
  })

  const response = sceneApiPreflight(request)

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example')
})
