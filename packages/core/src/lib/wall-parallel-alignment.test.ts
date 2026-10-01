import { describe, expect, test } from 'bun:test'
import { LevelNode, WallNode } from '../schema'
import { buildWallParallelAlignmentUpdates, WallOperationError } from './wall-operations'

type Point = [number, number]

function makeWall(
  id: string,
  parentId: string | null,
  start: Point,
  end: Point,
  extra: Record<string, unknown> = {},
) {
  return WallNode.parse({ id, parentId, start, end, ...extra })
}

function makeAlignmentScene({
  selectedStart = [0, 0] as Point,
  selectedEnd = [1, 0.01] as Point,
  referenceStart = [0, 0] as Point,
  referenceEnd = [-2, 0] as Point,
  selectedExtra = {},
  referenceExtra = {},
  referenceParentId,
  extras = [],
  reverseInsertion = false,
}: {
  selectedStart?: Point
  selectedEnd?: Point
  referenceStart?: Point
  referenceEnd?: Point
  selectedExtra?: Record<string, unknown>
  referenceExtra?: Record<string, unknown>
  referenceParentId?: string | null
  extras?: ReturnType<typeof makeWall>[]
  reverseInsertion?: boolean
} = {}) {
  const level = LevelNode.parse({ id: 'level_parallel_main', children: [] })
  const alternateLevel = LevelNode.parse({ id: 'level_parallel_other', children: [] })
  const selected = makeWall(
    'wall_parallel_selected',
    level.id,
    selectedStart,
    selectedEnd,
    selectedExtra,
  )
  const reference = makeWall(
    'wall_parallel_reference',
    referenceParentId === undefined ? level.id : referenceParentId,
    referenceStart,
    referenceEnd,
    referenceExtra,
  )
  const nodes: Record<string, ReturnType<typeof makeWall> | typeof level> = {
    [level.id]: level,
    [alternateLevel.id]: alternateLevel,
    [selected.id]: selected,
    [reference.id]: reference,
  }
  if (reference.parentId === alternateLevel.id) {
    nodes[alternateLevel.id] = LevelNode.parse({
      ...alternateLevel,
      children: [reference.id],
    })
  }
  for (const extra of extras) nodes[extra.id] = extra
  if (reverseInsertion) {
    return Object.fromEntries(Object.entries(nodes).reverse())
  }
  return nodes
}

function expectWallError(action: () => unknown, code: string) {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(WallOperationError)
  expect((caught as WallOperationError).code).toBe(code)
}

test('aligns the grounded crooked continuation and follows its free-end link', () => {
  const level = LevelNode.parse({
    id: 'level_parallel_grounded',
    children: [
      'wall_9d671l2wsc0l2z0i',
      'wall_spwze3zf32wqvlss',
      'wall_gga4jfp1oa10dy2g',
      'wall_ev1580n36u0mzfek',
    ],
  })
  const reference = WallNode.parse({
    id: 'wall_9d671l2wsc0l2z0i',
    parentId: level.id,
    start: [2.293701352710663, -3.378765764859558],
    end: [3.2932013527106627, -3.378765764859558],
  })
  const fixedCornerBranch = WallNode.parse({
    id: 'wall_spwze3zf32wqvlss',
    parentId: level.id,
    start: [3.2932013527106627, -3.378765764859558],
    end: [3.2932013527106627, -4.535565764859558],
  })
  const linked = WallNode.parse({
    id: 'wall_gga4jfp1oa10dy2g',
    parentId: level.id,
    start: [3.756621646873569, -3.384311150829128],
    end: [3.783104453799753, -2.9072578479807465],
  })
  const selected = WallNode.parse({
    id: 'wall_ev1580n36u0mzfek',
    parentId: level.id,
    start: [3.2932013527106627, -3.378765764859558],
    end: [3.756621646873569, -3.384311150829128],
  })
  const nodes = {
    [level.id]: level,
    [reference.id]: reference,
    [fixedCornerBranch.id]: fixedCornerBranch,
    [linked.id]: linked,
    [selected.id]: selected,
  }

  const updates = buildWallParallelAlignmentUpdates(nodes, selected.id)

  expect(updates[0]).toEqual({
    id: selected.id,
    data: {
      end: [3.7566548243209055, -3.378765764859558],
    },
  })
  expect(updates.find((update) => update.id === linked.id)?.data).toEqual({
    start: [3.7566548243209055, -3.378765764859558],
    end: linked.end,
  })
  expect(updates.find((update) => update.id === reference.id)).toBeUndefined()
  expect(updates.find((update) => update.id === fixedCornerBranch.id)).toBeUndefined()
  expect(
    Math.hypot(
      ...((updates[0]?.data.end as [number, number]).map(
        (value, index) => value - selected.start[index],
      ) as [number, number]),
    ),
  ).toBeCloseTo(
    Math.hypot(selected.end[0] - selected.start[0], selected.end[1] - selected.start[1]),
    12,
  )
})

