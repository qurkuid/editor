import { describe, expect, test } from 'bun:test'
import { isSuspiciousNodeDrop } from './use-auto-save'

describe('isSuspiciousNodeDrop', () => {
  test('blocks populated scenes from being flushed as empty skeletons', () => {
    expect(isSuspiciousNodeDrop(12, 0)).toBe(true)
    expect(isSuspiciousNodeDrop(12, 3)).toBe(true)
  })

  test('blocks small scenes from collapsing to zero (the trace-bootstrap wipe)', () => {
    // The 4-node /apt/trace scene was wiped through the old `> 4 → < 4` gap
    // when an unloadScene() transient reached autosave via soft navigation.
    expect(isSuspiciousNodeDrop(4, 0)).toBe(true)
    expect(isSuspiciousNodeDrop(1, 0)).toBe(true)
  })

  test('allows explicit undo to restore the pre-import skeleton', () => {
    expect(isSuspiciousNodeDrop(118, 3, true)).toBe(false)
    expect(isSuspiciousNodeDrop(118, 4, true)).toBe(false)
    expect(isSuspiciousNodeDrop(118, 3, false)).toBe(true)
  })

  test('allows ordinary edits, small-scene edits, and empty starting scenes', () => {
    expect(isSuspiciousNodeDrop(12, 11)).toBe(false)
    expect(isSuspiciousNodeDrop(12, 4)).toBe(false)
    expect(isSuspiciousNodeDrop(3, 1)).toBe(false)
    expect(isSuspiciousNodeDrop(0, 0)).toBe(false)
  })
})
