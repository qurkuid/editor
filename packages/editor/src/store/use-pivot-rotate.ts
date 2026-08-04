'use client'

import {
  type AnyNode,
  type AnyNodeId,
  pauseSpaceDetection,
  resumeSpaceDetection,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import {
  collectParticipants,
  type LinkedNeighbor,
  type ParticipantStart,
  rotateGroupPatches,
  type Vec3,
} from '../components/editor/group-transform-shared'
import { isHistoryShortcut } from '../lib/history'
import {
  MIN_REFERENCE_DISTANCE,
  type PivotPlanPoint,
  type PivotRotateAxis,
  parseTypedAngle,
  resolveRotateDelta,
  rotateVec3PatchesAboutAxis,
  typedAngleToDelta,
} from '../lib/pivot-rotate-math'
import { sfxEmitter } from '../lib/sfx-bus'
import useEditor from './use-editor'
import useInteractionScope from './use-interaction-scope'

// SketchUp-style pivot rotate, entered from the bottom action menu's Rotate
// button. One shared state machine drives both the 2D floor-plan layer and the
// 3D tool layer: the views translate pointer input into level-frame plan
// points and render the protractor chrome; every scene effect (live preview
// via `useLiveNodeOverrides`, single-undo commit, cancel revert) lives here.
//
// Stages: pivot (click 1 places the rotation center) → reference (click 2
// places the zero-angle arm) → angle (cursor sweeps / digits type the angle;
// click or Enter commits, Escape cancels).

export type PivotRotateStage = 'idle' | 'pivot' | 'reference' | 'angle'

export const PIVOT_ROTATE_TOOL = 'pivot-rotate'

type PivotRotateState = {
  stage: PivotRotateStage
  /** The originally selected ids, re-selected when the gesture ends. */
  nodeIds: string[]
  pivot: PivotPlanPoint | null
  reference: PivotPlanPoint | null
  cursor: PivotPlanPoint | null
  /** Currently previewed rotation delta (internal x→z sense), radians. */
  delta: number
  /** Typed-angle buffer (degrees); mouse movement clears it. */
  typedDigits: string
  /** Rotation axis; arrow keys switch it (← x · ↑ y · → z). */
  axis: PivotRotateAxis
  /**
   * X/Z rotation is representable only when every participant carries a full
   * 3D rotation (items) — walls / polygons / scalar kinds are plan-only.
   */
  horizontalAxesAllowed: boolean
  setAxis: (axis: PivotRotateAxis) => void
  /** Begin the gesture on the given selection. False when nothing rotates. */
  start: (ids: string[]) => boolean
  /** Advance the click sequence: pivot → reference → commit. */
  placePoint: (point: PivotPlanPoint) => void
  updateCursor: (point: PivotPlanPoint, free: boolean) => void
  commit: () => void
  cancel: () => void
}

// Non-reactive per-gesture context (snapshots + listeners), reset on finish.
let ctx: {
  starts: ParticipantStart[]
  links: LinkedNeighbor[]
  affectedIds: AnyNodeId[]
  onKeyDown: (event: KeyboardEvent) => void
  unsubscribeEditor: () => void
} | null = null

const IDLE = {
  stage: 'idle' as const,
  nodeIds: [] as string[],
  pivot: null,
  reference: null,
  cursor: null,
  delta: 0,
  typedDigits: '',
  axis: 'y' as PivotRotateAxis,
  horizontalAxesAllowed: false,
}

const usePivotRotate = create<PivotRotateState>((set, get) => {
  const applyPreview = (delta: number) => {
    const { pivot, axis } = get()
    if (!(ctx && pivot)) return
    const patches =
      axis === 'y'
        ? rotateGroupPatches(ctx.starts, ctx.links, pivot, delta)
        : rotateVec3PatchesAboutAxis(ctx.starts, pivot, axis, delta)
    const patchById = new Map(patches)
    const liveTransforms = useLiveTransforms.getState()
    for (const s of ctx.starts) {
      if (s.kind === 'scalar') {
        const patch = patchById.get(s.id)
        if (patch) {
          liveTransforms.set(s.id, {
            position: patch.position as Vec3,
            rotation: patch.rotation as number,
          })
        }
      }
      useScene.getState().markDirty(s.id)
    }
    for (const l of ctx.links) {
      useScene.getState().markDirty(l.id)
    }
    useLiveNodeOverrides.getState().setMany(patches)
    set({ delta })
  }

  const clearPreviews = () => {
    if (!ctx) return
    const overrides = useLiveNodeOverrides.getState()
    const liveTransforms = useLiveTransforms.getState()
    for (const id of ctx.affectedIds) {
      overrides.clear(id)
      liveTransforms.clear(id)
      useScene.getState().markDirty(id)
    }
  }

  // Shared teardown for commit and cancel. Commit resumes history itself
  // (before its single tracked `updateNodes`), so it passes false here.
  const finish = (resumeHistory: boolean) => {
    // Unsubscribe before the setMode below clears the tool, or the watchdog
    // re-enters cancel() mid-teardown.
    ctx?.unsubscribeEditor()
    if (ctx && typeof window !== 'undefined') {
      window.removeEventListener('keydown', ctx.onKeyDown, true)
    }
    if (resumeHistory) useScene.temporal.getState().resume()
    useInteractionScope
      .getState()
      .endIf((s) => s.kind === 'drafting' && s.tool === PIVOT_ROTATE_TOOL)
    useEditor.getState().setMode('select')
    const nodes = useScene.getState().nodes
    const survivors = get().nodeIds.filter((id) => nodes[id as AnyNodeId])
    if (survivors.length > 0) useViewer.getState().setSelection({ selectedIds: survivors })
    ctx = null
    set(IDLE)
  }

  return {
    ...IDLE,

    setAxis: (axis) => {
      const state = get()
      if (state.stage === 'idle' || axis === state.axis) return
      if (axis !== 'y' && !state.horizontalAxesAllowed) return
      set({ axis })
      if (state.stage === 'angle') applyPreview(state.delta)
    },

    start: (ids) => {
      if (get().stage !== 'idle' || ids.length === 0) return false
      const levelId = useViewer.getState().selection.levelId
      if (!levelId) return false
      const { starts, links } = collectParticipants(ids, useScene.getState().nodes, levelId)
      if (starts.length === 0) return false

      const onKeyDown = (event: KeyboardEvent) => {
        const state = get()
        if (state.stage === 'idle') return
        if (event.key === 'Escape' || isHistoryShortcut(event)) {
          event.preventDefault()
          event.stopPropagation()
          state.cancel()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          if (state.stage === 'angle') state.commit()
          return
        }
        const arrowAxis =
          event.key === 'ArrowLeft'
            ? 'x'
            : event.key === 'ArrowUp'
              ? 'y'
              : event.key === 'ArrowRight'
                ? 'z'
                : null
        if (arrowAxis) {
          event.preventDefault()
          event.stopPropagation()
          state.setAxis(arrowAxis)
          return
        }
        if (state.stage !== 'angle' || event.metaKey || event.ctrlKey || event.altKey) return
        let nextDigits: string | null = null
        if (/^[0-9.]$/.test(event.key)) nextDigits = state.typedDigits + event.key
        else if (event.key === '-' && state.typedDigits === '') nextDigits = '-'
        else if (event.key === 'Backspace') nextDigits = state.typedDigits.slice(0, -1)
        if (nextDigits === null) return
        event.preventDefault()
        event.stopPropagation()
        set({ typedDigits: nextDigits })
        const degrees = parseTypedAngle(nextDigits)
        if (degrees !== null) applyPreview(typedAngleToDelta(degrees))
      }

      // Leave site editing first (mirrors the other bottom-menu controls),
      // then hold build mode with a non-registry tool id so click-to-select
      // and every placement tool stay disarmed for the whole gesture. The
      // selection itself is kept so the rotating nodes stay highlighted;
      // conflicting gizmos hide via the pivot-rotate gates at their mounts.
      const editor = useEditor.getState()
      if (editor.phase === 'site') {
        editor.setPhase('structure')
        editor.setStructureLayer('elements')
      }
      useEditor.getState().setMode('build')
      useEditor.getState().setTool(PIVOT_ROTATE_TOOL)

      ctx = {
        starts,
        links,
        affectedIds: [...starts.map((s) => s.id), ...links.map((l) => l.id)],
        onKeyDown,
        // Anything that steals the tool slot mid-gesture (mode shortcuts,
        // another bottom-menu control, a phase switch) cancels the rotate so
        // it can never linger over a foreign tool.
        unsubscribeEditor: useEditor.subscribe((state) => {
          if (state.tool !== PIVOT_ROTATE_TOOL) get().cancel()
        }),
      }
      useScene.temporal.getState().pause()
      useInteractionScope.getState().begin({ kind: 'drafting', tool: PIVOT_ROTATE_TOOL })
      if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown, true)
      sfxEmitter.emit('sfx:item-pick')
      set({
        ...IDLE,
        stage: 'pivot',
        nodeIds: ids,
        horizontalAxesAllowed: starts.every((s) => s.kind === 'vec3') && links.length === 0,
      })
      return true
    },

    placePoint: (point) => {
      const state = get()
      if (state.stage === 'pivot') {
        sfxEmitter.emit('sfx:item-pick')
        set({ pivot: point, stage: 'reference', cursor: point })
      } else if (state.stage === 'reference') {
        const pivot = state.pivot
        if (!pivot) return
        if (Math.hypot(point.x - pivot.x, point.z - pivot.z) < MIN_REFERENCE_DISTANCE) return
        sfxEmitter.emit('sfx:item-pick')
        set({ reference: point, stage: 'angle', cursor: point })
      } else if (state.stage === 'angle') {
        state.commit()
      }
    },

    updateCursor: (point, free) => {
      const state = get()
      if (state.stage === 'idle') return
      set({ cursor: point })
      if (!(state.stage === 'angle' && state.pivot && state.reference)) return
      if (state.typedDigits !== '') set({ typedDigits: '' })
      applyPreview(resolveRotateDelta(state.pivot, state.reference, point, free))
    },

    commit: () => {
      const state = get()
      if (state.stage !== 'angle' || !ctx) return
      if (state.delta === 0) {
        // Nothing rotated — end without polluting scene history.
        clearPreviews()
        finish(true)
        return
      }
      const overrides = useLiveNodeOverrides.getState()
      const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
      for (const id of ctx.affectedIds) {
        const patch = overrides.get(id)
        if (patch) updates.push({ id, data: patch as Partial<AnyNode> })
      }
      sfxEmitter.emit('sfx:item-place')
      // Resume before the commit so the single batched `updateNodes` is the
      // one tracked set — the whole rotation collapses into one undo step.
      // Space detection stays out: rotating existing walls must not re-create
      // the room's auto floors/ceilings at the new bearing.
      pauseSpaceDetection()
      useScene.temporal.getState().resume()
      if (updates.length > 0) useScene.getState().updateNodes(updates)
      resumeSpaceDetection()
      clearPreviews()
      finish(false)
    },

    cancel: () => {
      if (get().stage === 'idle') return
      clearPreviews()
      finish(true)
    },
  }
})

export default usePivotRotate
