import { describe, expect, test } from 'bun:test'
import { DoorNode, ItemNode, LevelNode, WallNode } from '../schema'
import {
  buildWallMerge,
  buildWallSplit,
  buildWallSplitAtContacts,
  WallOperationError,
} from './wall-operations'

function scene() {
  const level = LevelNode.parse({ children: [] })
  const left = WallNode.parse({
    id: 'wall_left',
    parentId: level.id,
    start: [0, 0],
    end: [2, 0],
    children: ['door_main'],
    thickness: 0.12,
    height: 2.5,
    supportOffset: 0.2,
    fillToTerrain: true,
  })
  const right = WallNode.parse({
    id: 'wall_right',
    parentId: level.id,
    start: [2, 0],
    end: [5, 0],
    thickness: 0.12,
    height: 2.5,
    supportOffset: 0.2,
    fillToTerrain: true,
  })
  const door = DoorNode.parse({
    id: 'door_main',
    parentId: left.id,
    wallId: left.id,
    position: [1, 0, 0.01],
    width: 0.8,
  })
  const item = ItemNode.parse({
    id: 'item_main',
    parentId: right.id,
    wallId: right.id,
    wallT: 0.5,
    position: [1.5, 0.7, -0.02],
    asset: {
      id: 'cabinet',
      category: 'cabinet',
      name: 'Cabinet',
      thumbnail: '',
      src: 'https://example.com/cabinet.glb',
      dimensions: [0.6, 1, 0.3],
      attachTo: 'wall',
    },
  })
  const nodes = {
    [level.id]: LevelNode.parse({ ...level, children: [left.id, right.id] }),
    [left.id]: left,
    [right.id]: right,
    [door.id]: door,
    [item.id]: item,
  }
  return {
    nodes,
    rootNodeIds: [level.id],
    collections: {
      collection_test: { id: 'collection_test', name: 'Walls', nodeIds: [left.id] },
    },
  }
}

