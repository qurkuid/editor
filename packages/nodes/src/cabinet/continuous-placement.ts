import type { FloorPlacementClickTriggerEvent } from '../shared/floor-placement'
import { planToRunLocal, runLocalToPlan } from './run-layout'
import { CABINET_BASE_WIDTH } from './run-ops'

export type CabinetStretchPreview = {
  modules: { x: number; width: number }[]
  length: number
  centerLocalX: number
  direction: 1 | -1
}

export type StretchAnchor = {
  position: [number, number, number]
  yaw: number
  snappedToWall: boolean
  wallSurfaceNormal?: [number, number, number]
  forcedDirection?: 1 | -1
  leadingWidth?: number
}

export type StretchContinuation = {
  hingePosition: [number, number, number]
  sourceYaw: number
  sourceDirection: 1 | -1
  straightAnchor: StretchAnchor
  turnAnchor: StretchAnchor
  /** The mirror-image corner, for when the cursor turns the other way. */
  turnAnchorOpposite: StretchAnchor
}

type PlacementCollisionResult = {
  conflictIds: string[]
  valid: boolean
}

const MIN_END_MODULE_WIDTH = 0.1
const MIN_BAY_WIDTH = 0.1
const MAX_BAYS = 24

export function isForcePlacementEvent(event: FloorPlacementClickTriggerEvent): boolean {
  const native = (event as { nativeEvent?: { altKey?: boolean } }).nativeEvent
  return native?.altKey === true
}

/**
 * How many equal bays a span of `length` divides into when the user hasn't
 * pinned a count — the nearest whole number of standard-width bays, so a
 * 3.6 m span reads as 7 × 514 mm rather than 7 × 500 mm plus a 100 mm stub.
 */
export function autoCabinetBayCount(length: number): number {
  return Math.min(MAX_BAYS, Math.max(1, Math.round(length / CABINET_BASE_WIDTH)))
}

/**
 * Divide a span into equal bays. This is the start-point → end-point model:
 * the run is exactly as long as the span the user drew, and the bays split it
 * evenly, rather than tiling fixed-width modules and leaving a remainder.
 * `bayCount` pins the division; omitted, it follows `autoCabinetBayCount`.
 */
export function divideCabinetSpan(length: number, bayCount?: number | null): number[] {
  if (length <= 1e-6) return []
  const requested = bayCount ?? autoCabinetBayCount(length)
  // A pinned count that would produce slivers yields to what fits.
  const count = Math.min(
    Math.max(1, Math.min(MAX_BAYS, Math.floor(requested))),
    Math.max(1, Math.floor(length / MIN_BAY_WIDTH)),
  )
  return new Array(count).fill(length / count)
}

// Fill a span with standard-width modules; the remainder becomes a narrower
// end module (dropped entirely below MIN_END_MODULE_WIDTH). Still used where a
// run grows onto an existing module and the leading width is already fixed.
export function fillCabinetContinuousSpan(length: number): number[] {
  const full = Math.max(1, Math.floor((length + 1e-6) / CABINET_BASE_WIDTH))
  const widths: number[] = new Array(full).fill(CABINET_BASE_WIDTH)
  const remainder = length - full * CABINET_BASE_WIDTH
  if (remainder >= MIN_END_MODULE_WIDTH) widths.push(remainder)
  return widths
}

export function planCabinetContinuousStretch({
  anchor,
  bayCount,
  previewWidth,
  rawPlanPosition,
}: {
  anchor: StretchAnchor
  /** Pin the division; omitted/null follows `autoCabinetBayCount`. */
  bayCount?: number | null
  previewWidth: number
  rawPlanPosition: [number, number, number]
}): CabinetStretchPreview {
  const runLike = { position: anchor.position, rotation: anchor.yaw }
  const localX = planToRunLocal(runLike, rawPlanPosition[0], 0, rawPlanPosition[2])[0]
  const dir: 1 | -1 = anchor.forcedDirection ?? (localX >= 0 ? 1 : -1)
  const hasLeadingWidth = anchor.leadingWidth != null
  const projected = anchor.forcedDirection ? Math.max(0, localX * dir) : Math.abs(localX)

  // Fresh anchor: the click IS the run's start edge, and the span start→cursor
  // divides into equal bays. A corner leg keeps the corner filler as its fixed
  // leading module and divides everything past it the same way.
  if (!hasLeadingWidth) {
    // Dragging back past the start (or not yet moving) still previews a real
    // run, so the floor is one standard bay rather than a sliver.
    const length = Math.max(projected, CABINET_BASE_WIDTH)
    const widths = divideCabinetSpan(length, bayCount)
    // Run-local origin is the FIRST BAY'S CENTRE, not the run's left edge —
    // the same convention `chainModuleCenters` uses for every derived run
    // (corner legs, island back rows). Laying these out edge-first silently
    // desynced the two: corner legs stopped registering and an island's back
    // row landed offset from its front.
    const halfFirst = (widths[0] ?? length) / 2
    let cumulative = 0
    const modules = widths.map((width) => {
      const x = dir * (cumulative + width / 2 - halfFirst)
      cumulative += width
      return { x, width }
    })
    return {
      modules,
      length,
      centerLocalX: dir * (length / 2 - halfFirst),
      direction: dir,
    }
  }

  const firstWidth = anchor.leadingWidth ?? previewWidth
  const halfFirst = firstWidth / 2
  const minTotalLength = firstWidth + previewWidth
  const length = Math.max(projected + halfFirst, minTotalLength)
  const trailingLength = Math.max(0, length - firstWidth)
  // Equal division past the corner filler, matching the straight-leg rule —
  // otherwise a bent run reads as evenly divided on one leg and tiled with a
  // leftover stub on the other.
  const trailingWidths = trailingLength <= 1e-6 ? [] : divideCabinetSpan(trailingLength, bayCount)
  const widths = [firstWidth, ...trailingWidths]
  const total = widths.reduce((sum, width) => sum + width, 0)
  let cum = 0
  const modules = widths.map((width) => {
    const x = dir * (cum + width / 2 - halfFirst)
    cum += width
    return { x, width }
  })
  return {
    modules,
    length: total,
    centerLocalX: dir * (total / 2 - halfFirst),
    direction: dir,
  }
}

