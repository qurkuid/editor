'use client'

import {
  type AnyNodeId,
  type WallNode,
  WallOperationError,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { lingoUnitSpec, measurementHint, parseMeasurement } from '../../../lib/measurement-parser'
import { useLinearDisplay } from '../../../lib/use-linear-display'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { ActionButton } from '../controls/action-button'

const WALL_LENGTH_SPEC = lingoUnitSpec('m')

function wallLength(wall: WallNode): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function wallOperationErrorMessage(error: unknown): string {
  return error instanceof WallOperationError
    ? error.message
    : '벽 편집을 적용할 수 없습니다.'
}

export function WallEditControls() {
  const mode = useEditor((state) => state.mode)
  const scopeKind = useInteractionScope((state) => state.scope.kind)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const selectedWalls = useScene(
    useShallow((state) =>
      selectedIds
        .map((id) => state.nodes[id as AnyNodeId])
        .filter((node): node is WallNode => node?.type === 'wall'),
    ),
  )
  const wall = selectedWalls.length === 1 ? selectedWalls[0] : null
  const selectedWallIds = useMemo(() => selectedWalls.map((node) => node.id), [selectedWalls])
  const length = wall ? wallLength(wall) : 0
  const { isImperial, isMillimeters, displayUnit, displayPrecision, toDisplay } = useLinearDisplay(
    'm',
    2,
  )
  const bareUnit = isImperial ? 'ft' : isMillimeters ? 'mm' : 'm'
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const formatDistance = useCallback(
    (meters: number) => toDisplay(meters).toFixed(displayPrecision),
    [displayPrecision, toDisplay],
  )
  const parseDistance = useCallback(
    (raw: string) => {
      if (!WALL_LENGTH_SPEC || !raw.trim()) return null
      return parseMeasurement(raw, WALL_LENGTH_SPEC, {
        bareUnit,
        system: isImperial ? 'us' : 'metric',
      })
    },
    [bareUnit, isImperial],
  )

  useEffect(() => {
    if (!wall) {
      setInputValue('')
      setError(null)
      return
    }
    const nextDistance = length / 2
    setInputValue(formatDistance(nextDistance))
    setError(null)
  }, [formatDistance, length, wall?.id])

  const hint = useMemo(() => {
    if (!WALL_LENGTH_SPEC || !inputValue.trim()) return null
    return measurementHint(inputValue, WALL_LENGTH_SPEC, {
      bareUnit,
      displayUnit: bareUnit,
      precision: displayPrecision,
      system: isImperial ? 'us' : 'metric',
    })
  }, [bareUnit, displayPrecision, inputValue, isImperial])

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value
      setInputValue(raw)
      setError(null)
    },
    [],
  )

  const handleMerge = useCallback(() => {
    setError(null)
    try {
      const mutation = useScene.getState().mergeWalls(selectedWallIds)
      if (!mutation) {
        setError('읽기 전용 장면에서는 벽을 합칠 수 없습니다.')
        return
      }
      setSelection({ selectedIds: [mutation.primaryWallId] })
    } catch (operationError) {
      setError(wallOperationErrorMessage(operationError))
    }
  }, [selectedWallIds, setSelection])

  const handleSplit = useCallback(() => {
    const parsed = parseDistance(inputValue)
    if (parsed === null || !Number.isFinite(parsed)) {
      setError('벽 분리 거리를 입력하세요.')
      return
    }

    setError(null)
    try {
      if (!wall) return
      const mutation = useScene.getState().splitWall(wall.id, parsed)
      if (!mutation) {
        setError('읽기 전용 장면에서는 벽을 분리할 수 없습니다.')
        return
      }
      setSelection({
        selectedIds: [mutation.primaryWallId, ...mutation.createdNodeIds],
      })
    } catch (operationError) {
      setError(wallOperationErrorMessage(operationError))
    }
  }, [inputValue, parseDistance, setSelection, wall])

  if (mode !== 'select' || scopeKind !== 'idle') return null
  if (selectedWalls.length < 1 || selectedWalls.length !== selectedIds.length) return null
  if (selectedWalls.length === 1 && wall) {
    return (
      <div className="pointer-events-auto col-span-2 mt-1 border-border/40 border-t pt-2">
        <label className="mb-1 block text-muted-foreground text-[11px]" htmlFor={inputId}>
          벽 분리 거리
        </label>
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-border/50 bg-background/70 px-2">
            <input
              aria-describedby={error ? errorId : hint ? `${inputId}-hint` : undefined}
              aria-invalid={Boolean(error)}
              className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-foreground text-xs outline-none"
              id={inputId}
              onChange={handleInputChange}
              type="text"
              value={inputValue}
            />
            <span className="shrink-0 text-muted-foreground text-[10px]">{displayUnit}</span>
          </div>
          <ActionButton
            aria-label="벽 분리"
            className="h-9 flex-none px-2"
            label="벽 분리"
            onClick={handleSplit}
            type="button"
          />
        </div>
        {hint ? (
          <div className="mt-1 text-[10px] text-muted-foreground/70" id={`${inputId}-hint`}>
            {hint}
          </div>
        ) : null}
        {error ? (
          <div className="mt-1 text-[10px] text-red-300" id={errorId} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    )
  }

  if (selectedWalls.length < 2 || selectedWalls.length !== selectedIds.length) return null
  return (
    <div className="pointer-events-auto col-span-2 mt-1 border-border/40 border-t pt-2">
      <ActionButton
        aria-label="벽 합치기"
        className="w-full"
        label="벽 합치기"
        onClick={handleMerge}
        type="button"
      />
      {error ? (
        <div className="mt-1 text-[10px] text-red-300" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}
