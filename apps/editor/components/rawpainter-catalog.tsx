'use client'

import { registerLibraryMaterials } from '@pascal-app/core'
import {
  freezeHostMaterialCatalogItem,
  toHostMaterialCatalogItem,
  translate,
  useEditor,
  useLocale,
  useT,
} from '@pascal-app/editor'
import { LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  loadRawPainterCategories,
  loadRawPainterPage,
  normalizeRawPainterProduct,
  RawPainterCatalogError,
} from '@/lib/rawpainter-adapter'
import type {
  RawPainterCatalogPage,
  RawPainterCategory,
  RawPainterProduct,
} from '@/lib/rawpainter-contract'
import { RawPainterProductCard } from './rawpainter-product-card'
import { RawPainterSearch } from './rawpainter-search'

type CatalogStatus = 'loading' | 'ready' | 'error'
type CatalogRequest = {
  readonly categoryId: number | null
  readonly search: string
  readonly revision: number
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  if (error instanceof RawPainterCatalogError) {
    return translate('rawpainter.errors.connectionFailed', useLocale.getState().locale)
  }
  if (error instanceof Error) return error.message
  throw error
}

export function RawPainterCatalog() {
  const t = useT()
  const [categories, setCategories] = useState<readonly RawPainterCategory[]>([])
  const [catalogRequest, setCatalogRequest] = useState<CatalogRequest>({
    categoryId: null,
    search: '',
    revision: 0,
  })
  const [searchInput, setSearchInput] = useState('')
  const [products, setProducts] = useState<readonly RawPainterProduct[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<CatalogStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const categoryId = catalogRequest.categoryId

  useEffect(() => {
    const controller = new AbortController()
    void loadRawPainterCategories(fetch, controller.signal)
      .then(setCategories)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    void loadRawPainterPage(
      {
        page: 0,
        categoryId: catalogRequest.categoryId,
        search: catalogRequest.search,
      },
      fetch,
      controller.signal,
    )
      .then((page) => {
        setProducts(page.products)
        setTotal(page.total)
        setNextPage(typeof page.next === 'number' ? page.next : null)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(errorMessage(cause))
        setStatus('error')
      })
    return () => controller.abort()
  }, [catalogRequest])

  const selectProduct = (product: RawPainterProduct) => {
    const catalogItem = toHostMaterialCatalogItem(
      normalizeRawPainterProduct(product, globalThis.location.origin),
    )
    registerLibraryMaterials([catalogItem])
    setActivePaintMaterial({
      material: freezeHostMaterialCatalogItem(catalogItem),
      sourceTarget: activePaintTarget,
    })
    setSelectedId(String(product.id))
  }

  const appendPage = (page: RawPainterCatalogPage) => {
    setProducts((current) => [...current, ...page.products])
    setNextPage(typeof page.next === 'number' ? page.next : null)
  }

  const loadMore = async () => {
    if (nextPage === null || loadingMore) return
    setLoadingMore(true)
    try {
      appendPage(
        await loadRawPainterPage({ page: nextPage, categoryId, search: catalogRequest.search }),
      )
    } catch (cause) {
      if (cause instanceof Error) setError(errorMessage(cause))
      else throw cause
    } finally {
      setLoadingMore(false)
    }
  }

  const submitSearch = () => {
    const search = searchInput.trim()
    setCatalogRequest((current) => ({ ...current, search, revision: 0 }))
  }

  const clearSearch = () => {
    setSearchInput('')
    setCatalogRequest((current) => ({ ...current, search: '', revision: 0 }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-border/70 bg-background/65 p-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">{t('rawpainter.header.title')}</p>
            <p className="text-[10px] text-muted-foreground">
              {t('rawpainter.header.summary')
                .replace('{categories}', categories.length.toLocaleString('ko-KR'))
                .replace('{total}', total.toLocaleString('ko-KR'))}
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/12 px-2 py-1 font-semibold text-[9px] text-emerald-600 uppercase tracking-wider dark:text-emerald-400">
            {t('rawpainter.header.liveCatalog')}
          </span>
        </div>
        <RawPainterSearch
          onChange={setSearchInput}
          onClear={clearSearch}
          onSubmit={submitSearch}
          value={searchInput}
        />
        <div className="subtle-scrollbar mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          <button
            className={`rounded-md px-2 py-1 text-[10px] ${categoryId === null ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
            onClick={() =>
              setCatalogRequest((current) => ({ ...current, categoryId: null, revision: 0 }))
            }
            type="button"
          >
            {t('rawpainter.categories.all')}
          </button>
          {categories.map((category) => (
            <button
              className={`rounded-md px-2 py-1 text-[10px] ${categoryId === category.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              key={category.id}
              onClick={() =>
                setCatalogRequest((current) => ({
                  ...current,
                  categoryId: category.id,
                  revision: 0,
                }))
              }
              type="button"
            >
              {category.name} {category.productCount.toLocaleString('ko-KR')}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive text-xs">
          {error}
        </div>
      ) : null}

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground text-xs">
            <LoaderCircle className="h-4 w-4 animate-spin" /> {t('rawpainter.loading')}
          </div>
        ) : null}
        {status === 'error' ? (
          <button
            className="mx-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
            onClick={() =>
              setCatalogRequest((current) => ({ ...current, revision: current.revision + 1 }))
            }
            type="button"
          >
            <RotateCw className="h-3.5 w-3.5" /> {t('rawpainter.retry')}
          </button>
        ) : null}
        {status === 'ready' ? (
          products.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 pb-2">
              {products.map((product) => (
                <RawPainterProductCard
                  key={String(product.id)}
                  onSelect={selectProduct}
                  product={product}
                  selected={selectedId === String(product.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
              <p className="font-medium text-xs">{t('rawpainter.empty.title')}</p>
              <p className="text-[10px] text-muted-foreground">{t('rawpainter.empty.desc')}</p>
            </div>
          )
        ) : null}
        {status === 'ready' && nextPage !== null ? (
          <button
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-background/70 py-2 text-xs hover:bg-sidebar-accent"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('rawpainter.loadMore')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
