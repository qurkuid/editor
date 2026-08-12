import { cloneNodesInto, collectSubtree } from '../registry/subtree'
import { generateId } from '../schema/base'
import type { BodyNode } from '../schema/nodes/body'
import type { BodyGroupNode } from '../schema/nodes/body-group'
import type { ComponentNode } from '../schema/nodes/component'
import type { AnyNode, AnyNodeId } from '../schema/types'

export type BodyContainerNode = BodyGroupNode | ComponentNode

export type BodyContainerWrite = {
  readonly container: BodyContainerNode
  readonly bodyUpdates: readonly { readonly id: AnyNodeId; readonly data: Partial<BodyNode> }[]
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function isBodyContainerNode(node: AnyNode | undefined): node is BodyContainerNode {
  return node?.type === 'body-group' || node?.type === 'component'
}

export function bodyContainerChildren(
  node: BodyContainerNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): BodyNode[] {
  return node.children
    .map((id) => nodes[id])
    .filter((node): node is BodyNode => node?.type === 'body')
}

export function bodySiblingSelection(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bodyIds: readonly AnyNodeId[],
): { readonly bodyIds: readonly BodyNode['id'][]; readonly parentId: AnyNodeId | null } {
  const uniqueIds = [...new Set(bodyIds)]
  if (uniqueIds.length < 2) throw new RangeError('Select at least two Body nodes')
  const bodies = uniqueIds.map((id) => nodes[id])
  if (bodies.some((node) => node?.type !== 'body')) {
    throw new TypeError('Body containers only accept Body siblings')
  }
  const bodyNodes = bodies as BodyNode[]
  const parentId = bodyNodes[0]!.parentId as AnyNodeId | null
  if (bodyNodes.some((node) => node.parentId !== parentId)) {
    throw new RangeError('Body nodes must share a parent')
  }
  return { bodyIds: bodyNodes.map((node) => node.id), parentId }
}

export function createBodyGroupFromBodies(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bodyIds: readonly AnyNodeId[],
): BodyContainerWrite {
  const selection = bodySiblingSelection(nodes, bodyIds)
  const id = generateId('body-group')
  const container: BodyGroupNode = {
    object: 'node',
    id,
    type: 'body-group',
    parentId: selection.parentId,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: [...selection.bodyIds],
  }
  return {
    container,
    bodyUpdates: selection.bodyIds.map((id) => ({ id, data: { parentId: container.id } })),
  }
}

export function createComponentFromBodies(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bodyIds: readonly AnyNodeId[],
): BodyContainerWrite {
  const selection = bodySiblingSelection(nodes, bodyIds)
  const id = generateId('component')
  const container: ComponentNode = {
    object: 'node',
    id,
    type: 'component',
    parentId: selection.parentId,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: [...selection.bodyIds],
    definitionId: id,
  }
  return {
    container,
    bodyUpdates: selection.bodyIds.map((bodyId, index) => {
      const body = nodes[bodyId] as BodyNode
      return {
        id: bodyId,
        data: {
          parentId: container.id,
          metadata: { ...jsonObject(body.metadata), componentPartKey: `part-${index}` },
        },
      }
    }),
  }
}

export function cloneComponentInstance(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  sourceComponentId: AnyNodeId,
): { readonly rootId: AnyNodeId; readonly nodes: readonly AnyNode[] } {
  const source = nodes[sourceComponentId]
  if (source?.type !== 'component') throw new TypeError('Component source not found')
  const subtree = collectSubtree(nodes, source.id)
  if (!subtree) throw new TypeError('Component source subtree not found')
  const cloned = cloneNodesInto([subtree.root, ...subtree.descendants], {
    rootId: source.id,
    ...(source.parentId ? { parentId: source.parentId as AnyNodeId } : {}),
  })
  const clonedRoot = cloned.nodes[0]
  if (clonedRoot?.type !== 'component') throw new TypeError('Cloned component root is invalid')
  const component: ComponentNode = {
    ...clonedRoot,
    definitionId: source.definitionId ?? source.id,
  }
  return { rootId: cloned.rootId, nodes: [component, ...cloned.nodes.slice(1)] }
}

export function makeComponentUnique(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  componentId: AnyNodeId,
): { readonly id: AnyNodeId; readonly data: Partial<ComponentNode> } {
  const component = nodes[componentId]
  if (component?.type !== 'component') throw new TypeError('Component not found')
  return { id: component.id, data: { definitionId: component.id } }
}

export function componentBodyPeers(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bodyId: AnyNodeId,
): readonly AnyNodeId[] {
  const body = nodes[bodyId]
  if (body?.type !== 'body' || !body.parentId) return [bodyId]
  const component = nodes[body.parentId as AnyNodeId]
  if (component?.type !== 'component' || !component.definitionId) return [bodyId]
  const key = jsonObject(body.metadata).componentPartKey
  if (typeof key !== 'string') return [bodyId]
  const peers: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'component' || node.definitionId !== component.definitionId) continue
    for (const childId of node.children) {
      const child = nodes[childId]
      if (child?.type !== 'body') continue
      if (jsonObject(child.metadata).componentPartKey === key) peers.push(child.id)
    }
  }
  return peers.length > 0 ? peers : [bodyId]
}

export function linkedBodyUpdates(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bodyId: AnyNodeId,
  data: Partial<BodyNode>,
): readonly { readonly id: AnyNodeId; readonly data: Partial<BodyNode> }[] {
  const peers = componentBodyPeers(nodes, bodyId)
  const shared = Object.fromEntries(
    Object.entries(data).filter(
      ([key]) => !['id', 'type', 'object', 'parentId', 'metadata'].includes(key),
    ),
  ) as Partial<BodyNode>
  return peers.map((id) => ({ id, data: shared }))
}

export function explodeComponent(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  componentId: AnyNodeId,
): {
  readonly componentId: AnyNodeId
  readonly bodyUpdates: readonly { readonly id: AnyNodeId; readonly data: Partial<BodyNode> }[]
} {
  const component = nodes[componentId]
  if (component?.type !== 'component') throw new TypeError('Component not found')
  return {
    componentId: component.id,
    bodyUpdates: component.children.flatMap((childId) => {
      const body = nodes[childId]
      return body?.type === 'body'
        ? [{ id: body.id, data: { parentId: component.parentId, metadata: {} } }]
        : []
    }),
  }
}
