import { describe, expect, it } from 'bun:test'
import {
  normalizeShortcutOverrides,
  resolveShortcutKey,
  shortcutKeyConflict,
} from './keyboard-shortcuts'

describe('resolveShortcutKey', () => {
  it('falls back to the default and honors valid overrides', () => {
    expect(resolveShortcutKey('pivot-rotate', {})).toBe('q')
    expect(resolveShortcutKey('pivot-rotate', { 'pivot-rotate': 'u' })).toBe('u')
    expect(resolveShortcutKey('mode-select', { 'mode-select': '!!' })).toBe('v')
  })
})

describe('shortcutKeyConflict', () => {
  it('rejects statically reserved keys (camera WASD, R/T, contextual)', () => {
    expect(shortcutKeyConflict('pivot-rotate', 'w', {})).toBe('reserved')
    expect(shortcutKeyConflict('pivot-rotate', 'r', {})).toBe('reserved')
  })

  it('reports the shortcut currently holding the key', () => {
    expect(shortcutKeyConflict('pivot-rotate', 'v', {})).toBe('mode-select')
    expect(shortcutKeyConflict('pivot-rotate', 'u', { 'mode-select': 'u' })).toBe('mode-select')
  })

  it('allows free keys and re-assigning a shortcut its own key', () => {
    expect(shortcutKeyConflict('pivot-rotate', 'u', {})).toBeNull()
    expect(shortcutKeyConflict('mode-select', 'v', {})).toBeNull()
  })
})

describe('normalizeShortcutOverrides', () => {
  it('keeps only known ids with valid, non-default keys', () => {
    expect(
      normalizeShortcutOverrides({
        'pivot-rotate': 'u',
        'mode-select': 'v', // default → dropped
        'mode-build': 'Q!', // malformed → dropped
        bogus: 'k',
      }),
    ).toEqual({ 'pivot-rotate': 'u' })
    expect(normalizeShortcutOverrides(null)).toEqual({})
    expect(normalizeShortcutOverrides('nope')).toEqual({})
  })

  it('drops the later entry when two overrides collide (id declaration order)', () => {
    // tool-zone precedes pivot-rotate in the id order, so it wins the key.
    expect(normalizeShortcutOverrides({ 'pivot-rotate': 'u', 'tool-zone': 'u' })).toEqual({
      'tool-zone': 'u',
    })
  })
})
