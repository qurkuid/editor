import {
  buildWallMerge,
  buildWallSplit,
  buildWallSplitAtContacts,
  type WallMutation,
} from '../../lib/wall-operations'
import type { AnyNodeId } from '../../schema/types'
import type { SceneState } from '../use-scene'

type SceneSet = (fn: (state: SceneState) => Partial<SceneState>) => void
type SceneGet = () => SceneState

function applyWallMutation(set: SceneSet, get: SceneGet, mutation: WallMutation) {
  set(() => ({
    nodes: mutation.nodes,
    rootNodeIds: mutation.rootNodeIds,
    collections: mutation.collections,
  }))
  for (const id of mutation.deletedNodeIds) get().clearDirty(id)
  for (const id of mutation.changedNodeIds) {
    if (get().nodes[id]) get().markDirty(id)
  }
  for (const id of mutation.createdNodeIds) get().markDirty(id)
  return mutation
}

export function mergeWallsAction(set: SceneSet, get: SceneGet, wallIds: AnyNodeId[]) {
  if (get().readOnly) return undefined
  const mutation = buildWallMerge(
    { nodes: get().nodes, rootNodeIds: get().rootNodeIds, collections: get().collections },
    wallIds,
  )
  return applyWallMutation(set, get, mutation)
}

export function splitWallAction(
  set: SceneSet,
  get: SceneGet,
  wallId: AnyNodeId,
  distanceFromStart: number,
  requestedSecondWallId?: AnyNodeId,
) {
  if (get().readOnly) return undefined
  const mutation = buildWallSplit(
    { nodes: get().nodes, rootNodeIds: get().rootNodeIds, collections: get().collections },
    wallId,
    distanceFromStart,
    requestedSecondWallId,
  )
  return applyWallMutation(set, get, mutation)
}

export function splitWallAtContactsAction(set: SceneSet, get: SceneGet, wallId: AnyNodeId) {
  if (get().readOnly) return undefined
  const mutation = buildWallSplitAtContacts(
    { nodes: get().nodes, rootNodeIds: get().rootNodeIds, collections: get().collections },
    wallId,
  )
  return applyWallMutation(set, get, mutation)
}
