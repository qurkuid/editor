'use client'

import {
  generateSceneMaterialId,
  getCatalogMaterialById,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  registerLibraryMaterials,
  type SceneMaterialId,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
  toSceneMaterialRef,
} from '@pascal-app/core'
import {
  freezeHostMaterialCatalogItem,
  SceneMaterialList,
  toHostMaterialCatalogItem,
  translate,
  useEditor,
  useLocale,
  useScene,
  useT,
} from '@pascal-app/editor'
import { Bot, ClipboardPaste, ImagePlus, LoaderCircle, Plus, RotateCw, Star } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { requestAiMaterialApply } from '@/lib/ai-material-request'
import useMaterialFavorites, {
  type MaterialFavorite,
  materialFavoriteKey,
} from '@/lib/material-favorites-store'
import {
  addImportedSceneMaterial,
  MATERIAL_IMPORT_MIME_TYPES,
  readClipboardImage,
} from '@/lib/material-import'
import {
  loadRawPainterCategories,
  loadRawPainterPage,
  matchMaterialCategoryFromText,
  normalizeRawPainterProductSeamless,
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

/** Seamless-normalize a RawPainter product and register it as a library material. */
async function prepareRawPainterCatalogItem(product: RawPainterProduct) {
  const catalogItem = toHostMaterialCatalogItem(
    await normalizeRawPainterProductSeamless(product, globalThis.location.origin),
  )
  registerLibraryMaterials([catalogItem])
  return catalogItem
}

/**
 * Busy-tracked RawPainter product actions shared by the merged catalog and the
 * favorites grid: pick as brush, or hand off to the modeling agent.
 */
function useRawPainterProductActions() {
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const withPreparedItem = async (
    product: RawPainterProduct,
    action: (item: MaterialCatalogItem) => void,
  ) => {
    if (processingId !== null) return
    setProcessingId(String(product.id))
    setActionError(null)
    try {
      action(await prepareRawPainterCatalogItem(product))
    } catch (cause) {
      setActionError(errorMessage(cause))
    } finally {
      setProcessingId(null)
    }
  }

  const selectProduct = (product: RawPainterProduct) =>
    withPreparedItem(product, (item) => {
      useEditor.getState().setActivePaintMaterial({
        material: freezeHostMaterialCatalogItem(item),
        sourceTarget: useEditor.getState().activePaintTarget,
      })
    })

  const requestAiApply = (product: RawPainterProduct) =>
    withPreparedItem(product, (item) => {
      requestAiMaterialApply({
        name: item.label,
        ref: toLibraryMaterialRef(item.id),
        description: item.description,
      })
    })

  return { processingId, actionError, selectProduct, requestAiApply }
}

function FavoriteStarButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const t = useT()
  const label = active ? t('painting.favorites.remove') : t('painting.favorites.add')
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`absolute top-1 left-1 z-10 flex h-5 w-5 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors ${
        active ? 'bg-amber-400 text-amber-950' : 'bg-black/40 text-white hover:bg-black/60'
      }`}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <Star className={`h-3 w-3 ${active ? 'fill-current' : ''}`} />
    </button>
  )
}

function AiApplyButton({ onRequest, corner }: { onRequest: () => void; corner: 'tr' | 'br' }) {
  const t = useT()
  return (
    <button
      aria-label={t('painting.ai.request')}
      className={`absolute z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600/90 text-white shadow-sm backdrop-blur transition-colors hover:bg-emerald-500 ${
        corner === 'tr' ? 'top-1 right-1' : 'right-1 bottom-1'
      }`}
      onClick={onRequest}
      title={t('painting.ai.request')}
      type="button"
    >
      <Bot className="h-3 w-3" />
    </button>
  )
}

/** Compact swatch tile — library materials and scene materials share it. */
function SwatchTile({
  label,
  thumbnailUrl,
  color,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
  onAiRequest,
}: {
  label: string
  thumbnailUrl?: string
  color?: string
  selected: boolean
  favorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  onAiRequest: () => void
}) {
  return (
    <div className="group relative">
      <button
        className={`flex w-full flex-col gap-1 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
          selected ? 'bg-sidebar-accent ring-1 ring-primary ring-inset' : ''
        }`}
        onClick={onSelect}
        title={label}
        type="button"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-lg">
          {thumbnailUrl ? (
            <img
              alt={label}
              className="h-full w-full object-cover"
              loading="lazy"
              src={thumbnailUrl}
            />
          ) : (
            <div className="h-full w-full" style={{ backgroundColor: color ?? '#f3f4f6' }} />
          )}
        </div>
        <span className="w-full truncate px-0.5 text-left font-medium text-[10px] text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
      </button>
      <FavoriteStarButton active={favorite} onToggle={onToggleFavorite} />
      <AiApplyButton corner="tr" onRequest={onAiRequest} />
    </div>
  )
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-3 mb-1.5 flex items-center justify-between first:mt-0">
      <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
        {children}
      </span>
      {action}
    </div>
  )
}

