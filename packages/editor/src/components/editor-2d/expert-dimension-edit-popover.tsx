'use client'

import type {
  FloorplanDimensionEditDescriptor,
  FloorplanDimensionEditFixedEnd,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n/use-t'
import { parseDraftLength } from '../../lib/draft-length-input'
import { formatLinearMeasurement } from '../../lib/measurements'

export type ExpertDimensionEditApply = {
  targetDistance: number
  fixedEnd: FloorplanDimensionEditFixedEnd
  selectedLeafId?: string
}

export type ExpertDimensionEditPopoverProps = {
  descriptor: FloorplanDimensionEditDescriptor
  position: { left: number; top: number }
  error?: string | null
  onApply: (request: ExpertDimensionEditApply) => void
  onClose: () => void
}

function descriptorCurrentLength(descriptor: FloorplanDimensionEditDescriptor): number {
  if (descriptor.kind === 'total' && descriptor.leaves.length > 0) {
    return descriptor.leaves.reduce((sum, leaf) => sum + leaf.currentLength, 0)
  }
  return Math.hypot(
    descriptor.measuredEnd[0] - descriptor.measuredStart[0],
    descriptor.measuredEnd[1] - descriptor.measuredStart[1],
  )
}

function defaultLeafIdForFixedEnd(
  descriptor: FloorplanDimensionEditDescriptor,
  fixedEnd: FloorplanDimensionEditFixedEnd,
): string | undefined {
  if (descriptor.kind === 'total') {
    return fixedEnd === 'start' ? descriptor.leaves.at(-1)?.id : descriptor.leaves[0]?.id
  }
  return descriptor.defaultLeafId ?? descriptor.leaves[0]?.id
}

function descriptorReadOnlyReason(
  descriptor: FloorplanDimensionEditDescriptor,
  t: ReturnType<typeof useT>,
): string {
  switch (descriptor.readOnlyReasonCode) {
    case 'ambiguous-face':
      return t('actionMenu.dimensionEditReadOnlyAmbiguous')
    case 'room-to-room-thickness':
      return t('actionMenu.dimensionEditReadOnlyThickness')
    case 'curved-wall':
      return t('actionMenu.dimensionEditReadOnlyCurved')
    case 'structural-datum':
      return t('actionMenu.dimensionEditReadOnlyDatum')
    case 'missing-provenance':
      return t('actionMenu.dimensionEditReadOnlyMissing')
    case 'unsupported-dimension':
      return t('actionMenu.dimensionEditReadOnlyUnsupported')
    default:
      return descriptor.readOnlyReason && /[가-힣]/u.test(descriptor.readOnlyReason)
        ? descriptor.readOnlyReason
        : t('actionMenu.dimensionEditReadOnly')
  }
}

export function ExpertDimensionEditPopover({
  descriptor,
  position,
  error,
  onApply,
  onClose,
}: ExpertDimensionEditPopoverProps) {
  const t = useT()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const currentLength = descriptorCurrentLength(descriptor)
  const [raw, setRaw] = useState(() => formatLinearMeasurement(currentLength, unit, metricNotation))
  const [fixedEnd, setFixedEnd] = useState<FloorplanDimensionEditFixedEnd>(
    descriptor.fixedEndOptions[0] ?? 'start',
  )
  const [selectedLeafId, setSelectedLeafId] = useState<string | undefined>(
    defaultLeafIdForFixedEnd(descriptor, descriptor.fixedEndOptions[0] ?? 'start'),
  )
  const [leafSelectionTouched, setLeafSelectionTouched] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRaw(formatLinearMeasurement(currentLength, unit, metricNotation))
    setFixedEnd(descriptor.fixedEndOptions[0] ?? 'start')
    setSelectedLeafId(
      defaultLeafIdForFixedEnd(descriptor, descriptor.fixedEndOptions[0] ?? 'start'),
    )
    setLeafSelectionTouched(false)
  }, [currentLength, descriptor, metricNotation, unit])

  useEffect(() => {
    if (!descriptor.id) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [descriptor.id])

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  const parsedTarget = parseDraftLength(raw, unit, metricNotation)
  const isTotal = descriptor.kind === 'total'
  const canApply =
    descriptor.status === 'editable' && parsedTarget !== null && (!isTotal || !!selectedLeafId)
  const fixedEndOptions = useMemo(
    () =>
      descriptor.fixedEndOptions.filter((value, index, values) => values.indexOf(value) === index),
    [descriptor.fixedEndOptions],
  )
  const readOnlyReason = descriptorReadOnlyReason(descriptor, t)

  if (typeof document === 'undefined' || !document.body) return null

  const estimatedWidth = 288
  const estimatedHeight = descriptor.status === 'read-only' ? 96 : 300
  const minLeft = estimatedWidth / 2 + 8
  const maxLeft = Math.max(minLeft, window.innerWidth - estimatedWidth / 2 - 8)
  const left = Math.min(Math.max(position.left, minLeft), maxLeft)
  const belowTop = position.top + 6
  const top =
    belowTop + estimatedHeight <= window.innerHeight
      ? belowTop
      : Math.max(8, position.top - estimatedHeight - 6)

  return createPortal(
    <div
      aria-label={t('actionMenu.dimensionEditTitle')}
      className="pointer-events-auto fixed z-40 w-[18rem] -translate-x-1/2 rounded-lg border border-border/60 bg-background/95 p-2.5 shadow-elevation-3 backdrop-blur-md"
      data-floorplan-dimension-edit-popover=""
      onPointerDown={(event) => event.stopPropagation()}
      ref={rootRef}
      role="dialog"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-foreground">
          {t('actionMenu.dimensionEditTitle')}
        </div>
        <button
          aria-label={t('actionMenu.dimensionEditCancel')}
          className="rounded px-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="mb-1 text-[10px] text-muted-foreground">
        {t('actionMenu.dimensionEditCurrent')}:{' '}
        {formatLinearMeasurement(currentLength, unit, metricNotation)}
      </div>

      {descriptor.status === 'read-only' ? (
        <p aria-live="polite" className="text-xs text-destructive" role="alert">
          {readOnlyReason}
        </p>
      ) : (
        <>
          <label
            className="mb-1 block text-[10px] font-semibold text-muted-foreground"
            htmlFor="expert-dimension-target"
          >
            {t('actionMenu.dimensionEditTarget')}
          </label>
          <input
            aria-label={t('actionMenu.dimensionEditTarget')}
            className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none focus:border-cyan-400"
            id="expert-dimension-target"
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !canApply || parsedTarget === null) return
              event.preventDefault()
              onApply({ targetDistance: parsedTarget, fixedEnd, selectedLeafId })
            }}
            placeholder={
              unit === 'imperial' ? '0 ft' : metricNotation === 'millimeters' ? '0 mm' : '0 m'
            }
            ref={inputRef}
            value={raw}
          />
          <div className="mt-2 text-[10px] font-semibold text-muted-foreground">
            {t('actionMenu.dimensionEditFixedEnd')}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {fixedEndOptions.map((option) => {
              const label =
                option === 'start'
                  ? t('actionMenu.dimensionEditStart')
                  : t('actionMenu.dimensionEditEnd')
              return (
                <button
                  aria-pressed={fixedEnd === option}
                  className="h-8 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground aria-pressed:border-cyan-400 aria-pressed:bg-cyan-400/10 aria-pressed:text-foreground"
                  key={option}
                  onClick={() => {
                    setFixedEnd(option)
                    if (!leafSelectionTouched && isTotal) {
                      setSelectedLeafId(
                        option === 'start'
                          ? descriptor.leaves.at(-1)?.id
                          : descriptor.leaves[0]?.id,
                      )
                    }
                  }}
                  type="button"
                >
                  {label}
                </button>
              )
            })}
          </div>
          {isTotal ? (
            <>
              <label
                className="mt-2 mb-1 block text-[10px] font-semibold text-muted-foreground"
                htmlFor="expert-dimension-leaf"
              >
                {t('actionMenu.dimensionEditLeaf')}
              </label>
              <select
                aria-label={t('actionMenu.dimensionEditLeaf')}
                className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs outline-none focus:border-cyan-400"
                id="expert-dimension-leaf"
                onChange={(event) => {
                  setLeafSelectionTouched(true)
                  setSelectedLeafId(event.target.value || undefined)
                }}
                value={selectedLeafId ?? ''}
              >
                <option disabled value="">
                  {t('actionMenu.dimensionEditLeaf')}
                </option>
                {descriptor.leaves.map((leaf) => (
                  <option key={leaf.id} value={leaf.id}>
                    {formatLinearMeasurement(leaf.currentLength, unit, metricNotation)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            {t('actionMenu.dimensionEditPreservation')}
          </p>
          {!canApply && raw.trim() ? (
            <p aria-live="polite" className="mt-1 text-[11px] text-destructive" role="alert">
              {t('actionMenu.dimensionEditInvalid')}
            </p>
          ) : null}
          {error ? (
            <p aria-live="polite" className="mt-1 text-[11px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1">
            <button
              className="h-8 rounded-md border border-border/60 px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={onClose}
              type="button"
            >
              {t('actionMenu.dimensionEditCancel')}
            </button>
            <button
              className="h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canApply || parsedTarget === null}
              onClick={() => {
                if (parsedTarget === null) return
                onApply({ targetDistance: parsedTarget, fixedEnd, selectedLeafId })
              }}
              type="button"
            >
              {t('actionMenu.dimensionEditApply')}
            </button>
          </div>
        </>
      )}
      {descriptor.status === 'read-only' && error ? (
        <p aria-live="polite" className="mt-1 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>,
    document.body,
  )
}
