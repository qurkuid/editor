import { describe, expect, test } from 'bun:test'
import { DoorNode, LevelNode, WallNode } from '@pascal-app/core'
import { buildWallEndpointEditPlan } from './endpoint-edit-plan'

function fixture(position: number) {
  const level = LevelNode.parse({ id: 'level_split_preflight' })
  const source = WallNode.parse({
    id: 'wall_split_source',
    parentId: level.id,
    start: [0, 2],
    end: [1, 2],
  })
  const target = WallNode.parse({
    id: 'wall_split_target',
    parentId: level.id,
    start: [2, 0],
    end: [2, 4],
  })
  const door = DoorNode.parse({
    id: 'door_split_preflight',
    parentId: target.id,
    wallId: target.id,
    width: 0.8,
    position: [position, 1, 0],
  })
  target.children = [door.id]
  level.children = [source.id, target.id]
  return {
    nodes: { [level.id]: level, [source.id]: source, [target.id]: target, [door.id]: door },
    source,
    target,
    door,
  }
}

describe('shared 2D and 3D endpoint split preflight', () => {
  test('plans valid split and attachment migration without changing source nodes', () => {
    const { nodes, source, target, door } = fixture(1)
    const baseline = structuredClone(nodes)
    const plan = buildWallEndpointEditPlan(nodes, {
      wall: source,
      endpoint: 'end',
      start: source.start,
      end: [2, 2],
      detach: false,
    })
    expect(nodes).toEqual(baseline)
    expect(plan.changes.delete).toEqual([target.id])
    expect(plan.changes.create).toHaveLength(2)
    const childUpdate = plan.changes.update.find((update) => update.id === door.id)
    expect(childUpdate?.data.parentId).not.toBe(target.id)
    expect(
      plan.changes.create?.find((entry) => entry.node.id === childUpdate?.data.parentId)?.node
        .children,
    ).toContain(door.id)
  })
  test('rejects a split through an opening before any source graph change', () => {
    const { nodes, source } = fixture(2)
    const baseline = structuredClone(nodes)
    expect(() =>
      buildWallEndpointEditPlan(nodes, {
        wall: source,
        endpoint: 'end',
        start: source.start,
        end: [2, 2],
        detach: false,
      }),
    ).toThrow()
    expect(nodes).toEqual(baseline)
  })
})
