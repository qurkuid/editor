import { describe, expect, test } from 'bun:test'
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
    expect(first.dimensions).toEqual({ width: 1.2, height: 2.4, depth: 0.6 })
    expect(first.bays.map((bay) => bay.width)).toEqual([0.6, 0.6])
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
    const assembly = createDefaultFurnitureAssembly({ bayCount: 2 })
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
    const assembly = createDefaultFurnitureAssembly()
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