const SWATCH_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }

function libraryFavorite(item: MaterialCatalogItem): MaterialFavorite {
  return {
    kind: 'library',
    id: item.id,
    label: item.label,
    thumbnailUrl: item.previewThumbnailUrl,
    color: item.previewColor,
  }
}

/**
 * The Painting tab's single material surface: scene + registered library
 * materials and the RawPainter vendor catalog in one searchable scroll.
 * One search box filters the local sections live and queries RawPainter on
 * submit; the category chips narrow the RawPainter section.
 *
 * `sceneOnly` (the tab bar's house view) keeps just the 내 자재 section —
 * the materials this scene actually uses — and skips the search header,
 * built-in catalog, and every RawPainter request.
 */
export function MergedMaterialCatalog({ sceneOnly = false }: { sceneOnly?: boolean } = {}) {
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
  const [status, setStatus] = useState<CatalogStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Id of a just-created scene material whose inline editor should open on mount.
  const [autoEditMaterialId, setAutoEditMaterialId] = useState<SceneMaterialId | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const { processingId, actionError, selectProduct, requestAiApply } = useRawPainterProductActions()
  const categoryId = catalogRequest.categoryId

  const favorites = useMaterialFavorites((state) => state.favorites)
  const toggleFavorite = useMaterialFavorites((state) => state.toggleFavorite)
  const activePaintRef = useEditor((state) => state.activePaintMaterial?.materialPreset)
  const activePaintMaterialId = useEditor((state) => state.activePaintMaterial?.material?.id)
  const sceneMaterialCount = useScene((state) => Object.keys(state.materials).length)

  const libraryVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  const { builtinItems, myLibraryItems } = useMemo(() => {
    const seen = new Set<string>()
    const builtin: MaterialCatalogItem[] = []
    const mine: MaterialCatalogItem[] = []
    for (const category of MATERIAL_CATEGORIES) {
      for (const item of getMaterialsForCategory(category)) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        if ((item.source ?? 'pascal') === 'pascal') builtin.push(item)
        else mine.push(item)
      }
    }
    return { builtinItems: builtin, myLibraryItems: mine }
    // libraryVersion invalidates the registry snapshot on host (un)registrations.
  }, [])

  // The category chips and the search box filter the WHOLE catalog: the
  // selected vendor category maps onto the local taxonomy so the built-in and
  // my-material sections narrow together with the RawPainter products.
  const activeVendorCategory = categories.find((category) => category.id === categoryId) ?? null
  const localCategory = activeVendorCategory
    ? matchMaterialCategoryFromText(activeVendorCategory.name)
    : null
  const query = searchInput.trim().toLowerCase()
  const matchesQuery = (label: string) => !query || label.toLowerCase().includes(query)
  const matchesLocalFilters = (item: MaterialCatalogItem) =>
    matchesQuery(item.label) && (!localCategory || item.category === localCategory)
  const visibleBuiltin = builtinItems.filter(matchesLocalFilters)
  const visibleMyLibrary = myLibraryItems.filter(matchesLocalFilters)

  useEffect(() => {
    if (sceneOnly) return
    const controller = new AbortController()
    void loadRawPainterCategories(fetch, controller.signal)
      .then(setCategories)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [sceneOnly])

  // Live search: typing narrows the local sections instantly and, after a
  // short pause, re-queries the RawPainter server — no Enter required.
  useEffect(() => {
    const timer = setTimeout(() => {
      const search = searchInput.trim()
      setCatalogRequest((current) =>
        current.search === search ? current : { ...current, search, revision: 0 },
      )
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (sceneOnly) return
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
        setNextPage(typeof page.next === 'number' ? page.next : null)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(errorMessage(cause))
        setStatus('error')
      })
    return () => controller.abort()
  }, [catalogRequest, sceneOnly])

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

  // Create a blank custom scene material, select it as the brush (`scene:` ref
  // so edits propagate), and open its inline editor.
  const createCustomMaterial = () => {
    const id = generateSceneMaterialId()
    const count = Object.keys(useScene.getState().materials).length
    useScene.getState().addSceneMaterial({
      id,
      name: `Material ${count + 1}`,
      material: {
        preset: 'custom',
        properties: {
          color: '#ffffff',
          roughness: 0.5,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'front',
        },
      },
    })
    useEditor.getState().setActivePaintMaterial({
      materialPreset: toSceneMaterialRef(id),
      sourceTarget: useEditor.getState().activePaintTarget,
    })
    setAutoEditMaterialId(id)
  }

  const selectLibraryItem = (item: MaterialCatalogItem) => {
    useEditor.getState().setActivePaintMaterial({
      materialPreset: toLibraryMaterialRef(item.id),
      sourceTarget: useEditor.getState().activePaintTarget,
    })
  }

  // Shared tail of the file / clipboard import flows: create the textured
  // scene material, make it the brush, and open its inline editor.
  const importMaterialImage = async (image: Blob, name: string) => {
    try {
      const id = await addImportedSceneMaterial(image, name)
      useEditor.getState().setActivePaintMaterial({
        materialPreset: toSceneMaterialRef(id),
        sourceTarget: useEditor.getState().activePaintTarget,
      })
      setAutoEditMaterialId(id)
      setImportError(null)
    } catch {
      setImportError(t('painting.importFailed'))
    }
  }

  const importFromClipboard = async () => {
    try {
      const image = await readClipboardImage()
      if (!image) {
        setImportError(t('painting.clipboardNoImage'))
        return
      }
      const count = Object.keys(useScene.getState().materials).length
      await importMaterialImage(image, `Material ${count + 1}`)
    } catch {
      setImportError(t('painting.clipboardNoImage'))
    }
  }

  const libraryTile = (item: MaterialCatalogItem) => (
    <SwatchTile
      color={item.previewColor}
      favorite={materialFavoriteKey(libraryFavorite(item)) in favorites}
      key={item.id}
      label={item.label}
      onAiRequest={() =>
        requestAiMaterialApply({
          name: item.label,
          ref: toLibraryMaterialRef(item.id),
          description: item.description,
        })
      }
      onSelect={() => selectLibraryItem(item)}
      onToggleFavorite={() => toggleFavorite(libraryFavorite(item))}
      selected={activePaintRef === toLibraryMaterialRef(item.id)}
      thumbnailUrl={item.previewThumbnailUrl}
    />
  )

  const combinedError = error ?? actionError ?? importError

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {sceneOnly ? null : (
        <div className="shrink-0 rounded-xl border border-border/70 bg-background/65 p-2.5">
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
      )}

      {combinedError ? (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive text-xs">
          {combinedError}
        </div>
      ) : null}

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
        {/* 내 자재 — scene materials (managed rows) + registered host/library materials. */}
        <SectionLabel
          action={
            <div className="flex items-center gap-1">
              <input
                accept={MATERIAL_IMPORT_MIME_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void importMaterialImage(file, file.name.replace(/\.[^.]+$/, '') || file.name)
                }}
                ref={importFileInputRef}
                type="file"
              />
              <button
                aria-label={t('painting.importFile')}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
                onClick={() => importFileInputRef.current?.click()}
                title={t('painting.importFile')}
                type="button"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={t('painting.importClipboard')}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
                onClick={() => void importFromClipboard()}
                title={t('painting.importClipboard')}
                type="button"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={t('painting.addMaterial')}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
                onClick={createCustomMaterial}
                title={t('painting.addMaterial')}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          }
        >
          {t('painting.section.myMaterials')}
        </SectionLabel>
        {sceneMaterialCount > 0 ? (
          <SceneMaterialList
            autoEditId={autoEditMaterialId}
            filter={(_, sceneMaterial) => matchesQuery(sceneMaterial.name)}
            rowActions={(id, sceneMaterial) => (
              <>
                <button
                  aria-label={
                    `scene:${id}` in favorites
                      ? t('painting.favorites.remove')
                      : t('painting.favorites.add')
                  }
                  aria-pressed={`scene:${id}` in favorites}
                  className={`flex h-7 w-7 items-center justify-center rounded-md border border-border/70 transition-colors ${
                    `scene:${id}` in favorites
                      ? 'bg-amber-400/20 text-amber-500'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => toggleFavorite({ kind: 'scene', id })}
                  type="button"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${`scene:${id}` in favorites ? 'fill-current' : ''}`}
                  />
                </button>
                <button
                  aria-label={t('painting.ai.request')}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-emerald-600 hover:text-emerald-500"
                  onClick={() =>
                    requestAiMaterialApply({
                      name: sceneMaterial.name,
                      ref: toSceneMaterialRef(id),
                    })
                  }
                  title={t('painting.ai.request')}
                  type="button"
                >
                  <Bot className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          />
        ) : (
          <p className="px-0.5 py-1 text-muted-foreground text-xs">
            {t('painting.noSceneMaterials')}
          </p>
        )}
        {visibleMyLibrary.length > 0 ? (
          <div className="mt-2 grid gap-2" style={SWATCH_GRID_STYLE}>
            {visibleMyLibrary.map(libraryTile)}
          </div>
        ) : null}

        {/* 기본 자재 — the built-in Pascal catalog. */}
        {!sceneOnly && visibleBuiltin.length > 0 ? (
          <>
            <SectionLabel>{t('painting.section.builtin')}</SectionLabel>
            <div className="grid gap-2" style={SWATCH_GRID_STYLE}>
              {visibleBuiltin.map(libraryTile)}
            </div>
          </>
        ) : null}

        {/* RawPainter — the external vendor catalog. */}
        {sceneOnly ? null : (
          <>
            <SectionLabel>{t('painting.catalog.rawpainter')}</SectionLabel>
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
                      favorite={`rawpainter:${String(product.id)}` in favorites}
                      key={String(product.id)}
                      onAiRequest={(item) => void requestAiApply(item)}
                      onSelect={(item) => void selectProduct(item)}
                      onToggleFavorite={(item) =>
                        toggleFavorite({ kind: 'rawpainter', product: item })
                      }
                      processing={processingId === String(product.id)}
                      product={product}
                      selected={activePaintMaterialId === `rawpainter:${String(product.id)}`}
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
          </>
        )}
      </div>
    </div>
  )
}

