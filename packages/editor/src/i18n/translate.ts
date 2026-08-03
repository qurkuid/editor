import { isDevelopment } from '../lib/utils'
import { DICTIONARY } from './dictionary'
import type { Dictionary, DictionaryEntry } from './dictionary/types'
import type { Locale } from './locale-store'

export type MessageId = keyof typeof DICTIONARY

const warned = new Set<string>()

function warnOnce(message: string) {
  if (!isDevelopment || warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

/**
 * Resolves one dictionary entry to display text for a locale. Split out from
 * `translate()` (which always looks the id up in the real app dictionary) so
 * the fallback rules are unit-testable against fixture entries instead of
 * seeding fake ids into the shipped dictionary.
 *
 * A message id always resolves to real text: an `en` request falls back to
 * the entry's `ko` string when `en` is absent, and a genuinely unknown id
 * (e.g. a mistyped constant) falls back to the id itself as a last resort —
 * both cases warn once in development so a gap never ships silently.
 */
export function resolveMessage(
  entry: DictionaryEntry | undefined,
  key: string,
  locale: Locale,
): string {
  if (!entry) {
    warnOnce(`[i18n] missing message id "${key}"`)
    return key
  }
  if (locale === 'en') {
    if (entry.en) return entry.en
    warnOnce(`[i18n] "${key}" has no "en" string, falling back to ko`)
  }
  return entry.ko
}

/** Non-reactive lookup for call sites outside React (pure functions, event
 * handlers assembling strings, non-component modules). Components should
 * prefer `useT()` so they re-render on locale change. */
export function translate(key: MessageId, locale: Locale): string {
  return resolveMessage((DICTIONARY as Dictionary)[key], key, locale)
}
