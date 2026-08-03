import { describe, expect, test } from 'bun:test'
import { CabinetModuleNode, CabinetNode } from '../../schema/nodes/cabinet'
import {
  importFurnitureBuilder,
  importFurnitureBuilderJson,
  metresToMillimetres,
  millimetresToMetres,
  normalizeFurniture,
} from './index'

async function fixture(name: string) {
  const file = Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url))
  return JSON.parse(await file.text()) as Record<string, unknown>
}

describe('cabinet baseline and furniture Gate 0/1 contracts', () => {
  test('legacy cabinet and cabinet-module fixtures still parse and round-trip', () => {
    const cabinet = CabinetNode.parse({
      id: 'cabinet_legacy',
      type: 'cabinet',
      width: 1.2,
      depth: 0.6,
      carcassHeight: 0.85,
      stack: [{ id: 'compartment_legacy', type: 'door', shelfCount: 2 }],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_legacy',
      type: 'cabinet-module',
      width: 0.6,
      depth: 0.6,
      stack: [{ id: 'compartment_module', type: 'drawer', drawerCount: 2 }],
    })

    expect(cabinet.furniture).toBeUndefined()
    expect(module.furnitureBay).toBeUndefined()
    expect(CabinetNode.parse(JSON.parse(JSON.stringify(cabinet)))).toEqual(cabinet)
    expect(CabinetModuleNode.parse(JSON.parse(JSON.stringify(module)))).toEqual(module)
  })

  test('legacy cabinet normalization produces a deterministic base-run assembly', () => {
    const cabinet = CabinetNode.parse({
      id: 'cabinet_normalize',
      type: 'cabinet',
      runTier: 'base',
      width: 1.2,
      depth: 0.6,
      carcassHeight: 0.85,
      stack: [{ id: 'compartment_legacy', type: 'door', shelfCount: 2 }],
    })

    const normalized = normalizeFurniture(cabinet)

    expect(normalized).toEqual(normalizeFurniture(normalized))
    expect(normalized.furnitureKind).toBe('base-run')
    expect(normalized.dimensions).toEqual({ width: 1.2, height: 0.85, depth: 0.6 })
    expect(normalized.bays).toHaveLength(1)
    expect(normalized.bays[0]?.tiers[0]?.front.kind).toBe('hinged')
  })

  test('imports all six representative JSON fixtures deterministically and idempotently', async () => {
    const names = [
      'wardrobe',
      'island',
      'set',
      'sink',
      'drawer-cabinet',
      'furniture-sample',
    ] as const
    const sources = await Promise.all(names.map((name) => fixture(name)))
    const imports = sources.map((source) => importFurnitureBuilder(source))

    expect(imports.every((result) => result.assembly !== null)).toBe(true)
    expect(imports.map((result) => result.assembly)).toEqual(
      sources.map((source) => importFurnitureBuilder(source).assembly),
    )
    for (const result of imports) {
      expect(result.assembly).not.toBeNull()
      if (result.assembly) expect(normalizeFurniture(result.assembly)).toEqual(result.assembly)
    }

    const wardrobe = imports[0].assembly
    const island = imports[1].assembly
    const set = imports[2].assembly
    const sink = imports[3].assembly
    const drawerCabinet = imports[4].assembly
    const furnitureSample = imports[5].assembly

    expect(wardrobe?.furnitureKind).toBe('wardrobe')
    expect(wardrobe?.bays).toHaveLength(2)
    expect(wardrobe?.bays[0]?.tiers[0]?.shelves.count).toBe(2)
    expect(wardrobe?.bays[0]?.tiers[0]?.hanger).toBe(true)

    expect(island?.furnitureKind).toBe('island')
    expect(island?.depthSplit).toEqual({ front: 0.4, back: 0.8 })
    expect(island?.backBays).toHaveLength(2)
    expect(island?.bays[0]?.tiers[0]?.face).toBe('both')

    expect(set?.furnitureKind).toBe('set')
    expect(set?.setUpper?.gap).toBe(0.1)
    expect(set?.upperBays).toHaveLength(2)

    expect(sink?.furnitureKind).toBe('sink')
    expect(sink?.fixtures.map((entry) => entry.type)).toEqual(['sink-bowl', 'induction'])
    expect(sink?.bays[0]?.tiers[0]?.fixtures.map((entry) => entry.type)).toEqual([
      'sink-bowl',
      'faucet',
    ])

    expect(drawerCabinet?.furnitureKind).toBe('base-run')
    expect(drawerCabinet?.bays).toHaveLength(1)
    expect(drawerCabinet?.bays[0]?.tiers[0]?.front).toMatchObject({ kind: 'drawer', count: 4 })
    expect(drawerCabinet?.bays[0]?.tiers[0]?.internalDrawers).toEqual({
      count: 1,
      heights: [0.12],
    })
    expect(drawerCabinet?.bays[0]?.tiers[1]?.front).toMatchObject({ kind: 'drawer', count: 2 })

    expect(furnitureSample?.furnitureKind).toBe('wardrobe')
    expect(furnitureSample?.bays[0]?.tiers[0]?.fixtures.map((entry) => entry.type)).toEqual([
      'light',
      'outlet',
      'smps',
    ])
    expect(furnitureSample?.bays[0]?.tiers[0]?.fixtures).toEqual([
      expect.objectContaining({
        id: 'light-under-shelf',
        type: 'light',
        mount: 'shelf',
        axis: 'length',
        shelfIndex: 2,
        inset: 0.03,
      }),
      expect.objectContaining({
        id: 'outlet-back',
        type: 'outlet',
        position: { x: 0.12, z: 0.48 },
        size: { width: 0.086, height: 0.086 },
      }),
      expect.objectContaining({
        id: 'smps-back',
        type: 'smps',
        position: { x: 0.24, z: 0.4 },
        size: { width: 0.2, depth: 0.04, height: 0.03 },
      }),
    ])
  })

  test('unsupported fields are returned as stable structured warnings', async () => {
    const source = await fixture('wardrobe')
    const firstTier = (source.bays as Array<Record<string, unknown>>)[0]?.tiers as Array<
      Record<string, unknown>
    >
    firstTier[0].futureRubyThing = { enabled: true }
    source.futureRootThing = true

    const result = importFurnitureBuilder(source)

    expect(result.assembly).not.toBeNull()
    expect(result.warnings).toEqual([
      {
        severity: 'warning',
        code: 'unsupported_field',
        path: 'bays[0].tiers[0].futureRubyThing',
        message: 'Unsupported Furniture Builder field "futureRubyThing".',
      },
      {
        severity: 'warning',
        code: 'unsupported_field',
        path: 'futureRootThing',
        message: 'Unsupported Furniture Builder field "futureRootThing".',
      },
    ])
  })

  test('millimetre/metre conversion round-trips within 0.1 mm', () => {
    for (const millimetres of [0, 0.1, 18, 50, 600, 2400, 20000]) {
      expect(
        Math.abs(metresToMillimetres(millimetresToMetres(millimetres)) - millimetres),
      ).toBeLessThanOrEqual(0.1)
    }
  })

  test('reports malformed JSON and invalid inputs without throwing', () => {
    expect(() => importFurnitureBuilderJson('{"type":')).not.toThrow()
    expect(importFurnitureBuilderJson('{"type":')).toMatchObject({
      assembly: null,
      warnings: [expect.objectContaining({ code: 'invalid_json' })],
    })

    expect(() => importFurnitureBuilder({})).not.toThrow()
    expect(importFurnitureBuilder({})).toMatchObject({
      assembly: null,
      warnings: [expect.objectContaining({ code: 'invalid_input' })],
    })

    expect(() => importFurnitureBuilderJson(42)).not.toThrow()
    expect(importFurnitureBuilderJson(42)).toMatchObject({
      assembly: null,
      warnings: [expect.objectContaining({ code: 'invalid_input' })],
    })
  })
})