describe('wall parallel alignment candidate resolution', () => {
  test('supports a shared start or end joint in either authored direction', () => {
    const startNodes = makeAlignmentScene({
      selectedStart: [0, 0],
      selectedEnd: [2, 0.02],
      referenceStart: [0, 0],
      referenceEnd: [-3, 0],
    })
    const startUpdates = buildWallParallelAlignmentUpdates(
      startNodes,
      'wall_parallel_selected' as never,
    )
    expect(startUpdates[0]?.data.start).toBeUndefined()
    expect(startUpdates[0]?.data.end?.[0]).toBeCloseTo(Math.hypot(2, 0.02), 12)
    expect(startUpdates[0]?.data.end?.[1]).toBeCloseTo(0, 12)

    const endNodes = makeAlignmentScene({
      selectedStart: [2, 0.02],
      selectedEnd: [0, 0],
      referenceStart: [-3, 0],
      referenceEnd: [0, 0],
    })
    const endUpdates = buildWallParallelAlignmentUpdates(
      endNodes,
      'wall_parallel_selected' as never,
    )
    expect(endUpdates[0]?.data.start?.[0]).toBeCloseTo(Math.hypot(2, 0.02), 12)
    expect(endUpdates[0]?.data.start?.[1]).toBeCloseTo(0, 12)
    expect(endUpdates[0]?.data.end).toBeUndefined()
  })

  test('uses the actual candidate axis when a shared endpoint is epsilon-close', () => {
    const candidateJoint: Point = [5e-7, -5e-7]
    const candidateFree: Point = [-2, 0.001]
    const nodes = makeAlignmentScene({
      selectedStart: [0, 0],
      selectedEnd: [1, 0],
      referenceStart: candidateJoint,
      referenceEnd: candidateFree,
    })
    const updates = buildWallParallelAlignmentUpdates(nodes, 'wall_parallel_selected' as never)
    const expectedDirection = [
      (candidateFree[0] - candidateJoint[0]) /
        Math.hypot(candidateFree[0] - candidateJoint[0], candidateFree[1] - candidateJoint[1]),
      (candidateFree[1] - candidateJoint[1]) /
        Math.hypot(candidateFree[0] - candidateJoint[0], candidateFree[1] - candidateJoint[1]),
    ]
    expect(updates[0]?.data.end).toEqual([-expectedDirection[0], -expectedDirection[1]])
    expect(updates.find((update) => update.id === 'wall_parallel_reference')).toBeUndefined()
  })

  test('accepts the two-degree limit and rejects a bend just beyond it', () => {
    const limitNodes = makeAlignmentScene({
      selectedEnd: [1, Math.tan((2 * Math.PI) / 180)],
    })
    expect(() =>
      buildWallParallelAlignmentUpdates(limitNodes, 'wall_parallel_selected' as never),
    ).not.toThrow()

    const aboveLimitNodes = makeAlignmentScene({
      selectedEnd: [1, Math.tan((2.001 * Math.PI) / 180)],
    })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(aboveLimitNodes, 'wall_parallel_selected' as never),
      'no-parallel-continuation',
    )
  })

  test.each([
    ['perpendicular branch', { referenceEnd: [0, 2] as Point }],
    ['same-direction overlap', { referenceEnd: [2, 0] as Point }],
    [
      'endpoint to selected interior',
      {
        selectedEnd: [2, 0] as Point,
        referenceStart: [0.5, 0] as Point,
        referenceEnd: [-2, 0] as Point,
      },
    ],
    ['curved candidate', { referenceExtra: { curveOffset: 0.2 } }],
    ['different-parent candidate', { referenceParentId: 'level_parallel_other' }],
  ])('%s is not a qualifying continuation', (_label, options) => {
    const nodes = makeAlignmentScene(options)
    expectWallError(
      () => buildWallParallelAlignmentUpdates(nodes, 'wall_parallel_selected' as never),
      'no-parallel-continuation',
    )
  })

  test('fails closed for zero and multiple qualifying candidates regardless of insertion order', () => {
    const noCandidate = makeAlignmentScene({ referenceEnd: [0, 2] })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(noCandidate, 'wall_parallel_selected' as never),
      'no-parallel-continuation',
    )

    const secondReference = makeWall(
      'wall_parallel_reference_second',
      'level_parallel_main',
      [0, 0],
      [-3, -0.01],
    )
    for (const reverseInsertion of [false, true]) {
      const nodes = makeAlignmentScene({ extras: [secondReference], reverseInsertion })
      expectWallError(
        () => buildWallParallelAlignmentUpdates(nodes, 'wall_parallel_selected' as never),
        'ambiguous-parallel-continuation',
      )
    }
  })

  test('rejects invalid selected walls and an already aligned result', () => {
    const zero = makeAlignmentScene({ selectedEnd: [0, 0] })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(zero, 'wall_parallel_selected' as never),
      'zero-length-wall',
    )

    const noParent = makeAlignmentScene({
      referenceParentId: null,
      selectedExtra: { parentId: null },
    })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(noParent, 'wall_parallel_selected' as never),
      'wall-no-parent',
    )

    const curved = makeAlignmentScene({ selectedExtra: { curveOffset: 0.2 } })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(curved, 'wall_parallel_selected' as never),
      'curved-wall',
    )

    const aligned = makeAlignmentScene({ selectedEnd: [1, 0] })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(aligned, 'wall_parallel_selected' as never),
      'already-parallel',
    )
  })
})

