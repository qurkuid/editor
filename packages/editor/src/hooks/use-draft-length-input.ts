import { emitter, type GridEvent } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'
import { parseDraftLength, replayDraftMove } from '../lib/draft-length-input'
import { useDraftLengthHud } from '../store/use-draft-length-hud'

const FIRST_INPUT_KEY = /^\d$/
const CONTINUED_INPUT_KEY = /^[\d.a-z'"-]$/i

export interface DraftLengthInput {
  raw: string
  clear: () => void
  getLengthMeters: () => number | null
}

export function useDraftLengthInput(isActive: () => boolean): DraftLengthInput {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const raw = useDraftLengthHud((state) => state.raw)
  const rawRef = useRef(raw)
  const activeRef = useRef(isActive)
  const unitRef = useRef(unit)
  const metricNotationRef = useRef(metricNotation)
  const lastGridMoveRef = useRef<GridEvent | null>(null)
  activeRef.current = isActive
  unitRef.current = unit
  metricNotationRef.current = metricNotation

  const updateRaw = useCallback((next: string) => {
    rawRef.current = next
    useDraftLengthHud.getState().setRaw(next)
  }, [])

  const clear = useCallback(() => updateRaw(''), [updateRaw])
  const getLengthMeters = useCallback(
    () =>
      parseDraftLength(
        useDraftLengthHud.getState().raw,
        unitRef.current,
        metricNotationRef.current,
      ),
    [],
  )
  const replayLatestMove = useCallback(() => {
    replayDraftMove(lastGridMoveRef.current, (event) => emitter.emit('grid:move', event))
  }, [])

  useEffect(() => {
    const rememberGridMove = (event: GridEvent) => {
      lastGridMoveRef.current = event
    }
    emitter.on('grid:move', rememberGridMove)
    return () => emitter.off('grid:move', rememberGridMove)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current()) return

      let handled = false
      if (event.key === 'Backspace' && rawRef.current) {
        updateRaw(rawRef.current.slice(0, -1))
        handled = true
      } else if (event.key === 'Escape' && rawRef.current) {
        clear()
        handled = true
      } else if (
        (rawRef.current ? CONTINUED_INPUT_KEY : FIRST_INPUT_KEY).test(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        updateRaw(rawRef.current + event.key)
        handled = true
      }

      if (!handled) return
      replayLatestMove()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      clear()
    }
  }, [clear, replayLatestMove, updateRaw])

  return { raw, clear, getLengthMeters }
}
