import { emitter, type GridEvent } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'
import {
  parseDraftLength,
  parseSignedDraftLength,
  replayDraftMove,
} from '../lib/draft-length-input'
import { useDraftLengthHud } from '../store/use-draft-length-hud'

const FIRST_INPUT_KEY = /^\d$/
const CONTINUED_INPUT_KEY = /^[\d.a-z'"-]$/i
const SIGNED_FIRST_INPUT_KEY = /^[+\-\d]$/

export type DraftLengthInputOptions = {
  readonly onEscape?: () => void
  readonly signed?: boolean
}

export interface DraftLengthInput {
  raw: string
  clear: () => void
  getLengthMeters: () => number | null
}

export function useDraftLengthInput(
  isActive: () => boolean,
  options: DraftLengthInputOptions = {},
): DraftLengthInput {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const raw = useDraftLengthHud((state) => state.raw)
  const rawRef = useRef(raw)
  const activeRef = useRef(isActive)
  const unitRef = useRef(unit)
  const metricNotationRef = useRef(metricNotation)
  const signed = options.signed === true
  const onEscapeRef = useRef(options.onEscape)
  const signedRef = useRef(signed)
  const lastGridMoveRef = useRef<GridEvent | null>(null)
  activeRef.current = isActive
  unitRef.current = unit
  metricNotationRef.current = metricNotation
  signedRef.current = signed
  onEscapeRef.current = options.onEscape

  const updateRaw = useCallback((next: string) => {
    rawRef.current = next
    useDraftLengthHud.getState().setRaw(next)
  }, [])

  const clear = useCallback(() => {
    rawRef.current = ''
    useDraftLengthHud.getState().clear()
  }, [])
  const getLengthMeters = useCallback(
    () =>
      signedRef.current
        ? parseSignedDraftLength(
            useDraftLengthHud.getState().raw,
            unitRef.current,
            metricNotationRef.current,
          )
        : parseDraftLength(
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
    useDraftLengthHud.getState().setSignedMode(signed)
    const rememberGridMove = (event: GridEvent) => {
      lastGridMoveRef.current = event
    }
    emitter.on('grid:move', rememberGridMove)
    return () => emitter.off('grid:move', rememberGridMove)
  }, [signed])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current()) return

      let handled = false
      if (event.key === 'Backspace' && rawRef.current) {
        updateRaw(rawRef.current.slice(0, -1))
        handled = true
      } else if (event.key === 'Escape' && rawRef.current) {
        clear()
        onEscapeRef.current?.()
        handled = true
      } else if (
        (rawRef.current
          ? CONTINUED_INPUT_KEY
          : signedRef.current
            ? SIGNED_FIRST_INPUT_KEY
            : FIRST_INPUT_KEY
        ).test(event.key) &&
        !(rawRef.current.length > 0 && (event.key === '+' || event.key === '-')) &&
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
