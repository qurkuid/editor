import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applyHeightPatch,
  createTerrainField,
  DoorNode as DoorSchema,
  encodeTerrainField,
  flattenPatch,
  GROUND_SUPPORT_ID,
  runAsSingleSceneHistoryStep,
  spatialGridManager,
  useScene,
  type WallNode,
  WallNode as WallSchema,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  createWallOnCurrentLevel,
  type GuideSnapLine,
  resolveEndpointWallSplit,
  resolveTerrainWallConstructionOptions,
  resolveWallEndpointPoint,
  snapPointToGuides,
  snapWallDraftPointDetailed,
} from './wall-drafting'
import type { WallPlanPoint } from './wall-snap-geometry'

// `updateNodes` batches its dirty-marking through requestAnimationFrame,
// which bun's test runtime doesn't provide.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

const LEVEL_ID = 'level_test' as AnyNodeId

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id: string): WallNode {
  return {
    ...WallSchema.parse({ start, end, name: id }),
    id: id as WallNode['id'],
    parentId: LEVEL_ID,
  }
}

function seedLevel(walls: WallNode[], extraNodes: AnyNode[] = []) {
  useScene.setState({
    nodes: Object.fromEntries([
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: walls.map((wall) => wall.id),
          level: 0,
        } as AnyNode,
      ],
      ...walls.map((wall) => [wall.id, wall] as const),
      ...extraNodes.map((node) => [node.id, node] as const),
    ]),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall',
  )
}

