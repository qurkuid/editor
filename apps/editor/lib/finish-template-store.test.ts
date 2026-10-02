import { describe, expect, it } from 'bun:test'
import type { HomeFinishTemplate, ZoneFinishTemplateSnapshot } from '@pascal-app/editor'
import {
  HomeFinishTemplateSchema,
  isHomeFinishTemplate,
  isZoneFinishTemplateSnapshot,
  mergePersistedFinishTemplates,
  persistedFinishTemplatePayload,
  useFinishTemplates,
} from './finish-template-store'

const material = {
  label: 'Oak',
  preferredRef: 'library:wood-finewood27' as const,
  material: {
    preset: 'custom' as const,
    texture: { url: '/materials/oak.png', repeat: [2, 3] as [number, number] },
    physicalSize: { widthM: 1, heightM: 1 },
    source: { provider: 'fixture', externalId: 'oak', revision: '1' },
  },
}

function template(id = 'zone-template_test'): ZoneFinishTemplateSnapshot {
  return {
    version: 1,
    id,
    name: 'Room finish',
    createdAt: '2026-10-02T00:00:00.000Z',
    source: {
      sceneId: 'scene_test',
      zoneId: 'zone_room',
      fingerprint: {
        levelId: 'level_test',
        zoneId: 'zone_room',
        polygonSignature: '0,0;4,0;4,4;0,4',
        inwardWalls: [
          {
            wallId: 'wall_bottom',
            face: 'front',
            segmentSignature: '0,0|4,0',
            length: 4,
            activeSlotRoles: ['interior'],
          },
        ],
        floor: { slabId: 'slab_floor', polygonSignature: '0,0;4,0;4,4;0,4' },
      },
    },
    walls: [
      {
        sourceFace: {
          wallId: 'wall_bottom',
          face: 'front',
          key: 'wall_bottom:front',
          segmentSignature: '0,0|4,0',
          length: 4,
          activeSlotRoles: ['interior'],
        },
        slots: [{ role: 'interior', material }],
      },
    ],
    floor: material,
  }
}

function home(templateSnapshot: ZoneFinishTemplateSnapshot): HomeFinishTemplate {
  return {
    version: 1,
    id: 'home-template_test',
    name: 'Home finish',
    createdAt: '2026-10-02T00:00:00.000Z',
    sourceSceneId: 'scene_test',
    zones: [{ sourceZoneId: 'zone_room', sourceZoneName: 'Room', template: templateSnapshot }],
  }
}

function resetStore() {
  useFinishTemplates.setState({
    zoneTemplates: {},
    homeTemplates: {},
    localZoneTemplates: {},
    localHomeTemplates: {},
    confirmedZoneTemplateIds: {},
    confirmedHomeTemplateIds: {},
    templateMeta: {},
    hydrated: true,
    serverLoaded: false,
    serverError: null,
    serverErrorStatus: null,
  })
}

function serverRecord(
  templateSnapshot: ZoneFinishTemplateSnapshot,
  visibility: 'private' | 'company' = 'company',
) {
  return {
    id: templateSnapshot.id,
    kind: 'zone' as const,
    name: templateSnapshot.name,
    visibility,
    editable: true,
    version: 1,
    createdAt: templateSnapshot.createdAt,
    updatedAt: templateSnapshot.createdAt,
    template: templateSnapshot,
  }
}

