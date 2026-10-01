'use client'

import {
  type AnyNodeId,
  AxisGuideStretchError,
  type AxisGuideStretchPlan,
  buildAxisGuideStretchPlan,
  type ConstructionGuideNode,
  type DimensionStretchPlan,
  detectSpacesForLevel,
  pauseSpaceDetection,
  resumeSpaceDetection,
  runAsSingleSceneHistoryStep,
  type Space,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import { parseSignedDraftLength } from '../../lib/draft-length-input'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

type GuideAxis = 'x' | 'z' | null

const AXIS_EPSILON = 1e-6

export function constructionGuideAxis(direction: readonly [number, number]): GuideAxis {
  const [dx, dz] = direction
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= AXIS_EPSILON) return null
  const normalizedDx = Math.abs(dx) / length
  const normalizedDz = Math.abs(dz) / length
  if (normalizedDx <= AXIS_EPSILON && normalizedDz > AXIS_EPSILON) return 'x'
  if (normalizedDz <= AXIS_EPSILON && normalizedDx > AXIS_EPSILON) return 'z'
  return null
}

function stretchErrorMessage(error: AxisGuideStretchError, t: ReturnType<typeof useT>): string {
  switch (error.code) {
    case 'invalid-distance':
    case 'guide-not-found':
    case 'guide-parent-missing':
    case 'guide-parent-not-level':
    case 'invalid-guide-direction':
      return t('actionMenu.guideStretchInvalid')
    case 'unsupported-crossing-wall':
      return t('actionMenu.guideStretchUnsupported')
    case 'attachment-outside-wall':
    case 'attachment-collision':
    case 'wall-collapse':
    case 'wall-reversal':
    case 'broken-wall-junction':
    case 'invalid-zone':
    case 'invalid-wall':
      return t('actionMenu.guideStretchConflict')
    default:
      return t('actionMenu.guideStretchFailed')
  }
}

function refreshSelectedLevelSpaces(levelId: string): void {
  const nodes = useScene.getState().nodes
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
  const detected = detectSpacesForLevel(levelId, walls).spaces
  const current = useEditor.getState().spaces
  const next: Record<string, Space> = Object.fromEntries(
    Object.entries(current).filter(([, space]) => space.levelId !== levelId),
  )
  for (const space of detected) next[space.id] = space
  useEditor.getState().setSpaces(next)
}

export function applyConstructionGuideStretchPlan(
  plan: AxisGuideStretchPlan,
  levelId: string,
): void {
  applyStretchUpdates(plan.updates, levelId)
}

/**
 * Apply any validated planar stretch through the same scene transaction used
 * by construction guides. Dimension edits also move/reconcile spaces, so
 * keeping the pause, batched update, and refresh in one helper prevents a
 * second history or reactive-space path from being introduced.
 */
function applyStretchUpdates(updates: AxisGuideStretchPlan['updates'], levelId: string): void {
  if (updates.length === 0) return
  runAsSingleSceneHistoryStep(useScene, () => {
    pauseSpaceDetection()
    try {
      useScene.getState().updateNodes(updates)
    } finally {
      resumeSpaceDetection()
    }
  })
  refreshSelectedLevelSpaces(levelId)
}

export function applyDimensionStretchPlan(
  plan: Pick<DimensionStretchPlan, 'updates'>,
  levelId: string,
): void {
  applyStretchUpdates(plan.updates, levelId)
}

export function ConstructionGuideStretchControls({ guide }: { guide: ConstructionGuideNode }) {
  const t = useT()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const axis = constructionGuideAxis(guide.direction)
  const parsedDistance = parseSignedDraftLength(raw, unit, metricNotation)
  const canApply = axis !== null && parsedDistance !== null && Math.abs(parsedDistance) > 1e-6

  const apply = (side: -1 | 1) => {
    if (!canApply || parsedDistance === null) {
      setError(t('actionMenu.guideStretchInvalid'))
      return
    }
    try {
      const currentNodes = useScene.getState().nodes
      const currentGuide = currentNodes[guide.id as AnyNodeId]
      if (currentGuide?.type !== 'construction-guide') {
        throw new AxisGuideStretchError(
          'guide-not-found',
          'The selected guide is no longer available.',
        )
      }
      const plan = buildAxisGuideStretchPlan(currentNodes, {
        guideId: currentGuide.id,
        side,
        distance: parsedDistance,
      })
      if (plan.updates.length > 0) {
        if (currentGuide.parentId) {
          applyConstructionGuideStretchPlan(plan, currentGuide.parentId)
        }
        sfxEmitter.emit('sfx:structure-build')
      }
      setRaw('')
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof AxisGuideStretchError
          ? stretchErrorMessage(caught, t)
          : t('actionMenu.guideStretchFailed'),
      )
    }
  }

  const isVertical = axis === 'x'
  const leftLabel = isVertical ? t('actionMenu.guideStretchLeft') : t('actionMenu.guideStretchUp')
  const rightLabel = isVertical
    ? t('actionMenu.guideStretchRight')
    : t('actionMenu.guideStretchDown')

  return (
    <div
      className="pointer-events-auto mt-1 w-[17rem] rounded-lg border border-border/60 bg-background/95 p-2 shadow-elevation-3 backdrop-blur-md"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t('actionMenu.guideStretchDistance')}
      </div>
      <input
        aria-label={t('actionMenu.guideStretchDistance')}
        className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none focus:border-cyan-400"
        onChange={(event) => {
          setRaw(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setRaw('')
            setError(null)
          }
        }}
        placeholder={
          unit === 'imperial' ? '0 ft' : metricNotation === 'millimeters' ? '0 mm' : '0 m'
        }
        value={raw}
      />
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <button
          aria-label={leftLabel}
          className="h-8 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canApply}
          onClick={() => apply(-1)}
          type="button"
        >
          {leftLabel}
        </button>
        <button
          aria-label={rightLabel}
          className="h-8 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canApply}
          onClick={() => apply(1)}
          type="button"
        >
          {rightLabel}
        </button>
      </div>
      {axis === null ? (
        <p className="mt-1 text-[11px] text-destructive">{t('actionMenu.guideStretchInvalid')}</p>
      ) : error ? (
        <p aria-live="polite" className="mt-1 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
