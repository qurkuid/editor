import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { deriveTakeoff, type TakeoffCategory } from './quantity-takeoff'

function scene(...nodes: Array<Record<string, unknown>>): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id as string, n as unknown as AnyNode]))
}

function line(report: ReturnType<typeof deriveTakeoff>, category: TakeoffCategory, key: string) {
  return report.lines.find((l) => l.category === category && l.key === key)
}

describe('board takeoff', () => {
  test('a module counts sides, top, bottom, back and shelves', () => {
    // 1 × 0.5 × 2 m box: sides 2×0.5×2=2, top/bottom 2×1×0.5=1, back 1×2=2,
    // two shelves 2×1×0.5=1 → 6 m².
    const report = deriveTakeoff(
      scene({
        id: 'cabinet-module_a',
        type: 'cabinet-module',
        parentId: 'cabinet_a',
        width: 1,
        depth: 0.5,
        carcassHeight: 2,
        boardThickness: 0.018,
        stack: [{ id: 'c', type: 'shelf', shelfCount: 2 }],
      }),
    )

    expect(line(report, 'board', 'carcass-0.018')?.quantity).toBeCloseTo(6)
  })

  test('door and drawer faces are counted as front board, open shelving is not', () => {
    const withDoor = deriveTakeoff(
      scene({
        id: 'cabinet-module_a',
        type: 'cabinet-module',
        width: 1,
        depth: 0.5,
        carcassHeight: 2,
        stack: [{ id: 'c', type: 'door' }],
      }),
    )
    const openOnly = deriveTakeoff(
      scene({
        id: 'cabinet-module_b',
        type: 'cabinet-module',
        width: 1,
        depth: 0.5,
        carcassHeight: 2,
        stack: [{ id: 'c', type: 'shelf' }],
      }),
    )

    expect(withDoor.lines.some((l) => l.key.startsWith('front-'))).toBe(true)
    expect(openOnly.lines.some((l) => l.key.startsWith('front-'))).toBe(false)
  })

  test('a degenerate module contributes nothing rather than a zero-area line', () => {
    const report = deriveTakeoff(
      scene({ id: 'cabinet-module_a', type: 'cabinet-module', width: 0, depth: 0.5 }),
    )
    expect(report.lines).toHaveLength(0)
  })
})

describe('furniture and countertop', () => {
  test('a run reports itself, its bays, and its worktop area', () => {
    const report = deriveTakeoff(
      scene(
        {
          id: 'cabinet_a',
          type: 'cabinet',
          runTier: 'base',
          name: 'Base Cabinets',
          depth: 0.6,
          withCountertop: true,
          children: ['cabinet-module_a', 'cabinet-module_b'],
        },
        {
          id: 'cabinet-module_a',
          type: 'cabinet-module',
          width: 0.9,
          depth: 0.6,
          carcassHeight: 0.7,
        },
        {
          id: 'cabinet-module_b',
          type: 'cabinet-module',
          width: 0.6,
          depth: 0.6,
          carcassHeight: 0.7,
        },
      ),
    )

    expect(line(report, 'furniture', 'base')?.quantity).toBe(1)
    expect(line(report, 'furniture', 'bay')?.quantity).toBe(2)
    // 1.5 m of run × 0.6 m deep.
    expect(line(report, 'board', 'countertop')?.quantity).toBeCloseTo(0.9)
  })

  test('a run without a worktop reports no countertop', () => {
    const report = deriveTakeoff(
      scene({ id: 'cabinet_a', type: 'cabinet', withCountertop: false, children: [] }),
    )
    expect(line(report, 'board', 'countertop')).toBeUndefined()
  })
})

describe('areas and finishes', () => {
  test('floor and ceiling areas come from their polygons', () => {
    const square = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const report = deriveTakeoff(
      scene(
        { id: 'slab_a', type: 'slab', points: square },
        { id: 'ceiling_a', type: 'ceiling', points: square },
      ),
    )

    expect(report.totals.floor).toBeCloseTo(12)
    expect(report.totals.ceiling).toBeCloseTo(12)
  })

  test('painted wall faces group by material, not by wall', () => {
    const report = deriveTakeoff(
      scene(
        {
          id: 'wall_a',
          type: 'wall',
          start: [0, 0],
          end: [4, 0],
          height: 2.5,
          slots: { interior: 'library:paint-white', exterior: 'library:brick' },
        },
        {
          id: 'wall_b',
          type: 'wall',
          start: [0, 0],
          end: [2, 0],
          height: 2.5,
          slots: { interior: 'library:paint-white' },
        },
      ),
    )

    // 4×2.5 + 2×2.5 = 15 m² of the same paint, across two walls.
    const paint = line(report, 'finish', 'library:paint-white')
    expect(paint?.quantity).toBeCloseTo(15)
    expect(paint?.nodeIds).toEqual(['wall_a', 'wall_b'])
    expect(line(report, 'finish', 'library:brick')?.quantity).toBeCloseTo(10)
  })

  test('unpainted walls contribute no finish line', () => {
    const report = deriveTakeoff(
      scene({ id: 'wall_a', type: 'wall', start: [0, 0], end: [4, 0], height: 2.5 }),
    )
    expect(report.totals.finish).toBe(0)
  })
})

