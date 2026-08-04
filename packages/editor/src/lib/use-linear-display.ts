'use client'

import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { getLinearUnitLabel, linearUnitToMeters, metersToLinearUnit } from './measurements'

/**
 * Shared display/storage conversion for numeric property controls so that
 * every length input honors the unit preferences identically.
 *
 * Values are always STORED in the field's own unit (meters for `unit === 'm'`).
 * What the user sees follows BOTH preferences: `unit` (metric/imperial) and,
 * within metric, `metricNotation` (meters or millimeters). So a control that
 * hardcodes `unit="m"` renders millimeters once the scene is set to mm — the
 * alternative was every call site converting for itself, which is how so many
 * panels ended up still reading in metres.
 *
 * Non-length units (`'°'`, `'%'`, `'in'`, `''`, …) are untouched.
 *
 * `precision` is the caller's digit count in METERS; millimeter display drops
 * three of those digits (0.001 m → 1 mm) and never goes below 0.
 *
 * Used by both `SliderControl` and `MetricControl` — keep the two in sync via
 * this single source of truth.
 */
export function useLinearDisplay(unit: string, precision: number) {
  const viewerUnit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const isLength = unit === 'm'
  const isImperial = viewerUnit === 'imperial' && isLength
  const isMillimeters = !isImperial && isLength && metricNotation === 'millimeters'

  const displayUnit = isImperial ? getLinearUnitLabel('imperial') : isMillimeters ? 'mm' : unit
  const displayPrecision = isMillimeters ? Math.max(0, precision - 3) : precision

  const toDisplay = useCallback(
    (stored: number) =>
      isImperial ? metersToLinearUnit(stored, 'imperial') : isMillimeters ? stored * 1000 : stored,
    [isImperial, isMillimeters],
  )
  const toStored = useCallback(
    (display: number) =>
      isImperial
        ? linearUnitToMeters(display, 'imperial')
        : isMillimeters
          ? display / 1000
          : display,
    [isImperial, isMillimeters],
  )
  // Round a stored value so it lands on a clean number of DISPLAY-unit digits.
  const roundStored = useCallback(
    (stored: number) => toStored(Number.parseFloat(toDisplay(stored).toFixed(displayPrecision))),
    [toDisplay, toStored, displayPrecision],
  )

  return {
    isImperial,
    isMillimeters,
    displayUnit,
    displayPrecision,
    toDisplay,
    toStored,
    roundStored,
  }
}
