import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  cloneComponentInstance,
  componentBodyPeers,
  createBodyGroupFromBodies,
  createComponentFromBodies,
  explodeComponent,
  linkedBodyUpdates,
  makeComponentUnique,
} from './body-containers'
import { createRectangleBody } from './body-topology'

function scene() {
  const first = createRectangleBody({ width: 1, depth: 1 })
  const second = createRectangleBody({ width: 2, depth: 1 })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [first.id]: { ...first, parentId: 'level_test' as AnyNodeId },
    [second.id]: { ...second, parentId: 'level_test' as AnyNode },
  }
  return { nodes, first, second }
}

describe('persistent Body containers', () => {
  test('groups only sibling Bodies and returns reparent writes', () => {
    const { nodes, first, second } = scene()
    const result = createBodyGroupFromBodies(nodes, [first.id, second.id])
    expect(result.container.type).toBe('body-group')
    expect(result.container.children).toEqual([first.id, second.id])
    expect(result.bodyUpdates.map((update) => update.data.parentId)).toEqual([
      result.container.id,
      result.container.id,
    ])
  })

  test('assigns stable part keys and links cloned component instances', () => {
    const { nodes, first, second } = scene()
    const write = createComponentFromBodies(nodes, [first.id, second.id])
    const sourceNodes: Record<AnyNodeId, AnyNode> = {
      ...nodes,
      [write.container.id]: write.container,
      [first.id]: {
        ...nodes[first.id]!,
        parentId: write.container.id,
        metadata: { componentPartKey: 'part-0' },
      },
      [second.id]: {
        ...nodes[second.id]!,
        parentId: write.container.id,
        metadata: { componentPartKey: 'part-1' },
      },
    }
    const clone = cloneComponentInstance(sourceNodes, write.container.id)
    const clonedRoot = clone.nodes[0]
    expect(clonedRoot?.type).toBe('component')
    expect(clonedRoot?.id).not.toBe(write.container.id)
    const allNodes = Object.fromEntries([
      ...Object.entries(sourceNodes),
      ...clone.nodes.map((node) => [node.id, node]),
    ]) as Record<AnyNodeId, AnyNode>
    const peers = componentBodyPeers(allNodes, first.id)
    expect(peers).toHaveLength(2)
    expect(linkedBodyUpdates(allNodes, first.id, { revision: 4 })[1]?.data.revision).toBe(4)
  })

  test('make unique and explode preserve one-step write intent', () => {
    const { nodes, first, second } = scene()
    const write = createComponentFromBodies(nodes, [first.id, second.id])
    const component = write.container
    const withComponent: Record<AnyNodeId, AnyNode> = {
      ...nodes,
      [component.id]: component,
      [first.id]: { ...nodes[first.id]!, parentId: component.id },
      [second.id]: { ...nodes[second.id]!, parentId: component.id },
    }
    expect(makeComponentUnique(withComponent, component.id).data.definitionId).toBe(component.id)
    const exploded = explodeComponent(withComponent, component.id)
    expect(exploded.bodyUpdates).toHaveLength(2)
    expect(
      exploded.bodyUpdates.every((update) => update.data.parentId === component.parentId),
    ).toBe(true)
  })
})