describe('finish template persistence contract', () => {
  it('validates versioned Zone and home snapshots', () => {
    const snapshot = template()
    expect(isZoneFinishTemplateSnapshot(snapshot)).toBe(true)
    expect(
      isZoneFinishTemplateSnapshot({
        ...snapshot,
        ceiling: material,
        source: {
          ...snapshot.source,
          fingerprint: { ...snapshot.source.fingerprint, ceiling: { createFromZone: true } },
        },
      }),
    ).toBe(true)
    expect(isZoneFinishTemplateSnapshot({ ...snapshot, ceiling: material })).toBe(false)
    expect(
      isZoneFinishTemplateSnapshot({
        ...snapshot,
        source: {
          ...snapshot.source,
          fingerprint: { ...snapshot.source.fingerprint, ceiling: { createFromZone: true } },
        },
      }),
    ).toBe(false)
    expect(isHomeFinishTemplate(home(snapshot))).toBe(true)
    expect(isHomeFinishTemplate({ version: 2 })).toBe(false)
  })

  it('rejects transient blob URLs before they reach local persistence', () => {
    const snapshot = template()
    const persisted = {
      ...snapshot,
      floor: {
        ...snapshot.floor,
        material: { ...snapshot.floor.material, texture: { url: 'blob:temporary' } },
      },
    }
    expect(isZoneFinishTemplateSnapshot(persisted)).toBe(false)
    expect(
      HomeFinishTemplateSchema.safeParse(home(persisted as ZoneFinishTemplateSnapshot)).success,
    ).toBe(false)
    expect(
      isZoneFinishTemplateSnapshot({
        ...snapshot,
        ceiling: {
          ...material,
          material: { ...material.material, texture: { url: 'blob:ceiling' } },
        },
        source: {
          ...snapshot.source,
          fingerprint: { ...snapshot.source.fingerprint, ceiling: { createFromZone: true } },
        },
      }),
    ).toBe(false)
  })

  it('rejects empty wall slots and empty home membership at the persistence boundary', () => {
    const snapshot = template()
    expect(
      isZoneFinishTemplateSnapshot({ ...snapshot, walls: [{ ...snapshot.walls[0]!, slots: [] }] }),
    ).toBe(false)
    expect(isHomeFinishTemplate({ ...home(snapshot), zones: [] })).toBe(false)
  })

  it('stores an immutable Zone snapshot and supports rename/remove actions', () => {
    resetStore()
    const snapshot = template()
    expect(useFinishTemplates.getState().addZoneTemplate(snapshot)).toBe(true)
    snapshot.name = 'mutated caller'
    snapshot.floor.material.texture = { url: '/changed.png' }
    expect(useFinishTemplates.getState().zoneTemplates[snapshot.id]?.name).toBe('Room finish')
    expect(
      useFinishTemplates.getState().zoneTemplates[snapshot.id]?.floor.material.texture?.url,
    ).toBe('/materials/oak.png')
    expect(useFinishTemplates.getState().renameZoneTemplate(snapshot.id, 'Renamed')).toBe(true)
    expect(useFinishTemplates.getState().zoneTemplates[snapshot.id]?.name).toBe('Renamed')
    useFinishTemplates.getState().removeZoneTemplate(snapshot.id)
    expect(useFinishTemplates.getState().zoneTemplates[snapshot.id]).toBeUndefined()
  })

  it('stores home templates with embedded Zone snapshots and independent lifecycle', () => {
    resetStore()
    const snapshot = template()
    const savedHome = home(snapshot)
    expect(useFinishTemplates.getState().addHomeTemplate(savedHome)).toBe(true)
    savedHome.zones[0]!.template.name = 'changed source'
    expect(useFinishTemplates.getState().homeTemplates[savedHome.id]?.zones[0]?.template.name).toBe(
      'Room finish',
    )
    expect(useFinishTemplates.getState().renameHomeTemplate(savedHome.id, 'Renamed home')).toBe(
      true,
    )
    useFinishTemplates.getState().removeHomeTemplate(savedHome.id)
    expect(useFinishTemplates.getState().homeTemplates[savedHome.id]).toBeUndefined()
  })

  it('uses a successful server list as the visible authority while retaining local cache entries', async () => {
    resetStore()
    const local = template('local-zone')
    const remote = template('remote-zone')
    useFinishTemplates.getState().addZoneTemplate(local)
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({ templates: [serverRecord(remote, 'private')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const loaded = await useFinishTemplates.getState().loadTemplates()
      expect(loaded.ok).toBe(true)
      expect(useFinishTemplates.getState().zoneTemplates['local-zone']).toBeDefined()
      expect(useFinishTemplates.getState().zoneTemplates['remote-zone']?.name).toBe('Room finish')
      expect(useFinishTemplates.getState().templateMeta['zone:remote-zone']?.source).toBe('server')
      expect(useFinishTemplates.getState().serverLoaded).toBe(true)
      expect(requestedUrl).toBe('/api/finish-templates?limit=500')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('hides a previously confirmed local copy when a fresh authorized list omits it', async () => {
    resetStore()
    const snapshot = template('confirmed-private')
    const originalFetch = globalThis.fetch
    let requestCount = 0
    globalThis.fetch = (async (_input, init) => {
      requestCount += 1
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(serverRecord(snapshot, 'private')), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      expect((await useFinishTemplates.getState().saveZoneTemplate(snapshot)).ok).toBe(true)
      expect(useFinishTemplates.getState().zoneTemplates['confirmed-private']).toBeDefined()
      expect(useFinishTemplates.getState().confirmedZoneTemplateIds['confirmed-private']).toBe(true)

      expect((await useFinishTemplates.getState().loadTemplates()).ok).toBe(true)
      expect(useFinishTemplates.getState().zoneTemplates['confirmed-private']).toBeUndefined()
      expect(useFinishTemplates.getState().localZoneTemplates['confirmed-private']).toBeDefined()
      expect(useFinishTemplates.getState().templateMeta['zone:confirmed-private']).toMatchObject({
        source: 'local',
        status: 'pending-local-import',
      })
      expect(
        useFinishTemplates.getState().templateMeta['zone:confirmed-private']?.serverId,
      ).toBeUndefined()
      expect((await useFinishTemplates.getState().importLegacyTemplates()).ok).toBe(true)
      expect(requestCount).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('hides confirmed server rows after an authorization failure while retaining local copies', async () => {
    resetStore()
    const snapshot = template('auth-private')
    useFinishTemplates.getState().addZoneTemplate(snapshot)
    const originalFetch = globalThis.fetch
    let authorized = true
    globalThis.fetch = (async () => {
      if (!authorized) return new Response('unauthorized', { status: 401 })
      return new Response(JSON.stringify({ templates: [serverRecord(snapshot, 'private')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      expect((await useFinishTemplates.getState().loadTemplates()).ok).toBe(true)
      expect(useFinishTemplates.getState().zoneTemplates['auth-private']).toBeDefined()
      authorized = false
      expect((await useFinishTemplates.getState().loadTemplates()).ok).toBe(false)
      expect(useFinishTemplates.getState().zoneTemplates['auth-private']).toBeUndefined()
      expect(useFinishTemplates.getState().serverLoaded).toBe(false)
      expect(useFinishTemplates.getState().serverErrorStatus).toBe(401)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('commits only the latest out-of-order server list', async () => {
    resetStore()
    const first = template('first-response')
    const second = template('second-response')
    const originalFetch = globalThis.fetch
    const resolvers: Array<(response: Response) => void> = []
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve)
      })) as typeof fetch
    try {
      const firstLoad = useFinishTemplates.getState().loadTemplates()
      const secondLoad = useFinishTemplates.getState().loadTemplates()
      resolvers[1]?.(
        new Response(JSON.stringify({ templates: [serverRecord(second)] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      resolvers[0]?.(
        new Response(JSON.stringify({ templates: [serverRecord(first)] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad])
      expect(firstResult).toMatchObject({ ok: true, stale: true })
      expect(secondResult).toMatchObject({ ok: true })
      expect(useFinishTemplates.getState().zoneTemplates['second-response']).toBeDefined()
      expect(useFinishTemplates.getState().zoneTemplates['first-response']).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps the newest server error when an earlier success resolves later', async () => {
    resetStore()
    const snapshot = template('stale-success')
    const originalFetch = globalThis.fetch
    const resolvers: Array<(response: Response) => void> = []
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve)
      })) as typeof fetch
    try {
      const firstLoad = useFinishTemplates.getState().loadTemplates()
      const secondLoad = useFinishTemplates.getState().loadTemplates()
      resolvers[1]?.(new Response('newest offline', { status: 503 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      resolvers[0]?.(
        new Response(JSON.stringify({ templates: [serverRecord(snapshot)] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad])
      expect(firstResult).toMatchObject({ ok: true, stale: true })
      expect(secondResult).toMatchObject({ ok: false })
      expect(useFinishTemplates.getState().serverError).toContain('503')
      expect(useFinishTemplates.getState().serverLoaded).toBe(false)
      expect(useFinishTemplates.getState().zoneTemplates['stale-success']).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps local entries when GET fails', async () => {
    resetStore()
    const local = template('fallback-zone')
    useFinishTemplates.getState().addZoneTemplate(local)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('offline', { status: 503 })) as typeof fetch
    try {
      const loaded = await useFinishTemplates.getState().loadTemplates()
      expect(loaded.ok).toBe(false)
      expect(useFinishTemplates.getState().zoneTemplates['fallback-zone']?.name).toBe('Room finish')
      expect(useFinishTemplates.getState().serverError).toContain('503')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains a failed save for retry and dedupes the confirmed server id', async () => {
    resetStore()
    const snapshot = template('retry-zone')
    const originalFetch = globalThis.fetch
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      if (attempts === 1) return new Response('offline', { status: 500 })
      return new Response(JSON.stringify(serverRecord(snapshot)), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const failed = await useFinishTemplates.getState().saveZoneTemplate(snapshot, 'company')
      expect(failed.ok).toBe(false)
      expect(useFinishTemplates.getState().localZoneTemplates['retry-zone']).toBeDefined()
      expect(useFinishTemplates.getState().templateMeta['zone:retry-zone']?.status).toBe('failed')

      const retried = await useFinishTemplates.getState().retryTemplate('zone', 'retry-zone')
      expect(retried.ok).toBe(true)
      expect(useFinishTemplates.getState().templateMeta['zone:retry-zone']).toMatchObject({
        status: 'server',
        source: 'server',
        serverId: 'retry-zone',
      })
      expect(Object.keys(useFinishTemplates.getState().zoneTemplates)).toEqual(['retry-zone'])
      expect(attempts).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('requires a successful server GET before explicit legacy import and skips confirmed ids', async () => {
    resetStore()
    const snapshot = template('legacy-zone')
    useFinishTemplates.getState().addZoneTemplate(snapshot)
    const blocked = await useFinishTemplates.getState().importLegacyTemplates()
    expect(blocked.ok).toBe(false)

    const originalFetch = globalThis.fetch
    let postCount = 0
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'POST') {
        postCount += 1
        return new Response(JSON.stringify(serverRecord(snapshot)), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      expect((await useFinishTemplates.getState().loadTemplates()).ok).toBe(true)
      expect((await useFinishTemplates.getState().importLegacyTemplates()).ok).toBe(true)
      expect(postCount).toBe(1)
      expect(useFinishTemplates.getState().localZoneTemplates['legacy-zone']).toBeDefined()
      expect(useFinishTemplates.getState().templateMeta['zone:legacy-zone']?.imported).toBe(true)
      expect((await useFinishTemplates.getState().importLegacyTemplates()).ok).toBe(true)
      expect(postCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rehydrates persisted confirmed ids while keeping their retained copies hidden', () => {
    resetStore()
    const snapshot = template('persisted-confirmed')
    useFinishTemplates.setState({
      localZoneTemplates: { [snapshot.id]: snapshot },
      zoneTemplates: { [snapshot.id]: snapshot },
      confirmedZoneTemplateIds: { [snapshot.id]: true },
    })

    const values = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    localStorage.setItem(
      'pascal-finish-templates-v1',
      JSON.stringify({
        state: persistedFinishTemplatePayload(useFinishTemplates.getState()),
        version: 0,
      }),
    )

    const raw = localStorage.getItem('pascal-finish-templates-v1')
    expect(raw).toContain('persisted-confirmed')
    const rehydrated = mergePersistedFinishTemplates(
      JSON.parse(raw ?? '{}'),
      useFinishTemplates.getState(),
    )
    expect(rehydrated.localZoneTemplates['persisted-confirmed']).toBeDefined()
    expect(rehydrated.confirmedZoneTemplateIds['persisted-confirmed']).toBe(true)
    expect(rehydrated.zoneTemplates['persisted-confirmed']).toBeUndefined()
  })
})
