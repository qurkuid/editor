import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  type RawPainterCatalogPage,
  type RawPainterProduct,
  rawPainterCatalogPageSchema,
} from '@/lib/rawpainter-contract'

const RAWPAINTER_CLONE_URL = 'https://intm.kr/api/studio/material-clone'
const SEARCH_PAGE_SIZE = 60
const INDEX_BATCH_SIZE = 24

export const dynamic = 'force-dynamic'

const rawPainterQuerySchema = z.object({
  view: z.enum(['categories']).optional(),
  page: z.coerce.number().int().min(0).catch(0),
  categoryId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(80).optional(),
})

let catalogIndexPromise: Promise<readonly RawPainterProduct[]> | null = null

async function fetchClone(endpoint: string, payload: Readonly<Record<string, unknown>>) {
  const response = await fetch(RAWPAINTER_CLONE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Client-Platform': 'pascal-editor',
    },
    body: JSON.stringify({ endpoint, payload }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`RawPainter clone failed: ${response.status}`)
  return response
}

async function fetchProductPage(page: number): Promise<RawPainterCatalogPage> {
  const response = await fetchClone('/product', { page })
  return rawPainterCatalogPageSchema.parse(await response.json())
}

async function createCatalogIndex(): Promise<readonly RawPainterProduct[]> {
  const firstPage = await fetchProductPage(0)
  const pageCount = Math.max(
    1,
    firstPage.pageNum ?? Math.ceil(firstPage.total / Math.max(firstPage.products.length, 1)),
  )
  const products = [...firstPage.products]
  for (let start = 1; start < pageCount; start += INDEX_BATCH_SIZE) {
    const pageNumbers = Array.from(
      { length: Math.min(INDEX_BATCH_SIZE, pageCount - start) },
      (_, index) => start + index,
    )
    const pages = await Promise.all(pageNumbers.map(fetchProductPage))
    for (const page of pages) products.push(...page.products)
  }
  return products
}

async function loadCatalogIndex(): Promise<readonly RawPainterProduct[]> {
  catalogIndexPromise ??= createCatalogIndex().catch((error: unknown) => {
    catalogIndexPromise = null
    throw error
  })
  return catalogIndexPromise
}

function searchableText(product: RawPainterProduct): string {
  return [product.name, product.brand, product.store, product.category, product.subCategory]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('ko-KR')
}

async function searchCatalog(
  search: string,
  page: number,
  categoryId?: number,
): Promise<RawPainterCatalogPage> {
  const words = search.toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean)
  const matches = (await loadCatalogIndex()).filter((product) => {
    if (categoryId && Number(product.categoryId) !== categoryId) return false
    const haystack = searchableText(product)
    return words.every((word) => haystack.includes(word))
  })
  const start = page * SEARCH_PAGE_SIZE
  const end = start + SEARCH_PAGE_SIZE
  return {
    products: matches.slice(start, end),
    next: end < matches.length ? page + 1 : null,
    pageNum: Math.ceil(matches.length / SEARCH_PAGE_SIZE),
    total: matches.length,
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const query = rawPainterQuerySchema.parse({
    view: url.searchParams.get('view') ?? undefined,
    page: url.searchParams.get('page') ?? 0,
    categoryId: url.searchParams.get('categoryId') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
  })
  if (query.search) {
    try {
      return NextResponse.json(await searchCatalog(query.search, query.page, query.categoryId))
    } catch {
      return NextResponse.json({ error: 'rawpainter_unavailable' }, { status: 502 })
    }
  }
  const cloneRequest =
    query.view === 'categories'
      ? { endpoint: '/category/filter', payload: {} }
      : {
          endpoint: '/product',
          payload: {
            page: query.page,
            ...(query.categoryId ? { categories: [query.categoryId] } : {}),
          },
        }

  try {
    const response = await fetchClone(cloneRequest.endpoint, cloneRequest.payload)
    return NextResponse.json(await response.json())
  } catch {
    return NextResponse.json({ error: 'rawpainter_unavailable' }, { status: 502 })
  }
}
