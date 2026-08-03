import { describe, expect, test } from 'bun:test'
import { resizeMaterialPhysicalSize } from './material-size'
import type { MaterialSchema } from './schema/material'

describe('material physical size', () => {
  test('updates texture repeat when the real material dimensions change', () => {
    // Given: a repeatable RawPainter texture sized at 1200 by 600 millimetres.
    const material: MaterialSchema = {
      preset: 'custom',
      physicalSize: { widthM: 1.2, heightM: 0.6 },
      texture: { url: '/api/materials/rawpainter/asset/70225', repeat: [1 / 1.2, 1 / 0.6] },
    }

    // When: the user changes its real size to 600 by 300 millimetres.
    const resized = resizeMaterialPhysicalSize(material, { widthM: 0.6, heightM: 0.3 })

    // Then: physical size and world-scale repeats change together.
    expect(resized).toEqual({
      ...material,
      physicalSize: { widthM: 0.6, heightM: 0.3 },
      texture: { ...material.texture, repeat: [1 / 0.6, 1 / 0.3] },
    })
  })

  test('stores dimensions without inventing a texture for color-only materials', () => {
    // Given: a color-only material with no image.
    const material: MaterialSchema = { preset: 'custom' }

    // When: the user records a physical size.
    const resized = resizeMaterialPhysicalSize(material, { widthM: 0.4, heightM: 0.2 })

    // Then: only the physical metadata is added.
    expect(resized).toEqual({
      preset: 'custom',
      physicalSize: { widthM: 0.4, heightM: 0.2 },
    })
  })
})
