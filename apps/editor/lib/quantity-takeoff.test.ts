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
