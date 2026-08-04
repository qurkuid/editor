import { describe, expect, test } from 'bun:test'
import {
  cabinetStretchEndEdgeLocalX,
  cabinetStretchEndLocalX,
  cabinetStretchExitSide,
  chooseCabinetContinuousAnchor,
  createCabinetContinuousContinuation,
  fillCabinetContinuousSpan,
  isCabinetContinuousFollowUpClick,
  planCabinetContinuousStretch,
  resolveCabinetContinuousValidity,
  type StretchAnchor,
} from '../continuous-placement'

const ANCHOR: StretchAnchor = {
  position: [0, 0, 0],
  yaw: 0,
  snappedToWall: false,
}

describe('cabinet continuous placement', () => {
  test('fills a stretch with full modules plus a partial end module when needed', () => {
    const widths = fillCabinetContinuousSpan(1.15)
    expect(widths).toHaveLength(3)
    expect(widths[0]).toBeCloseTo(0.5)
    expect(widths[1]).toBeCloseTo(0.5)
    expect(widths[2]).toBeCloseTo(0.15)
  })

  test('drops a tiny remainder below the minimum end-module width', () => {
    expect(fillCabinetContinuousSpan(1.07)).toEqual([0.5, 0.5])
  })

  test('spans exactly start→end and divides it into equal bays', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.35, 0, 0],
    })

    // 1.35 m ≈ 3 standard bays, so it splits 3 × 450 mm — the run ends at the
    // cursor rather than overshooting it with a fixed-width tile.
    expect(stretch.length).toBeCloseTo(1.35)
    expect(stretch.modules).toHaveLength(3)
    expect(stretch.modules.map((m) => m.width)).toEqual([0.45, 0.45, 0.45])
    // Run-local origin is the first bay's centre (shared with derived runs).
    for (const [index, expected] of [0, 0.45, 0.9].entries()) {
      expect(stretch.modules[index]?.x).toBeCloseTo(expected)
    }
    expect(stretch.centerLocalX).toBeCloseTo(0.45)
    expect(stretch.direction).toBe(1)
    expect(cabinetStretchExitSide(stretch)).toBe('right')
    // End edge is the run's far edge; end-x is the last bay's centre.
    expect(cabinetStretchEndLocalX(stretch)).toBeCloseTo(0.9)
    expect(cabinetStretchEndEdgeLocalX(stretch)).toBeCloseTo(1.125)
  })

  test('a pinned bay count overrides the automatic division', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      bayCount: 2,
      previewWidth: 0.6,
      rawPlanPosition: [3, 0, 0],
    })

    expect(stretch.length).toBeCloseTo(3)
    expect(stretch.modules.map((m) => m.width)).toEqual([1.5, 1.5])
  })

  test('mirrors the division when the span is drawn left of the start', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [-1.35, 0, 0],
    })

    expect(stretch.length).toBeCloseTo(1.35)
    expect(stretch.modules.map((m) => m.width)).toEqual([0.45, 0.45, 0.45])
    for (const [index, expected] of [0, -0.45, -0.9].entries()) {
      expect(stretch.modules[index]?.x).toBeCloseTo(expected)
    }
    expect(stretch.centerLocalX).toBeCloseTo(-0.45)
    expect(stretch.direction).toBe(-1)
    expect(cabinetStretchExitSide(stretch)).toBe('left')
  })

  test('forced-direction anchors keep orthogonal follow-on legs growing outward', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1 },
      previewWidth: 0.6,
      rawPlanPosition: [-1.0, 0, 0],
    })

    // Cursor behind a forced direction: still one standard bay, not a sliver.
    expect(stretch.direction).toBe(1)
    expect(stretch.length).toBeCloseTo(0.5)
    expect(stretch.modules).toHaveLength(1)
  })

  test('leading-width anchors reserve the corner filler before adding cabinet modules', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1, leadingWidth: 0.58 },
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })

    // Corner filler stays fixed at 0.58; the 0.91 m past it divides into two
    // equal 455 mm bays rather than a 500 mm tile plus a stub.
    expect(stretch.modules[0]?.width).toBeCloseTo(0.58)
    expect(stretch.modules[0]?.x).toBeCloseTo(0)
    expect(stretch.modules.slice(1).map((m) => m.width)).toEqual([0.455, 0.455])
    expect(stretch.modules[1]?.x).toBeGreaterThan(0.58 / 2)
  })

  test('a pinned bay count divides the leg past the corner filler', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1, leadingWidth: 0.58 },
      bayCount: 3,
      previewWidth: 0.6,
      rawPlanPosition: [2.42, 0, 0],
    })

    expect(stretch.modules[0]?.width).toBeCloseTo(0.58)
    expect(stretch.modules.slice(1)).toHaveLength(3)
    const trailing = stretch.modules.slice(1).map((m) => m.width)
    expect(trailing[0]).toBeCloseTo(trailing[1]!)
    expect(trailing[1]).toBeCloseTo(trailing[2]!)
  })

  test('leading-width anchors always preview the first connected cabinet after the corner filler', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1, leadingWidth: 0.58 },
      previewWidth: 0.6,
      rawPlanPosition: [0.05, 0, 0],
    })

    // Below the minimum the leg still previews one full bay after the filler.
    expect(stretch.modules.map((module) => module.width)).toEqual([0.58, 0.6])
    expect(stretch.length).toBeCloseTo(1.18)
  })

  test('prefers continuing straight when the cursor moves forward from the committed end', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.58,
      previewWidth: 0.6,
      stretch,
    })

    expect(chooseCabinetContinuousAnchor(continuation, [1.9, 0, 0.1])).toEqual(
      continuation.straightAnchor,
    )
  })

  test('prefers the L turn when the cursor moves more laterally than forward', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.58,
      previewWidth: 0.6,
      stretch,
    })

    // Either corner counts — which one depends on the side the cursor is on
    // (see the 'corner direction' block); what matters here is that a lateral
    // cursor turns rather than continuing straight.
    const picked = chooseCabinetContinuousAnchor(continuation, [1.35, 0, -0.9])
    expect(picked).not.toEqual(continuation.straightAnchor)
    expect(picked).toEqual(continuation.turnAnchorOpposite)
  })

  test('treats Alt force-place as valid while keeping normal collisions blocked', () => {
    const blocked = { conflictIds: ['cabinet_a', 'cabinet_b'], valid: false }

    expect(resolveCabinetContinuousValidity(blocked, false)).toEqual(blocked)
    expect(resolveCabinetContinuousValidity(blocked, true)).toEqual({
      conflictIds: [],
      valid: true,
    })
  })

  test('treats the second click in a double-click as a follow-up click to ignore', () => {
    expect(isCabinetContinuousFollowUpClick(2)).toBe(true)
  })

  test('treats a normal click as a segment commit click', () => {
    expect(isCabinetContinuousFollowUpClick(1)).toBe(false)
  })
})