export function cabinetStretchExitSide(stretch: CabinetStretchPreview): 'left' | 'right' {
  return stretch.direction === 1 ? 'right' : 'left'
}

/**
 * Centre of the run's last bay, in run-local X. Read off the laid-out modules
 * rather than derived from `previewWidth` — with equal division the last bay
 * is `length / bayCount` wide, not the preview width, and deriving it put the
 * corner hinge in the wrong place (the follow-up click then failed to register
 * as a corner continuation, so clicking did nothing and double-click cancelled).
 */
export function cabinetStretchEndLocalX(stretch: CabinetStretchPreview): number {
  const last = stretch.modules[stretch.modules.length - 1]
  return last ? last.x : 0
}

/** Outer edge of the run's last bay, in run-local X. */
export function cabinetStretchEndEdgeLocalX(stretch: CabinetStretchPreview): number {
  const last = stretch.modules[stretch.modules.length - 1]
  return last ? last.x + stretch.direction * (last.width / 2) : 0
}

export function createCabinetContinuousContinuation({
  anchor,
  previewDepth,
  previewWidth,
  stretch,
}: {
  anchor: StretchAnchor
  previewDepth: number
  previewWidth: number
  stretch: CabinetStretchPreview
}): StretchContinuation {
  const endLocalX = cabinetStretchEndLocalX(stretch)
  const endEdgeLocalX = cabinetStretchEndEdgeLocalX(stretch)
  const hingePosition = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
    endLocalX,
    0,
    0,
  ])
  const straightAnchor = {
    position: runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
      endEdgeLocalX,
      0,
      0,
    ]),
    yaw: anchor.yaw,
    snappedToWall: anchor.snappedToWall,
    wallSurfaceNormal: anchor.wallSurfaceNormal,
  } satisfies StretchAnchor

  const sourceAxis: [number, number] = [Math.cos(anchor.yaw), -Math.sin(anchor.yaw)]
  const corner = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
    endEdgeLocalX,
    0,
    -previewDepth / 2,
  ])

  // A corner can go either way off the run's end. Build both and let the
  // cursor pick — pinning the side to whichever way the FIRST leg happened to
  // run meant dragging the other way selected a turn that could never grow
  // (its forced direction pointed away from the cursor), so the leg stuck at
  // its minimum length and the corner looked impossible to place.
  const buildTurnAnchor = (sign: 1 | -1): StretchAnchor => {
    const shiftedCorner: [number, number] = [
      corner[0] + sign * previewDepth * sourceAxis[0],
      corner[2] + sign * previewDepth * sourceAxis[1],
    ]
    const yaw = sign === 1 ? anchor.yaw - Math.PI / 2 : anchor.yaw + Math.PI / 2
    return {
      position: runLocalToPlan(
        {
          position: [shiftedCorner[0], anchor.position[1], shiftedCorner[1]],
          rotation: yaw,
        },
        [previewDepth / 2, 0, previewDepth / 2],
      ),
      yaw,
      snappedToWall: false,
      forcedDirection: 1,
      leadingWidth: previewDepth,
    }
  }

  const turnAnchor = buildTurnAnchor(1)
  const turnAnchorOpposite = buildTurnAnchor(-1)

  return {
    hingePosition,
    sourceYaw: anchor.yaw,
    sourceDirection: stretch.direction,
    straightAnchor,
    turnAnchor,
    turnAnchorOpposite,
  }
}

export function chooseCabinetContinuousAnchor(
  continuation: StretchContinuation,
  rawPlanPosition: [number, number, number],
): StretchAnchor {
  const [localX, , localZ] = planToRunLocal(
    { position: continuation.hingePosition, rotation: continuation.sourceYaw },
    rawPlanPosition[0],
    0,
    rawPlanPosition[2],
  )
  const forward = localX * continuation.sourceDirection
  const lateral = Math.abs(localZ)
  if (forward >= lateral) return continuation.straightAnchor
  // Turn toward the side the cursor is actually on. `turnAnchor` (the +1
  // shift) is the one whose forced direction runs toward +localZ.
  return localZ >= 0 ? continuation.turnAnchor : continuation.turnAnchorOpposite
}

export function resolveCabinetContinuousValidity(
  result: PlacementCollisionResult,
  forcePlace: boolean,
): PlacementCollisionResult {
  return forcePlace ? { conflictIds: [], valid: true } : result
}

export function isCabinetContinuousFollowUpClick(clickCount: number): boolean {
  return clickCount >= 2
}