/** Starred materials across every source, resolved live where possible. */
export function FavoriteMaterialsGrid() {
  const t = useT()
  const favorites = useMaterialFavorites((state) => state.favorites)
  const toggleFavorite = useMaterialFavorites((state) => state.toggleFavorite)
  const sceneMaterials = useScene((state) => state.materials)
  const activePaintRef = useEditor((state) => state.activePaintMaterial?.materialPreset)
  const activePaintMaterialId = useEditor((state) => state.activePaintMaterial?.material?.id)
  const { processingId, actionError, selectProduct, requestAiApply } = useRawPainterProductActions()
  useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )

  const entries = Object.values(favorites)
  const swatchFavorites = entries.filter((entry) => entry.kind !== 'rawpainter')
  const productFavorites = entries.filter((entry) => entry.kind === 'rawpainter')

  if (entries.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center px-4 text-center text-muted-foreground text-xs">
        {t('painting.favorites.empty')}
      </div>
    )
  }

  return (
    <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
      {actionError ? (
        <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive text-xs">
          {actionError}
        </div>
      ) : null}
      {swatchFavorites.length > 0 ? (
        <div className="grid gap-2" style={SWATCH_GRID_STYLE}>
          {swatchFavorites.map((favorite) => {
            if (favorite.kind === 'scene') {
              const sceneMaterial = sceneMaterials[favorite.id as SceneMaterialId]
              if (!sceneMaterial) return null
              const ref = toSceneMaterialRef(favorite.id as SceneMaterialId)
              return (
                <SwatchTile
                  color={sceneMaterial.material.properties?.color ?? '#ffffff'}
                  favorite
                  key={materialFavoriteKey(favorite)}
                  label={sceneMaterial.name}
                  onAiRequest={() => requestAiMaterialApply({ name: sceneMaterial.name, ref })}
                  onSelect={() =>
                    useEditor.getState().setActivePaintMaterial({
                      materialPreset: ref,
                      sourceTarget: useEditor.getState().activePaintTarget,
                    })
                  }
                  onToggleFavorite={() => toggleFavorite(favorite)}
                  selected={activePaintRef === ref}
                />
              )
            }
            // Library favorites resolve live; a stale registration falls back
            // to the stored snapshot for display and stays selectable-only if
            // the material is still registered.
            const item = getCatalogMaterialById(favorite.id)
            const label = item?.label ?? favorite.label
            const ref = toLibraryMaterialRef(favorite.id)
            return (
              <SwatchTile
                color={item?.previewColor ?? favorite.color}
                favorite
                key={materialFavoriteKey(favorite)}
                label={label}
                onAiRequest={() =>
                  requestAiMaterialApply({ name: label, ref, description: item?.description })
                }
                onSelect={() => {
                  if (!item) return
                  useEditor.getState().setActivePaintMaterial({
                    materialPreset: ref,
                    sourceTarget: useEditor.getState().activePaintTarget,
                  })
                }}
                onToggleFavorite={() => toggleFavorite(favorite)}
                selected={activePaintRef === ref}
                thumbnailUrl={item?.previewThumbnailUrl ?? favorite.thumbnailUrl}
              />
            )
          })}
        </div>
      ) : null}
      {productFavorites.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-2 pb-2">
          {productFavorites.map((favorite) =>
            favorite.kind === 'rawpainter' ? (
              <RawPainterProductCard
                favorite
                key={materialFavoriteKey(favorite)}
                onAiRequest={(item) => void requestAiApply(item)}
                onSelect={(item) => void selectProduct(item)}
                onToggleFavorite={() => toggleFavorite(favorite)}
                processing={processingId === String(favorite.product.id)}
                product={favorite.product}
                selected={activePaintMaterialId === `rawpainter:${String(favorite.product.id)}`}
              />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  )
}
