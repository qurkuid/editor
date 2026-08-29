import { describe, expect, test } from 'bun:test'
import {
  normalizeWheelZoomNotches,
  resolveWheelZoomStep,
  WHEEL_ZOOM_OUT_LIMIT_M,
} from './wheel-zoom'

describe('normalizeWheelZoomNotches', () => {
  test('pixel mode: 120 units is one notch, wheel-up zooms in', () => {
    expect(normalizeWheelZoomNotches({ deltaY: -120, deltaMode: 0, ctrlKey: false })).toBe(1)
    expect(normalizeWheelZoomNotches({ deltaY: 120, deltaMode: 0, ctrlKey: false })).toBe(-1)
    expect(normalizeWheelZoomNotches({ deltaY: -60, deltaMode: 0, ctrlKey: false })).toBe(0.5)
  })

  test('line and page modes arrive pre-quantized', () => {
    expect(normalizeWheelZoomNotches({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBe(1)
    expect(normalizeWheelZoomNotches({ deltaY: 2, deltaMode: 2, ctrlKey: false })).toBe(-2)
  })

  test('trackpad pinch (ctrlKey) is boosted 3x', () => {
    expect(normalizeWheelZoomNotches({ deltaY: -40, deltaMode: 0, ctrlKey: true })).toBe(1)
  })

  test('zero and non-finite deltas produce no zoom', () => {
    expect(normalizeWheelZoomNotches({ deltaY: 0, deltaMode: 0, ctrlKey: false })).toBe(0)
    expect(normalizeWheelZoomNotches({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: false })).toBe(0)
  })
})

describe('resolveWheelZoomStep', () => {
  test('mid-range zoom-in is exactly multiplicative (10m -> 9m per notch)', () => {
    expect(resolveWheelZoomStep(10, 1)).toBeCloseTo(1, 10)
    expect(resolveWheelZoomStep(10, 2)).toBeCloseTo(1.9, 10)
  })

  test('zoom-in can never overshoot an anchor that is still ahead', () => {
    for (const notches of [1, 3, 10, 50]) {
      expect(resolveWheelZoomStep(10, notches)).toBeLessThan(10)
    }
  })

  test('approach floors instead of stalling against a close surface', () => {
    // reference floors at 1.5m -> 0.15m per notch, never zero
    expect(resolveWheelZoomStep(0.4, 1)).toBeCloseTo(0.15, 10)
    expect(resolveWheelZoomStep(0.01, 1)).toBeCloseTo(0.15, 10)
  })

  test('pace recovers with distance once past the anchor', () => {
    expect(resolveWheelZoomStep(-2, 1)).toBeCloseTo(0.35, 10)
    expect(resolveWheelZoomStep(-20, 1)).toBeCloseTo(2.15, 10)
  })

  test('reference is capped for far or fallback anchors', () => {
    expect(resolveWheelZoomStep(100, 1)).toBeCloseTo(4, 10)
  })

  test('mid-range zoom-out is exactly multiplicative (10m -> 11.1m per notch)', () => {
    expect(resolveWheelZoomStep(10, -1)).toBeCloseTo(-(10 / 0.9 - 10), 10)
  })

  test('escaping a nose-on-the-wall view is never slow', () => {
    const trapped = resolveWheelZoomStep(0.1, -1)
    expect(trapped).toBeCloseTo(-(3 / 0.9 - 3), 10)
    expect(resolveWheelZoomStep(-1, -1)).toBeCloseTo(-(3 / 0.9 - 3), 10)
  })

  test('zoom-out stops at the recede limit', () => {
    expect(resolveWheelZoomStep(WHEEL_ZOOM_OUT_LIMIT_M - 1, -1)).toBe(-1)
    expect(resolveWheelZoomStep(WHEEL_ZOOM_OUT_LIMIT_M + 50, -1)).toBe(0)
  })

  test('fractional trackpad notches scale continuously', () => {
    expect(resolveWheelZoomStep(10, 0.5)).toBeCloseTo(10 * (1 - 0.9 ** 0.5), 10)
  })

  test('guards: no travel for zero or non-finite inputs', () => {
    expect(resolveWheelZoomStep(10, 0)).toBe(0)
    expect(resolveWheelZoomStep(Number.NaN, 1)).toBe(0)
    expect(resolveWheelZoomStep(10, Number.NaN)).toBe(0)
  })
})
