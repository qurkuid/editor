import { beforeEach, describe, expect, test } from 'bun:test'
import { nodeRegistry } from '../registry/registry'
import type { AnyNodeDefinition } from '../registry/types'
import { LevelNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene from './use-scene'

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
})
