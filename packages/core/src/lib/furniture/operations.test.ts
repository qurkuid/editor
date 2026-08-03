import { describe, expect, test } from 'bun:test'
import type { FurnitureKind } from '../../schema/nodes/furniture'
import {
  createDefaultFurnitureAssembly,
  deleteFurnitureBay,
  deleteFurnitureTier,
  insertFurnitureBay,
  insertFurnitureTier,
  resizeFurnitureAssembly,
  resizeFurnitureBay,
  resizeFurnitureTier,
  setFurnitureKind,
  setFurnitureTierFront,
  setFurnitureTierInterior,
} from './operations'

describe('furniture direct and AI operation contract', () => {
  test('creates a deterministic normalized assembly with equal bays', () => {
    const first = createDefaultFurnitureAssembly({ bayCount: 2 })
    const second = createDefaultFurnitureAssembly({ bayCount: 2 })

    expect(first).toEqual(second)
    expect(first.dimensions).toEqual({ width: 2.4, height: 2.4, depth: 0.6 })
    expect(first.bays.map((bay) => bay.width)).toEqual([1.2, 1.2])
    expect(first.bays.map((bay) => bay.id)).toEqual(['bay-0', 'bay-1'])
  })

  test('resizes total dimensions and preserves bay proportions and semantic IDs', () => {
    const assembly = createDefaultFurnitureAssembly({ bayCount: 2 })
    const resized = resizeFurnitureAssembly(assembly, { width: 2.4, height: 2.6, depth: 0.7 })

    expect(resized.dimensions).toEqual({ width: 2.4, height: 2.6, depth: 0.7 })
    expect(resized.bays.map((bay) => bay.width)).toEqual([1.2, 1.2])
    expect(resized.bays.map((bay) => bay.id)).toEqual(assembly.bays.map((bay) => bay.id))
  })

  test('changes kind without changing the rest of the normalized assembly', () => {
    const assembly = createDefaultFurnitureAssembly()
    const changed = setFurnitureKind(assembly, 'island')

    expect(changed).toEqual({ ...assembly, furnitureKind: 'island' })
  })

  test('rejects invalid dimensions and bay counts', () => {
    expect(() => createDefaultFurnitureAssembly({ bayCount: 0 })).toThrow(RangeError)
    expect(() => createDefaultFurnitureAssembly({ bayCount: 1.5 })).toThrow(RangeError)
    expect(() => resizeFurnitureAssembly(createDefaultFurnitureAssembly(), { width: 0 })).toThrow()
  })

  test('sets evenly spaced shelves and hanger state by stable bay and tier IDs', () => {
    const assembly = createDefaultFurnitureAssembly({ bayCount: 2 })
    const targetBay = assembly.bays[1]
    const targetTier = targetBay.tiers[0]
    const changed = setFurnitureTierInterior(assembly, {
      bayId: targetBay.id,
      tierId: targetTier.id,
      shelfCount: 3,
      hanger: true,
    })

    expect(changed.bays[0]).toBe(assembly.bays[0])
    expect(changed.bays[1].id).toBe(targetBay.id)
    expect(changed.bays[1].tiers[0].id).toBe(targetTier.id)
    expect(changed.bays[1].tiers[0].shelves).toEqual({
      count: 3,
      heights: [targetTier.height / 4, targetTier.height / 2, (targetTier.height * 3) / 4],
    })
    expect(changed.bays[1].tiers[0].hanger).toBe(true)
    expect(changed.dimensions).toBe(assembly.dimensions)
    expect(changed.materialDefaults).toBe(assembly.materialDefaults)
  })

  test('supports zero through eight shelves and treats identical input as a no-op', () => {
    let assembly = createDefaultFurnitureAssembly()
    const bayId = assembly.bays[0].id
    const tierId = assembly.bays[0].tiers[0].id

    for (let shelfCount = 0; shelfCount <= 8; shelfCount += 1) {
      assembly = setFurnitureTierInterior(assembly, { bayId, tierId, shelfCount, hanger: false })
      const tier = assembly.bays[0].tiers[0]
      expect(tier.shelves.count).toBe(shelfCount)
      expect(tier.shelves.heights).toHaveLength(shelfCount)
      expect(
        tier.shelves.heights.every(
          (height, index) => height === (tier.height * (index + 1)) / (shelfCount + 1),
        ),
      ).toBe(true)
    }

    expect(
      setFurnitureTierInterior(assembly, { bayId, tierId, shelfCount: 8, hanger: false }),
    ).toBe(assembly)
  })

  test('rejects invalid counts and missing stable targets', () => {
    const assembly = createDefaultFurnitureAssembly()
    const options = {
      bayId: assembly.bays[0].id,
      tierId: assembly.bays[0].tiers[0].id,
      hanger: false,
    }

    expect(() => setFurnitureTierInterior(assembly, { ...options, shelfCount: -1 })).toThrow(
      RangeError,
    )
    expect(() => setFurnitureTierInterior(assembly, { ...options, shelfCount: 9 })).toThrow(
      RangeError,
    )
    expect(() => setFurnitureTierInterior(assembly, { ...options, shelfCount: 1.5 })).toThrow(
      RangeError,
    )
    expect(() => setFurnitureTierInterior(assembly, { ...options, bayId: 'missing' })).toThrow(
      RangeError,
    )
    expect(() => setFurnitureTierInterior(assembly, { ...options, tierId: 'missing' })).toThrow(
      RangeError,
    )
  })

  test('sets a tier front by stable bay and tier IDs and treats identical input as a no-op', () => {
    const assembly = createDefaultFurnitureAssembly({ bayCount: 2 })
    const targetBay = assembly.bays[1]
    const targetTier = targetBay.tiers[0]
    const changed = setFurnitureTierFront(assembly, {
      bayId: targetBay.id,
      tierId: targetTier.id,
      front: { kind: 'drawer', count: 3, color: '' },
    })

    expect(changed.bays[0]).toBe(assembly.bays[0])
    expect(changed.bays[1].id).toBe(targetBay.id)
    expect(changed.bays[1].tiers[0].id).toBe(targetTier.id)
    expect(changed.bays[1].tiers[0].front).toEqual({ kind: 'drawer', count: 3, color: '' })
    expect(changed.dimensions).toBe(assembly.dimensions)

    expect(
      setFurnitureTierFront(changed, {
        bayId: targetBay.id,
        tierId: targetTier.id,
        front: { kind: 'drawer', count: 3, color: '' },
      }),
    ).toBe(changed)
  })

  test('rejects invalid fronts and missing stable targets', () => {
    const assembly = createDefaultFurnitureAssembly()
    const options = { bayId: assembly.bays[0].id, tierId: assembly.bays[0].tiers[0].id }

    expect(() =>
      setFurnitureTierFront(assembly, { ...options, front: { kind: 'drawer', count: 9 } as never }),
    ).toThrow()
    expect(() =>
      setFurnitureTierFront(assembly, {
        ...options,
        bayId: 'missing',
        front: { kind: 'open', color: '' },
      }),
    ).toThrow(RangeError)
    expect(() =>
      setFurnitureTierFront(assembly, {
        ...options,
        tierId: 'missing',
        front: { kind: 'open', color: '' },
      }),
    ).toThrow(RangeError)
  })

  test('inserts, resizes, and deletes bays without changing total width or stable IDs', () => {
    const assembly = createDefaultFurnitureAssembly({
      bayCount: 2,
      dimensions: { width: 1.2, height: 2.4, depth: 0.6 },
    })
    const inserted = insertFurnitureBay(assembly, { afterBayId: 'bay-0', newWidth: 0.2 })

    expect(inserted.bays.map((bay) => bay.id)).toEqual(['bay-0', 'bay-0-copy', 'bay-1'])
    expect(inserted.bays[0].width).toBeCloseTo(0.4)
    expect(inserted.bays[1].width).toBeCloseTo(0.2)
    expect(inserted.bays[2].width).toBeCloseTo(0.6)
    expect(inserted.bays.reduce((sum, bay) => sum + bay.width, 0)).toBeCloseTo(1.2)
    expect(inserted.bays[2]).toBe(assembly.bays[1])
    expect(new Set(inserted.bays.flatMap((bay) => bay.tiers.map((tier) => tier.id))).size).toBe(3)

    const resized = resizeFurnitureBay(inserted, { bayId: 'bay-0-copy', width: 0.3 })
    expect(resized.bays[0].width).toBeCloseTo(0.4)
    expect(resized.bays[1].width).toBeCloseTo(0.3)
    expect(resized.bays[2].width).toBeCloseTo(0.5)
    expect(resizeFurnitureBay(resized, { bayId: 'bay-0-copy', width: 0.3 })).toBe(resized)

    const deleted = deleteFurnitureBay(resized, { bayId: 'bay-0-copy' })
    expect(deleted.bays.map((bay) => bay.id)).toEqual(['bay-0', 'bay-1'])
    expect(deleted.bays[0].width).toBeCloseTo(0.7)
    expect(deleted.bays[1].width).toBeCloseTo(0.5)
    expect(deleted.dimensions).toBe(resized.dimensions)
  })

  test('creates collision-free deterministic IDs across repeated bay inserts', () => {
    const assembly = createDefaultFurnitureAssembly()
    const once = insertFurnitureBay(assembly, { afterBayId: 'bay-0' })
    const twice = insertFurnitureBay(once, { afterBayId: 'bay-0' })

    expect(twice.bays.map((bay) => bay.id)).toEqual(['bay-0', 'bay-0-copy-2', 'bay-0-copy'])
    expect(new Set(twice.bays.map((bay) => bay.id)).size).toBe(3)
    expect(new Set(twice.bays.flatMap((bay) => bay.tiers.map((tier) => tier.id))).size).toBe(3)
  })

  test('inserts, resizes, and deletes tiers while scaling interior positions', () => {
    const base = createDefaultFurnitureAssembly()
    const bayId = base.bays[0].id
    const tierId = base.bays[0].tiers[0].id
    const furnished = setFurnitureTierInterior(base, {
      bayId,
      tierId,
      shelfCount: 2,
      hanger: true,
    })
    const originalHeight = furnished.bays[0].tiers[0].height
    const inserted = insertFurnitureTier(furnished, {
      bayId,
      afterTierId: tierId,
      newHeight: originalHeight * 0.4,
    })

    expect(inserted.bays[0].tiers.map((tier) => tier.id)).toEqual([tierId, `${tierId}-copy`])
    expect(inserted.bays[0].tiers.reduce((sum, tier) => sum + tier.height, 0)).toBeCloseTo(
      originalHeight,
    )
    expect(inserted.bays[0].tiers[0].shelves.heights[0]).toBeCloseTo(originalHeight * 0.2)
    expect(inserted.bays[0].tiers[0].shelves.heights[1]).toBeCloseTo(originalHeight * 0.4)

    const resized = resizeFurnitureTier(inserted, {
      bayId,
      tierId,
      height: originalHeight * 0.5,
    })
    expect(resized.bays[0].tiers[0].height).toBeCloseTo(originalHeight * 0.5)
    expect(resized.bays[0].tiers[1].height).toBeCloseTo(originalHeight * 0.5)
    expect(resizeFurnitureTier(resized, { bayId, tierId, height: originalHeight * 0.5 })).toBe(
      resized,
    )

    const deleted = deleteFurnitureTier(resized, { bayId, tierId: `${tierId}-copy` })
    expect(deleted.bays[0].tiers).toHaveLength(1)
    expect(deleted.bays[0].tiers[0].id).toBe(tierId)
    expect(deleted.bays[0].tiers[0].height).toBeCloseTo(originalHeight)
  })

  test('rejects missing, invalid, impossible, and final structural edits before mutation', () => {
    const assembly = createDefaultFurnitureAssembly({
      dimensions: { width: 1.2, height: 2.4, depth: 0.6 },
    })
    const bayId = assembly.bays[0].id
    const tierId = assembly.bays[0].tiers[0].id

    expect(() => insertFurnitureBay(assembly, { afterBayId: 'missing' })).toThrow(RangeError)
    expect(() => insertFurnitureBay(assembly, { afterBayId: bayId, newWidth: 2 })).toThrow(
      RangeError,
    )
    expect(() => deleteFurnitureBay(assembly, { bayId })).toThrow(RangeError)
    expect(() => resizeFurnitureBay(assembly, { bayId, width: 0.4 })).toThrow(RangeError)
    expect(() =>
      insertFurnitureTier(assembly, { bayId, afterTierId: tierId, newHeight: 0 }),
    ).toThrow(RangeError)
    expect(() => deleteFurnitureTier(assembly, { bayId, tierId })).toThrow(RangeError)
    expect(() => resizeFurnitureTier(assembly, { bayId, tierId, height: 1 })).toThrow(RangeError)
    expect(assembly.bays).toHaveLength(1)
    expect(assembly.bays[0].tiers).toHaveLength(1)
  })
})

