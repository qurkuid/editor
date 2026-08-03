import { describe, expect, test } from 'bun:test'
import {
  createRawPainterIntegrationAdapter,
  loadRawPainterPage,
  normalizeRawPainterProduct,
  parseRawPainterPhysicalSize,
} from './rawpainter-adapter'

const product = {
  id: 70225,
  category: '디자인월',
  subCategory: 'Carving Stone',
  name: 'CV20_화이트',
  thumbnailUrl: 'https://intm.kr/api/studio/material-clone/asset/70225/original',
  brand: '인테리어패밀리',
  store: '이디티씨코퍼레이션',
  price: 229900,
  options: [{ size: '1,160*300', price: 229900 }],
}

describe('RawPainter host adapter', () => {
  test('normalizes the real clone payload into the shared Paint provider DTO', () => {
    expect(normalizeRawPainterProduct(product)).toMatchObject({
      provider: 'rawpainter',
      externalId: '70225',
      name: 'CV20_화이트',
      category: 'stone',
      source: 'workspace',
      physicalSize: { widthM: 1.16, heightM: 0.3 },
      previewThumbnailUrl: 'https://intm.kr/api/studio/material-clone/asset/70225/original',
      appearance: {
        maps: { albedoMap: '/api/materials/rawpainter/asset/70225' },
        mapProperties: { repeatX: 1 / 1.16, repeatY: 1 / 0.3 },
      },
    })
  })

  test('loads the first real catalog page through the editor-owned proxy', async () => {
    const requests: string[] = []
    const adapter = createRawPainterIntegrationAdapter(async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ products: [product], next: 1 }))
    })

    const page = await adapter.materials?.search({ context: null, cursor: null })

    expect(requests).toEqual(['/api/materials/rawpainter?page=0'])
    expect(page?.items[0]?.externalId).toBe('70225')
    expect(page?.nextCursor).toBe('1')
  })

  test('preserves the catalog search while paging within a category', async () => {
    // Given: a category-scoped search request.
    const requests: string[] = []
    const fetcher = async (input: string | URL | Request) => {
      requests.push(String(input))
      return Response.json({ products: [], next: null, total: 0 })
    }

    // When: the second search result page is loaded.
    await loadRawPainterPage({ page: 1, categoryId: 103, search: 'grey stone' }, fetcher)

    // Then: paging, category, and encoded search term reach the editor proxy together.
    expect(requests).toEqual(['/api/materials/rawpainter?page=1&categoryId=103&search=grey+stone'])
  })

  test('normalizes metric API size variants into metres', () => {
    // Given: RawPainter option sizes using the formats returned by different suppliers.
    const sizes = ['1,200*600', '120 × 60 cm', '1.2m x 0.6m']

    // When: the catalog boundary parses each physical size.
    const parsed = sizes.map(parseRawPainterPhysicalSize)

    // Then: every variant produces the same world-scale dimensions.
    expect(parsed).toEqual([
      { widthM: 1.2, heightM: 0.6 },
      { widthM: 1.2, heightM: 0.6 },
      { widthM: 1.2, heightM: 0.6 },
    ])
  })

  test('uses the seamless API asset for repeatable surface painting when available', () => {
    // Given: a catalog product with both original and seamless image assets.
    const seamlessProduct = {
      ...product,
      id: 12619,
      hasSeamless: true,
      seamlessImage: 'https://intm.kr/api/studio/material-clone/asset/12619/seamless',
    }

    // When: the RawPainter product becomes an editor material.
    const material = normalizeRawPainterProduct(seamlessProduct)

    // Then: the thumbnail stays original while the painted texture uses the seamless asset.
    expect(material.previewThumbnailUrl).toBe(product.thumbnailUrl)
    expect(material.appearance.maps.albedoMap).toBe(
      '/api/materials/rawpainter/asset/12619?kind=seamless',
    )
  })

  test('keeps painted textures on the current editor origin', () => {
    // Given: the local editor origin that owns the RawPainter image proxy.
    const editorOrigin = 'http://localhost:3002'

    // When: a RawPainter product becomes a paintable material.
    const material = normalizeRawPainterProduct(product, editorOrigin)

    // Then: the viewer receives an absolute same-origin URL instead of rewriting it to its CDN.
    expect(material.appearance.maps.albedoMap).toBe(
      'http://localhost:3002/api/materials/rawpainter/asset/70225',
    )
  })

  test('keeps host integration usable when the optional RawPainter catalog is unavailable', async () => {
    const adapter = createRawPainterIntegrationAdapter(async () =>
      Response.json({ error: 'rawpainter_unavailable' }, { status: 502 }),
    )

    await expect(adapter.materials?.search({ context: null, cursor: null })).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
  })

  test('stores a scene texture through the shared local seamless cache', async () => {
    // Given: a host adapter backed by the local seamless asset resolver.
    const resolvedUrls: string[] = []
    const adapter = createRawPainterIntegrationAdapter(
      async () => Response.json({ products: [], next: null }),
      async (textureUrl) => {
        resolvedUrls.push(textureUrl)
        return 'asset://seamless-abc123'
      },
    )

    // When: the scene material UI requests a seamless version of its texture.
    const result = await adapter.materials?.makeSeamless?.({
      materialId: 'scene_material_42',
      textureUrl: '/api/materials/rawpainter/asset/70225',
    })

    // Then: the adapter returns the locally persisted asset reference.
    expect(resolvedUrls).toEqual(['/api/materials/rawpainter/asset/70225'])
    expect(result).toEqual({ textureUrl: 'asset://seamless-abc123' })
  })
})
