import type { BodyDraftPoint } from './rectangle-draft'

const MIN_EDGE_LENGTH = 0.001
const MIN_AREA = 0.000001

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
  segments = 32,
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
