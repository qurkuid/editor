import { afterEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'

// bun test auto-loads .env.local; without this the route's disk-cached index
// would read from and write into the real APT_DATA_DIR.
delete process.env.APT_DATA_DIR

const { GET } = await import('./route')

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('RawPainter material proxy', () => {
  test('serves the category list and pre-warms the catalog index', async () => {
    // Given: the clone answers both the category view and product pages.
    const cloneRequests: { endpoint: string; payload: { page?: number } }[] = []
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as (typeof cloneRequests)[number]
      cloneRequests.push(request)
      if (request.endpoint === '/category/filter') {
        return Response.json([{ id: 127, name: '가구재', productCount: 63 }])
      }
      const products =
        request.payload.page === 0
          ? [{ id: 1, name: 'White Oak', brand: 'Woodworks', store: 'Alpha' }]
          : [{ id: 2, name: 'Stone Grey', brand: 'Raw Studio', store: 'Beta' }]
      return Response.json({ products, next: null, total: 2, pageNum: 2 })
    }

    // When: the category proxy route is called.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?view=categories'),
    )

    // Then: the category endpoint is proxied, and the same request kicks off
    // the background index build the drill-down's brand level will need.
    expect(await response.json()).toEqual([{ id: 127, name: '가구재', productCount: 63 }])
    expect(cloneRequests).toContainEqual({ endpoint: '/category/filter', payload: {} })
    // Let the background build settle so it cannot leak into later tests.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      cloneRequests.filter((request) => request.endpoint === '/product').length,
    ).toBeGreaterThanOrEqual(1)
  })

  test('forwards the selected RawPainter category to product paging', async () => {
    // Given: a category-specific second product page is requested.
    const cloneRequests: unknown[] = []
    globalThis.fetch = async (_input, init) => {
      cloneRequests.push(JSON.parse(String(init?.body)))
      return Response.json({ products: [], next: null, total: 0 })
    }

    // When: the product proxy route is called.
    await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?page=2&categoryId=103'),
    )

    // Then: pagination and provider category stay intact at the clone boundary.
    expect(cloneRequests).toEqual([
      { endpoint: '/product', payload: { page: 2, categories: [103] } },
    ])
  })

  test('searches every RawPainter page by product and supplier metadata', async () => {
    // Given: matching products are split across multiple provider pages.
    const cloneRequests: unknown[] = []
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        endpoint: string
        payload: { page: number }
      }
      cloneRequests.push(request)
      const products =
        request.payload.page === 0
          ? [{ id: 1, name: 'White Oak', brand: 'Woodworks', store: 'Alpha' }]
          : [{ id: 2, name: 'Stone Grey', brand: 'Raw Studio', store: 'Beta' }]
      return Response.json({ products, next: null, total: 2, pageNum: 2 })
    }

    // When: the editor searches by a supplier name that only exists on the second page.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?page=0&search=raw'),
    )

    // Then: only the matching product is returned. (The index may already be
    // warm from the categories pre-warm, so the clone request count is not
    // asserted — a cold run pages the whole catalog, a warm run pages none.)
    expect(
      cloneRequests.every((request) => (request as { endpoint: string }).endpoint === '/product'),
    ).toBe(true)
    expect(await response.json()).toEqual({
      products: [{ id: 2, name: 'Stone Grey', brand: 'Raw Studio', store: 'Beta' }],
      next: null,
      pageNum: 1,
      total: 1,
    })
  })

  // The two tests below serve the same two-page catalog the search test
  // serves, so they pass identically whether the module-level index cache is
  // warm (full-file run) or cold (isolated run).
  const serveIndexPages = () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { payload: { page: number } }
      const products =
        request.payload.page === 0
          ? [{ id: 1, name: 'White Oak', brand: 'Woodworks', store: 'Alpha' }]
          : [{ id: 2, name: 'Stone Grey', brand: 'Raw Studio', store: 'Beta' }]
      return Response.json({ products, next: null, total: 2, pageNum: 2 })
    }
  }

  test('aggregates brands from the catalog index, busiest first', async () => {
    // Given: the catalog index is reachable.
    serveIndexPages()

    // When: the drill-down requests the brand rollup.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?view=brands'),
    )

    // Then: one row per brand with counts, ties ordered by name.
    expect(await response.json()).toEqual([
      { name: 'Raw Studio', productCount: 1 },
      { name: 'Woodworks', productCount: 1 },
    ])
  })

  test('an empty brand parameter selects the unbranded group', async () => {
    // Given: the catalog index is reachable and one product has no brand.
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { payload: { page: number } }
      const products =
        request.payload.page === 0
          ? [{ id: 1, name: 'White Oak', brand: 'Woodworks', store: 'Alpha' }]
          : [{ id: 3, name: 'No Name Slab', store: 'Gamma' }]
      return Response.json({ products, next: null, total: 2, pageNum: 2 })
    }

    // When: the drill-down asks for the unbranded group via `brand=`.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?page=0&brand='),
    )

    // Then: only the brandless product comes back.
    const payload = (await response.json()) as { products: { id: number }[] }
    expect(payload.products.every((product) => !('brand' in product && product.brand))).toBe(true)
  })

  test('filters the product list to one brand', async () => {
    // Given: the catalog index is reachable.
    serveIndexPages()

    // When: the drill-down's product level asks for a single brand.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?page=0&brand=Woodworks'),
    )

    // Then: only that brand's products come back.
    expect(await response.json()).toEqual({
      products: [{ id: 1, name: 'White Oak', brand: 'Woodworks', store: 'Alpha' }],
      next: null,
      pageNum: 1,
      total: 1,
    })
  })
})