describe('createDefaultFurnitureAssembly per-kind defaults', () => {
  test('wardrobe is a full-height plinth cabinet with a hanger and one shelf', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'wardrobe' })

    expect(assembly.dimensions).toEqual({ width: 2.4, height: 2.4, depth: 0.6 })
    expect(assembly.bays[0].base).toEqual({ type: 'plinth', height: 0.05 })
    expect(assembly.bays[0].kickplate).toBe(true)
    expect(assembly.bays[0].tiers).toHaveLength(1)
    expect(assembly.bays[0].tiers[0].hanger).toBe(true)
    expect(assembly.bays[0].tiers[0].shelves.count).toBe(1)
  })

  test('base-run is counter height with a plinth base and one shelf, no hanger', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'base-run' })

    expect(assembly.dimensions).toEqual({ width: 1.8, height: 0.85, depth: 0.6 })
    expect(assembly.bays[0].base.type).toBe('plinth')
    expect(assembly.bays[0].tiers).toHaveLength(1)
    expect(assembly.bays[0].tiers[0].hanger).toBe(false)
    expect(assembly.bays[0].tiers[0].shelves.count).toBe(1)
  })

  test('upper-run is a shallow wall-hung cabinet with no plinth or kickplate', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'upper-run' })

    expect(assembly.dimensions).toEqual({ width: 1.8, height: 0.72, depth: 0.35 })
    expect(assembly.bays[0].base).toEqual({ type: 'floating', height: 0 })
    expect(assembly.bays[0].kickplate).toBe(false)
    expect(assembly.bays[0].tiers).toHaveLength(1)
    expect(assembly.bays[0].tiers[0].shelves.count).toBe(2)
  })

  test('tall is a narrow two-tier cabinet with shelves in both tiers', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'tall' })

    expect(assembly.dimensions).toEqual({ width: 0.6, height: 2.1, depth: 0.6 })
    expect(assembly.bays[0].tiers).toHaveLength(2)
    expect(assembly.bays[0].tiers[0].height).toBeCloseTo(0.6)
    expect(assembly.bays[0].tiers[1].height).toBeCloseTo(1.4)
    expect(assembly.bays[0].tiers[0].shelves.count).toBeGreaterThan(0)
    expect(assembly.bays[0].tiers[1].shelves.count).toBeGreaterThan(0)
  })

  test('island is counter height with extra depth and one shelf', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island' })

    expect(assembly.dimensions).toEqual({ width: 1.8, height: 0.85, depth: 0.9 })
    expect(assembly.bays[0].tiers).toHaveLength(1)
    expect(assembly.bays[0].tiers[0].shelves.count).toBe(1)
  })

  test('set is a full-height cabinet with a lower and upper tier separated by an invisible gap', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'set' })

    expect(assembly.dimensions).toEqual({ width: 1.8, height: 2.4, depth: 0.6 })
    expect(assembly.bays[0].tiers).toHaveLength(3)
    expect(assembly.bays[0].tiers[0].height).toBeCloseTo(0.85)
    expect(assembly.bays[0].tiers[1].visible).toBe(false)
    expect(assembly.bays[0].tiers[2].height).toBeCloseTo(0.72)
    const totalHeight = assembly.bays[0].tiers.reduce((sum, tier) => sum + tier.height, 0)
    expect(totalHeight).toBeCloseTo(assembly.dimensions.height - assembly.bays[0].base.height)
  })

  test('sink is counter height with an open front', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'sink' })

    expect(assembly.dimensions).toEqual({ width: 0.9, height: 0.85, depth: 0.6 })
    expect(assembly.bays[0].tiers).toHaveLength(1)
    expect(assembly.bays[0].tiers[0].front.kind).toBe('open')
  })

  test('different kinds produce structurally different assemblies', () => {
    const kinds: FurnitureKind[] = [
      'wardrobe',
      'base-run',
      'upper-run',
      'tall',
      'island',
      'set',
      'sink',
    ]
    const assemblies = kinds.map((kind) => createDefaultFurnitureAssembly({ furnitureKind: kind }))
    const signatures = assemblies.map((assembly) =>
      JSON.stringify({
        dimensions: assembly.dimensions,
        base: assembly.bays[0].base,
        kickplate: assembly.bays[0].kickplate,
        tiers: assembly.bays[0].tiers.map((tier) => ({
          height: tier.height,
          hanger: tier.hanger,
          shelves: tier.shelves.count,
          visible: tier.visible,
          front: tier.front.kind,
        })),
      }),
    )

    expect(new Set(signatures).size).toBe(kinds.length)
  })

  test('explicit dimensions and bay count still win over kind defaults', () => {
    const assembly = createDefaultFurnitureAssembly({
      furnitureKind: 'upper-run',
      dimensions: { width: 3, height: 1, depth: 0.5 },
      bayCount: 3,
    })

    expect(assembly.dimensions).toEqual({ width: 3, height: 1, depth: 0.5 })
    expect(assembly.bays).toHaveLength(3)
  })
})

