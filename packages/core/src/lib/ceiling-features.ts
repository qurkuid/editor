import type { CeilingFeature } from '../schema/nodes/ceiling'
import { type Point2D, pointInPolygon } from './polygon-relations'

/**
 * Plan-space frame of the ceiling polygon edge a feature sweeps along.
 * Shared by the 3D sweep builder (viewer), the 2D floor-plan footprint,
 * and the inspector — one derivation, three consumers.
 */
export type CeilingFeatureEdgeFrame = {
  start: Point2D
  end: Point2D
  /** Unit vector along the edge, start → end. */
  dir: Point2D
  /** Unit perpendicular pointing toward the ceiling interior (profile +u). */
  inward: Point2D
  length: number
}

/**
 * Resolves a feature's edge into a frame, or null when the edge is
 * degenerate / out of range (e.g. a vertex was deleted after the feature
 * was created — the feature simply stops rendering instead of crashing).
 *
 * The inward side is found by point-in-polygon testing a probe just off
 * the edge midpoint, so it is correct for either polygon winding.
 */
export function ceilingFeatureEdgeFrame(
  polygon: ReadonlyArray<readonly [number, number]>,
  edgeIndex: number,
): CeilingFeatureEdgeFrame | null {
  if (polygon.length < 3 || edgeIndex < 0 || edgeIndex >= polygon.length) return null
  const start = polygon[edgeIndex]!
  const end = polygon[(edgeIndex + 1) % polygon.length]!
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null

  const dir: Point2D = [dx / length, dz / length]
  let inward: Point2D = [-dir[1], dir[0]]
  const eps = Math.min(0.01, length * 0.1)
  const probe: Point2D = [
    (start[0] + end[0]) / 2 + inward[0] * eps,
    (start[1] + end[1]) / 2 + inward[1] * eps,
  ]
  if (!pointInPolygon(probe, polygon.map(([x, z]) => [x, z] as Point2D), { includeBoundary: false })) {
    inward = [dir[1], -dir[0]]
  }

  return { start: [start[0], start[1]], end: [end[0], end[1]], dir, inward, length }
}

export type CeilingProfileBounds = {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

/** Axis-aligned bounds of a feature's section profile in (u, v) meters. */
export function ceilingProfileBounds(profile: CeilingFeature['profile']): CeilingProfileBounds {
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (const [u, v] of profile) {
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  return { minU, maxU, minV, maxV }
}
