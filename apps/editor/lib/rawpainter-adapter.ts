import type { MaterialCategory } from '@pascal-app/core'
import type { EditorHostIntegrationAdapter, EditorHostMaterialProduct } from '@pascal-app/editor'
import { withBasePath } from './base-path'
import { getOrCreateSeamlessAsset } from './material-seamless-cache'
import {
  type RawPainterCatalogPage,
  type RawPainterCategory,
  type RawPainterProduct,
  rawPainterCatalogPageSchema,
  rawPainterCategoryListSchema,
} from './rawpainter-contract'

type RawPainterOption = {
  size?: unknown
  price?: unknown
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type SeamlessAssetResolver = (textureUrl: string) => Promise<string>

export class RawPainterCatalogError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`RawPainter catalog request failed: ${status}`)
    this.name = 'RawPainterCatalogError'
    this.status = status
  }
}

const DEFAULT_MAP_PROPERTIES = {
  color: '#ffffff',
  roughness: 0.7,
  metalness: 0,
  rotation: 0,
  wrapS: 'Repeat' as const,
  wrapT: 'Repeat' as const,
  normalScaleX: 1,
  normalScaleY: 1,
  emissiveIntensity: 1,
  displacementScale: 0,
  transparent: false,
  flipY: false,
  bumpScale: 1,
  emissiveColor: '#000000',
  aoMapIntensity: 1,
  side: 0,
  opacity: 1,
  lightMapIntensity: 1,
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rawPainterCategory(product: RawPainterProduct): MaterialCategory {
  const value = `${text(product.category)} ${text(product.subCategory)}`.toLowerCase()
  if (/목재|우드|wood|마루/.test(value)) return 'wood'
  if (/석재|스톤|stone|대리석|디자인월/.test(value)) return 'stone'
  if (/타일|tile/.test(value)) return 'tile'
  if (/벽지|wallpaper/.test(value)) return 'wallpaper'
  if (/콘크리트|cement|시멘트/.test(value)) return 'concrete'
  if (/금속|metal/.test(value)) return 'metal'
  if (/패브릭|fabric|폴리에스터/.test(value)) return 'fabric'
  if (/카펫|carpet/.test(value)) return 'carpet'
  if (/가죽|leather/.test(value)) return 'leather'
  if (/유리|glass/.test(value)) return 'glass'
  if (/페인트|paint|plaster/.test(value)) return 'colors'
  return 'other'
}

export function parseRawPainterPhysicalSize(
  value: unknown,
): { widthM: number; heightM: number } | undefined {
  const source = text(value).toLowerCase()
  const matches = [...source.matchAll(/(\d[\d,.]*)\s*(mm|cm|m)?/g)]
  if (matches.length < 2) return undefined
  const fallbackUnit = matches.find((match) => match[2])?.[2] ?? 'mm'
  const dimensions = matches.map((match) => {
    const parsed = Number(match[1]?.replaceAll(',', ''))
    const unit = match[2] ?? fallbackUnit
    const unitScale = unit === 'm' ? 1 : unit === 'cm' ? 0.01 : 0.001
    return parsed * unitScale
  })
  const widthM = dimensions[0]
  const heightM = dimensions[1]
  if (!(widthM && heightM && Number.isFinite(widthM) && Number.isFinite(heightM))) {
    return undefined
  }
  return { widthM, heightM }
}

function physicalSize(options: unknown): { widthM: number; heightM: number } | undefined {
  if (!Array.isArray(options)) return undefined
  for (const option of options as RawPainterOption[]) {
    const parsed = parseRawPainterPhysicalSize(option.size)
    if (parsed) return parsed
  }
  return undefined
}

export function normalizeRawPainterProduct(
  product: RawPainterProduct,
  assetOrigin?: string,
): EditorHostMaterialProduct {
  const externalId = String(product.id)
  const size = physicalSize(product.options)
  const previewThumbnailUrl =
    text(product.thumbnailUrl) || text(product.image) || text(product.img) || undefined
  const textureKind =
    text(product.seamlessImage) || product.hasSeamless === true ? 'seamless' : null
  const texturePath = withBasePath(
    `/api/materials/rawpainter/asset/${externalId}${textureKind ? '?kind=seamless' : ''}`,
  )
  const textureUrl = assetOrigin ? new URL(texturePath, assetOrigin).href : texturePath
  const brand = text(product.brand)
  const store = text(product.store)
  const price = number(product.price)

  return {
    provider: 'rawpainter',
    externalId,
    name: text(product.name) || `RawPainter ${externalId}`,
    category: rawPainterCategory(product),
    source: 'workspace',
    description: [brand, store, price == null ? '' : `${price.toLocaleString('ko-KR')}원`]
      .filter(Boolean)
      .join(' · '),
    previewThumbnailUrl,
    physicalSize: size,
    appearance: {
      maps: { albedoMap: textureUrl },
      mapProperties: {
        ...DEFAULT_MAP_PROPERTIES,
        repeatX: size ? 1 / size.widthM : 1,
        repeatY: size ? 1 / size.heightM : 1,
      },
    },
  }
}

export function hasVendorSeamlessTexture(product: RawPainterProduct): boolean {
  return Boolean(text(product.seamlessImage) || product.hasSeamless === true)
}

/**
 * Normalize with a seamless surface guaranteed: a vendor-provided seamless
 * image is used as-is (the asset proxy already serves it), otherwise the raw
 * texture runs through the local seamless pipeline and the processed
 * `asset://` result replaces the albedo map.
 */
export async function normalizeRawPainterProductSeamless(
  product: RawPainterProduct,
  assetOrigin?: string,
  resolveSeamlessAsset: SeamlessAssetResolver = getOrCreateSeamlessAsset,
): Promise<EditorHostMaterialProduct> {
  const normalized = normalizeRawPainterProduct(product, assetOrigin)
  const albedoMap = normalized.appearance.maps.albedoMap
  if (hasVendorSeamlessTexture(product) || !albedoMap) return normalized
  return {
    ...normalized,
    appearance: {
      ...normalized.appearance,
      maps: { ...normalized.appearance.maps, albedoMap: await resolveSeamlessAsset(albedoMap) },
    },
  }
}

export async function loadRawPainterCategories(
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<readonly RawPainterCategory[]> {
  const response = await fetcher(withBasePath('/api/materials/rawpainter?view=categories'), {
    signal,
  })
  if (!response.ok) throw new RawPainterCatalogError(response.status)
  return rawPainterCategoryListSchema.parse(await response.json())
}

export async function loadRawPainterPage(
  input: { readonly page: number; readonly categoryId: number | null; readonly search?: string },
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<RawPainterCatalogPage> {
  const searchParams = new URLSearchParams({ page: String(input.page) })
  if (input.categoryId !== null) searchParams.set('categoryId', String(input.categoryId))
  if (input.search) searchParams.set('search', input.search)
  const response = await fetcher(
    withBasePath(`/api/materials/rawpainter?${searchParams.toString()}`),
    { signal },
  )
  if (!response.ok) throw new RawPainterCatalogError(response.status)
  return rawPainterCatalogPageSchema.parse(await response.json())
}

export function createRawPainterIntegrationAdapter(
  fetcher: Fetcher = fetch,
  resolveSeamlessAsset: SeamlessAssetResolver = getOrCreateSeamlessAsset,
): EditorHostIntegrationAdapter {
  return {
    getContext: async () => ({ projectId: 'local-editor' }),
    materials: {
      async makeSeamless(input) {
        return { textureUrl: await resolveSeamlessAsset(input.textureUrl) }
      },
      async search(input) {
        const page = input.cursor ?? '0'
        const response = await fetcher(
          withBasePath(`/api/materials/rawpainter?page=${encodeURIComponent(page)}`),
        )
        if (response.status === 502) return { items: [], nextCursor: null }
        if (!response.ok) throw new RawPainterCatalogError(response.status)
        const payload = rawPainterCatalogPageSchema.parse(await response.json())
        const nextCursor =
          typeof payload.next === 'number' || typeof payload.next === 'string'
            ? String(payload.next)
            : null
        return {
          items: payload.products.map((product) =>
            normalizeRawPainterProduct(product, globalThis.location?.origin),
          ),
          nextCursor,
        }
      },
    },
  }
}

export const rawPainterIntegrationAdapter = createRawPainterIntegrationAdapter()
