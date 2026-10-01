import type { Collection, CollectionId } from '../schema/collections'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'

let sceneHistoryPauseDepth = 0

export type SceneSnapshot = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections: Record<CollectionId, Collection>
  materials: Record<SceneMaterialId, SceneMaterial>
  installedPlugins: string[]
}

export type SceneCommitOrigin = 'local' | 'load' | 'host'

export type SceneCommit = {
  origin: SceneCommitOrigin
  before: SceneSnapshot
  current: SceneSnapshot
}

export type SceneCommitListener = (commit: SceneCommit) => void

type TemporalStoreLike = {
  temporal: {
    getState(): {
      pause(): void
      resume(): void
    }
  }
}

type TemporalHistoryState<TPastState> = {
  pastStates: TPastState[]
}

type TemporalHistoryStoreLike<TPastState> = {
  temporal: {
    getState(): TemporalHistoryState<TPastState>
    setState(state: { pastStates: TPastState[] }): void
    subscribe(
      listener: (
        state: TemporalHistoryState<TPastState>,
        previousState: TemporalHistoryState<TPastState>,
      ) => void,
    ): () => void
  }
}

const sceneCommitListeners = new Set<SceneCommitListener>()
let sceneCommitTransactionDepth = 0
let pendingSceneCommit: SceneCommit | null = null

function areSemanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right)) || left.length !== right.length) return false
    return left.every((value, index) => areSemanticValuesEqual(value, right[index]))
  }

  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!(key in rightRecord) || !areSemanticValuesEqual(leftRecord[key], rightRecord[key])) {
      return false
    }
  }
  return true
}

export function areSceneSnapshotsEqual(left: SceneSnapshot, right: SceneSnapshot): boolean {
  return (
    areSemanticValuesEqual(left.nodes, right.nodes) &&
    areSemanticValuesEqual(left.rootNodeIds, right.rootNodeIds) &&
    areSemanticValuesEqual(left.collections, right.collections) &&
    areSemanticValuesEqual(left.materials, right.materials) &&
    areSemanticValuesEqual(left.installedPlugins, right.installedPlugins)
  )
}

export function subscribeSceneCommits(listener: SceneCommitListener): () => void {
  sceneCommitListeners.add(listener)
  return () => {
    sceneCommitListeners.delete(listener)
  }
}

function emitSceneCommit(commit: SceneCommit): void {
  for (const listener of [...sceneCommitListeners]) {
    try {
      listener(commit)
    } catch (error) {
      console.error('[Scene] Scene commit listener failed', error)
    }
  }
}

export function notifySceneCommit(commit: SceneCommit): void {
  if (areSceneSnapshotsEqual(commit.before, commit.current)) return

  if (sceneCommitTransactionDepth > 0) {
    if (pendingSceneCommit) {
      pendingSceneCommit = {
        origin: pendingSceneCommit.origin,
        before: pendingSceneCommit.before,
        current: commit.current,
      }
    } else {
      pendingSceneCommit = commit
    }
    return
  }

  emitSceneCommit(commit)
}

function beginSceneCommitTransaction(): void {
  sceneCommitTransactionDepth += 1
}

function pendingSceneCommitIsNoOp(): boolean {
  return Boolean(
    pendingSceneCommit &&
      areSceneSnapshotsEqual(pendingSceneCommit.before, pendingSceneCommit.current),
  )
}

function endSceneCommitTransaction(): void {
  if (sceneCommitTransactionDepth === 0) return
  sceneCommitTransactionDepth -= 1
  if (sceneCommitTransactionDepth > 0) return

  const commit = pendingSceneCommit
  pendingSceneCommit = null
  if (commit && !areSceneSnapshotsEqual(commit.before, commit.current)) {
    emitSceneCommit(commit)
  }
}

export function pauseSceneHistory(sceneStore: TemporalStoreLike): void {
  if (sceneHistoryPauseDepth === 0) {
    sceneStore.temporal.getState().pause()
  }
  sceneHistoryPauseDepth += 1
}

export function resumeSceneHistory(sceneStore: TemporalStoreLike): void {
  if (sceneHistoryPauseDepth === 0) {
    return
  }

  sceneHistoryPauseDepth -= 1
  if (sceneHistoryPauseDepth === 0) {
    sceneStore.temporal.getState().resume()
  }
}

export function getSceneHistoryPauseDepth(): number {
  return sceneHistoryPauseDepth
}

export function resetSceneHistoryPauseDepth(): void {
  sceneHistoryPauseDepth = 0
}

export function runAsSingleSceneHistoryStep<TPastState, TResult>(
  sceneStore: TemporalHistoryStoreLike<TPastState>,
  run: () => TResult,
): TResult {
  const beforePastStates = [...sceneStore.temporal.getState().pastStates]
  let firstAddedPastStates: TPastState[] | null = null
  const unsubscribe = sceneStore.temporal.subscribe((state, previousState) => {
    if (firstAddedPastStates !== null) return
    if (state.pastStates.length !== previousState.pastStates.length + 1) return
    firstAddedPastStates = [...state.pastStates]
  })
  beginSceneCommitTransaction()
  try {
    const result = run()
    if (firstAddedPastStates !== null) {
      sceneStore.temporal.setState({
        pastStates: pendingSceneCommitIsNoOp() ? beforePastStates : firstAddedPastStates,
      })
    }
    return result
  } finally {
    unsubscribe()
    endSceneCommitTransaction()
  }
}
