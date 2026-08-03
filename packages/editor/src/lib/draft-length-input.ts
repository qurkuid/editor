import { parseMeasurement } from './measurement-parser'

export type DraftUnitSystem = 'metric' | 'imperial'
export type DraftMetricNotation = 'meters' | 'millimeters'
export type PlanDraftPoint = readonly [number, number]
export type SpatialDraftPoint = readonly [number, number, number]
export type DraftLengthPresentation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly display: string }
  | { readonly kind: 'valid'; readonly display: string; readonly lengthMeters: number }

export function replayDraftMove<T>(event: T | null, replay: (event: T) => void): void {
  if (event !== null) replay(event)
}

export function parseDraftLength(
  raw: string,
  unit: DraftUnitSystem,
  metricNotation: DraftMetricNotation,
): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const bareUnit = unit === 'imperial' ? 'ft' : metricNotation === 'millimeters' ? 'mm' : 'm'
  const value = parseMeasurement(
    trimmed,
    { kind: 'length', unitId: 'm' },
    { bareUnit, system: unit },
  )
  return value !== null && value > 0 ? value : null
}

export function formatDraftLengthInput(
  raw: string,
  unit: DraftUnitSystem,
  metricNotation: DraftMetricNotation,
): string {
  if (!raw || /[a-z'"]/i.test(raw)) return raw
  const suffix = unit === 'imperial' ? 'ft' : metricNotation === 'millimeters' ? 'mm' : 'm'
  return `${raw} ${suffix}`
}

export function resolveDraftLengthPresentation(
  raw: string,
  unit: DraftUnitSystem,
  metricNotation: DraftMetricNotation,
): DraftLengthPresentation {
  if (!raw) return { kind: 'empty' }
  const display = formatDraftLengthInput(raw, unit, metricNotation)
  const lengthMeters = parseDraftLength(raw, unit, metricNotation)
  return lengthMeters === null
    ? { kind: 'invalid', display }
    : { kind: 'valid', display, lengthMeters }
}

export function constrainPlanDraftPoint(
  start: PlanDraftPoint,
  cursor: PlanDraftPoint,
  lengthMeters: number | null,
): [number, number] {
  if (lengthMeters === null || !Number.isFinite(lengthMeters) || lengthMeters <= 0) {
    return [cursor[0], cursor[1]]
  }
  const dx = cursor[0] - start[0]
  const dz = cursor[1] - start[1]
  const directionLength = Math.hypot(dx, dz)
  if (directionLength === 0) return [cursor[0], cursor[1]]
  return [
    start[0] + (dx / directionLength) * lengthMeters,
    start[1] + (dz / directionLength) * lengthMeters,
  ]
}

export function constrainSpatialDraftPoint(
  start: SpatialDraftPoint,
  cursor: SpatialDraftPoint,
  lengthMeters: number | null,
): [number, number, number] {
  if (lengthMeters === null || !Number.isFinite(lengthMeters) || lengthMeters <= 0) {
    return [cursor[0], cursor[1], cursor[2]]
  }
  const dx = cursor[0] - start[0]
  const dy = cursor[1] - start[1]
  const dz = cursor[2] - start[2]
  const directionLength = Math.hypot(dx, dy, dz)
  if (directionLength === 0) return [cursor[0], cursor[1], cursor[2]]
  return [
    start[0] + (dx / directionLength) * lengthMeters,
    start[1] + (dy / directionLength) * lengthMeters,
    start[2] + (dz / directionLength) * lengthMeters,
  ]
}
