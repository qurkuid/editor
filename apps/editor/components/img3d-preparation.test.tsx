import { describe, expect, test } from 'bun:test'
import type { AssetInput } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { Img3dPreparation, validateImg3dReference } from './img3d-preparation'
import { generateImg3dAsset, parseImg3dDimensions, readImg3dReference } from './img3d-workflow'

const sculpt = {
  version: 1 as const,
  name: 'Chair',
  materials: [{ name: 'wood', color: '#8b5e3c', roughness: 0.7, metalness: 0, slot: null }],
  parts: [
    {
      name: 'seat',
      primitive: 'box' as const,
      material: 0,
      position: [0, 0.45, 0] as const,
      rotation: [0, 0, 0] as const,
      size: [1.2, 0.1, 0.6] as const,
    },
  ],
}

describe('Img3dPreparation', () => {
  test('renders the img3d leading tile contract', () => {
    const markup = renderToStaticMarkup(<Img3dPreparation />)

    expect(markup).toContain('>img3d<')
    expect(markup).toContain('aria-label="img3d 열기"')
  })

  test('accepts only one supported reference image up to 5MB', () => {
    const markup = renderToStaticMarkup(<Img3dPreparation />)

    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"')
    expect(markup).not.toContain('multiple=""')
    expect(validateImg3dReference(new File(['image'], 'chair.webp', { type: 'image/webp' }))).toBe(
      null,
    )
    expect(
      validateImg3dReference(new File(['model'], 'chair.glb', { type: 'model/gltf-binary' })),
    ).not.toBe(null)
    expect(
      validateImg3dReference(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
      ),
    ).not.toBe(null)
  })

  test('parses finite positive metre dimensions within the endpoint contract', () => {
    expect(parseImg3dDimensions({ width: '1.2', height: '0.9', depth: '0.6' })).toEqual({
      width: 1.2,
      height: 0.9,
      depth: 0.6,
    })
    expect(parseImg3dDimensions({ width: '0', height: '0.9', depth: '0.6' })).toBe(null)
    expect(parseImg3dDimensions({ width: '1.2', height: 'Infinity', depth: '0.6' })).toBe(null)
    expect(parseImg3dDimensions({ width: '1.2', height: '0.9', depth: '100.001' })).toBe(null)
  })

  test('converts a valid reference into the request image payload', async () => {
    const image = await readImg3dReference(
      new File(['chair'], 'chair.webp', { type: 'image/webp' }),
    )

    expect(image).toEqual({
      name: 'chair.webp',
      mimeType: 'image/webp',
      dataUrl: 'data:image/webp;base64,Y2hhaXI=',
    })
  })

  test('persists a generated GLB before handing the asset to item placement', async () => {
    const calls: string[] = []
    let requestBody: unknown
    let placedAsset: AssetInput | null = null
    const file = new File(['chair'], 'chair.png', { type: 'image/png' })
    const dimensions = { width: 1.2, height: 0.9, depth: 0.6 }

    await generateImg3dAsset(
      { file, dimensions },
      {
        request: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body))
          return new Response(JSON.stringify(sculpt), { status: 200 })
        },
        compile: async (_parsedSculpt, options) => {
          calls.push(`compile:${options.assetId}`)
          return {
            glb: new Blob(['glb'], { type: 'model/gltf-binary' }),
            asset: {
              id: options.assetId,
              category: 'img3d',
              name: 'Chair',
              thumbnail: options.thumbnail,
              src: `asset://${options.assetId}`,
              dimensions: [1.2, 0.9, 0.6],
              source: 'mine',
            },
            metadata: { version: 1, partCount: 1, slots: [] },
          }
        },
        save: async (assetId) => {
          calls.push(`save:${assetId}`)
          return `asset://${assetId}`
        },
        createId: () => 'generated-chair',
        place: (asset) => {
          calls.push(`place:${asset.id}`)
          placedAsset = asset
        },
      },
    )

    expect(requestBody).toEqual({
      image: {
        name: 'chair.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,Y2hhaXI=',
      },
      dimensions,
      provider: 'codex',
      model: null,
      effort: null,
    })
    expect(calls).toEqual([
      'compile:generated-chair',
      'save:generated-chair',
      'place:generated-chair',
    ])
    expect(placedAsset?.src).toBe('asset://generated-chair')
  })

  test('surfaces a server failure without arming placement', async () => {
    let placementCount = 0

    const result = generateImg3dAsset(
      {
        file: new File(['chair'], 'chair.png', { type: 'image/png' }),
        dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
      },
      {
        request: async () =>
          new Response(JSON.stringify({ error: 'ai_failed', message: '로그인이 필요합니다.' }), {
            status: 503,
          }),
        compile: async () => {
          throw new Error('compile must not run')
        },
        save: async () => 'asset://unused',
        createId: () => 'unused',
        place: () => {
          placementCount += 1
        },
      },
    )

    expect(result).rejects.toThrow('로그인이 필요합니다.')
    expect(placementCount).toBe(0)
  })
})
