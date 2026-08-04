import { type AnyNode, type AnyNodeId, createSceneApi, useScene } from '@pascal-app/core'
import { create } from 'zustand'
import useInteractionScope from '../store/use-interaction-scope'
import { handleDragInfo } from './interaction/scope'

/**
 * Alt-toggled copy mode for move / rotate gestures, common to every node kind.
 *
 * A clean Alt tap during an active gesture stations a TWIN of the node at its
 * pre-gesture transform; a second tap removes it. Committing the gesture then
 * reads as copy-and-move (the twin stays behind, the original lands at the new
 * spot) without any commit path knowing about copying — the store still holds
 * the original transform during a drag, since live previews go through
 * `useLiveNodeOverrides` / `useLiveTransforms`.
 */

type MoveCopyState = {
  twinId: AnyNodeId | null
  sourceId: AnyNodeId | null
  /** Source transform at station time — the commit-vs-cancel telltale. */
  snapshot: string | null
}

export const useMoveCopyMode = create<MoveCopyState>(() => ({
  twinId: null,
  sourceId: null,
  snapshot: null,
}))

const transformKey = (node: AnyNode) => {
  const record = node as { position?: unknown; rotation?: unknown }
  return JSON.stringify({ p: record.position ?? null, r: record.rotation ?? null })
}

/** Node id the copy toggle applies to — an active move or handle drag. */
function sessionNodeId(): AnyNodeId | null {
  const scope = useInteractionScope.getState().scope
  if (scope.kind === 'moving') return scope.nodeId as AnyNodeId
  const drag = handleDragInfo(scope)
  return drag ? (drag.nodeId as AnyNodeId) : null
}

export function toggleMoveCopy(): 'copied' | 'cleared' | null {
  const state = useMoveCopyMode.getState()
  if (state.twinId) {
    useMoveCopyMode.setState({ twinId: null, sourceId: null, snapshot: null })
    useScene.getState().deleteNode(state.twinId)
    return 'cleared'
  }
  const nodeId = sessionNodeId()
  if (!nodeId) return null
  const node = useScene.getState().nodes[nodeId]
  if (!node) return null
  const api = createSceneApi(useScene)
  const subtree = api.getSubtree(nodeId)
  if (!subtree) return null
  const twinId = api.cloneNodesInto([subtree.root, ...subtree.descendants], { rootId: nodeId })
  if (!twinId) return null
  useMoveCopyMode.setState({
    twinId: twinId as AnyNodeId,
    sourceId: nodeId,
    snapshot: transformKey(node),
  })
  return 'copied'
}

// Commit handlers run synchronously with the pointer-up that also ends the
// scope, but the two orderings differ per path — settle both by checking after
// the current task (and any batched React work) has flushed.
// ponytail: fixed delay; a commit that lands later than this loses its twin.
const SESSION_SETTLE_MS = 120

/**
 * Gesture over. A cancelled (or committed-in-place) gesture leaves the source
 * exactly where the twin stands — remove the twin so Esc never mints a stacked
 * duplicate. A real move/rotate keeps it: that IS the copy.
 */
export function endMoveCopySession(): void {
  const { twinId, sourceId, snapshot } = useMoveCopyMode.getState()
  if (!twinId) return
  useMoveCopyMode.setState({ twinId: null, sourceId: null, snapshot: null })
  setTimeout(() => {
    const source = sourceId ? useScene.getState().nodes[sourceId] : null
    if (source && snapshot && transformKey(source) === snapshot) {
      useScene.getState().deleteNode(twinId)
    }
  }, SESSION_SETTLE_MS)
}
