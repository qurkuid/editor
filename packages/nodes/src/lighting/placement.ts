import {
  type AlignmentAnchor,
  type AlignmentGuide,
  resolveAlignment,
  snapPointToGrid,
} from '@pascal-app/core'

export function resolveLightingGridPoint(
  point: readonly [number, number],
  gridStep: number,
  gridSnapActive: boolean,
): [number, number] {
  if (!gridSnapActive || !Number.isFinite(gridStep) || gridStep <= 0) return [point[0], point[1]]
  const snapped = snapPointToGrid(point, gridStep)
  return [snapped[0], snapped[1]]
}

/** Figma-style alignment-snap threshold (meters), matching wall/column/elevator placement. */
export const LIGHTING_ALIGNMENT_THRESHOLD_M = 0.08

export type LightingAlignmentResult = {
  point: [number, number]
  guides: AlignmentGuide[]
}

/**
 * Snap a lighting placement point onto nearby reference-element anchors
 * (wall corners/faces, other fixtures) — Figma-style alignment, mirroring
 * wall / column / elevator floor placement. Pure — no store or DOM access —
 * so it's testable without React. Treats the point as a single corner
 * anchor; fixtures have no meaningful footprint to align by edges.
 *
 * `showGuides` gates whether guides are even computed (mirrors
 * `isAlignmentGuideActive()`). `applySnap` additionally gates whether the
 * matched delta is applied to the returned point (mirrors
 * `isMagneticSnapActive()` — guides are shown passively otherwise).
 */
export function resolveLightingAlignedPoint(
  point: readonly [number, number],
  candidates: readonly AlignmentAnchor[],
  options: { showGuides: boolean; applySnap: boolean; threshold?: number },
): LightingAlignmentResult {
  if (!options.showGuides || candidates.length === 0) {
    return { point: [point[0], point[1]], guides: [] }
  }
  const result = resolveAlignment({
    moving: [{ nodeId: '__lighting-draft__', kind: 'corner', x: point[0], z: point[1] }],
    candidates,
    threshold: options.threshold ?? LIGHTING_ALIGNMENT_THRESHOLD_M,
  })
  if (!result.snap || !options.applySnap) {
    return { point: [point[0], point[1]], guides: result.guides }
  }
  return { point: [point[0] + result.snap.dx, point[1] + result.snap.dz], guides: result.guides }
}

// Preview/commit identity: the point already shown as the hover preview is
// what gets committed, instead of re-resolving from the commit event and
// risking a different (even if only slightly) snapped point.
export function resolveLightingCommitPoint(
  snapshot: readonly [number, number] | null,
  resolveFresh: () => [number, number],
): [number, number] {
  if (snapshot) return [snapshot[0], snapshot[1]]
  return resolveFresh()
}

// Below a segment this short, a linear fixture's draft is a mis-click, not a
// fixture — the commit is rejected rather than creating a degenerate light.
export const LINEAR_LIGHT_MIN_LENGTH = 0.05
// Length used to size the geometry when a `lightType: 'linear'` node is
// missing `start`/`end` (e.g. a hand-authored scene) — matches the default
// `areaSize[0]` so an unspecified linear fixture reads at the same scale as
// an unspecified area fixture.
export const LINEAR_LIGHT_FALLBACK_LENGTH = 0.6

// Derives the wall-style two-click draft's committed placement from its two
// plan points: the midpoint (`position`'s x/z), the group Y-rotation that
// turns the fixture's local +X axis to face the segment direction (same
// `-atan2(dz, dx)` convention the wall draft tool uses for its preview box),
// and the segment length.
export function resolveLinearLightSegment(
  start: readonly [number, number],
  end: readonly [number, number],
): { position: [number, number]; rotationY: number; length: number } {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  return {
    position: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    rotationY: -Math.atan2(dz, dx),
    length: Math.hypot(dx, dz),
  }
}

// Evenly divide a two-click run into `count` fixture points, endpoints
// included — the first light lands on the start click, the last on the end
// click. A degenerate run (both clicks in one spot) is a single placement,
// which is also how a plain click places one light in array mode.
export function resolveLightingArrayPoints(
  start: readonly [number, number],
  end: readonly [number, number],
  count: number,
): [number, number][] {
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < LINEAR_LIGHT_MIN_LENGTH) {
    return [[start[0], start[1]]]
  }
  const n = Math.max(2, Math.round(count))
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
  })
}

// Local +X offsets of each fixture in a divided run, centred on the node's
// midpoint origin — endpoints included, the local-frame twin of
// `resolveLightingArrayPoints`. The renderer and the 2D glyph both derive
// light positions from these, so a moved/rotated run can never drift from
// its lights.
export function resolveLightingRunOffsets(length: number, count: number): number[] {
  if (length < LINEAR_LIGHT_MIN_LENGTH) return [0]
  const n = Math.max(2, Math.round(count))
  return Array.from({ length: n }, (_, i) => -length / 2 + (length * i) / (n - 1))
}

// Length fed to the fixture body mesh and `RectAreaLight` width — both the 3D
// visual and the 2D floor-plan glyph derive it from `start`/`end` rather than
// storing it a second time, so it can never drift out of sync with the
// drafted segment.
export function resolveLinearLightLength(
  start: readonly [number, number] | undefined,
  end: readonly [number, number] | undefined,
): number {
  if (!start || !end) return LINEAR_LIGHT_FALLBACK_LENGTH
  return Math.max(Math.hypot(end[0] - start[0], end[1] - start[1]), LINEAR_LIGHT_MIN_LENGTH)
}
