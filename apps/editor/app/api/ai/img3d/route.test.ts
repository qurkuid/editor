import { describe, expect, test } from 'bun:test'
import { handleImg3dPost, type Img3dRouteDependencies } from './route'

const validRequest = {
  image: {
    name: 'chair.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,aGVsbG8=',
  },
  dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
  provider: 'codex',
}

const sculpt = {
  version: 1 as const,
  name: 'Chair',
  materials: [{ name: 'wood', color: '#8b5e3c', roughness: 0.7, metalness: 0, slot: null }],
  parts: [
    {
      name: 'seat',
      primitive: 'box' as const,
      material: 0,
      position: [0, 0.45, 0] as const,
      rotation: [0, 0, 0] as const,
      size: [1.2, 0.1, 0.6] as const,
    },
  ],
}

function dependencies(overrides: Partial<Img3dRouteDependencies> = {}): Img3dRouteDependencies {
  return {
    codexStatus: async () => ({ connected: true, authMethod: 'chatgpt', command: 'codex' }),
    claudeStatus: async () => ({ connected: true, authMethod: 'claude.ai', command: 'claude' }),
    codexRequest: async () => sculpt,
    claudeRequest: async () => sculpt,
    ...overrides,
  }
}

describe('/api/ai/img3d request boundary', () => {
  test('returns 400 for invalid JSON and invalid request shape', async () => {
    const invalidJson = await handleImg3dPost(
      new Request('http://localhost/api/ai/img3d', { method: 'POST', body: '{' }),
      dependencies(),
    )
    const invalidShape = await handleImg3dPost(
      new Request('http://localhost/api/ai/img3d', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validRequest, image: [] }),
      }),
      dependencies(),
    )

    expect(invalidJson.status).toBe(400)
    expect(invalidShape.status).toBe(400)
  })

  test('requires login for the selected provider', async () => {
    const response = await handleImg3dPost(
      new Request('http://localhost/api/ai/img3d', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validRequest),
      }),
      dependencies({
        codexStatus: async () => ({ connected: false, authMethod: null }),
      }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'ai_not_configured' })
  })

  test('falls back to connected Claude only on Codex usage limit', async () => {
    let claudeCalls = 0
    const response = await handleImg3dPost(
      new Request('http://localhost/api/ai/img3d', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validRequest),
      }),
      dependencies({
        codexRequest: async () => {
          throw new Error('usage limit reached')
        },
        claudeRequest: async () => {
          claudeCalls += 1
          return sculpt
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(claudeCalls).toBe(1)
    expect(await response.json()).toEqual(sculpt)
  })
})
