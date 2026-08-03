import { describe, expect, test } from 'bun:test'
import type { MaterialSchema, SceneMaterial, SceneMaterialId } from '@pascal-app/core'
import { resolveCeilingSurfaceInput } from './materials'

const rawPainterMaterial: MaterialSchema = {
  id: 'rawpainter:70225',
  preset: 'custom',
  properties: {
    color: '#ffffff',
    roughness: 0.7,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  source: { provider: 'rawpainter', externalId: '70225' },
  physicalSize: { widthM: 1.16, heightM: 0.3 },
  texture: {
    url: '/api/materials/rawpainter/asset/70225',
    repeat: [1 / 1.16, 1 / 0.3],
  },
}

describe('ceiling material resolution', () => {
  test('keeps a selected RawPainter texture when preparing the ceiling underside', () => {
    // Given: a RawPainter material selected directly from the catalog.
    // When: the ceiling renderer prepares it for the underside face.
    const input = resolveCeilingSurfaceInput(rawPainterMaterial, undefined, undefined)

    // Then: the texture scale survives and only the rendered face changes.
    expect(input).toEqual({
      kind: 'material',
      material: {
        ...rawPainterMaterial,
        properties: { ...rawPainterMaterial.properties, side: 'back' },
      },
    })
  })

  test('resolves a committed scene material without dropping its RawPainter texture', () => {
    // Given: the same RawPainter material after Paint commits it to the scene palette.
    const id = 'material_rawpainter' as SceneMaterialId
    const sceneMaterial: SceneMaterial = { id, name: 'CV20_화이트', material: rawPainterMaterial }

    // When: the ceiling slot resolves its scene reference.
    const input = resolveCeilingSurfaceInput(undefined, `scene:${id}`, { [id]: sceneMaterial })

    // Then: the persisted texture remains the rendered ceiling input.
    expect(input).toMatchObject({
      kind: 'material',
      material: {
        source: { provider: 'rawpainter', externalId: '70225' },
        texture: { url: '/api/materials/rawpainter/asset/70225' },
        properties: { side: 'back' },
      },
    })
  })
})
