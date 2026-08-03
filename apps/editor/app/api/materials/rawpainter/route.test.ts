import { afterEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { GET } from './route'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('RawPainter material proxy', () => {
  test('requests the complete RawPainter category list', async () => {
    // Given: the editor requests the provider-native category view.
    const cloneRequests: unknown[] = []
    globalThis.fetch = async (_input, init) => {
      cloneRequests.push(JSON.parse(String(init?.body)))
      return Response.json([{ id: 127, name: '가구재', productCount: 63 }])
    }

    // When: the category proxy route is called.
    const response = await GET(
      new NextRequest('http://localhost:3002/api/materials/rawpainter?view=categories'),
    )

    // Then: the clone receives its category endpoint rather than a product-page request.
    expect(cloneRequests).toEqual([{ endpoint: '/category/filter', payload: {} }])
    expect(await response.json()).toEqual([{ id: 127, name: '가구재', productCount: 63 }])
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

    // Then: the full catalog is indexed and only the matching product is returned.
    expect(cloneRequests).toEqual([
      { endpoint: '/product', payload: { page: 0 } },
      { endpoint: '/product', payload: { page: 1 } },
    ])
    expect(await response.json()).toEqual({
      products: [{ id: 2, name: 'Stone Grey', brand: 'Raw Studio', store: 'Beta' }],
      next: null,
      pageNum: 1,
      total: 1,
    })
  })
})