describe('wall parallel alignment staging and validation', () => {
  test('moves every linked free-end wall to one coordinate and updates hosted item wallT', () => {
    const linkedStart = makeWall(
      'wall_parallel_linked_start',
      'level_parallel_main',
      [1, 0.01],
      [2, 1],
    )
    const linkedEnd = makeWall('wall_parallel_linked_end', 'level_parallel_main', [2, 2], [1, 0.01])
    const item = {
      id: 'item_parallel_linked',
      type: 'item' as const,
      parentId: linkedStart.id,
      wallId: linkedStart.id,
      position: [0.25, 0, 0] as [number, number, number],
      wallT: 0.5,
      asset: {
        id: 'asset_parallel',
        category: 'cabinet' as const,
        name: 'Cabinet',
        thumbnail: '',
        src: 'asset://parallel-cabinet',
        dimensions: [0.4, 0.8, 0.3] as [number, number, number],
        attachTo: 'wall' as const,
      },
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      visible: true,
      metadata: {},
      children: [],
      object: 'node' as const,
    }
    const nodes = makeAlignmentScene({ extras: [linkedStart, linkedEnd, item as never] })
    const updates = buildWallParallelAlignmentUpdates(nodes, 'wall_parallel_selected' as never)
    const linkedStartUpdate = updates.find((update) => update.id === linkedStart.id)
    const linkedEndUpdate = updates.find((update) => update.id === linkedEnd.id)
    expect(linkedStartUpdate?.data.start).toEqual(updates[0]?.data.end)
    expect(linkedEndUpdate?.data.end).toEqual(updates[0]?.data.end)
    expect(updates.find((update) => update.id === item.id)?.data.wallT).toBeDefined()
    expect(updates.map((update) => update.id)).toEqual([
      'wall_parallel_selected',
      'wall_parallel_linked_end',
      'wall_parallel_linked_start',
      'item_parallel_linked',
    ])
  })

  test.each([
    [
      'linked wall collapse',
      { linkedEnd: [1.0000499987500624, 0] as Point },
      'detached-wall-junction',
    ],
    ['linked wall reversal', { linkedEnd: [1, 0.005] as Point }, 'reversed-wall'],
    ['curved linked wall', { linkedExtra: { curveOffset: 0.2 } }, 'curved-wall'],
  ])('%s is atomic', (_label, options, code) => {
    const linked = makeWall(
      'wall_parallel_linked_invalid',
      'level_parallel_main',
      [1, 0.01],
      options.linkedEnd ?? [2, 1],
      options.linkedExtra,
    )
    const nodes = makeAlignmentScene({ extras: [linked] })
    const before = JSON.stringify(nodes)
    expectWallError(
      () => buildWallParallelAlignmentUpdates(nodes, 'wall_parallel_selected' as never),
      code,
    )
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('rejects a detached interior T contact and an attachment outside the final host', () => {
    const branch = makeWall('wall_parallel_branch', 'level_parallel_main', [0.5, 0.005], [0.5, 1])
    const tNodes = makeAlignmentScene({ extras: [branch] })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(tNodes, 'wall_parallel_selected' as never),
      'detached-wall-junction',
    )

    const linked = makeWall(
      'wall_parallel_linked_attachment',
      'level_parallel_main',
      [1, 0.01],
      [1, -0.01],
    )
    const door = {
      id: 'door_parallel_attachment',
      type: 'door' as const,
      parentId: linked.id,
      wallId: linked.id,
      position: [0.005, 0, 0] as [number, number, number],
      width: 0.1,
      children: [],
      visible: true,
      metadata: {},
      object: 'node' as const,
    }
    const attachmentNodes = makeAlignmentScene({
      extras: [linked, door as never],
    })
    expectWallError(
      () => buildWallParallelAlignmentUpdates(attachmentNodes, 'wall_parallel_selected' as never),
      'attachment-outside-wall',
    )
  })
})
