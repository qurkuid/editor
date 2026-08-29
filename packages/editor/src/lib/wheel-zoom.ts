/**
 * Depth-aware wheel-zoom step law for the 3D viewport.
 *
 * SketchUp's law — each notch travels a fixed fraction of the distance to the
 * point under the cursor — reads the scene scale for free, but diverges at the
 * domain's ends: steps vanish against a close surface (the infamous "trapped
 * behind a wall" stall) and explode when the cursor is over empty sky. Both
 * fixes here are clamps on the reference distance, not separate features:
 * flooring it turns the stall into a controlled pass-through, and capping it
 * tames empty-space anchors.
 */

export const WHEEL_ZOOM_PER_NOTCH = 0.9
/**
 * Zoom-in reference floor. Sets the slowest approach pace (floor × 10% per
 * notch) and, because the step never reaches zero, the pass-through pace.
 */
export const WHEEL_ZOOM_IN_MIN_REF_M = 1.5
/**
 * Zoom-out reference floor, deliberately larger than the zoom-in floor:
 * receding from a nose-on-the-wall view must never be slow — that asymmetry
 * is what SketchUp lacks.
 */
export const WHEEL_ZOOM_OUT_MIN_REF_M = 3
/** Reference cap so a far or fallback anchor cannot cause huge jumps. */
export const WHEEL_ZOOM_MAX_REF_M = 40
/** Hard ceiling on how far past the anchor a zoom-out may recede. */
export const WHEEL_ZOOM_OUT_LIMIT_M = 300
/**
 * Wheel events closer together than this belong to one gesture and reuse its
 * anchor, so a foreground object sliding under the cursor mid-zoom cannot
 * yank the trajectory (SketchUp re-picks every tick and can).
 */
export const WHEEL_ZOOM_GESTURE_TIMEOUT_MS = 300

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Wheel delta → signed notch count. Positive = zoom in.
 *
 * 120 pixel-mode units ≈ one physical notch; line/page modes arrive already
 * quantized in notch-sized units. Trackpad pinch (ctrlKey) reports tiny
 * per-event deltas, so it gets a 3x boost for a full pinch to span a useful
 * zoom range.
 */
export function normalizeWheelZoomNotches(event: {
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}): number {
  const { deltaY, deltaMode, ctrlKey } = event
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  const notches = deltaMode === 1 ? deltaY / 3 : deltaMode === 2 ? deltaY : deltaY / 120
  return (ctrlKey ? notches * 3 : notches) * -1
}

/**
 * Signed camera travel along the cursor ray for one wheel event.
 *
 * While the anchor is ahead, travel is `ref × (1 − 0.9^notches)` with
 * `ref = distance` — the exponential approach can never overshoot the anchor
 * on its own; only the floor region produces pass-through. Once the camera is
 * past the anchor (negative distance) the reference grows with the distance
 * beyond it, so pace recovers without waiting for a re-anchor.
 *
 * @param signedAnchorDist camera→anchor distance along the ray, negative once
 *   the camera has passed the anchor
 * @param notches positive = zoom in (toward the anchor)
 * @returns signed travel along the ray (positive = toward the anchor)
 */
export function resolveWheelZoomStep(signedAnchorDist: number, notches: number): number {
  if (!Number.isFinite(signedAnchorDist) || !Number.isFinite(notches) || notches === 0) {
    return 0
  }

  const magnitude = Math.abs(notches)
  const inwardFraction = 1 - WHEEL_ZOOM_PER_NOTCH ** magnitude

  if (notches > 0) {
    const reference = clamp(
      signedAnchorDist > 0 ? signedAnchorDist : WHEEL_ZOOM_IN_MIN_REF_M - signedAnchorDist,
      WHEEL_ZOOM_IN_MIN_REF_M,
      WHEEL_ZOOM_MAX_REF_M,
    )
    return reference * inwardFraction
  }

  const reference = clamp(
    Math.max(signedAnchorDist, 0),
    WHEEL_ZOOM_OUT_MIN_REF_M,
    WHEEL_ZOOM_MAX_REF_M,
  )
  const travel = reference * (WHEEL_ZOOM_PER_NOTCH ** -magnitude - 1)
  const room = Math.max(WHEEL_ZOOM_OUT_LIMIT_M - signedAnchorDist, 0)
  const capped = Math.min(travel, room)
  return capped <= 0 ? 0 : -capped
}
