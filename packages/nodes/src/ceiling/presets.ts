import { type CeilingFeature, ceilingProfileBounds } from '@pascal-app/core'

type ProfilePoint = [number, number]

/**
 * Seed profiles for the hybrid feature model: a preset only provides the
 * starting section — the stored profile stays the single source of truth
 * and remains freely editable in the section editor afterwards.
 *
 * Section frame: u = meters from the ceiling edge (wall side) toward the
 * room interior, v = meters from the ceiling plane (negative = down).
 */
export const CEILING_FEATURE_SEED_PROFILES: Record<CeilingFeature['kind'], ProfilePoint[]> = {
  // 커튼박스 — a fascia board dropping 150mm at 180mm off the wall; the
  // open slot between the wall and the fascia is the curtain pocket.
  'curtain-box': [
    [0.18, 0],
    [0.21, 0],
    [0.21, -0.15],
    [0.18, -0.15],
  ],
  // 단내림 — a solid bulkhead mass 600mm wide dropping 300mm from the wall.
  drop: [
    [0, 0],
    [0.6, 0],
    [0.6, -0.3],
    [0, -0.3],
  ],
  // Free-drawn starting point — a two-step section that shows off the
  // editable vertices (reads as a soffit with an indirect-light ledge).
  custom: [
    [0, 0],
    [0.45, 0],
    [0.45, -0.12],
    [0.25, -0.12],
    [0.25, -0.25],
    [0, -0.25],
  ],
}

export const CEILING_FEATURE_LABELS: Record<CeilingFeature['kind'], string> = {
  'curtain-box': 'Curtain box',
  drop: 'Bulkhead',
  custom: 'Custom',
}

/**
 * Overall width (u extent) and depth (drop below the plane) of a profile —
 * what the inspector sliders read.
 */
export function ceilingProfileSize(profile: CeilingFeature['profile']): {
  width: number
  depth: number
} {
  const bounds = ceilingProfileBounds(profile)
  return { width: Math.max(0, bounds.maxU), depth: Math.max(0, -bounds.minV) }
}

/**
 * Uniformly rescales a profile to a target width/depth. Scaling instead of
 * regenerating keeps any custom-edited section shape intact — the hybrid
 * contract: sliders resize, they never reset.
 */
export function scaleCeilingProfile(
  profile: CeilingFeature['profile'],
  target: { width?: number; depth?: number },
): ProfilePoint[] {
  const { width, depth } = ceilingProfileSize(profile)
  const uScale = target.width != null && width > 1e-6 ? target.width / width : 1
  const vScale = target.depth != null && depth > 1e-6 ? target.depth / depth : 1
  return profile.map(([u, v]) => [u * uScale, v * vScale])
}

/** Longest polygon edge — the default sweep edge for a new feature. */
export function longestEdgeIndex(polygon: ReadonlyArray<readonly [number, number]>): number {
  let best = 0
  let bestLength = -1
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length > bestLength) {
      bestLength = length
      best = i
    }
  }
  return best
}
