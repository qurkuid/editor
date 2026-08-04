import { describe, expect, test } from 'bun:test'
import type { AnyNode, MaterialSchema } from '@pascal-app/core'
import {
  applySurfaceTextureTransform,
  countSceneMaterialSlotUses,
  readSurfaceTextureTransform,
} from './surface-texture-transform'

const texturedMaterial: MaterialSchema = {
  preset: 'custom',
  physicalSize: { widthM: 1.2, heightM: 0.6 },
  texture: {
    url: 'asset://bookmatch-abc',
    repeat: [1 / 1.2, 1 / 0.6],
  },
} as MaterialSchema

describe('wall surface texture transform', () => {
  test('round-trips placement through the material texture config', () => {
    // Given: a placement moved 300mm right, 150mm up, resized, and rotated.
    const transform = {
      offsetXM: 0.3,
      offsetYM: 0.15,
      tileWidthM: 2.4,
      tileHeightM: 1.2,
      rotationDeg: 90,
    }

    // When: the placement is applied and read back.
    const applied = applySurfaceTextureTransform(texturedMaterial, transform)
    const read = readSurfaceTextureTransform(applied)

    // Then: the physical placement survives the UV encoding exactly.
    expect(read?.offsetXM).toBeCloseTo(0.3)
    expect(read?.offsetYM).toBeCloseTo(0.15)
    expect(read?.tileWidthM).toBeCloseTo(2.4)
    expect(read?.tileHeightM).toBeCloseTo(1.2)
    expect(read?.rotationDeg).toBe(90)
    // And: the physical size follows the tile so world-scale repeat stays true.
    expect(applied.physicalSize).toEqual({ widthM: 2.4, heightM: 1.2 })
  })

  test('reads an untouched material as identity placement', () => {
    // Given: a freshly painted material with no placement edits.
    const read = readSurfaceTextureTransform(texturedMaterial)

    // Then: origin placement at the material's physical tile size.
    expect(read?.offsetXM).toBeCloseTo(0)
    expect(read?.offsetYM).toBeCloseTo(0)
    expect(read?.tileWidthM).toBeCloseTo(1.2)
    expect(read?.tileHeightM).toBeCloseTo(0.6)
    expect(read?.rotationDeg).toBe(0)
  })

  test('returns null for a texture-less material', () => {
    expect(readSurfaceTextureTransform({ preset: 'custom' } as MaterialSchema)).toBeNull()
  })

  test('normalizes rotation and clamps degenerate tile sizes', () => {
    // Given: a rotation past a full turn and a zero tile width.
    const applied = applySurfaceTextureTransform(texturedMaterial, {
      offsetXM: 0,
      offsetYM: 0,
      tileWidthM: 0,
      tileHeightM: 1,
      rotationDeg: 450,
    })

    // Then: rotation wraps to 90° and the tile floors at 10mm.
    expect(applied.texture?.rotationDeg).toBe(90)
    expect(applied.physicalSize?.widthM).toBeCloseTo(0.01)
  })

  test('counts slot references so shared materials fork instead of mutating', () => {
    // Given: one material shared by two wall slots and unrelated refs elsewhere.
    const nodes = {
      wall_a: { id: 'wall_a', type: 'wall', slots: { interior: 'scene:mat_1' } },
      wall_b: {
        id: 'wall_b',
        type: 'wall',
        slots: { interior: 'scene:mat_1', exterior: 'scene:mat_2' },
      },
      wall_c: { id: 'wall_c', type: 'wall' },
    } as unknown as Record<string, AnyNode>

    // Then: only exact scene refs to that material count.
    expect(countSceneMaterialSlotUses(nodes, 'mat_1' as never)).toBe(2)
    expect(countSceneMaterialSlotUses(nodes, 'mat_2' as never)).toBe(1)
  })
})