describe('wall operations', () => {
  test('merges exact collinear walls and preserves hosted world positions and construction', () => {
    const result = buildWallMerge(scene(), ['wall_left', 'wall_right'])
    const wall = result.nodes.wall_left
    expect(wall?.type).toBe('wall')
    expect(wall?.start).toEqual([0, 0])
    expect(wall?.end).toEqual([5, 0])
    expect(wall?.thickness).toBe(0.12)
    expect(wall?.supportOffset).toBe(0.2)
    expect(wall?.fillToTerrain).toBe(true)
    expect(result.nodes.item_main?.type).toBe('item')
    expect((result.nodes.item_main as any).position[0]).toBe(3.5)
    expect((result.nodes.item_main as any).parentId).toBe('wall_left')
    expect((result.nodes.item_main as any).wallT).toBeCloseTo(0.7)
    expect(result.nodes.wall_right).toBeUndefined()
    expect(result.collections.collection_test.nodeIds).toEqual(['wall_left'])
    expect(result.nodes.wall_left && (result.nodes.wall_left as any).children).toEqual([
      'door_main',
      'item_main',
    ])
  })

  test('splits inside a wall, retains the first id, and preserves collection membership', () => {
    const result = buildWallSplit(scene(), 'wall_left', 1.5, 'wall_second')
    expect(result.nodes.wall_left?.type).toBe('wall')
    expect(result.nodes.wall_left?.end).toEqual([1.5, 0])
    expect(result.nodes.wall_second?.type).toBe('wall')
    expect(result.nodes.wall_second?.start).toEqual([1.5, 0])
    expect((result.nodes.door_main as any)?.wallId).toBe('wall_left')
    expect((result.nodes.door_main as any)?.parentId).toBe('wall_left')
    expect(result.collections.collection_test.nodeIds).toEqual(['wall_left', 'wall_second'])
    expect(result.nodes[levelId(result)].type).toBe('level')
  })

  test('rejects an opening that would straddle the split', () => {
    const input = scene()
    const wall = input.nodes.wall_left as any
    const door = input.nodes.door_main as any
    input.nodes.door_main = DoorNode.parse({ ...door, position: [1.5, 0, 0], width: 1.2 })
    input.nodes.wall_left = WallNode.parse({ ...wall, children: ['door_main'] })
    expect(() => buildWallSplit(input, 'wall_left', 1.5)).toThrow(WallOperationError)
  })

  test('supports a three-wall chain when the first selected wall is internal', () => {
    const input = scene()
    const level = input.nodes[input.rootNodeIds[0]!] as any
    const middle = WallNode.parse({
      id: 'wall_middle',
      parentId: level.id,
      start: [2, 0],
      end: [4, 0],
      thickness: 0.12,
      height: 2.5,
      supportOffset: 0.2,
      fillToTerrain: true,
    })
    const right = WallNode.parse({
      id: 'wall_rightmost',
      parentId: level.id,
      start: [4, 0],
      end: [5, 0],
      thickness: 0.12,
      height: 2.5,
      supportOffset: 0.2,
      fillToTerrain: true,
    })
    input.nodes[middle.id] = middle
    input.nodes[right.id] = right
    input.nodes[level.id] = { ...level, children: ['wall_left', middle.id, right.id] }
    const result = buildWallMerge(input, [middle.id, 'wall_left', right.id])
    expect(result.nodes[middle.id]?.type).toBe('wall')
    expect((result.nodes[middle.id] as any).start).toEqual([0, 0])
    expect((result.nodes[middle.id] as any).end).toEqual([5, 0])
    expect(result.nodes.wall_left).toBeUndefined()
    expect(result.nodes.wall_rightmost).toBeUndefined()
  })

  test('adds a secondary-only collection membership to the retained wall', () => {
    const input = scene()
    input.collections.collection_test.nodeIds = ['wall_right']
    const result = buildWallMerge(input, ['wall_left', 'wall_right'])
    expect(result.collections.collection_test.nodeIds).toEqual(['wall_left'])
    expect((result.nodes.wall_left as any).collectionIds).toEqual(['collection_test'])
  })

  test('rejects reversed one-sided trims before changing their side', () => {
    const input = scene()
    delete input.nodes.item_main
    const trim = {
      enabled: true,
      sides: 'interior' as const,
      height: 0.12,
      proud: 0.02,
      profile: 'flat' as const,
    }
    input.nodes.wall_left = WallNode.parse({ ...(input.nodes.wall_left as any), skirting: trim })
    input.nodes.wall_right = WallNode.parse({
      ...(input.nodes.wall_right as any),
      start: [5, 0],
      end: [2, 0],
      skirting: trim,
    })
    expect(() => buildWallMerge(input, ['wall_left', 'wall_right'])).toThrow(WallOperationError)
  })

  test('rejects reversed walls with unequal front and back side metadata', () => {
    const input = scene()
    delete input.nodes.item_main
    input.nodes.wall_left = WallNode.parse({
      ...(input.nodes.wall_left as any),
      frontSide: 'interior',
      backSide: 'unknown',
    })
    input.nodes.wall_right = WallNode.parse({
      ...(input.nodes.wall_right as any),
      start: [5, 0],
      end: [2, 0],
      frontSide: 'interior',
      backSide: 'unknown',
    })
    expect(() => buildWallMerge(input, ['wall_left', 'wall_right'])).toThrow(WallOperationError)
  })

  test('rejects a reversed hosted wall instead of changing its local frame', () => {
    const input = scene()
    const right = input.nodes.wall_right as any
    input.nodes.wall_right = WallNode.parse({ ...right, start: [5, 0], end: [2, 0] })
    input.nodes[input.rootNodeIds[0]!] = {
      ...(input.nodes[input.rootNodeIds[0]!] as any),
      children: ['wall_left', 'wall_right'],
    }
    expect(() => buildWallMerge(input, ['wall_left', 'wall_right'])).toThrow(WallOperationError)
  })

  test('projects rotated item width and depth when validating a split', () => {
    const input = scene()
    const item = input.nodes.item_main as any
    input.nodes.item_main = ItemNode.parse({
      ...item,
      position: [1.5, 0.7, -0.02],
      rotation: [0, Math.PI / 2, 0],
    })
    expect(() => buildWallSplit(input, 'wall_right', 1.5)).toThrow(WallOperationError)
  })

  test('rejects an occupied requested split id', () => {
    expect(() => buildWallSplit(scene(), 'wall_left', 1.5, 'wall_right')).toThrow(
      WallOperationError,
    )
  })

  test('splits a wall once per distinct interior T/X contact in descending order', () => {
    const input = scene()
    delete input.nodes.door_main
    input.nodes.wall_left = WallNode.parse({
      ...(input.nodes.wall_left as any),
      end: [5, 0],
      children: [],
    })
    const level = input.nodes[input.rootNodeIds[0]!] as any
    const branchAtOne = WallNode.parse({
      id: 'wall_branch_one',
      parentId: level.id,
      start: [1, 0],
      end: [1, 2],
    })
    const duplicateBranch = WallNode.parse({
      id: 'wall_branch_duplicate',
      parentId: level.id,
      start: [1, 0],
      end: [1, -2],
    })
    const branchAtThree = WallNode.parse({
      id: 'wall_branch_three',
      parentId: level.id,
      start: [3, -2],
      end: [3, 2],
    })
    input.nodes[branchAtOne.id] = branchAtOne
    input.nodes[duplicateBranch.id] = duplicateBranch
    input.nodes[branchAtThree.id] = branchAtThree
    input.nodes[level.id] = {
      ...level,
      children: [...level.children, branchAtOne.id, duplicateBranch.id, branchAtThree.id],
    }

    const result = buildWallSplitAtContacts(input, 'wall_left')
    expect(result.createdNodeIds).toHaveLength(2)
    expect((result.nodes.wall_left as any).start).toEqual([0, 0])
    expect((result.nodes.wall_left as any).end).toEqual([1, 0])
    expect(result.createdNodeIds.map((id) => (result.nodes[id] as any).start)).toEqual([
      [3, 0],
      [1, 0],
    ])
    expect(result.nodes.wall_branch_one).toEqual(branchAtOne)
    expect(result.nodes.wall_branch_duplicate).toEqual(duplicateBranch)
    expect(result.nodes.wall_branch_three).toEqual(branchAtThree)
  })

  test('ignores endpoint-only contacts and contacts on another level', () => {
    const input = scene()
    const level = input.nodes[input.rootNodeIds[0]!] as any
    const otherLevel = LevelNode.parse({ children: [] })
    const endpointBranch = WallNode.parse({
      id: 'wall_endpoint_branch',
      parentId: level.id,
      start: [0, 0],
      end: [0, 2],
    })
    const otherLevelBranch = WallNode.parse({
      id: 'wall_other_level_branch',
      parentId: otherLevel.id,
      start: [1, 0],
      end: [1, 2],
    })
    input.nodes[otherLevel.id] = otherLevel
    input.nodes[endpointBranch.id] = endpointBranch
    input.nodes[otherLevelBranch.id] = otherLevelBranch
    input.nodes[level.id] = { ...level, children: [...level.children, endpointBranch.id] }
    expect(() => buildWallSplitAtContacts(input, 'wall_left')).toThrow(
      expect.objectContaining({ code: 'no-wall-contacts' }),
    )
  })

  test('validates every contact before exposing a mutation when an attachment crosses one', () => {
    const input = scene()
    const level = input.nodes[input.rootNodeIds[0]!] as any
    const branchAtOne = WallNode.parse({
      id: 'wall_branch_one',
      parentId: level.id,
      start: [1, 0],
      end: [1, 2],
    })
    const branchAtThree = WallNode.parse({
      id: 'wall_branch_three',
      parentId: level.id,
      start: [3, -2],
      end: [3, 2],
    })
    const crossingDoor = DoorNode.parse({
      id: 'door_crossing_contacts',
      parentId: 'wall_left',
      wallId: 'wall_left',
      position: [1, 0, 0],
      width: 1,
    })
    input.nodes[branchAtOne.id] = branchAtOne
    input.nodes[branchAtThree.id] = branchAtThree
    input.nodes[crossingDoor.id] = crossingDoor
    input.nodes.wall_left = WallNode.parse({
      ...(input.nodes.wall_left as any),
      children: [...((input.nodes.wall_left as any).children ?? []), crossingDoor.id],
    })
    input.nodes[level.id] = {
      ...level,
      children: [...level.children, branchAtOne.id, branchAtThree.id],
    }
    const before = JSON.stringify(input)
    expect(() => buildWallSplitAtContacts(input, 'wall_left')).toThrow(
      expect.objectContaining({ code: 'attachment-crosses-split' }),
    )
    expect(JSON.stringify(input)).toBe(before)
  })
})

function levelId(input: ReturnType<typeof scene>) {
  return input.rootNodeIds[0]!
}