describe('lighting', () => {
  test('fixtures aggregate per kind', () => {
    const report = deriveTakeoff(
      scene(
        { id: 'l1', type: 'lighting-fixture', fixtureKind: 'downlight' },
        { id: 'l2', type: 'lighting-fixture', fixtureKind: 'downlight' },
        { id: 'l3', type: 'lighting-fixture', fixtureKind: 'pendant' },
      ),
    )

    expect(line(report, 'lighting', 'downlight')?.quantity).toBe(2)
    expect(line(report, 'lighting', 'pendant')?.quantity).toBe(1)
    expect(report.totals.lighting).toBe(3)
  })
})

describe('scoping', () => {
  test('a level filter excludes other levels', () => {
    const nodes = scene(
      {
        id: 'slab_a',
        type: 'slab',
        parentId: 'level_1',
        points: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
      {
        id: 'slab_b',
        type: 'slab',
        parentId: 'level_2',
        points: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
    )

    expect(deriveTakeoff(nodes, { levelId: 'level_1' }).totals.floor).toBeCloseTo(4)
    expect(deriveTakeoff(nodes).totals.floor).toBeCloseTo(20)
  })
})

describe('walls are a quantity even before anyone picks a finish', () => {
  const wall = {
    id: 'wall_a',
    type: 'wall',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
  }

  test('an unpainted wall still reports face area and length', () => {
    const report = deriveTakeoff(scene(wall))

    // Both faces: 4 m × 2.5 m × 2.
    expect(line(report, 'wall', 'face')?.quantity).toBeCloseTo(20)
    expect(line(report, 'wall', 'length')?.quantity).toBeCloseTo(4)
    expect(report.totals.finish).toBe(0)
  })

  test('painting it adds finish lines without removing the wall quantity', () => {
    const report = deriveTakeoff(scene({ ...wall, slots: { interior: 'library:paint-white' } }))

    expect(line(report, 'wall', 'face')?.quantity).toBeCloseTo(20)
    expect(line(report, 'finish', 'library:paint-white')?.quantity).toBeCloseTo(10)
  })

  test('wall areas aggregate across walls', () => {
    const report = deriveTakeoff(scene(wall, { ...wall, id: 'wall_b', end: [2, 0] }))
    expect(line(report, 'wall', 'face')?.quantity).toBeCloseTo(30)
    expect(line(report, 'wall', 'length')?.quantity).toBeCloseTo(6)
  })
})

describe('placed models', () => {
  test('items count per product, aggregating duplicates', () => {
    const report = deriveTakeoff(
      scene(
        { id: 'item_1', type: 'item', asset: { name: '식탁', category: 'furniture' } },
        { id: 'item_2', type: 'item', asset: { name: '식탁', category: 'furniture' } },
        { id: 'item_3', type: 'item', asset: { name: '스툴', category: 'furniture' } },
      ),
    )

    expect(line(report, 'item', 'furniture:식탁')?.quantity).toBe(2)
    expect(line(report, 'item', 'furniture:스툴')?.quantity).toBe(1)
    expect(report.totals.item).toBe(3)
  })

  test('an item with no asset metadata still gets counted', () => {
    const report = deriveTakeoff(scene({ id: 'item_1', type: 'item' }))
    expect(report.totals.item).toBe(1)
  })
})

describe('furniture run make-up', () => {
  function run(...widths: number[]) {
    const ids = widths.map((_, i) => `cabinet-module_${i}`)
    return scene(
      {
        id: 'cabinet_a',
        type: 'cabinet',
        runTier: 'tall',
        name: '붙박이장',
        depth: 0.6,
        children: ids,
      },
      ...widths.map((width, i) => ({
        id: ids[i],
        type: 'cabinet-module',
        width,
        depth: 0.6,
        carcassHeight: 2.4,
      })),
    )
  }

  test('reports total run length alongside the bay count', () => {
    const report = deriveTakeoff(run(0.6, 0.6, 0.45))

    expect(line(report, 'furniture', 'run-length')?.quantity).toBeCloseTo(1.65)
    expect(line(report, 'furniture', 'run-length')?.unit).toBe('m')
    expect(line(report, 'furniture', 'bay')?.quantity).toBe(3)
  })

  // A shop cuts and prices by bay width, so equal bays aggregate.
  test('bays group by width', () => {
    const report = deriveTakeoff(run(0.6, 0.6, 0.6, 0.45, 0.45))

    expect(line(report, 'furniture', 'bay-600')?.quantity).toBe(3)
    expect(line(report, 'furniture', 'bay-450')?.quantity).toBe(2)
  })

  test('a run with no bays reports no length or make-up', () => {
    const report = deriveTakeoff(scene({ id: 'cabinet_a', type: 'cabinet', children: [] }))
    expect(line(report, 'furniture', 'run-length')).toBeUndefined()
  })
})
