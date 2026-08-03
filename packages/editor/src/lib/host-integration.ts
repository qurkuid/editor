import {
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialPresetPayload,
  type MaterialSchema,
  type MaterialSource,
  type MeasurementFeatureAnchor,
  registerLibraryMaterials,
  unregisterLibraryMaterials,
} from '@pascal-app/core'

export type EditorHostProjectContext = {
  projectId: string
  documentId?: string
  modelVersionId?: string
}

export type EditorHostViewpoint = {
  camera: [number, number, number]
  target: [number, number, number]
  projection: 'perspective' | 'orthographic'
}

export type EditorHostAnnotation = {
  id: string
  projectId: string
  modelVersionId?: string
  kind: 'comment' | 'issue' | 'review'
  status: 'open' | 'resolved' | 'sync-error'
  body: string
  anchor: MeasurementFeatureAnchor
  viewpoint?: EditorHostViewpoint
  authorId?: string
  assigneeId?: string
  revision: string
  createdAt: string
  updatedAt: string
}

export type EditorHostAnnotationMutation = Omit<
  EditorHostAnnotation,
  'id' | 'revision' | 'createdAt' | 'updatedAt'
> & {
  mutationId: string
}

export type EditorHostMaterialProduct = {
  provider: string
  externalId: string
  revision?: string
  name: string
  category: MaterialCategory
  source?: MaterialSource
  description?: string
  previewThumbnailUrl?: string
  previewColor?: string
  physicalSize?: { widthM: number; heightM: number }
  commercial?: {
    brand?: string
    productCode?: string
    unitPrice?: number
    unit?: string
  }
  constructionKinds?: Array<'gypsum-board' | 'mdf' | 'timber-stud' | 'finish' | 'custom'>
  appearance: MaterialPresetPayload
}

export type EditorHostMaterialSearch = {
  context: EditorHostProjectContext | null
  cursor: string | null
  query?: string
  category?: MaterialCategory
}

export type EditorHostMaterialPage = {
  items: EditorHostMaterialProduct[]
  nextCursor?: string | null
}

export type EditorHostMaterialSeamlessRequest = {
  readonly materialId: string
  readonly textureUrl: string
}

export type EditorHostMaterialSeamlessAsset = {
  readonly textureUrl: string
}

export type SceneMaterialSeamlessResult =
  | { readonly kind: 'complete'; readonly textureUrl: string }
  | { readonly kind: 'unavailable' }

type MaterialSeamlessHandler = (
  input: EditorHostMaterialSeamlessRequest,
) => Promise<EditorHostMaterialSeamlessAsset>

let activeMaterialSeamlessHandler: MaterialSeamlessHandler | null = null

export interface EditorHostIntegrationAdapter {
  getContext?: () => Promise<EditorHostProjectContext | null>
  annotations?: {
    list(input: { projectId: string; modelVersionId?: string }): Promise<EditorHostAnnotation[]>
    upsert(input: EditorHostAnnotationMutation): Promise<EditorHostAnnotation>
  }
  materials?: {
    search(input: EditorHostMaterialSearch): Promise<EditorHostMaterialPage>
    makeSeamless?: MaterialSeamlessHandler
  }
}

export type EditorHostIntegrationSession = {
  context: EditorHostProjectContext | null
  materialIds: string[]
  dispose(): void
}

function catalogId(product: EditorHostMaterialProduct): string {
  return `${product.provider}:${product.externalId}`
}

export async function requestSceneMaterialSeamless(
  input: EditorHostMaterialSeamlessRequest,
): Promise<SceneMaterialSeamlessResult> {
  const handler = activeMaterialSeamlessHandler
  if (!handler) return { kind: 'unavailable' }
  const asset = await handler(input)
  return { kind: 'complete', textureUrl: asset.textureUrl }
}

export function toHostMaterialCatalogItem(product: EditorHostMaterialProduct): MaterialCatalogItem {
  return {
    id: catalogId(product),
    label: product.name,
    category: product.category,
    source: product.source ?? 'workspace',
    description: product.description,
    previewThumbnailUrl: product.previewThumbnailUrl,
    previewColor: product.previewColor,
    sourceRef: {
      provider: product.provider,
      externalId: product.externalId,
      revision: product.revision,
    },
    physicalSize: product.physicalSize,
    commercial: product.commercial,
    constructionKinds: product.constructionKinds,
    preset: product.appearance,
  }
}

export function freezeHostMaterialCatalogItem(item: MaterialCatalogItem): MaterialSchema {
  const properties = item.preset.mapProperties
  const albedoMap = item.preset.maps.albedoMap
  return {
    id: item.id,
    preset: 'custom',
    properties: {
      color: properties.color,
      roughness: properties.roughness,
      metalness: properties.metalness,
      opacity: properties.opacity,
      transparent: properties.transparent,
      side: properties.side === 1 ? 'back' : properties.side === 2 ? 'double' : 'front',
    },
    source: item.sourceRef,
    physicalSize: item.physicalSize,
    texture: albedoMap
      ? {
          url: albedoMap,
          repeat: [properties.repeatX, properties.repeatY],
        }
      : undefined,
  }
}

export async function connectEditorHostIntegration(
  adapter: EditorHostIntegrationAdapter | null | undefined,
): Promise<EditorHostIntegrationSession> {
  if (!adapter) {
    return { context: null, materialIds: [], dispose() {} }
  }

  const context = (await adapter.getContext?.()) ?? null
  const page = adapter.materials
    ? await adapter.materials.search({ context, cursor: null })
    : { items: [] }
  const materials = page.items.map(toHostMaterialCatalogItem)
  const materialIds = materials.map((item) => item.id)
  const materialSeamlessHandler = adapter.materials?.makeSeamless ?? null
  activeMaterialSeamlessHandler = materialSeamlessHandler
  registerLibraryMaterials(materials)

  return {
    context,
    materialIds,
    dispose() {
      unregisterLibraryMaterials(materialIds)
      if (activeMaterialSeamlessHandler === materialSeamlessHandler) {
        activeMaterialSeamlessHandler = null
      }
    },
  }
}