describe('createWallOnCurrentLevel', () => {
  beforeEach(() => {
    useViewer.setState({
      selection: {
        buildingId: 'building_test',
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    // 'lines' keeps the generous commit-time join radius; the other modes
    // still resolve + split within the tight connect radius (covered by the
    // grid-mode cases below). A reshaping-endpoint scope resolves to the
    // 'wall' context without needing the node registry (which isn't loaded in
    // this package's tests).
    useEditor.getState().setSnappingMode('wall', 'lines')
    useInteractionScope
      .getState()
      .begin({ kind: 'reshaping', nodeId: 'wall_a', reshape: 'endpoint', driver: 'tool' })
    seedLevel([makeWall([0, 0], [4, 0], 'wall_a')])
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('a direction-locked wall keeps its endpoint near a host corner', () => {
    const created = createWallOnCurrentLevel([3.99, 2], [3.99, 0], {
      preserveDirection: true,
    })
    expect(created?.start).toEqual([3.99, 2])
    expect(created?.end).toEqual([3.99, 0])
  })

  test('endpoint near an existing corner attaches to the corner instead of splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [3.99, 0])

    expect(created?.end).toEqual([4, 0])
    const hostWall = useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode | undefined
    expect(hostWall?.start).toEqual([0, 0])
    expect(hostWall?.end).toEqual([4, 0])
    expect(levelWalls()).toHaveLength(2)
  })

  test('new walls start with a single 100 mm concrete layer', () => {
    const created = createWallOnCurrentLevel([2, 2], [3, 2])

    expect(created?.faceBands?.construction?.upper?.layers).toEqual([
      { kind: 'concrete', thickness: 0.1, wasteFactor: 0 },
    ])
    expect(created?.thickness).toBeCloseTo(0.1)
  })

  test('committed wall preserves the ghost construction elevation on ground', () => {
    const created = createWallOnCurrentLevel([2, 2], [3, 2], {
      supportCap: 1.75,
      preferredSupportSlabId: GROUND_SUPPORT_ID,
      constructionElevation: 1.75,
      constructionHeight: 2.5,
    })

    expect(created?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(created?.supportOffset).toBe(1.75)
    expect(created?.height).toBe(2.5)
    const support = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      created?.start ?? [0, 0],
      created?.end ?? [0, 0],
      created?.curveOffset,
      created?.thickness,
      created?.supportSlabId,
      undefined,
      created?.supportOffset,
    )
    expect(support.elevation).toBe(1.75)
  })

  test('2D terrain construction options freeze the first-point elevation and wall height', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [-2, -2] })
    const patch = flattenPatch(field, { minX: -2, minZ: -2, maxX: 2, maxZ: 2 }, 1.5)
    if (!patch) throw new Error('Expected terrain patch')
    const terrain = applyHeightPatch(field, patch)
    const site = {
      id: 'site_test',
      type: 'site',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_test'],
      terrain: encodeTerrainField(terrain),
    } as unknown as AnyNode
    const building = {
      id: 'building_test',
      type: 'building',
      object: 'node',
      parentId: site.id,
      visible: true,
      metadata: {},
      children: [LEVEL_ID],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    } as AnyNode
    const level = {
      id: LEVEL_ID,
      type: 'level',
      object: 'node',
      parentId: building.id,
      visible: true,
      metadata: {},
      children: [],
      level: 0,
      height: 3,
    } as AnyNode
    const nodes = Object.fromEntries([site, building, level].map((node) => [node.id, node]))

    expect(resolveTerrainWallConstructionOptions(nodes, LEVEL_ID, [0, 0])).toEqual({
      constructionElevation: 1.5,
      constructionHeight: 3,
      supportCap: 1.5,
    })
    expect(
      resolveTerrainWallConstructionOptions(nodes, LEVEL_ID, [0, 0], { height: 2.25 }),
    ).toEqual({
      constructionElevation: 1.5,
      constructionHeight: 2.25,
      supportCap: 1.5,
    })
  })

  test('endpoint near the host start corner snaps there without splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [0.015, 0])

    expect(created?.end).toEqual([0, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('genuine mid-wall endpoint still splits the host (T junction)', () => {
    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    const walls = levelWalls()
    expect(walls).toHaveLength(3)
    expect(
      walls.some((wall) => wall.start[0] === 0 && wall.end[0] === 2 && wall.end[1] === 0),
    ).toBe(true)
    expect(
      walls.some((wall) => wall.start[0] === 2 && wall.start[1] === 0 && wall.end[0] === 4),
    ).toBe(true)
  })

  test('exact duplicate segment is rejected', () => {
    expect(createWallOnCurrentLevel([0, 0], [4, 0])).toBeNull()
    expect(levelWalls()).toHaveLength(1)
  })

  test('grid mode: endpoint resolved onto a wall body still splits the host', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    expect(levelWalls()).toHaveLength(3)
  })

  test('grid mode: endpoint beyond the connect radius is left alone (no residual snap)', () => {
    useEditor.getState().setSnappingMode('wall', 'grid')

    const created = createWallOnCurrentLevel([2, 2], [2, 0.2])

    expect(created?.end).toEqual([2, 0.2])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('mid-span split migrates the host attachments to the covering half', () => {
    const door = DoorSchema.parse({
      position: [1, 1.05, 0],
      parentId: 'wall_a',
      wallId: 'wall_a',
    })
    seedLevel([{ ...makeWall([0, 0], [4, 0], 'wall_a'), children: [door.id] }], [door as AnyNode])

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    const walls = levelWalls()
    const firstHalf = walls.find((wall) => wall.start[0] === 0 && wall.end[0] === 2)
    expect(firstHalf).toBeDefined()
    const migratedDoor = useScene.getState().nodes[door.id as AnyNodeId]
    expect(migratedDoor?.parentId).toBe(firstHalf?.id)
    expect(firstHalf?.children).toContain(door.id)
  })

  test('a splitting commit lands as a single undo step', () => {
    const before = useScene.temporal.getState().pastStates.length

    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created).not.toBeNull()
    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
  })
})

describe('resolveEndpointWallSplit', () => {
  beforeEach(() => {
    seedLevel([makeWall([0, 0], [4, 0], 'wall_host'), makeWall([2, 2], [2, 1], 'wall_moved')])
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('endpoint dropped mid-span splits the host and returns the projection', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0.02],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeUndefined()
    const walls = levelWalls()
    expect(walls).toHaveLength(3)
    expect(
      walls.some((wall) => wall.start[0] === 0 && wall.end[0] === 2 && wall.end[1] === 0),
    ).toBe(true)
    expect(
      walls.some((wall) => wall.start[0] === 2 && wall.start[1] === 0 && wall.end[0] === 4),
    ).toBe(true)
  })

  test('mid-span split migrates host attachments to the covering half', () => {
    const door = DoorSchema.parse({
      position: [1, 1.05, 0],
      parentId: 'wall_host',
      wallId: 'wall_host',
    })
    seedLevel(
      [
        { ...makeWall([0, 0], [4, 0], 'wall_host'), children: [door.id] },
        makeWall([2, 2], [2, 1], 'wall_moved'),
      ],
      [door as AnyNode],
    )

    const resolved = resolveEndpointWallSplit({
      point: [2, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    const firstHalf = levelWalls().find((wall) => wall.start[0] === 0 && wall.end[0] === 2)
    expect(firstHalf).toBeDefined()
    const migratedDoor = useScene.getState().nodes[door.id as AnyNodeId]
    expect(migratedDoor?.parentId).toBe(firstHalf?.id)
    expect(firstHalf?.children).toContain(door.id)
  })

  test('a drop near an existing corner resolves to the corner without splitting', () => {
    const resolved = resolveEndpointWallSplit({
      point: [3.99, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([4, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('an opening straddling the drop point skips the split but still resolves the point', () => {
    const door = DoorSchema.parse({
      position: [2, 1.05, 0],
      parentId: 'wall_host',
      wallId: 'wall_host',
    })
    seedLevel(
      [
        { ...makeWall([0, 0], [4, 0], 'wall_host'), children: [door.id] },
        makeWall([2, 2], [2, 1], 'wall_moved'),
      ],
      [door as AnyNode],
    )

    const resolved = resolveEndpointWallSplit({
      point: [2, 0.02],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_host' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('a drop beyond the connect radius resolves nothing and splits nothing', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0.2],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved'],
    })

    expect(resolved).toBeNull()
    expect(levelWalls()).toHaveLength(2)
  })

  test('ignored walls (the moved wall and its commit siblings) are never split', () => {
    const resolved = resolveEndpointWallSplit({
      point: [2, 0],
      levelId: LEVEL_ID,
      ignoreWallIds: ['wall_moved', 'wall_host'],
    })

    expect(resolved).toBeNull()
    expect(levelWalls()).toHaveLength(2)
  })

  test('split + endpoint write compose into a single history step', () => {
    const before = useScene.temporal.getState().pastStates.length

    runAsSingleSceneHistoryStep(useScene, () => {
      const resolved = resolveEndpointWallSplit({
        point: [2, 0],
        levelId: LEVEL_ID,
        ignoreWallIds: ['wall_moved'],
      })
      useScene
        .getState()
        .updateNodes([{ id: 'wall_moved' as AnyNodeId, data: { end: resolved ?? [2, 0] } }])
    })

    expect(useScene.temporal.getState().pastStates.length - before).toBe(1)
    expect(levelWalls()).toHaveLength(3)
    const moved = useScene.getState().nodes['wall_moved' as AnyNodeId] as WallNode
    expect(moved.end).toEqual([2, 0])
  })
})

describe('snapWallDraftPointDetailed', () => {
  test('bypassSnap returns the raw point without endpoint or angle snap', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_a')
    const result = snapWallDraftPointDetailed({
      point: [3.99, 0.03],
      walls: [wall],
      start: [2, 2],
      angleSnap: true,
      bypassSnap: true,
    })

    expect(result.point).toEqual([3.99, 0.03])
    expect(result.snap).toBeNull()
    expect(result.targetWallIds).toEqual([])
  })

  // Endpoint-move regression: walls attached to the moving corner keep their
  // pre-drag coordinates in the scene during the drag, so their stale corner
  // recreates the old junction inside the connect radius. The move tools must
  // pass those walls in `ignoreWallIds` (attached mode) or a sub-5cm corner
  // correction — e.g. squaring a scan-imported 91° junction — can never land.
  test('a stale linked-wall corner swallows a sub-connect-radius correction unless ignored', () => {
    // `wall_d` shares the dragged corner of `wall_c` at [2, 0.03]; the user
    // drops 3cm away at [2, 0] to square the junction.
    const linked = makeWall([2, 0.03], [2, 2], 'wall_d')

    const captured = snapWallDraftPointDetailed({
      point: [2, 0],
      walls: [linked],
      ignoreWallIds: ['wall_c'],
      magnetic: false,
      step: 0,
    })
    expect(captured.point).toEqual([2, 0.03])
    expect(captured.snap).toBe('endpoint')
    expect(captured.targetWallIds).toEqual(['wall_d'])

    const freed = snapWallDraftPointDetailed({
      point: [2, 0],
      walls: [linked],
      ignoreWallIds: ['wall_c', 'wall_d'],
      magnetic: false,
      step: 0,
    })
    expect(freed.point).toEqual([2, 0])
    expect(freed.snap).toBeNull()
  })
})

describe('construction guide snapping', () => {
  const vertical = (x: number): GuideSnapLine => ({ origin: [x, 0], direction: [0, 1] })
  const horizontal = (z: number): GuideSnapLine => ({ origin: [0, z], direction: [1, 0] })

  test('sticks a nearby point to the guide line foot', () => {
    const stuck = snapPointToGuides([1.1, 0.5], [vertical(1.03)])
    expect(stuck?.[0]).toBeCloseTo(1.03)
    expect(stuck?.[1]).toBeCloseTo(0.5)
  })

  test('ignores guides outside the stick radius', () => {
    expect(snapPointToGuides([2, 0.5], [vertical(1)])).toBeNull()
  })

  test('a guide intersection beats the nearest single line', () => {
    const stuck = snapPointToGuides([1.1, 2.1], [vertical(1), horizontal(2)])
    expect(stuck?.[0]).toBeCloseTo(1)
    expect(stuck?.[1]).toBeCloseTo(2)
  })

  test('an angle-locked ray slides along the ray to the guide', () => {
    // 45° ray from the origin; vertical guide at x=2 crosses it at [2, 2].
    const stuck = snapPointToGuides([1.93, 1.93], [vertical(2)], {
      origin: [0, 0],
      through: [1.93, 1.93],
    })
    expect(stuck?.[0]).toBeCloseTo(2)
    expect(stuck?.[1]).toBeCloseTo(2)
  })

  test('snapWallDraftPointDetailed lands the drafted point on an off-grid guide', () => {
    const snapped = snapWallDraftPointDetailed({
      point: [1.1, 0.7],
      walls: [],
      step: 0.5,
      magnetic: false,
      guides: [vertical(1.03)],
    })
    expect(snapped.point[0]).toBeCloseTo(1.03)
    expect(snapped.point[1]).toBeCloseTo(0.5)
  })

  test('Alt bypass skips guides too', () => {
    const bypassed = snapWallDraftPointDetailed({
      point: [1.1, 0.7],
      walls: [],
      bypassSnap: true,
      guides: [vertical(1.03)],
    })
    expect(bypassed.point).toEqual([1.1, 0.7])
  })
})

describe('guide snapping is on by default from the scene store', () => {
  test('auto-collects the active level guides when none are passed', () => {
    useViewer.setState({
      selection: { buildingId: 'building_test', levelId: LEVEL_ID, zoneId: null, selectedIds: [] },
    } as never)
    seedLevel(
      [],
      [
        {
          id: 'cguide_snaptest',
          type: 'construction-guide',
          object: 'node',
          parentId: LEVEL_ID,
          visible: true,
          metadata: {},
          origin: [1.03, 0],
          direction: [0, 1],
        } as unknown as AnyNode,
      ],
    )

    const snapped = snapWallDraftPointDetailed({
      point: [1.1, 0.7],
      walls: [],
      step: 0.5,
      magnetic: false,
    })
    expect(snapped.point[0]).toBeCloseTo(1.03)
    expect(snapped.point[1]).toBeCloseTo(0.5)
  })
})

test('shared wall inference keeps guides and corners ahead of weak angles and respects modes', () => {
  const args = {
    point: [4, 0.1] as WallPlanPoint,
    start: [0, 0] as WallPlanPoint,
    walls: [] as WallNode[],
    magnetic: false,
    step: 0.001,
    guides: [] as GuideSnapLine[],
    inferDirection: true,
  }
  expect(snapWallDraftPointDetailed(args).point).toEqual([4, 0])
  expect(snapWallDraftPointDetailed({ ...args, point: [4, 0.2] }).point).toEqual([4, 0.2])
  expect(snapWallDraftPointDetailed({ ...args, step: 0 }).point).toEqual([4, 0.1])
  const guided = snapWallDraftPointDetailed({
    ...args,
    guides: [{ origin: [0, 0.12], direction: [1, 0] }],
  })
  expect(guided.point[1]).toBeCloseTo(0.12, 12)
  expect(guided.directionInferred).toBeUndefined()
  const corner = snapWallDraftPointDetailed({
    ...args,
    magnetic: true,
    walls: [makeWall([4, 0.1], [5, 2], 'wall_priority')],
  })
  expect(corner.point).toEqual([4, 0.1])
  expect(corner.snap).toBe('endpoint')
  const edge = snapWallDraftPointDetailed({
    ...args,
    point: [20, 0.45],
    walls: [makeWall([20, -4], [20, 6], 'wall_edge_priority')],
  })
  expect(edge.point[0]).toBeCloseTo(20, 12)
  expect(edge.point[1]).toBeCloseTo(0.45, 12)
  expect(edge.snap).toBe('wall')

  const angled = snapWallDraftPointDetailed({ ...args, point: [4, 1.1], angleSnap: true })
  expect((Math.atan2(angled.point[1], angled.point[0]) * 180) / Math.PI).toBeCloseTo(15, 12)
})

describe('resolveWallEndpointPoint', () => {
  test('endpoint cardinal axes outrank a slightly tilted linked reference', () => {
    const tiltedReference = makeWall([0, 0], [1, 0.012], 'wall_tilted_reference')
    const result = resolveWallEndpointPoint({
      point: [4, 0.05],
      walls: [tiltedReference],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0.001,
      guides: [],
    })

    expect(result.point).toEqual([4, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('a cardinal L corner resolves to the exact stationary-axis intersection', () => {
    const result = resolveWallEndpointPoint({
      point: [4.04, 0.03],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference: {
        sharedPoint: [4.04, 0.03],
        oppositeEndpoints: [[4, 3]],
      },
    })

    expect(result.point).toEqual([4, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('the L corner works when the primary ray travels in reverse', () => {
    const result = resolveWallEndpointPoint({
      point: [4.04, 0.03],
      walls: [],
      start: [8, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference: {
        sharedPoint: [4.04, 0.03],
        oppositeEndpoints: [[4, 3]],
      },
    })

    expect(result.point).toEqual([4, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('ambiguous nearby L intersections fail closed to the primary cardinal ray', () => {
    const result = resolveWallEndpointPoint({
      point: [4.04, 0.03],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference: {
        sharedPoint: [4.04, 0.03],
        oppositeEndpoints: [
          [4, 3],
          [4.1, 3],
        ],
      },
    })

    expect(result.point).toEqual([4.04, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('uses the current cursor to confirm a stationary outer cardinal leg', () => {
    const result = resolveWallEndpointPoint({
      point: [4.02, 0.02],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference: {
        sharedPoint: [4.3, 0.2],
        oppositeEndpoints: [[4, 3]],
      },
    })

    expect(result.point).toEqual([4, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('does not form an L corner when the current outer approach is outside 2 degrees', () => {
    const result = resolveWallEndpointPoint({
      point: [4.14, 0.03],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference: {
        sharedPoint: [4.04, 0.03],
        oppositeEndpoints: [[4, 3]],
      },
    })

    expect(result.point).toEqual([4.14, 0])
    expect(result.directionInferred).toBe(true)
    expect(result.constraintOwned).toBe(true)
  })

  test('squares vertical L corners in either outer direction', () => {
    const resolve = (start: WallPlanPoint, opposite: WallPlanPoint) =>
      resolveWallEndpointPoint({
        point: [0.03, 4.04],
        walls: [],
        start,
        inferDirection: true,
        magnetic: true,
        step: 0,
        guides: [],
        junctionReference: {
          sharedPoint: [0.03, 4.04],
          oppositeEndpoints: [opposite],
        },
      })

    expect(resolve([0, 0], [3, 4]).point).toEqual([0, 4])
    expect(resolve([0, 8], [-3, 4]).point).toEqual([0, 4])
  })

  test('fixed-corner right-angle inference wins over an off-ray endpoint', () => {
    const target = { ...makeWall([2, 0.03], [2, 4], 'wall_corner'), thickness: 0.4 }
    const result = resolveWallEndpointPoint({
      point: [1.8, 0.03],
      walls: [target],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point).toEqual([1.8, 0])
    expect(result.snap).toBeNull()
    expect(result.constraintOwned).toBe(true)
  })

  test('captures a thick target face at the inferred-ray intersection', () => {
    const target = { ...makeWall([2, -2], [2, 4], 'wall_face'), thickness: 0.4 }
    const result = resolveWallEndpointPoint({
      point: [1.796, 1.02],
      walls: [target],
      start: [0, 1],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point[0]).toBeCloseTo(2, 12)
    expect(result.point[1]).toBeCloseTo(1, 12)
    expect(result.snap).toBe('wall')
    expect(result.targetWallIds).toEqual(['wall_face'])
    expect(result.directionInferred).toBe(true)
  })

  test('keeps an outside-envelope cursor free on the inferred ray', () => {
    const target = { ...makeWall([2, -2], [2, 4], 'wall_face'), thickness: 0.4 }
    const result = resolveWallEndpointPoint({
      point: [1.69, 1.02],
      walls: [target],
      start: [0, 1],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point).toEqual([1.69, 1])
    expect(result.snap).toBeNull()
    expect(result.targetWallIds).toEqual([])
    expect(result.directionInferred).toBe(true)
  })

  test('captures a physical face for an arbitrary-angle endpoint approach', () => {
    const target = { ...makeWall([2, -2], [2, 4], 'wall_face'), thickness: 0.4 }
    const result = resolveWallEndpointPoint({
      point: [1.8, 0.5],
      walls: [target],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point[0]).toBeCloseTo(2, 12)
    expect(result.point[1]).toBeCloseTo(0.5555555555555556, 12)
    expect(result.snap).toBe('wall')
    expect(result.targetWallIds).toEqual(['wall_face'])
    expect(result.directionInferred).toBeUndefined()
  })

  test('preserves an exact endpoint hit before direction inference', () => {
    const target = { ...makeWall([2, 0.03], [2, 4], 'wall_corner'), thickness: 0.4 }
    const result = resolveWallEndpointPoint({
      point: [2.00005, 0.03],
      walls: [target],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point).toEqual([2, 0.03])
    expect(result.snap).toBe('endpoint')
    expect(result.constraintOwned).toBeUndefined()
  })

  test('keeps an explicit construction guide ahead of weak direction inference', () => {
    const result = resolveWallEndpointPoint({
      point: [4, 0.1],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: false,
      step: 0.001,
      guides: [{ origin: [0, 0.12], direction: [1, 0] }],
    })

    expect(result.point).toEqual([4, 0.12])
    expect(result.constraintOwned).toBe(true)
  })

  test('keeps an explicit construction guide on a locked ray', () => {
    const result = resolveWallEndpointPoint({
      point: [4, 0.1],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: false,
      step: 0,
      guides: [{ origin: [3.95, -2], direction: [0, 1] }],
      constraintRay: { origin: [0, 0], through: [4, 0] },
    })

    expect(result.point).toEqual([3.95, 0])
    expect(result.constraintOwned).toBe(true)
    expect(result.targetCaptured).toBeUndefined()
  })

  test('does not infer a weak ray in Off mode', () => {
    const result = resolveWallEndpointPoint({
      point: [4, 0.1],
      walls: [],
      start: [0, 0],
      inferDirection: true,
      magnetic: false,
      step: 0,
      guides: [],
    })

    expect(result.point).toEqual([4, 0.1])
    expect(result.directionInferred).toBeUndefined()
  })

  test('does not capture a distant on-ray endpoint outside the physical envelope', () => {
    const result = resolveWallEndpointPoint({
      point: [1.3, 0],
      walls: [{ ...makeWall([2, 0], [2, 4], 'wall_distant_corner'), thickness: 0.4 }],
      start: [0, 0],
      inferDirection: true,
      magnetic: false,
      step: 0,
      guides: [],
    })

    expect(result.point).toEqual([1.3, 0])
    expect(result.targetCaptured).toBeUndefined()
  })

  test('captures a target corner only when the inferred ray reaches that corner', () => {
    const onRay = resolveWallEndpointPoint({
      point: [1.8, 0.03],
      walls: [{ ...makeWall([2, 0], [2, 4], 'wall_corner_capture'), thickness: 0.4 }],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })
    expect(onRay.point).toEqual([2, 0])
    expect(onRay.targetCaptured).toBe(true)

    const offRay = resolveWallEndpointPoint({
      point: [1.8, 0.03],
      walls: [{ ...makeWall([2, 0.03], [2, 4], 'wall_off_ray_corner'), thickness: 0.4 }],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
    })
    expect(offRay.point).toEqual([1.8, 0])
    expect(offRay.targetCaptured).toBeUndefined()
  })

  test('uses an explicit locked ray for thick-face capture', () => {
    const result = resolveWallEndpointPoint({
      point: [1.8, 1.02],
      walls: [{ ...makeWall([2, -2], [2, 4], 'wall_locked_face'), thickness: 0.4 }],
      start: [0, 0],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      constraintRay: { origin: [0, 0], through: [1.8, 0] },
    })

    expect(result.point).toEqual([2, 0])
    expect(result.targetCaptured).toBe(true)
    expect(result.directionInferred).toBe(true)
  })

  test('captures a thick face on the explicit 15 degree angle ray', () => {
    const result = resolveWallEndpointPoint({
      point: [1.8, 1.02],
      walls: [{ ...makeWall([2, -2], [2, 4], 'wall_angle_face'), thickness: 0.4 }],
      start: [0, 0],
      inferDirection: true,
      angleSnap: true,
      magnetic: true,
      step: 0,
      guides: [],
    })

    expect(result.point[0]).toBeCloseTo(2, 12)
    expect(result.point[1]).toBeCloseTo(2 * Math.tan(Math.PI / 6), 12)
    expect(result.targetCaptured).toBe(true)
    expect(result.directionInferred).toBe(true)
  })

  test('captures a linked straight-junction datum without moving the inferred ray', () => {
    const junctionReference = {
      sharedPoint: [1.999, 4] as WallPlanPoint,
      oppositeEndpoints: [
        [2, 2],
        [2, 7],
      ] as [WallPlanPoint, WallPlanPoint],
    }

    const free = resolveWallEndpointPoint({
      point: [2.048, 4.421],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(free.point).toEqual([2, 4.421])
    expect(free.constraintOwned).toBe(true)
    expect(free.directionInferred).toBe(true)

    const onPrimaryRay = resolveWallEndpointPoint({
      point: [2.048, 4.02],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(onPrimaryRay.point).toEqual([2, 4])
    expect(onPrimaryRay.constraintOwned).toBe(true)
    expect(onPrimaryRay.directionInferred).toBe(true)
  })

  test('uses the outer endpoint datum regardless of order and ignores invalid captures', () => {
    const base = {
      walls: [] as WallNode[],
      start: [-4, 4] as WallPlanPoint,
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [] as GuideSnapLine[],
    }
    const reversed = resolveWallEndpointPoint({
      ...base,
      point: [2.048, 4.421],
      junctionReference: {
        sharedPoint: [1.999, 4],
        oppositeEndpoints: [
          [2, 7],
          [2, 2],
        ],
      },
    })
    expect(reversed.point).toEqual([2, 4.421])

    const nonCollinear = resolveWallEndpointPoint({
      ...base,
      point: [2.048, 4.421],
      junctionReference: {
        sharedPoint: [1.999, 4],
        oppositeEndpoints: [
          [2, 2],
          [3, 7],
        ],
      },
    })
    expect(nonCollinear.point).toEqual([2.048, 4.421])

    const outsideCapture = resolveWallEndpointPoint({
      ...base,
      point: [2.3, 4.421],
      junctionReference: {
        sharedPoint: [1.999, 4],
        oppositeEndpoints: [
          [2, 2],
          [2, 7],
        ],
      },
    })
    expect(outsideCapture.point).toEqual([2.3, 4.421])
  })

  test('keeps guide, Off, and Angles precedence over a linked datum', () => {
    const junctionReference = {
      sharedPoint: [1.999, 4] as WallPlanPoint,
      oppositeEndpoints: [
        [2, 2],
        [2, 7],
      ] as [WallPlanPoint, WallPlanPoint],
    }
    const guided = resolveWallEndpointPoint({
      point: [2.048, 4.12],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [{ origin: [0, 4.12], direction: [1, 0] }],
      junctionReference,
    })
    expect(guided.point).toEqual([2.048, 4.12])
    expect(guided.constraintOwned).toBe(true)

    const off = resolveWallEndpointPoint({
      point: [2.048, 4.421],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: false,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(off.point).toEqual([2.048, 4.421])
    expect(off.constraintOwned).toBeUndefined()

    const angles = resolveWallEndpointPoint({
      point: [2.048, 4.421],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      angleSnap: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(angles.point[0]).not.toBeCloseTo(2, 12)
  })

  test('combines a locked ray with a linked datum only inside the capture radius', () => {
    const junctionReference = {
      sharedPoint: [1.999, 4] as WallPlanPoint,
      oppositeEndpoints: [
        [2, 2],
        [2, 7],
      ] as [WallPlanPoint, WallPlanPoint],
    }
    const captured = resolveWallEndpointPoint({
      point: [2.048, 4.02],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      constraintRay: { origin: [-4, 4], through: [2.048, 4] },
      junctionReference,
    })
    expect(captured.point).toEqual([2, 4])
    expect(captured.constraintOwned).toBe(true)
    expect(captured.directionInferred).toBe(true)

    const released = resolveWallEndpointPoint({
      point: [2.5, 4.3],
      walls: [],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      constraintRay: { origin: [-4, 4], through: [2.5, 4] },
      junctionReference,
    })
    expect(released.point).toEqual([2.5, 4])
    expect(released.constraintOwned).toBe(true)
  })

  test('uses the linked datum ray for a competing face only when no primary ray exists', () => {
    const junctionReference = {
      sharedPoint: [1.999, 4] as WallPlanPoint,
      oppositeEndpoints: [
        [2, 2],
        [2, 7],
      ] as WallPlanPoint[],
    }
    const horizontalFace = {
      ...makeWall([1, 4.5], [4, 4.5], 'wall_external_horizontal'),
      thickness: 0.4,
    }
    const datumOnly = resolveWallEndpointPoint({
      point: [2.048, 4.421],
      walls: [horizontalFace],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(datumOnly.point).toEqual([2, 4.5])
    expect(datumOnly.snap).toBe('wall')
    expect(datumOnly.targetWallIds).toContain('wall_external_horizontal')
    expect(datumOnly.targetCaptured).toBe(true)
    expect(datumOnly.constraintOwned).toBe(true)
    expect(datumOnly.directionInferred).toBe(true)

    const verticalFace = {
      ...makeWall([2.2, 2], [2.2, 7], 'wall_external_vertical'),
      thickness: 0.4,
    }
    const alignedVerticalFace = {
      ...makeWall([2, 2], [2, 7], 'wall_external_aligned'),
      thickness: 0.4,
    }
    const primary = resolveWallEndpointPoint({
      point: [2.048, 4.02],
      walls: [verticalFace, alignedVerticalFace],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(primary.point).toEqual([2, 4])
    expect(primary.targetCaptured).toBe(true)
    expect(primary.targetWallIds).toEqual(['wall_external_aligned'])

    const reverseHorizontalFace = {
      ...makeWall([1, 1.8], [4, 1.8], 'wall_external_reverse'),
      thickness: 0.4,
    }
    const reverse = resolveWallEndpointPoint({
      point: [2.048, 1.9],
      walls: [reverseHorizontalFace],
      start: [-4, 4],
      inferDirection: true,
      magnetic: true,
      step: 0,
      guides: [],
      junctionReference,
    })
    expect(reverse.point).toEqual([2, 1.8])
    expect(reverse.targetWallIds).toContain('wall_external_reverse')
  })

  test('accepts a linked pair inside the 2 degree window and rejects one outside it', () => {
    const nearTwoDegrees = (degrees: number) =>
      resolveWallEndpointPoint({
        point: [0.05, 0.08],
        walls: [],
        start: [-2, 0],
        inferDirection: true,
        magnetic: true,
        step: 0,
        guides: [],
        junctionReference: {
          sharedPoint: [0, 0],
          oppositeEndpoints: [
            [-1, 0],
            [1, Math.tan((degrees * Math.PI) / 180)],
          ],
        },
      })

    const inside = nearTwoDegrees(1.9)
    expect(inside.point).not.toEqual([0.05, 0.08])
    expect(inside.constraintOwned).toBe(true)

    const outside = nearTwoDegrees(2.1)
    expect(outside.point).toEqual([0.05, 0.08])
    expect(outside.constraintOwned).toBeUndefined()
  })
})
