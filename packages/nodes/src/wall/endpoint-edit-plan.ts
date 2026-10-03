import {
  type AnyNode,
  type AnyNodeId,
  buildWallEndpointUpdates,
  type WallNode,
  WallOperationError,
} from '@pascal-app/core'
import { planEndpointWallSplit, type WallPlanPoint } from '@pascal-app/editor'

export function buildWallEndpointEditPlan(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    wall: WallNode
    endpoint: 'start' | 'end'
    start: WallPlanPoint
    end: WallPlanPoint
    detach: boolean
    radius?: number
  },
) {
  const provisional = buildWallEndpointUpdates(nodes, args.wall.id, args.start, args.end, {
    detachLinkedWalls: args.detach,
  })
  const movingPoint = args.endpoint === 'start' ? args.start : args.end
  const split = planEndpointWallSplit({
    nodes,
    point: movingPoint,
    levelId: args.wall.parentId ?? null,
    ignoreWallIds: provisional
      .filter((update) => nodes[update.id]?.type === 'wall')
      .map((update) => update.id),
    radius: args.radius,
  })
  if (split?.blocked)
    throw new WallOperationError('attachment-crosses-split', '벽 분할 위치가 부착물과 겹칩니다.')
  const point = split?.point ?? movingPoint
  const updates = buildWallEndpointUpdates(
    nodes,
    args.wall.id,
    args.endpoint === 'start' ? point : args.start,
    args.endpoint === 'end' ? point : args.end,
    { detachLinkedWalls: args.detach },
  )
  const changes = { ...split?.changes, update: [...updates, ...(split?.changes.update ?? [])] }
  const finalNodes = { ...nodes }
  for (const entry of changes.create ?? []) finalNodes[entry.node.id] = entry.node
  for (const update of changes.update)
    finalNodes[update.id] = { ...finalNodes[update.id], ...update.data } as AnyNode
  for (const id of changes.delete ?? []) delete finalNodes[id]
  for (const entry of changes.create ?? []) {
    if (entry.node.type === 'wall')
      buildWallEndpointUpdates(finalNodes, entry.node.id, entry.node.start, entry.node.end)
  }
  return { changes, updates }
}
