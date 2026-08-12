import { describe, expect, test } from 'bun:test'
import { resolveOffsetDisplayDistance, resolveOffsetDistance } from './offset-handle'

describe('Body Offset interaction', () => {
  test('keeps the signed typed offset instead of inferring its direction', () => {
    expect(resolveOffsetDistance(0.45, -0.12)).toBe(-0.12)
    expect(resolveOffsetDistance(-0.45, 0.12)).toBe(0.12)
  })

  test('falls back to the signed cursor distance when no typed value exists', () => {
    expect(resolveOffsetDistance(0.45, null)).toBe(0.45)
    expect(resolveOffsetDistance(-0.45, null)).toBe(-0.45)
  })

  test('does not fall back when signed typed input is invalid', () => {
    expect(resolveOffsetDistance(0.45, null, true)).toBeNaN()
  })

  test('keeps a finite rejected offset visible without rendering an invalid number', () => {
    expect(resolveOffsetDisplayDistance(-99.999)).toBe(-99.999)
    expect(resolveOffsetDisplayDistance(Number.NaN)).toBe(0)
  })
})