describe('island two-sided defaults and face-addressed operations', () => {
  test('seeds a mirrored back row and a depthSplit that sums to the overall depth', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island' })

    expect(assembly.depthSplit).toEqual({ front: 0.27, back: 0.63 })
    expect(assembly.depthSplit!.front + assembly.depthSplit!.back).toBeCloseTo(
      assembly.dimensions.depth,
    )
    expect(assembly.backBays).toHaveLength(assembly.bays.length)
    expect(assembly.backBays?.[0]?.id).not.toBe(assembly.bays[0].id)
    expect(assembly.backBays?.[0]?.width).toBeCloseTo(assembly.bays[0].width)
    expect(assembly.backBays?.[0]?.base).toEqual(assembly.bays[0].base)
    expect(assembly.backBays?.[0]?.kickplate).toBe(assembly.bays[0].kickplate)
    expect(assembly.backBays?.[0]?.tiers[0]?.shelves).toEqual(assembly.bays[0].tiers[0]?.shelves)
  })

  test('other kinds stay front-only — no backBays or depthSplit seeded', () => {
    const kinds: FurnitureKind[] = ['wardrobe', 'base-run', 'upper-run', 'tall', 'set', 'sink']

    for (const kind of kinds) {
      const assembly = createDefaultFurnitureAssembly({ furnitureKind: kind })
      expect(assembly.backBays).toBeUndefined()
      expect(assembly.depthSplit).toBeUndefined()
    }
  })

  test('face-addressed tier interior and front edits mutate only the targeted face', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island' })
    const backBay = assembly.backBays![0]!
    const backTier = backBay.tiers[0]!

    const interiorChanged = setFurnitureTierInterior(assembly, {
      bayId: backBay.id,
      tierId: backTier.id,
      shelfCount: 3,
      hanger: true,
      face: 'back',
    })
    expect(interiorChanged.bays).toBe(assembly.bays)
    expect(interiorChanged.backBays?.[0]?.tiers[0]?.shelves.count).toBe(3)
    expect(interiorChanged.backBays?.[0]?.tiers[0]?.hanger).toBe(true)

    const frontChanged = setFurnitureTierFront(assembly, {
      bayId: backBay.id,
      tierId: backTier.id,
      front: { kind: 'hinged', leaves: 2, glass: false, color: '' },
      face: 'back',
    })
    expect(frontChanged.bays).toBe(assembly.bays)
    expect(frontChanged.backBays?.[0]?.tiers[0]?.front).toEqual({
      kind: 'hinged',
      leaves: 2,
      glass: false,
      color: '',
    })
  })

  test('face-addressed bay insert, resize, and delete mutate only the targeted face', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island', bayCount: 2 })
    const backBayId = assembly.backBays![0]!.id

    const inserted = insertFurnitureBay(assembly, { afterBayId: backBayId, face: 'back' })
    expect(inserted.bays).toBe(assembly.bays)
    expect(inserted.backBays).toHaveLength(3)

    const resized = resizeFurnitureBay(inserted, {
      bayId: inserted.backBays![1]!.id,
      width: 0.3,
      face: 'back',
    })
    expect(resized.bays).toBe(inserted.bays)
    expect(resized.backBays?.[1]?.width).toBeCloseTo(0.3)

    const deleted = deleteFurnitureBay(resized, {
      bayId: resized.backBays![1]!.id,
      face: 'back',
    })
    expect(deleted.bays).toBe(resized.bays)
    expect(deleted.backBays).toHaveLength(2)
  })

  test('face-addressed tier insert, resize, and delete mutate only the targeted face', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island' })
    const backBayId = assembly.backBays![0]!.id
    const backTierId = assembly.backBays![0]!.tiers[0]!.id

    const inserted = insertFurnitureTier(assembly, {
      bayId: backBayId,
      afterTierId: backTierId,
      face: 'back',
    })
    expect(inserted.bays).toBe(assembly.bays)
    expect(inserted.backBays?.[0]?.tiers).toHaveLength(2)

    const resized = resizeFurnitureTier(inserted, {
      bayId: backBayId,
      tierId: backTierId,
      height: 0.2,
      face: 'back',
    })
    expect(resized.bays).toBe(inserted.bays)
    expect(resized.backBays?.[0]?.tiers[0]?.height).toBeCloseTo(0.2)

    const deleted = deleteFurnitureTier(resized, {
      bayId: backBayId,
      tierId: `${backTierId}-copy`,
      face: 'back',
    })
    expect(deleted.bays).toBe(resized.bays)
    expect(deleted.backBays?.[0]?.tiers).toHaveLength(1)
  })

  test('resizeFurnitureAssembly scales the back row width in step with the front row', () => {
    const assembly = createDefaultFurnitureAssembly({ furnitureKind: 'island' })
    const resized = resizeFurnitureAssembly(assembly, { width: 3.6 })

    expect(resized.bays[0].width).toBeCloseTo(3.6)
    expect(resized.backBays?.[0]?.width).toBeCloseTo(3.6)
  })
})
