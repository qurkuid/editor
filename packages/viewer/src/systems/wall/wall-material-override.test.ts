// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { MeshStandardMaterial } from 'three'
import { hasWallMaterialOverride, markWallMaterialOverride } from './wall-materials'

describe('wall material override claim', () => {
  test('only a claimed material array reports an override', () => {
    const cached = [new MeshStandardMaterial(), new MeshStandardMaterial()]
    expect(hasWallMaterialOverride(cached)).toBe(false)

    const ghosted = cached.map((material) => markWallMaterialOverride(material.clone()))
    expect(hasWallMaterialOverride(ghosted)).toBe(true)
    // The claim must not leak back into the shared cached array.
    expect(hasWallMaterialOverride(cached)).toBe(false)

    // Paint preview swaps a single slot of the current array; the claim survives.
    const painted = ghosted.slice()
    painted[0] = new MeshStandardMaterial()
    expect(hasWallMaterialOverride(painted)).toBe(true)
  })
})
