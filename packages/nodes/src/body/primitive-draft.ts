import {
  DEFAULT_ARC_SEGMENTS,
  DEFAULT_POLYGON_SIDES,
  MAX_ARC_SEGMENTS,
  MAX_POLYGON_SIDES,
  MIN_ARC_SEGMENTS,
  MIN_POLYGON_SIDES,
} from './options'
import type { BodyDraftPoint } from './rectangle-draft'

const MIN_EDGE_LENGTH = 0.001
const MIN_AREA = 0.000001
export const DEFAULT_PRIMITIVE_SEGMENTS = DEFAULT_ARC_SEGMENTS
const ARC_EPSILON = 1e-9

export function resolveBodyDraftFeedback(
  points: readonly BodyDraftPoint[],
  cursor: BodyDraftPoint | null,
) {
  const committed = points.map((point) => [...point] as BodyDraftPoint)
  return {
    start: committed[0] ?? null,
    committed,
    cursor: cursor ? ([...cursor] as BodyDraftPoint) : null,
    path: cursor ? [...committed, [...cursor] as BodyDraftPoint] : committed,
  }
}

export function shouldCloseLineDraft(
  start: BodyDraftPoint,
  cursor: BodyDraftPoint,
  tolerance: number,
): boolean {
  return Math.hypot(cursor[0] - start[0], cursor[1] - start[1]) <= tolerance
}

/**
 * Endpoint snap for the line primitive: once the draft can close (≥ 3 points),
 * a cursor within `tolerance` of the start point sticks onto it exactly — the
 * hover, rubber band, and the closing click all land on the same vertex.
 */
export function snapLineDraftPoint(
  points: readonly BodyDraftPoint[],
  point: BodyDraftPoint,
  tolerance: number,
): BodyDraftPoint {
  const first = points[0]
  if (!first || points.length < 3) return point
  return shouldCloseLineDraft(first, point, tolerance) ? [first[0], first[1]] : point
}

export function resolveLineFaceDraft(points: readonly BodyDraftPoint[]): BodyDraftPoint[] | null {
  if (points.length < 3) return null
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    if (!next) return sum
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  if (Math.abs(area) * 0.5 < MIN_AREA) return null
  return points.map((point) => [...point])
}

export function resolveCircleDraft(
  center: BodyDraftPoint,
  cursor: BodyDraftPoint,
  exactRadius: number | null,
  segments = DEFAULT_PRIMITIVE_SEGMENTS,
): BodyDraftPoint[] | null {
  const cursorRadius = Math.hypot(cursor[0] - center[0], cursor[1] - center[1])
  const radius = exactRadius ?? cursorRadius
  if (!Number.isFinite(radius) || radius < MIN_EDGE_LENGTH || segments < 8) return null
  const startAngle = Math.atan2(cursor[1] - center[1], cursor[0] - center[0])
  return Array.from({ length: segments }, (_, index) => {
    const angle = startAngle + (index / segments) * Math.PI * 2
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
  })
}

export function resolveRegularPolygonDraft(
  center: BodyDraftPoint,
  radiusPoint: BodyDraftPoint,
  exactRadius: number | null = null,
  sides = DEFAULT_POLYGON_SIDES,
): BodyDraftPoint[] | null {
  if (
    ![...center, ...radiusPoint].every((value) => Number.isFinite(value)) ||
    !Number.isInteger(sides) ||
    sides < MIN_POLYGON_SIDES ||
    sides > MAX_POLYGON_SIDES
  ) {
    return null
  }
  const direction = Math.atan2(radiusPoint[1] - center[1], radiusPoint[0] - center[0])
  const cursorRadius = Math.hypot(radiusPoint[0] - center[0], radiusPoint[1] - center[1])
  const radius = exactRadius ?? cursorRadius
  if (!Number.isFinite(radius) || radius < MIN_EDGE_LENGTH) return null
  return Array.from({ length: sides }, (_, index) => {
    const angle = direction + (index / sides) * Math.PI * 2
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
  })
}

function positiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2
  const normalized = angle % fullTurn
  return normalized < 0 ? normalized + fullTurn : normalized
}

export function resolveArcDraft(
  start: BodyDraftPoint,
  through: BodyDraftPoint,
  end: BodyDraftPoint,
  segments = DEFAULT_PRIMITIVE_SEGMENTS,
): BodyDraftPoint[] | null {
  if (
    ![...start, ...through, ...end].every((value) => Number.isFinite(value)) ||
    !Number.isInteger(segments) ||
    segments < MIN_ARC_SEGMENTS ||
    segments > MAX_ARC_SEGMENTS
  ) {
    return null
  }
  const distance = (first: BodyDraftPoint, second: BodyDraftPoint) =>
    Math.hypot(first[0] - second[0], first[1] - second[1])
  if (
    distance(start, through) < MIN_EDGE_LENGTH ||
    distance(through, end) < MIN_EDGE_LENGTH ||
    distance(start, end) < MIN_EDGE_LENGTH
  ) {
    return null
  }

  const determinant =
    2 *
    (start[0] * (through[1] - end[1]) +
      through[0] * (end[1] - start[1]) +
      end[0] * (start[1] - through[1]))
  const scale = Math.max(distance(start, through), distance(through, end), distance(start, end))
  if (Math.abs(determinant) <= ARC_EPSILON * scale * scale) return null

  const startSquared = start[0] * start[0] + start[1] * start[1]
  const throughSquared = through[0] * through[0] + through[1] * through[1]
  const endSquared = end[0] * end[0] + end[1] * end[1]
  const center: BodyDraftPoint = [
    (startSquared * (through[1] - end[1]) +
      throughSquared * (end[1] - start[1]) +
      endSquared * (start[1] - through[1])) /
      determinant,
    (startSquared * (end[0] - through[0]) +
      throughSquared * (start[0] - end[0]) +
      endSquared * (through[0] - start[0])) /
      determinant,
  ]
  const radius = distance(center, start)
  if (!Number.isFinite(radius) || radius < MIN_EDGE_LENGTH) return null

  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const throughAngle = Math.atan2(through[1] - center[1], through[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const counterClockwiseSweep = positiveAngle(endAngle - startAngle)
  if (counterClockwiseSweep <= ARC_EPSILON || Math.PI * 2 - counterClockwiseSweep <= ARC_EPSILON) {
    return null
  }
  const throughSweep = positiveAngle(throughAngle - startAngle)
  const sweep =
    throughSweep <= counterClockwiseSweep + ARC_EPSILON
      ? counterClockwiseSweep
      : -(Math.PI * 2 - counterClockwiseSweep)

  return Array.from({ length: segments + 1 }, (_, index) => {
    if (index === 0) return [...start] as BodyDraftPoint
    if (index === segments) return [...end] as BodyDraftPoint
    const angle = startAngle + (sweep * index) / segments
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
  })
}
