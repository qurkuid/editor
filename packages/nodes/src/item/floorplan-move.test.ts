import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ItemNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useInteractionScope } from '@pascal-app/editor'
import { itemDefinition } from './definition'
import { itemFloorplanMoveTarget } from './floorplan-move'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

/**
 * End-to-end 2D move-session check for the furniture wall-flush snap: a
 * 4m × 3m room (walls drawn clockwise, 0.1 thick — inner faces at z=0.05,
 * x=3.95, z=2.95, x=0.05) and a 1×1×1 floor item dragged toward each wall.
 * Exercises the real session pipeline — cursor resolver, snap-mode gates,
 * alignment, flush snap, commit — not just the pure solver, so a regression
 * anywhere in the wiring (e.g. only some wall orientations snapping) fails
 * here.
 */

const LEVEL_ID = 'level_flush-test' as AnyNodeId

function wall(id: string, start: [number, number], end: [number, number]): AnyNode {
  return WallNode.parse({ id, parentId: LEVEL_ID, start, end, thickness: 0.1 })
}

function buildScene() {
  const item = ItemNode.parse({
    id: 'item_flush-test',
    parentId: LEVEL_ID,
    position: [2, 0, 1.5],
    asset: {
      id: 'asset-flush-test',
      category: 'furniture',
      name: 'Test Box',
      thumbnail: 'thumb.png',
      src: 'https://example.com/box.glb',
      dimensions: [1, 1, 1],
    },
  })
  const nodes: Record<string, AnyNode> = {
    [LEVEL_ID]: {
      id: LEVEL_ID,
      type: 'level',
      children: ['wall_back', 'wall_right', 'wall_front', 'wall_left', item.id],
    } as unknown as AnyNode,
    wall_back: wall('wall_back', [0, 0], [4, 0]),
    wall_right: wall('wall_right', [4, 0], [4, 3]),
    wall_front: wall('wall_front', [4, 3], [0, 3]),
    wall_left: wall('wall_left', [0, 3], [0, 0]),
    [item.id]: item,
  }
  useScene.setState({ nodes: nodes as never })
  return item
}

/** Grab the item at its centre, drag to `target`, commit, and return the
 *  committed plan position. */
function dragTo(target: readonly [number, number]): [number, number] {
  const item = buildScene()
  useInteractionScope.getState().begin({
    kind: 'moving',
    node: item as unknown as AnyNode,
    nodeId: item.id,
    nodeType: 'item',
    view: 'floorplan',
  } as never)

  const session = itemFloorplanMoveTarget({
    node: item,
    nodes: useScene.getState().nodes,
  } as never)
  // First apply seeds the relative-drag anchor at the grab point (item centre).
  session.apply({ planPoint: [2, 1.5] } as never)
  session.apply({ planPoint: [target[0], target[1]] } as never)
  expect(session.canCommit()).toBe(true)
  session.commit()

  const committed = useScene.getState().nodes[item.id as AnyNodeId] as ItemNode
  return [committed.position[0], committed.position[2]]
}

describe('item floorplan move — wall-flush snap', () => {
  beforeAll(() => {
    if (!nodeRegistry.get('item')) registerNode(itemDefinition as never)
  })

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useInteractionScope.getState().end()
  })

  test('flushes onto the back wall (face z=0.05)', () => {
    const [x, z] = dragTo([2, 0.5])
    expect(x).toBeCloseTo(2)
    expect(z).toBeCloseTo(0.55)
  })

  test('flushes onto the left wall (face x=0.05)', () => {
    const [x, z] = dragTo([0.5, 1.5])
    expect(x).toBeCloseTo(0.55)
    expect(z).toBeCloseTo(1.5)
  })

  test('flushes onto the right wall (face x=3.95)', () => {
    const [x, z] = dragTo([3.5, 1.5])
    expect(x).toBeCloseTo(3.45)
    expect(z).toBeCloseTo(1.5)
  })

  test('flushes onto the front wall (face z=2.95)', () => {
    const [x, z] = dragTo([2, 2.5])
    expect(x).toBeCloseTo(2)
    expect(z).toBeCloseTo(2.45)
  })

  test('stays free in the middle of the room', () => {
    const [x, z] = dragTo([2.5, 1.5])
    expect(x).toBeCloseTo(2.5)
    expect(z).toBeCloseTo(1.5)
  })
})
