import { describe, expect, test } from 'bun:test'
import { getOrCreateSeamlessAsset } from './material-seamless-cache'

describe('AI material seamless cache', () => {
  test('reuses one locally stored result for identical source image bytes', async () => {
    // Given: one source image and an initially empty persistent cache.
    const source = new Blob(['same material pixels'], { type: 'image/png' })
    const stored = new Map<string, Blob>()
    let transformations = 0
    const dependencies = {
      readSource: async (url: string) => {
        if (url === 'asset://source') return source
        const cached = stored.get(url.replace('asset://', ''))
        if (!cached) throw new RangeError(`Missing test asset: ${url}`)
        return cached
      },
      loadStored: async (id: string) => (stored.has(id) ? `asset://${id}` : null),
      transform: async () => {
        transformations += 1
        return new Blob(['seamless pixels'], { type: 'image/webp' })
      },
      store: async (id: string, image: Blob) => {
        stored.set(id, image)
        return `asset://${id}`
      },
    }

    // When: AI requests seamless conversion twice for the same source.
    const first = await getOrCreateSeamlessAsset('asset://source', dependencies)
    const second = await getOrCreateSeamlessAsset(first, dependencies)

    // Then: both requests use one local result and run conversion only once.
    expect(second).toBe(first)
    expect(transformations).toBe(1)
    expect(stored.size).toBe(1)
  })
})
