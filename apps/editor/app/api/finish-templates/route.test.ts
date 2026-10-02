import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { NextRequest } from 'next/server'
import { __resetSceneStoreForTests, getSceneStore } from '@/lib/scene-store-server'
import { DELETE, GET as GET_TEMPLATE, PATCH } from './[id]/route'
import { GET, POST } from './route'

const ORIGINAL_ENV = { ...process.env }
let databaseRoot: string | null = null

const snapshot = {
  version: 1 as const,
  id: 'zone-template_route',
  name: 'Route finish',
  createdAt: '2026-10-02T00:00:00.000Z',
  source: {
    zoneId: 'zone_route',
    fingerprint: {
      levelId: 'level_route',
      zoneId: 'zone_route',
      polygonSignature: '0,0;4,0;4,4;0,4',
      inwardWalls: [
        {
          wallId: 'wall_route',
          face: 'front' as const,
          segmentSignature: '0,0|4,0',
          length: 4,
          activeSlotRoles: ['interior'],
        },
      ],
      floor: { slabId: 'slab_route', polygonSignature: '0,0;4,0;4,4;0,4' },
    },
  },
  walls: [
    {
      sourceFace: {
        wallId: 'wall_route',
        face: 'front' as const,
        key: 'wall_route:front',
        segmentSignature: '0,0|4,0',
        length: 4,
        activeSlotRoles: ['interior'],
      },
      slots: [
        {
          role: 'interior',
          material: {
            label: 'Oak',
            material: { texture: { url: 'https://cdn.example.test/oak.png' } },
          },
        },
      ],
    },
  ],
  floor: {
    label: 'Oak',
    material: { texture: { url: 'https://cdn.example.test/oak.png' } },
  },
}

function request(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers)
  headers.set('host', '127.0.0.1:3000')
  return new NextRequest(url, { ...init, headers })
}

afterEach(async () => {
  const store = await getSceneStore().catch(() => null)
  store?.close()
  __resetSceneStoreForTests()
  if (databaseRoot) await fs.rm(databaseRoot, { recursive: true, force: true })
  databaseRoot = null
  process.env = { ...ORIGINAL_ENV }
})

describe('finish template API', () => {
  test('creates locally, returns only public fields, replays idempotently, and lists', async () => {
    databaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-finish-route-'))
    process.env.NODE_ENV = 'test'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED
    process.env.PASCAL_DB_PATH = path.join(databaseRoot, 'pascal.db')
    process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'

    const body = { kind: 'zone', visibility: 'company', template: snapshot }
    const first = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
    )
    expect(first.status).toBe(201)
    const firstJson = (await first.json()) as Record<string, unknown>
    expect(firstJson.visibility).toBe('local')
    expect(firstJson.editable).toBe(true)
    expect(firstJson.ownerId).toBeUndefined()
    expect(firstJson.companyId).toBeUndefined()

    const replay = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
    )
    expect(replay.status).toBe(200)

    const listed = await GET(request('http://127.0.0.1:3000/api/finish-templates') as never)
    expect(listed.status).toBe(200)
    const listedJson = (await listed.json()) as { templates: Array<Record<string, unknown>> }
    expect(listedJson.templates.map((entry) => entry.id)).toEqual([snapshot.id])
    expect(listedJson.templates[0]?.ownerId).toBeUndefined()
  })

  test('renames and deletes through version CAS', async () => {
    databaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-finish-route-'))
    process.env.NODE_ENV = 'test'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED
    process.env.PASCAL_DB_PATH = path.join(databaseRoot, 'pascal.db')
    process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'

    const created = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'zone', template: snapshot }),
      }) as never,
    )
    expect(created.status).toBe(201)

    const renamed = await PATCH(
      request(`http://127.0.0.1:3000/api/finish-templates/${snapshot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': '"1"' },
        body: JSON.stringify({ name: 'Renamed' }),
      }) as never,
      { params: Promise.resolve({ id: snapshot.id }) },
    )
    expect(renamed.status).toBe(200)
    const renamedJson = (await renamed.json()) as {
      name: string
      version: number
      template: { name: string }
    }
    expect(renamedJson.name).toBe('Renamed')
    expect(renamedJson.version).toBe(2)
    expect(renamedJson.template.name).toBe('Renamed')

    const stale = await PATCH(
      request(`http://127.0.0.1:3000/api/finish-templates/${snapshot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': '"1"' },
        body: JSON.stringify({ name: 'Stale' }),
      }),
      { params: Promise.resolve({ id: snapshot.id }) },
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'conflict', currentVersion: 2 })

    const loaded = await GET_TEMPLATE(
      request(`http://127.0.0.1:3000/api/finish-templates/${snapshot.id}`) as never,
      { params: Promise.resolve({ id: snapshot.id }) },
    )
    expect(loaded.status).toBe(200)

    const removed = await DELETE(
      request(`http://127.0.0.1:3000/api/finish-templates/${snapshot.id}`, {
        method: 'DELETE',
        headers: { 'if-match': '"2"' },
      }) as never,
      { params: Promise.resolve({ id: snapshot.id }) },
    )
    expect(removed.status).toBe(204)
  })

  test('rejects an expanded request body over the server cap', async () => {
    databaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-finish-route-'))
    process.env.NODE_ENV = 'test'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED
    process.env.PASCAL_DB_PATH = path.join(databaseRoot, 'pascal.db')
    process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'

    const response = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) }),
      }),
    )
    expect(response.status).toBe(413)
  })

  test('rejects unknown top-level zone fields instead of silently stripping them', async () => {
    databaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-finish-route-'))
    process.env.NODE_ENV = 'test'
    delete process.env.INTM_BASE_URL
    delete process.env.INTM_AUTH_DISABLED
    process.env.PASCAL_DB_PATH = path.join(databaseRoot, 'pascal.db')
    process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'

    const response = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'zone',
          template: { ...snapshot, unknownZoneField: true },
        }),
      }) as never,
    )
    expect(response.status).toBe(400)
  })

  test('keeps company-less verified users private-only', async () => {
    databaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-finish-route-'))
    process.env.NODE_ENV = 'test'
    process.env.INTM_BASE_URL = 'https://intm.example.test'
    delete process.env.INTM_AUTH_DISABLED
    process.env.PASCAL_DB_PATH = path.join(databaseRoot, 'pascal.db')
    process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ user: { id: 'user-companyless' } }), {
        status: 200,
      })) as typeof fetch

    const cookie = { cookie: 'session_token=verified' }
    const privateResponse = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { ...cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'zone', template: snapshot }),
      }) as never,
    )
    expect(privateResponse.status).toBe(201)

    const companyResponse = await POST(
      request('http://127.0.0.1:3000/api/finish-templates', {
        method: 'POST',
        headers: { ...cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'zone', visibility: 'company', template: snapshot }),
      }) as never,
    )
    expect(companyResponse.status).toBe(403)

    const companyList = await GET(
      request('http://127.0.0.1:3000/api/finish-templates?scope=company', {
        headers: cookie,
      }) as never,
    )
    expect(companyList.status).toBe(403)

    const privateList = await GET(
      request('http://127.0.0.1:3000/api/finish-templates', { headers: cookie }) as never,
    )
    expect(privateList.status).toBe(200)
    expect(((await privateList.json()) as { templates: unknown[] }).templates).toHaveLength(1)
  })
})
