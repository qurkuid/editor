import { describe, expect, test } from 'bun:test'
import { resolvePushPullDistance } from './push-pull'

describe('Body Push/Pull interaction', () => {
  test('uses cursor direction with an exact typed magnitude', () => {
    expect(resolvePushPullDistance(0.45, 1.2)).toBe(1.2)
    expect(resolvePushPullDistance(-0.45, 1.2)).toBe(-1.2)
  })

  test('falls back to the live cursor distance', () => {
    expect(resolvePushPullDistance(0.45, null)).toBe(0.45)
    expect(resolvePushPullDistance(-0.45, null)).toBe(-0.45)
  })
})
