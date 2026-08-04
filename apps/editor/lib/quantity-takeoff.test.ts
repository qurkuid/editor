import { describe, expect, test } from 'bun:test'
import { type AnyNode, createDefaultWallFaceBands, DEFAULT_WALL_HEIGHT } from '@pascal-app/core'
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
        { id: 'slab_a', type: 'slab', polygon: square },
        { id: 'ceiling_a', type: 'ceiling', polygon: square },
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
  test('fixtures aggregate per light type', () => {
    const report = deriveTakeoff(
      scene(
        { id: 'l1', type: 'lighting-fixture', lightType: 'point' },
        { id: 'l2', type: 'lighting-fixture', lightType: 'point' },
        { id: 'l3', type: 'lighting-fixture', lightType: 'spot' },
      ),
    )

    expect(line(report, 'lighting', 'point')?.quantity).toBe(2)
    expect(line(report, 'lighting', 'point')?.label).toBe('포인트 조명')
    expect(line(report, 'lighting', 'spot')?.quantity).toBe(1)
  })

  test('a divided run counts its full fixture count from one node', () => {
    const report = deriveTakeoff(
      scene(
        {
          id: 'run1',
          type: 'lighting-fixture',
          lightType: 'point',
          start: [0, 0],
          end: [3, 0],
          count: 5,
        },
        { id: 'l1', type: 'lighting-fixture', lightType: 'point' },
      ),
    )

    expect(line(report, 'lighting', 'point')?.quantity).toBe(6)
  })

  test('a linked product groups by its ref and carries it as materialRef', () => {
    const report = deriveTakeoff(
      scene(
        {
          id: 'l1',
          type: 'lighting-fixture',
          lightType: 'point',
          metadata: { productRef: 'intm:mat-1' },
        },
        { id: 'l2', type: 'lighting-fixture', lightType: 'point' },
      ),
    )

    const linked = line(report, 'lighting', 'intm:mat-1')
    expect(linked?.quantity).toBe(1)
    expect(linked?.materialRef).toBe('intm:mat-1')
    expect(line(report, 'lighting', 'point')?.quantity).toBe(1)
  })

  test('linear fixtures add a run-length measure', () => {
    const report = deriveTakeoff(
      scene({
        id: 'l1',
        type: 'lighting-fixture',
        lightType: 'linear',
        start: [0, 0],
        end: [3, 4],
      }),
    )

    const length = line(report, 'lighting', 'linear-length')
    expect(length?.quantity).toBeCloseTo(5)
    expect(length?.role).toBe('measure')
  })
})

