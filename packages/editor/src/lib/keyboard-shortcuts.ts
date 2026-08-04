// Single source of truth for the rebindable global shortcuts. The settings
// page (keyboard-shortcuts-dialog) edits an override map persisted in
// `useEditor.shortcutOverrides`; `use-keyboard` and the bottom-menu badges
// resolve their keys through here, so the page, the handlers, and the UI can
// never disagree.

export type RebindableShortcutId =
  | 'phase-site'
  | 'phase-structure'
  | 'phase-furnish'
  | 'mode-select'
  | 'mode-build'
  | 'mode-delete'
  | 'tool-furnish'
  | 'tool-zone'
  | 'tool-measurement'
  | 'pivot-rotate'

export type ShortcutOverrides = Partial<Record<RebindableShortcutId, string>>

export const DEFAULT_SHORTCUT_KEYS: Record<RebindableShortcutId, string> = {
  'phase-site': '1',
  'phase-structure': '2',
  'phase-furnish': '3',
  'mode-select': 'v',
  'mode-build': 'b',
  'mode-delete': 'x',
  'tool-furnish': 'f',
  'tool-zone': 'z',
  'tool-measurement': 'm',
  'pivot-rotate': 'q',
}

export const REBINDABLE_SHORTCUT_IDS = Object.keys(DEFAULT_SHORTCUT_KEYS) as RebindableShortcutId[]

/**
 * Single keys owned by fixed, contextual interactions — camera WASD pan,
 * R/T rotate, C room auto-close, E operate node, G/P tool gestures.
 * Rebinding a shortcut onto one of these would double-fire both actions.
 */
export const STATIC_RESERVED_KEYS = new Set(['a', 'c', 'd', 'e', 'g', 'p', 'r', 's', 't', 'w'])

export function isValidShortcutKey(key: string): boolean {
  return /^[a-z0-9]$/.test(key)
}

export function resolveShortcutKey(id: RebindableShortcutId, overrides: ShortcutOverrides): string {
  const override = overrides[id]
  return override && isValidShortcutKey(override) ? override : DEFAULT_SHORTCUT_KEYS[id]
}

/**
 * Why `key` cannot be assigned to `id`: a statically reserved key, or the id
 * of another rebindable shortcut currently resolving to that key. Null when
 * the assignment is free (assigning a shortcut its own key is a no-op, not a
 * conflict).
 */
export function shortcutKeyConflict(
  id: RebindableShortcutId,
  key: string,
  overrides: ShortcutOverrides,
): 'reserved' | RebindableShortcutId | null {
  if (STATIC_RESERVED_KEYS.has(key)) return 'reserved'
  for (const other of REBINDABLE_SHORTCUT_IDS) {
    if (other !== id && resolveShortcutKey(other, overrides) === key) return other
  }
  return null
}

/** Drop unknown ids, malformed keys, and colliding entries from persisted data. */
export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (typeof value !== 'object' || value === null) return {}
  const normalized: ShortcutOverrides = {}
  for (const id of REBINDABLE_SHORTCUT_IDS) {
    const key = (value as Record<string, unknown>)[id]
    if (typeof key !== 'string' || !isValidShortcutKey(key)) continue
    if (key === DEFAULT_SHORTCUT_KEYS[id]) continue
    if (shortcutKeyConflict(id, key, normalized) !== null) continue
    normalized[id] = key
  }
  return normalized
}
