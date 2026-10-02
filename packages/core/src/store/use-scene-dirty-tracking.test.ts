import { beforeEach, describe, expect, test } from 'bun:test'
import { buildWallParallelAlignmentUpdates } from '../lib/wall-operations'
import { nodeRegistry } from '../registry/registry'
import type { AnyNodeDefinition } from '../registry/types'
import { LevelNode, WallNode } from '../schema'
import type { WallNode as WallNodeData } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene from './use-scene'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  callback,
) => {
  callback(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const untrackedDef = {
  kind: 'test-untracked',
  schemaVersion: 1,
  schema: {} as never,
  category: 'furnishing',
  defaults: () => ({}),
  capabilities: {},
  dirtyTracking: false,
} as unknown as AnyNodeDefinition

const trackedDef = {
  ...untrackedDef,
  kind: 'test-tracked',
  dirtyTracking: undefined,
} as unknown as AnyNodeDefinition

const UNTRACKED = 'item_untracked' as AnyNodeId
const TRACKED = 'item_tracked' as AnyNodeId
const UNREGISTERED = 'item_unregistered' as AnyNodeId

const makeNode = (id: AnyNodeId, type: string): AnyNode =>
  ({
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
  }) as unknown as AnyNode

describe('dirty tracking', () => {
  beforeEach(() => {
    if (!nodeRegistry.has(untrackedDef.kind)) nodeRegistry._register(untrackedDef)
    if (!nodeRegistry.has(trackedDef.kind)) nodeRegistry._register(trackedDef)
    useScene.setState({
      nodes: {
        [UNTRACKED]: makeNode(UNTRACKED, 'test-untracked'),
        [TRACKED]: makeNode(TRACKED, 'test-tracked'),
        [UNREGISTERED]: makeNode(UNREGISTERED, 'unregistered-kind'),
      },
      rootNodeIds: [UNTRACKED, TRACKED, UNREGISTERED],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  // Membership asserts (not set size/equality): the scene store is a module
  // singleton, and subscribers leaked by other test files can add their own
  // dirty marks when `setState` fires.
  test('markDirty skips kinds whose definition opts out', () => {
    useScene.getState().markDirty(UNTRACKED)
    expect(useScene.getState().dirtyNodes.has(UNTRACKED)).toBe(false)
  })

  test('markDirty tracks kinds without the opt-out, registered or not', () => {
    useScene.getState().markDirty(TRACKED)
    useScene.getState().markDirty(UNREGISTERED)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(UNREGISTERED)).toBe(true)
  })

  test('deleteNodes removes deleted ids from the dirty set', () => {
    useScene.getState().markDirty(TRACKED)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
    useScene.getState().deleteNodes([TRACKED])
    expect(useScene.getState().nodes[TRACKED]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(false)
  })

  test('wall merge does not re-mark a deleted secondary wall dirty', () => {
    const level = LevelNode.parse({
      id: 'level_dirty_walls',
      children: ['wall_dirty_left', 'wall_dirty_right'],
    })
    const left = WallNode.parse({
      id: 'wall_dirty_left',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0],
    })
    const right = WallNode.parse({
      id: 'wall_dirty_right',
      parentId: level.id,
      start: [1, 0],
      end: [2, 0],
    })
    useScene.setState({
      nodes: { [level.id]: level, [left.id]: left, [right.id]: right },
      rootNodeIds: [level.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
    })

    useScene.getState().mergeWalls([left.id, right.id])

    expect(useScene.getState().nodes[right.id]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(right.id)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(left.id)).toBe(true)
  })

  test('deleting a wall skips optional neighbor merge when either neighbor has finish regions', () => {
    const level = LevelNode.parse({
      id: 'level_finish_region_delete',
      children: ['wall_finish_left', 'wall_finish_intermediary', 'wall_finish_right'],
    })
    const left = WallNode.parse({
      id: 'wall_finish_left',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0],
      finishRegions: [
        {
          id: 'left-region',
          side: 'interior',
          start: 0,
          end: 0.5,
          slots: { upperInterior: 'library:left-region' },
        },
      ],
    })
    const intermediary = WallNode.parse({
      id: 'wall_finish_intermediary',
      parentId: level.id,
      start: [1, 0],
      end: [1, 1],
    })
    const right = WallNode.parse({
      id: 'wall_finish_right',
      parentId: level.id,
      start: [1, 0],
      end: [2, 0],
      finishRegions: [
        {
          id: 'right-region',
          side: 'interior',
          start: 0.5,
          end: 1,
          slots: { upperInterior: 'library:right-region' },
        },
      ],
    })
    useScene.setState({
      nodes: {
        [level.id]: level,
        [left.id]: left,
        [intermediary.id]: intermediary,
        [right.id]: right,
      },
      rootNodeIds: [level.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      readOnly: false,
    })
    useScene.temporal.getState().clear()

    useScene.getState().deleteNodes([intermediary.id])

    expect(useScene.getState().nodes[intermediary.id]).toBeUndefined()
    expect(useScene.getState().nodes[left.id]).toEqual(left)
    expect(useScene.getState().nodes[right.id]).toEqual(right)
    expect(useScene.getState().nodes[level.id]).toMatchObject({
      children: [left.id, right.id],
    })
  })

  test('rejecting conflicting finish regions leaves nodes and history untouched', () => {
    const level = LevelNode.parse({ id: 'level_finish_region_conflict', children: [] })
    const left = WallNode.parse({
      id: 'wall_finish_conflict_left',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0],
    })
    const right = WallNode.parse({
      id: 'wall_finish_conflict_right',
      parentId: level.id,
      start: [1, 0],
      end: [2, 0],
    })
    const invalidLeft = {
      ...left,
      finishRegions: [
        {
          id: 'conflict-first',
          side: 'interior' as const,
          start: 0,
          end: 0.8,
          slots: { upperInterior: 'library:conflict-first' },
        },
        {
          id: 'conflict-second',
          side: 'interior' as const,
          start: 0.5,
          end: 1,
          slots: { upperInterior: 'library:conflict-second' },
        },
      ],
    } as AnyNode
    const nextLevel = LevelNode.parse({
      ...level,
      children: [left.id, right.id],
    })
    useScene.setState({
      nodes: { [nextLevel.id]: nextLevel, [left.id]: invalidLeft, [right.id]: right },
      rootNodeIds: [nextLevel.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      readOnly: false,
    })
    useScene.temporal.getState().clear()
    const beforeNodes = JSON.stringify(useScene.getState().nodes)
    const beforeHistory = useScene.temporal.getState().pastStates.length

    expect(() => useScene.getState().mergeWalls([left.id, right.id])).toThrow(
      expect.objectContaining({ code: 'finish-region-conflict' }),
    )
    expect(JSON.stringify(useScene.getState().nodes)).toBe(beforeNodes)
    expect(useScene.temporal.getState().pastStates).toHaveLength(beforeHistory)
  })

  test('wall topology actions create a direct undo and redo step', async () => {
    const level = LevelNode.parse({
      id: 'level_wall_history',
      children: ['wall_history_left', 'wall_history_right'],
    })
    const left = WallNode.parse({
      id: 'wall_history_left',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0],
    })
    const right = WallNode.parse({
      id: 'wall_history_right',
      parentId: level.id,
      start: [1, 0],
      end: [2, 0],
    })
    useScene.setState({
      nodes: { [level.id]: level, [left.id]: left, [right.id]: right },
      rootNodeIds: [level.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
    })
    useScene.temporal.getState().clear()

    useScene.getState().mergeWalls([left.id, right.id])

    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.getState().nodes[right.id]).toBeUndefined()

    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(useScene.getState().nodes[right.id]).toBeDefined()
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    useScene.getState().dirtyNodes.clear()
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(useScene.getState().nodes[right.id]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(right.id)).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    const splitWall = WallNode.parse({
      id: 'wall_history_split',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
    })
    useScene.setState({
      nodes: {
        [level.id]: LevelNode.parse({ ...level, children: [splitWall.id] }),
        [splitWall.id]: splitWall,
      },
      rootNodeIds: [level.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
    })
    useScene.temporal.getState().clear()
    const splitMutation = useScene.getState().splitWall(splitWall.id, 1)
    expect(splitMutation?.createdNodeIds).toHaveLength(1)
    useScene.getState().dirtyNodes.clear()
    useScene.temporal.getState().undo()
    await Promise.resolve()
    const splitSecondId = splitMutation?.createdNodeIds[0]
    expect(splitSecondId).toBeDefined()
    expect(useScene.getState().nodes[splitSecondId!]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(splitSecondId!)).toBe(false)
  })

  test('parallel wall alignment is one undo step and restores the exact graph', async () => {
    const level = LevelNode.parse({
      id: 'level_parallel_history',
      children: ['wall_parallel_history_reference', 'wall_parallel_history_selected'],
    })
    const reference = WallNode.parse({
      id: 'wall_parallel_history_reference',
      parentId: level.id,
      start: [-2, 0],
      end: [0, 0],
    })
    const selected = WallNode.parse({
      id: 'wall_parallel_history_selected',
      parentId: level.id,
      start: [0, 0],
      end: [1, 0.01],
    })
    const linked = WallNode.parse({
      id: 'wall_parallel_history_linked',
      parentId: level.id,
      start: [1, 0.01],
      end: [1, 1],
    })
    useScene.setState({
      nodes: {
        [level.id]: level,
        [reference.id]: reference,
        [selected.id]: selected,
        [linked.id]: linked,
      },
      rootNodeIds: [level.id],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      readOnly: false,
    })
    useScene.temporal.getState().clear()

    const before = JSON.stringify(useScene.getState().nodes)
    const updates = buildWallParallelAlignmentUpdates(useScene.getState().nodes, selected.id)
    useScene.getState().updateNodes(updates)
    await Promise.resolve()
    const aligned = JSON.stringify(useScene.getState().nodes)

    expect(aligned).not.toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.getState().nodes[linked.id]?.type).toBe('wall')
    expect((useScene.getState().nodes[linked.id] as WallNodeData).start).toEqual(
      (useScene.getState().nodes[selected.id] as WallNodeData).end,
    )

    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(before)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(JSON.stringify(useScene.getState().nodes)).toBe(aligned)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().clear()
    const historyBeforeRejectedPaths = useScene.temporal.getState().pastStates.length
    useScene.setState({ readOnly: true })
    useScene.getState().updateNodes(updates)
    expect(useScene.temporal.getState().pastStates).toHaveLength(historyBeforeRejectedPaths)
    useScene.setState({ readOnly: false })
    expect(() =>
      buildWallParallelAlignmentUpdates(
        {
          ...useScene.getState().nodes,
          [selected.id]: WallNode.parse({
            ...selected,
            start: [0, 0],
            end: [0, 0],
          }),
        },
        selected.id,
      ),
    ).toThrow()
    expect(useScene.temporal.getState().pastStates).toHaveLength(historyBeforeRejectedPaths)
  })
})