describe('scoping', () => {
  test('a level filter excludes other levels', () => {
    const nodes = scene(
      {
        id: 'slab_a',
        type: 'slab',
        parentId: 'level_1',
        polygon: [
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
        polygon: [
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

describe('a wall expands into what actually gets ordered', () => {
  // Exactly what the wall tool stamps on every new wall — 각재 + 석고보드 + 마감.
  const wall = {
    id: 'wall_a',
    type: 'wall',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    thickness: 0.1,
    faceBands: createDefaultWallFaceBands(0.1),
  }

  test('the default build-up yields its materials, not just an area', () => {
    const labels = deriveTakeoff(scene(wall))
      .lines.filter((l) => l.category === 'wall')
      .map((l) => l.label)

    expect(labels.some((l) => l.includes('각재'))).toBe(true)
    expect(labels.some((l) => l.includes('석고보드'))).toBe(true)
  })

  test('각재 is ordered by the metre and 석고보드 by the sheet', () => {
    const lines = deriveTakeoff(scene(wall)).lines
    const stud = lines.find((l) => l.label.includes('각재'))
    const board = lines.find((l) => l.label.includes('석고보드'))

    expect(stud?.unit).toBe('m')
    expect(board?.unit).toBe('ea')
    // 4 m at 300 mm = 15 studs of 2.5 m, plus top and bottom plates, +10%.
    expect(stud?.quantity).toBeCloseTo((15 * 2.5 + 4 * 2) * 1.1)
    // One face, 10 m² over 900×1800 sheets, +10% → 6.79 → 7.
    expect(board?.quantity).toBe(7)
  })

  test('a cavity is not ordered — it is empty space', () => {
    const labels = deriveTakeoff(scene(wall)).lines.map((l) => l.label)
    expect(labels.some((l) => l.includes('공기층'))).toBe(false)
  })

  test('the same layer aggregates across walls', () => {
    const report = deriveTakeoff(scene(wall, { ...wall, id: 'wall_b' }))
    const stud = report.lines.find((l) => l.label.includes('각재'))
    expect(stud?.quantity).toBeCloseTo((15 * 2.5 + 4 * 2) * 1.1 * 2)
    expect(stud?.nodeIds).toEqual(['wall_a', 'wall_b'])
  })

  // Areas and lengths inform an order; they are not lines on one.
  test('face area and run length are marked as measures, materials are not', () => {
    const report = deriveTakeoff(scene(wall))
    expect(line(report, 'wall', 'face')?.role).toBe('measure')
    expect(line(report, 'wall', 'length')?.role).toBe('measure')
    expect(report.lines.find((l) => l.label.includes('석고보드'))?.role).toBe('material')
  })

  test('a wall with no build-up recorded still reports its area', () => {
    const report = deriveTakeoff(scene({ ...wall, faceBands: undefined }))
    expect(line(report, 'wall', 'face')?.quantity).toBeCloseTo(20)
    expect(report.lines.some((l) => l.label.includes('석고보드'))).toBe(false)
  })

  // The store and the build-up both stand an unset wall at DEFAULT_WALL_HEIGHT.
  // Measuring it as zero here dropped the face area of every such wall.
  test('a wall with no height set is measured at the same default core uses', () => {
    const report = deriveTakeoff(scene({ ...wall, height: undefined }))
    expect(line(report, 'wall', 'face')?.quantity).toBeCloseTo(4 * DEFAULT_WALL_HEIGHT * 2)
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

describe('floor and ceiling openings', () => {
  const square = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]

  // The schema field is `polygon`; reading `points` silently measured zero.
  test('area comes from the polygon field', () => {
    expect(
      deriveTakeoff(scene({ id: 'slab_a', type: 'slab', polygon: square })).totals.floor,
    ).toBeCloseTo(12)
  })

  test('holes are deducted — a stairwell is not floor', () => {
    const report = deriveTakeoff(
      scene({
        id: 'slab_a',
        type: 'slab',
        polygon: square,
        holes: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        ],
      }),
    )
    expect(report.totals.floor).toBeCloseTo(11)
  })

  test('holes larger than the slab clamp at zero rather than going negative', () => {
    const report = deriveTakeoff(
      scene({
        id: 'slab_a',
        type: 'slab',
        polygon: square,
        holes: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      }),
    )
    expect(report.totals.floor).toBe(0)
  })
})

describe('floor and ceiling build-up', () => {
  const square = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]

  test('a ceiling expands into furring and board, under the ceiling heading', () => {
    const report = deriveTakeoff(
      scene({
        id: 'ceiling_a',
        type: 'ceiling',
        polygon: square,
        construction: [
          {
            kind: 'furring',
            thickness: 0.03,
            memberWidth: 0.03,
            memberSpacing: 0.45,
            wasteFactor: 0,
          },
          {
            kind: 'gypsum-board',
            thickness: 0.0095,
            sheetWidth: 0.9,
            sheetHeight: 1.8,
            wasteFactor: 0,
          },
        ],
      }),
    )

    const furring = report.lines.find((l) => l.label.includes('각재'))
    const board = report.lines.find((l) => l.label.includes('석고보드'))
    expect(furring?.category).toBe('ceiling')
    expect(furring?.unit).toBe('m')
    expect(board?.category).toBe('ceiling')
    expect(board?.unit).toBe('ea')
    // 12㎡ over 1.62㎡ sheets = 7.4 → 8.
    expect(board?.quantity).toBe(8)
  })

  // Screed is poured, so it is bought by volume — not by area, not by sheet.
  test('floor screed is measured by volume', () => {
    const report = deriveTakeoff(
      scene({
        id: 'slab_a',
        type: 'slab',
        polygon: square,
        construction: [{ kind: 'screed', thickness: 0.05, wasteFactor: 0 }],
      }),
    )

    const screed = report.lines.find((l) => l.label.includes('방통'))
    expect(screed?.category).toBe('floor')
    expect(screed?.unit).toBe('m3')
    expect(screed?.quantity).toBeCloseTo(12 * 0.05)
  })

  test('holes reduce the build-up too, not just the headline area', () => {
    const withHole = deriveTakeoff(
      scene({
        id: 'slab_a',
        type: 'slab',
        polygon: square,
        holes: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        ],
        construction: [{ kind: 'screed', thickness: 0.05, wasteFactor: 0 }],
      }),
    )
    expect(withHole.lines.find((l) => l.unit === 'm3')?.quantity).toBeCloseTo(11 * 0.05)
  })

  test('a surface with no construction still reports its area', () => {
    const report = deriveTakeoff(scene({ id: 'slab_a', type: 'slab', polygon: square }))
    expect(report.totals.floor).toBeCloseTo(12)
  })
})
