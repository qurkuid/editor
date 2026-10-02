'use client'

import {
  generateSceneMaterialId,
  getCatalogMaterialById,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialSchema,
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
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCw,
  Star,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { requestAiMaterialApply } from '@/lib/ai-material-request'
import useMaterialFavorites, {
  type MaterialFavorite,
  materialFavoriteKey,
} from '@/lib/material-favorites-store'
import {
  addImportedSceneMaterial,
  MATERIAL_IMPORT_MIME_TYPES,
  prepareImportedSceneMaterial,
  readClipboardImage,
} from '@/lib/material-import'
import {
  loadRawPainterBrands,
  loadRawPainterCategories,
  loadRawPainterPage,
  normalizeRawPainterProductSeamless,
  RawPainterCatalogError,
} from '@/lib/rawpainter-adapter'
import type {
  RawPainterBrand,
  RawPainterCatalogPage,
  RawPainterCategory,
  RawPainterProduct,
} from '@/lib/rawpainter-contract'
import {
  BUILTIN_BRAND,
  buildUnifiedCategories,
  builtinItemsForUnifiedCategory,
  type UnifiedCategory,
} from '@/lib/unified-material-catalog'
import { RawPainterProductCard } from './rawpainter-product-card'
import { RawPainterSearch } from './rawpainter-search'

type CatalogStatus = 'loading' | 'ready' | 'error'
export type CatalogMaterialSelection = {
  material?: MaterialSchema
  materialPreset?: string
  materialLabel?: string
  sourceTarget: ReturnType<typeof useEditor.getState>['activePaintTarget']
}
export type MaterialSelectionSink = (selection: CatalogMaterialSelection) => void | Promise<void>
type CatalogRequest = {
  // A vendor category id, or a negative synthetic id (builtin-only category).
  readonly categoryId: number | null
  // null = no brand chosen yet (the drill-down's brand level); '' = the
  // unbranded vendor group; BUILTIN_BRAND = the built-in pseudo-brand.
  readonly brand: string | null
  readonly search: string
  readonly revision: number
}

// The drill-down position survives unmounts — switching to 즐겨찾기/내 자재
// or to another sidebar tab and back lands on the same category/brand/search
// instead of the root. Data refetches (the server index keeps that fast);
// only the position is kept.
let lastCatalogRequest: CatalogRequest = {
  categoryId: null,
  brand: null,
  search: '',
  revision: 0,
}
let lastSearchInput = ''

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
      await action(await prepareRawPainterCatalogItem(product))
    } catch (cause) {
      setActionError(errorMessage(cause))
    } finally {
      setProcessingId(null)
    }
  }

  const selectProduct = (product: RawPainterProduct, onSelectMaterial?: MaterialSelectionSink) => {
    // Capture the sink and source target before the async normalization starts.
    // A later target change must not redirect an in-flight catalog pick.
    const sink = onSelectMaterial
    const sourceTarget = useEditor.getState().activePaintTarget
    return withPreparedItem(product, (item) => {
      if (sink) {
        return sink({
          material: freezeHostMaterialCatalogItem(item),
          materialLabel: item.label,
          materialPreset: toLibraryMaterialRef(item.id),
          sourceTarget,
        })
      }
      useEditor.getState().setActivePaintMaterial({
        material: freezeHostMaterialCatalogItem(item),
        sourceTarget,
      })
    })
  }

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
        aria-pressed={selected}
        className={`flex w-full flex-col gap-1 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
          selected
            ? 'bg-sidebar-accent ring-1 ring-primary ring-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
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
        <span className="w-full truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
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

const SWATCH_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }

function catalogGridStyle(columns?: number) {
  return columns && columns > 0
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : SWATCH_GRID_STYLE
}

/** One level of the category → brand drill-down: a large tappable row. */
function DrillRow({
  label,
  count,
  onClick,
}: {
  label: string
  count: number
  onClick: () => void
}) {
  const t = useT()
  return (
    <button
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/65 px-3.5 py-3 text-left transition-colors hover:border-foreground/35 hover:bg-sidebar-accent"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-sm">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {t('rawpainter.drill.productCount').replace('{count}', count.toLocaleString('ko-KR'))}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function DrillHeader({ trail, onBack }: { trail: string; onBack: () => void }) {
  const t = useT()
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <button
        aria-label={t('rawpainter.nav.back')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:text-foreground"
        onClick={onBack}
        title={t('rawpainter.nav.back')}
        type="button"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="truncate font-semibold text-sm">{trail}</span>
    </div>
  )
}

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
 * submit.
 *
 * Built-in Pascal materials and the RawPainter vendor catalog are ONE browsing
 * system: the category → brand → product drill-down hosts the built-ins as a
 * pinned 기본 자재 pseudo-brand inside matching categories (synthetic
 * categories cover the rest), so nothing lives beside the drill-down anymore.
 *
 * `sceneOnly` (the tab bar's house view) is the ONLY home of the 내 자재
 * section — the materials this scene actually uses plus imports — and skips
 * the search header and every RawPainter request. The default view carries
 * no local sections at all.
 */
export function MergedMaterialCatalog({
  columns,
  sceneOnly = false,
  onSelectMaterial,
}: {
  columns?: number
  sceneOnly?: boolean
  onSelectMaterial?: MaterialSelectionSink
} = {}) {
  const t = useT()
  const [categories, setCategories] = useState<readonly RawPainterCategory[]>([])
  const [brands, setBrands] = useState<readonly RawPainterBrand[] | null>(null)
  const [catalogRequest, setCatalogRequest] = useState<CatalogRequest>(() => lastCatalogRequest)
  const [searchInput, setSearchInput] = useState(() => lastSearchInput)
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

  useEffect(() => {
    lastCatalogRequest = catalogRequest
  }, [catalogRequest])
  useEffect(() => {
    lastSearchInput = searchInput
  }, [searchInput])

  const libraryVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: libraryVersion is a version counter whose only job is to invalidate this registry snapshot.
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
    // libraryVersion invalidates the registry snapshot on host
    // (un)registrations — without it, newly registered materials only
    // appeared after a remount.
  }, [libraryVersion])

  // One unified catalog: vendor categories host the built-ins their names map
  // onto (surfaced as a pinned 기본 자재 pseudo-brand at the brand level), and
  // local buckets no vendor category covers appear as synthetic categories.
  const unifiedCategories = useMemo(
    () =>
      buildUnifiedCategories(categories, builtinItems, (local) => t(`materialCategory.${local}`)),
    [categories, builtinItems, t],
  )
  const activeUnifiedCategory =
    unifiedCategories.find((category) => category.id === categoryId) ?? null
  const query = searchInput.trim().toLowerCase()
  const matchesQuery = (label: string) => !query || label.toLowerCase().includes(query)
  // Built-ins in scope at the current drill position: the hosted set inside a
  // category, everything at the root.
  const builtinScope = activeUnifiedCategory
    ? builtinItemsForUnifiedCategory(activeUnifiedCategory, builtinItems)
    : builtinItems
  const visibleBuiltin = builtinScope.filter((item) => matchesQuery(item.label))
  const visibleMyLibrary = myLibraryItems.filter((item) => matchesQuery(item.label))

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

  // The drill-down's brand level for the selected category. Synthetic
  // (builtin-only, negative-id) categories have no vendor brands to fetch.
  useEffect(() => {
    if (sceneOnly || categoryId === null || categoryId < 0) {
      setBrands(null)
      return
    }
    const controller = new AbortController()
    setBrands(null)
    void loadRawPainterBrands(categoryId, fetch, controller.signal)
      .then(setBrands)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [categoryId, sceneOnly])

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
    // Vendor products load only at a vendor leaf (category + real brand) or
    // for a search outside the builtin pseudo-brand; the category and brand
    // levels are pure navigation, and builtin leaves render client-side.
    const isBuiltinLeaf = catalogRequest.brand === BUILTIN_BRAND
    const wantsVendorProducts =
      !isBuiltinLeaf &&
      (catalogRequest.search !== '' ||
        (catalogRequest.categoryId !== null &&
          catalogRequest.categoryId > 0 &&
          catalogRequest.brand !== null))
    if (!wantsVendorProducts) {
      setProducts([])
      setNextPage(null)
      setStatus('ready')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    void loadRawPainterPage(
      {
        page: 0,
        // Synthetic categories are client-side only — never a server filter.
        categoryId:
          catalogRequest.categoryId !== null && catalogRequest.categoryId > 0
            ? catalogRequest.categoryId
            : null,
        brand: catalogRequest.brand,
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
        await loadRawPainterPage({
          page: nextPage,
          categoryId: categoryId !== null && categoryId > 0 ? categoryId : null,
          brand: catalogRequest.brand === BUILTIN_BRAND ? null : catalogRequest.brand,
          search: catalogRequest.search,
        }),
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
    const sink = onSelectMaterial
    const sourceTarget = useEditor.getState().activePaintTarget
    const id = generateSceneMaterialId()
    const count = Object.keys(useScene.getState().materials).length
    const sceneMaterial: { id: SceneMaterialId; name: string; material: MaterialSchema } = {
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
    }
    if (sink) {
      void sink({
        material: sceneMaterial.material,
        materialLabel: sceneMaterial.name,
        materialPreset: toSceneMaterialRef(id),
        sourceTarget,
      })
    } else {
      useScene.getState().addSceneMaterial(sceneMaterial)
      useEditor.getState().setActivePaintMaterial({
        materialPreset: toSceneMaterialRef(id),
        sourceTarget,
      })
    }
    if (!sink) setAutoEditMaterialId(id)
  }

  const selectLibraryItem = (item: MaterialCatalogItem) => {
    const sourceTarget = useEditor.getState().activePaintTarget
    if (onSelectMaterial) {
      void onSelectMaterial({
        material: freezeHostMaterialCatalogItem(item),
        materialLabel: item.label,
        materialPreset: toLibraryMaterialRef(item.id),
        sourceTarget,
      })
      return
    }
    useEditor.getState().setActivePaintMaterial({
      materialPreset: toLibraryMaterialRef(item.id),
      sourceTarget,
    })
  }

  // Shared tail of the file / clipboard import flows: create the textured
  // scene material, make it the brush, and open its inline editor.
  const importMaterialImage = async (image: Blob, name: string) => {
    const sink = onSelectMaterial
    const sourceTarget = useEditor.getState().activePaintTarget
    try {
      const sceneMaterial = sink
        ? await prepareImportedSceneMaterial(image, name)
        : await addImportedSceneMaterial(image, name).then(
            (id) => useScene.getState().materials[id],
          )
      if (!sceneMaterial) throw new Error('Imported material could not be registered.')
      const sceneMaterialId = sceneMaterial.id as SceneMaterialId
      if (sink) {
        await sink({
          material: sceneMaterial.material,
          materialLabel: sceneMaterial.name,
          materialPreset: toSceneMaterialRef(sceneMaterialId),
          sourceTarget,
        })
      } else {
        useEditor.getState().setActivePaintMaterial({
          materialPreset: toSceneMaterialRef(sceneMaterialId),
          sourceTarget,
        })
      }
      if (!sink) setAutoEditMaterialId(sceneMaterialId)
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

  // Category → brand → product drill-down. A live search shows products
  // directly, scoped to wherever the drill-down currently points.
  const drillPane: 'categories' | 'brands' | 'products' =
    catalogRequest.search !== ''
      ? 'products'
      : categoryId === null
        ? 'categories'
        : catalogRequest.brand === null
          ? 'brands'
          : 'products'
  const isBuiltinLeaf = catalogRequest.brand === BUILTIN_BRAND
  const brandLabel = isBuiltinLeaf
    ? t('painting.section.builtin')
    : catalogRequest.brand
      ? catalogRequest.brand
      : t('rawpainter.card.unbrandedLabel')
  // A synthetic category has exactly one "brand" (the built-ins), so entering
  // it skips the brand level and lands on its products directly.
  const enterCategory = (entry: UnifiedCategory) =>
    setCatalogRequest((current) => ({
      ...current,
      categoryId: entry.id,
      brand: entry.synthetic ? BUILTIN_BRAND : null,
      revision: 0,
    }))
  const enterBrand = (name: string) =>
    setCatalogRequest((current) => ({ ...current, brand: name, revision: 0 }))
  const backToCategories = () =>
    setCatalogRequest((current) => ({ ...current, categoryId: null, brand: null, revision: 0 }))
  const backFromProducts = () =>
    activeUnifiedCategory?.synthetic
      ? backToCategories()
      : setCatalogRequest((current) => ({ ...current, brand: null, revision: 0 }))

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
        </div>
      )}

      {combinedError ? (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive text-xs">
          {combinedError}
        </div>
      ) : null}

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
        {/* 내 자재 — scene materials (managed rows) + registered host/library
            materials. Lives ONLY in the house view; the default 자재 view is
            purely the unified drill-down catalog. */}
        {sceneOnly ? (
          <>
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
                columns={columns}
                filter={(_, sceneMaterial) => matchesQuery(sceneMaterial.name)}
                onSelectMaterial={onSelectMaterial}
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
              <div className="mt-2 grid gap-2" style={catalogGridStyle(columns)}>
                {visibleMyLibrary.map(libraryTile)}
              </div>
            ) : null}
          </>
        ) : null}

        {/* 자재 카탈로그 — built-in and RawPainter materials as one system,
            browsed category → brand → products (or searched directly).
            Built-ins live inside the categories as a 기본 자재 pseudo-brand. */}
        {sceneOnly ? null : (
          <>
            <SectionLabel>{t('painting.catalog.rawpainter')}</SectionLabel>
            {drillPane === 'categories' ? (
              categories.length > 0 ? (
                <div className="flex flex-col gap-1.5 pb-2">
                  {unifiedCategories.map((category) => (
                    <DrillRow
                      count={category.productCount}
                      key={category.id}
                      label={category.name}
                      onClick={() => enterCategory(category)}
                    />
                  ))}
                </div>
              ) : combinedError ? null : (
                <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground text-xs">
                  <LoaderCircle className="h-4 w-4 animate-spin" /> {t('rawpainter.loading')}
                </div>
              )
            ) : null}
            {drillPane === 'brands' ? (
              <>
                <DrillHeader onBack={backToCategories} trail={activeUnifiedCategory?.name ?? ''} />
                {activeUnifiedCategory && activeUnifiedCategory.builtinCount > 0 ? (
                  <div className="mb-1.5">
                    <DrillRow
                      count={activeUnifiedCategory.builtinCount}
                      label={t('painting.section.builtin')}
                      onClick={() => enterBrand(BUILTIN_BRAND)}
                    />
                  </div>
                ) : null}
                {brands === null ? (
                  <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground text-xs">
                    <LoaderCircle className="h-4 w-4 animate-spin" /> {t('rawpainter.loading')}
                  </div>
                ) : brands.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pb-2">
                    {brands.map((brand) => (
                      <DrillRow
                        count={brand.productCount}
                        key={brand.name || '\u0000unbranded'}
                        label={brand.name || t('rawpainter.card.unbrandedLabel')}
                        onClick={() => enterBrand(brand.name)}
                      />
                    ))}
                  </div>
                ) : activeUnifiedCategory && activeUnifiedCategory.builtinCount > 0 ? null : (
                  <p className="px-0.5 py-1 text-muted-foreground text-xs">
                    {t('rawpainter.drill.brandsEmpty')}
                  </p>
                )}
              </>
            ) : null}
            {drillPane === 'products' ? (
              <>
                {catalogRequest.search === '' && catalogRequest.brand !== null ? (
                  <DrillHeader
                    onBack={backFromProducts}
                    trail={
                      // Until the restored position's category list arrives
                      // (a remount refetches it), show just the brand.
                      activeUnifiedCategory === null
                        ? brandLabel
                        : activeUnifiedCategory.synthetic
                          ? activeUnifiedCategory.name
                          : `${activeUnifiedCategory.name} · ${brandLabel}`
                    }
                  />
                ) : null}
                {/* Built-ins in scope: the whole builtin leaf, or the hosted
                    matches alongside vendor results while searching. */}
                {isBuiltinLeaf ||
                (catalogRequest.search !== '' && catalogRequest.brand === null) ? (
                  visibleBuiltin.length > 0 ? (
                    <div className="mb-2.5 grid gap-2" style={catalogGridStyle(columns)}>
                      {visibleBuiltin.map(libraryTile)}
                    </div>
                  ) : isBuiltinLeaf ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
                      <p className="font-medium text-xs">{t('rawpainter.empty.title')}</p>
                      {catalogRequest.search !== '' ? (
                        <button
                          className="mt-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs hover:bg-sidebar-accent"
                          onClick={backToCategories}
                          type="button"
                        >
                          {t('rawpainter.search.everywhere')}
                        </button>
                      ) : null}
                    </div>
                  ) : null
                ) : null}
                {!isBuiltinLeaf && status === 'loading' ? (
                  <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground text-xs">
                    <LoaderCircle className="h-4 w-4 animate-spin" /> {t('rawpainter.loading')}
                  </div>
                ) : null}
                {!isBuiltinLeaf && status === 'error' ? (
                  <button
                    className="mx-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                    onClick={() =>
                      setCatalogRequest((current) => ({
                        ...current,
                        revision: current.revision + 1,
                      }))
                    }
                    type="button"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> {t('rawpainter.retry')}
                  </button>
                ) : null}
                {!isBuiltinLeaf && status === 'ready' ? (
                  products.length > 0 ? (
                    <div
                      className="grid grid-cols-1 gap-2.5 pb-2"
                      style={columns ? catalogGridStyle(columns) : undefined}
                    >
                      {products.map((product) => (
                        <RawPainterProductCard
                          favorite={`rawpainter:${String(product.id)}` in favorites}
                          key={String(product.id)}
                          onAiRequest={(item) => void requestAiApply(item)}
                          onSelect={(item) => void selectProduct(item, onSelectMaterial)}
                          onToggleFavorite={(item) =>
                            toggleFavorite({ kind: 'rawpainter', product: item })
                          }
                          processing={processingId === String(product.id)}
                          product={product}
                          selected={activePaintMaterialId === `rawpainter:${String(product.id)}`}
                        />
                      ))}
                    </div>
                  ) : visibleBuiltin.length > 0 &&
                    catalogRequest.search !== '' &&
                    catalogRequest.brand === null ? null : (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
                      <p className="font-medium text-xs">{t('rawpainter.empty.title')}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t('rawpainter.empty.desc')}
                      </p>
                      {catalogRequest.search !== '' &&
                      (catalogRequest.categoryId !== null || catalogRequest.brand !== null) ? (
                        <button
                          className="mt-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs hover:bg-sidebar-accent"
                          onClick={backToCategories}
                          type="button"
                        >
                          {t('rawpainter.search.everywhere')}
                        </button>
                      ) : null}
                    </div>
                  )
                ) : null}
                {!isBuiltinLeaf && status === 'ready' && nextPage !== null ? (
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
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/** Starred materials across every source, resolved live where possible. */
export function FavoriteMaterialsGrid({
  columns,
  onSelectMaterial,
}: {
  columns?: number
  onSelectMaterial?: MaterialSelectionSink
} = {}) {
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
        <div className="grid gap-2" style={catalogGridStyle(columns)}>
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
                  onSelect={() => {
                    const sourceTarget = useEditor.getState().activePaintTarget
                    if (onSelectMaterial) {
                      void onSelectMaterial({
                        material: sceneMaterial.material,
                        materialLabel: sceneMaterial.name,
                        materialPreset: ref,
                        sourceTarget,
                      })
                      return
                    }
                    useEditor.getState().setActivePaintMaterial({
                      materialPreset: ref,
                      sourceTarget,
                    })
                  }}
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
                  const sourceTarget = useEditor.getState().activePaintTarget
                  if (onSelectMaterial) {
                    void onSelectMaterial({
                      material: freezeHostMaterialCatalogItem(item),
                      materialLabel: label,
                      materialPreset: ref,
                      sourceTarget,
                    })
                    return
                  }
                  useEditor.getState().setActivePaintMaterial({
                    materialPreset: ref,
                    sourceTarget,
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
        <div
          className="mt-2 grid grid-cols-1 gap-2.5 pb-2"
          style={columns ? catalogGridStyle(columns) : undefined}
        >
          {productFavorites.map((favorite) =>
            favorite.kind === 'rawpainter' ? (
              <RawPainterProductCard
                favorite
                key={materialFavoriteKey(favorite)}
                onAiRequest={(item) => void requestAiApply(item)}
                onSelect={(item) => void selectProduct(item, onSelectMaterial)}
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
