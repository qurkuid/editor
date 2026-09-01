import { promises as fs } from 'node:fs'
import path from 'node:path'
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
// The index is rebuilt in the background once it is older than this —
// without it a built index served vendor catalog changes only after the
// next pm2 restart.
const INDEX_TTL_MS = 12 * 60 * 60 * 1000
const INDEX_DISK_FILE = 'rawpainter-index.json'

export const dynamic = 'force-dynamic'

const rawPainterQuerySchema = z.object({
  view: z.enum(['categories', 'brands']).optional(),
  page: z.coerce.number().int().min(0).catch(0),
  categoryId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(80).optional(),
  // Not trimmed to `undefined` when empty: `brand=` is a real filter — it
  // selects the unbranded group.
  brand: z.string().max(80).optional(),
})

type CatalogIndex = {
  readonly builtAt: number
  readonly products: readonly RawPainterProduct[]
}

let catalogIndex: CatalogIndex | null = null
let catalogIndexBuild: Promise<CatalogIndex> | null = null

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

// The index survives restarts on disk (deploys restart pm2, and a cold
// rebuild crawls the whole vendor catalog). Absent APT_DATA_DIR the index is
// memory-only, which also keeps tests off the real data directory.
function indexDiskPath(): string | null {
  const dir = process.env.APT_DATA_DIR
  return dir ? path.join(dir, INDEX_DISK_FILE) : null
}

async function readDiskIndex(): Promise<CatalogIndex | null> {
  const diskPath = indexDiskPath()
  if (!diskPath) return null
  try {
    const parsed = JSON.parse(await fs.readFile(diskPath, 'utf8')) as CatalogIndex
    if (typeof parsed.builtAt !== 'number' || !Array.isArray(parsed.products)) return null
    if (parsed.products.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function startIndexBuild(): Promise<CatalogIndex> {
  catalogIndexBuild ??= createCatalogIndex()
    .then((products) => {
      const index: CatalogIndex = { builtAt: Date.now(), products }
      catalogIndex = index
      const diskPath = indexDiskPath()
      if (diskPath) void fs.writeFile(diskPath, JSON.stringify(index)).catch(() => {})
      return index
    })
    .finally(() => {
      catalogIndexBuild = null
    })
  return catalogIndexBuild
}

async function loadCatalogIndex(): Promise<readonly RawPainterProduct[]> {
  if (!catalogIndex) {
    const disk = await readDiskIndex()
    if (disk) catalogIndex = disk
  }
  if (catalogIndex) {
    // Stale-while-revalidate: keep serving the old index and refresh behind
    // the request; a failed refresh keeps the old index in place.
    if (Date.now() - catalogIndex.builtAt > INDEX_TTL_MS) {
      void startIndexBuild().catch(() => {})
    }
    return catalogIndex.products
  }
  return (await startIndexBuild()).products
}

function searchableText(product: RawPainterProduct): string {
  return [product.name, product.brand, product.store, product.category, product.subCategory]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('ko-KR')
}

function productBrand(product: RawPainterProduct): string {
  return typeof product.brand === 'string' ? product.brand.trim() : ''
}

async function filterCatalog(
  input: { readonly search?: string; readonly categoryId?: number; readonly brand?: string },
  page: number,
): Promise<RawPainterCatalogPage> {
  const words = (input.search ?? '').toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean)
  const matches = (await loadCatalogIndex()).filter((product) => {
    if (input.categoryId && Number(product.categoryId) !== input.categoryId) return false
    if (input.brand !== undefined && productBrand(product) !== input.brand) return false
    if (words.length === 0) return true
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

/** Brand rollup for the drill-down's middle level — the vendor API has no
 * brand endpoint, so it is aggregated from the same catalog index search
 * uses. Sorted by product count so the household names surface first. */
async function listBrands(categoryId?: number) {
  const counts = new Map<string, number>()
  for (const product of await loadCatalogIndex()) {
    if (categoryId && Number(product.categoryId) !== categoryId) continue
    const brand = productBrand(product)
    counts.set(brand, (counts.get(brand) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, productCount]) => ({ name, productCount }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, 'ko'))
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const query = rawPainterQuerySchema.parse({
    view: url.searchParams.get('view') ?? undefined,
    page: url.searchParams.get('page') ?? 0,
    categoryId: url.searchParams.get('categoryId') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    brand: url.searchParams.get('brand') ?? undefined,
  })
  if (query.view === 'brands') {
    try {
      return NextResponse.json(await listBrands(query.categoryId))
    } catch {
      return NextResponse.json({ error: 'rawpainter_unavailable' }, { status: 502 })
    }
  }
  if (query.search || query.brand !== undefined) {
    try {
      return NextResponse.json(
        await filterCatalog(
          { search: query.search, categoryId: query.categoryId, brand: query.brand },
          query.page,
        ),
      )
    } catch {
      return NextResponse.json({ error: 'rawpainter_unavailable' }, { status: 502 })
    }
  }
  if (query.view === 'categories') {
    // Pre-warm: the drill-down's brand level and search both need the index —
    // start building it while the user is still reading the category list.
    void loadCatalogIndex().catch(() => {})
    try {
      const response = await fetchClone('/category/filter', {})
      const categories = (await response.json()) as {
        id?: unknown
        productCount?: unknown
      }[]
      // The vendor's own counts overshoot what its product feed actually
      // returns (가구재 says 63, lists 33). Once the index is warm, count from
      // the same source the drill-down lists so rows match reality; until
      // then the vendor counts stand.
      if (catalogIndex && Array.isArray(categories)) {
        const counts = new Map<number, number>()
        for (const product of catalogIndex.products) {
          const categoryId = Number(product.categoryId)
          if (Number.isFinite(categoryId)) {
            counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
          }
        }
        for (const category of categories) {
          if (typeof category.id === 'number' && typeof category.productCount === 'number') {
            category.productCount = counts.get(category.id) ?? 0
          }
        }
      }
      return NextResponse.json(categories)
    } catch {
      return NextResponse.json({ error: 'rawpainter_unavailable' }, { status: 502 })
    }
  }
  const cloneRequest = {
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
