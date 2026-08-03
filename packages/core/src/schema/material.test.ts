import { describe, expect, test } from 'bun:test'
import { MaterialSchema } from './material'

describe('MaterialSchema', () => {
  describe('preset', () => {
    test('valid preset passes through unchanged', () => {
      const result = MaterialSchema.parse({ preset: 'brick' })
      expect(result.preset).toBe('brick')
    })

    test('every enum preset is accepted', () => {
      const presets = [
        'white',
        'brick',
        'concrete',
        'wood',
        'glass',
        'metal',
        'plaster',
        'tile',
        'marble',
        'custom',
      ] as const
      for (const preset of presets) {
        expect(MaterialSchema.parse({ preset }).preset).toBe(preset)
      }
    })

    test("unknown preset coerces to 'custom' instead of throwing (Sentry MONOREPO-EDITOR-DB)", () => {
      const result = MaterialSchema.parse({ preset: 'stone' })
      expect(result.preset).toBe('custom')
    })

    test("non-string preset coerces to 'custom'", () => {
      const result = MaterialSchema.parse({ preset: 42 })
      expect(result.preset).toBe('custom')
    })

    test('missing preset stays undefined', () => {
      const result = MaterialSchema.parse({})
      expect(result.preset).toBeUndefined()
    })

    test('explicit undefined preset stays undefined', () => {
      const result = MaterialSchema.parse({ preset: undefined })
      expect(result.preset).toBeUndefined()
    })
  })

  test('preserves external provider provenance and physical size for scene snapshots', () => {
    expect(
      MaterialSchema.parse({
        id: 'rawpainter:70225',
        preset: 'custom',
        source: {
          provider: 'rawpainter',
          externalId: '70225',
          revision: '2026-08-02T05:00:00.000Z',
        },
        physicalSize: { widthM: 1.16, heightM: 0.3 },
        texture: {
          url: '/api/materials/rawpainter/asset/70225',
          repeat: [1 / 1.16, 1 / 0.3],
        },
      }),
    ).toMatchObject({
      source: { provider: 'rawpainter', externalId: '70225' },
      physicalSize: { widthM: 1.16, heightM: 0.3 },
    })
  })
})