describe('corner continuation geometry', () => {
  // The hinge has to sit on the run's real end. Deriving it from a fixed
  // preview width put it inside the last bay once bays became equal-divided,
  // so the follow-up click never resolved as a corner and clicking did nothing.
  test('the corner hinge follows the divided run, not the preview width', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      bayCount: 2,
      previewWidth: 0.6,
      rawPlanPosition: [3, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.6,
      previewWidth: 0.6,
      stretch,
    })

    // Bays are 1.5 m wide here — a previewWidth-derived hinge would land at
    // 2.7 m, well short of the 3 m end.
    expect(cabinetStretchEndEdgeLocalX(stretch)).toBeCloseTo(2.25)
    expect(continuation.straightAnchor.position[0]).toBeCloseTo(2.25)
    expect(continuation.hingePosition[0]).toBeCloseTo(1.5)
  })

  test('the turn anchor keeps the corner filler as its leading module', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [2, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.6,
      previewWidth: 0.6,
      stretch,
    })

    expect(continuation.turnAnchor.leadingWidth).toBeCloseTo(0.6)
    expect(continuation.turnAnchor.forcedDirection).toBe(1)
  })
})

describe('corner direction', () => {
  function cornerAfterFirstLeg() {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      bayCount: 2,
      previewWidth: 0.6,
      rawPlanPosition: [3, 0, 0],
    })
    return createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.6,
      previewWidth: 0.6,
      stretch,
    })
  }

  // A corner can go either way off a run's end. The turn used to be pinned to
  // whichever way the FIRST leg ran, so dragging the other way picked a turn
  // whose forced direction pointed away from the cursor: the leg stayed at its
  // minimum length and the corner looked impossible to place.
  test.each([-3, 3])('a corner drawn toward z=%s actually grows', (z) => {
    const continuation = cornerAfterFirstLeg()
    const anchor = chooseCabinetContinuousAnchor(continuation, [2.25, 0, z])
    const leg = planCabinetContinuousStretch({
      anchor,
      previewWidth: 0.6,
      rawPlanPosition: [2.25, 0, z],
    })

    expect(anchor).not.toBe(continuation.straightAnchor)
    expect(leg.length).toBeGreaterThan(1.5)
  })

  test('each side picks its own corner, and they are mirror images', () => {
    const continuation = cornerAfterFirstLeg()

    expect(chooseCabinetContinuousAnchor(continuation, [2.25, 0, 3])).toBe(continuation.turnAnchor)
    expect(chooseCabinetContinuousAnchor(continuation, [2.25, 0, -3])).toBe(
      continuation.turnAnchorOpposite,
    )
    expect(continuation.turnAnchor.yaw).not.toBeCloseTo(continuation.turnAnchorOpposite.yaw)
    expect(continuation.turnAnchor.leadingWidth).toBeCloseTo(
      continuation.turnAnchorOpposite.leadingWidth!,
    )
  })

  test('dragging straight ahead still continues straight', () => {
    const continuation = cornerAfterFirstLeg()
    expect(chooseCabinetContinuousAnchor(continuation, [6, 0, 0])).toBe(continuation.straightAnchor)
  })
})
