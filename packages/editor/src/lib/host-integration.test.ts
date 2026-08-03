import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCatalogMaterialById,
  getDynamicLibraryMaterials,
  type MaterialPresetPayload,
  unregisterLibraryMaterials,
} from '@pascal-app/core'
import {
  connectEditorHostIntegration,
  type EditorHostIntegrationAdapter,
  freezeHostMaterialCatalogItem,
  requestSceneMaterialSeamless,
} from './host-integration'

const appearance: MaterialPresetPayload = {
  maps: { albedoMap: 'https://intm.kr/materials/42.webp' },
  mapProperties: {
    color: '#ffffff',
    roughness: 0.7,
    metalness: 0,
    repeatX: 2,
    repeatY: 1,
    rotation: 0,
    wrapS: 'Repeat',
    wrapT: 'Repeat',
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
  },
}

afterEach(() => {
  unregisterLibraryMaterials(
    getDynamicLibraryMaterials()
      .filter((item) => item.id.startsWith('rawpainter:'))
      .map((item) => item.id),
  )
})

describe('connectEditorHostIntegration', () => {
  test('routes scene material seamless requests through the active host session', async () => {
    // Given: a host adapter that can persist a locally generated seamless texture.
    const adapter: EditorHostIntegrationAdapter = {
      materials: {
        search: async () => ({ items: [] }),
        makeSeamless: async (input) => ({
          textureUrl: `asset://seamless-${input.materialId}`,
        }),
      },
    }
    const session = await connectEditorHostIntegration(adapter)

    // When: the scene material UI requests a seamless texture.
    const result = await requestSceneMaterialSeamless({
      materialId: 'scene_material_42',
      textureUrl: 'https://intm.kr/materials/42.webp',
    })

    // Then: the active host returns the persisted texture reference.
    expect(result).toEqual({
      kind: 'complete',
      textureUrl: 'asset://seamless-scene_material_42',
    })
    session.dispose()
  })

  test('reports an unavailable seamless action after the host session is disposed', async () => {
    // Given: a connected host seamless action that is subsequently disposed.
    const session = await connectEditorHostIntegration({
      materials: {
        search: async () => ({ items: [] }),
        makeSeamless: async () => ({ textureUrl: 'asset://seamless-unused' }),
      },
    })
    session.dispose()

    // When: the scene material UI requests another conversion.
    const result = await requestSceneMaterialSeamless({
      materialId: 'scene_material_42',
      textureUrl: 'https://intm.kr/materials/42.webp',
    })

    // Then: the UI receives a typed unavailable outcome instead of a runtime error.
    expect(result).toEqual({ kind: 'unavailable' })
  })

  test('registers INTM/RawPainter products in the existing Paint catalog and cleans them up', async () => {
    const searches: unknown[] = []
    const adapter: EditorHostIntegrationAdapter = {
      getContext: async () => ({ projectId: 'project-7', modelVersionId: 'version-3' }),
      materials: {
        search: async (input) => {
          searches.push(input)
          return {
            items: [
              {
                provider: 'rawpainter',
                externalId: '42',
                name: '600 x 1200 Limestone',
                category: 'stone',
                previewThumbnailUrl: 'https://intm.kr/materials/42-thumb.webp',
                physicalSize: { widthM: 0.6, heightM: 1.2 },
                commercial: {
                  brand: 'INTM Wood',
                  productCode: 'WOOD-42',
                  unitPrice: 3800,
                  unit: 'm',
                },
                constructionKinds: ['timber-stud'],
                appearance,
              },
            ],
          }
        },
      },
    }

    const session = await connectEditorHostIntegration(adapter)

    expect(searches).toEqual([
      {
        context: { projectId: 'project-7', modelVersionId: 'version-3' },
        cursor: null,
      },
    ])
    expect(getCatalogMaterialById('rawpainter:42')).toMatchObject({
      id: 'rawpainter:42',
      label: '600 x 1200 Limestone',
      category: 'stone',
      source: 'workspace',
      commercial: {
        brand: 'INTM Wood',
        productCode: 'WOOD-42',
        unitPrice: 3800,
        unit: 'm',
      },
      constructionKinds: ['timber-stud'],
      preset: appearance,
    })

    session.dispose()
    expect(getCatalogMaterialById('rawpainter:42')).toBeUndefined()
  })

  test('keeps standalone editing available when no host adapter is supplied', async () => {
    const session = await connectEditorHostIntegration(null)

    expect(session.context).toBeNull()
    expect(session.materialIds).toEqual([])
    session.dispose()
  })

  test('preserves semantic Annotation anchors across the host mutation contract', async () => {
    const received: unknown[] = []
    const adapter: EditorHostIntegrationAdapter = {
      annotations: {
        list: async () => [],
        upsert: async (mutation) => {
          received.push(mutation)
          return {
            ...mutation,
            id: 'annotation-1',
            revision: 'rev-1',
            createdAt: '2026-08-02T00:00:00.000Z',
            updatedAt: '2026-08-02T00:00:00.000Z',
          }
        },
      },
    }
    const mutation = {
      mutationId: 'mutation-1',
      projectId: 'project-7',
      modelVersionId: 'version-3',
      kind: 'issue' as const,
      status: 'open' as const,
      body: 'Confirm limestone direction',
      anchor: {
        kind: 'feature' as const,
        reference: {
          nodeId: 'body_1',
          featureId: 'face:0',
          parameters: { u: 0.6, v: 1.2 },
        },
        fallback: [0.6, 1.2, 0] as [number, number, number],
      },
    }

    await adapter.annotations?.upsert(mutation)

    expect(received).toEqual([mutation])
  })

  test('freezes an external catalog item into a portable scene material snapshot', () => {
    const frozen = freezeHostMaterialCatalogItem({
      id: 'rawpainter:42',
      label: '600 x 1200 Limestone',
      category: 'stone',
      source: 'workspace',
      previewThumbnailUrl: 'https://intm.kr/materials/42-thumb.webp',
      sourceRef: { provider: 'rawpainter', externalId: '42' },
      physicalSize: { widthM: 0.6, heightM: 1.2 },
      preset: appearance,
    })

    expect(frozen).toEqual({
      id: 'rawpainter:42',
      preset: 'custom',
      properties: {
        color: '#ffffff',
        roughness: 0.7,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
      source: { provider: 'rawpainter', externalId: '42' },
      physicalSize: { widthM: 0.6, heightM: 1.2 },
      texture: {
        url: 'https://intm.kr/materials/42.webp',
        repeat: [2, 1],
      },
    })
  })
})
