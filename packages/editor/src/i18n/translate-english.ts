import { DICTIONARY } from './dictionary'
import type { Locale } from './locale-store'

/**
 * English-string → message-id lookup, inverted from the dictionary once on
 * first use. Registry data (tool hints, `presentation.label`, chip labels)
 * is declared as plain English strings by node definitions and plugins, so
 * render sites can't reference message ids directly. Passing those strings
 * through here translates every label the dictionary knows and leaves
 * unknown ones (user-entered names, third-party plugins) untouched.
 */
let inverted: Map<string, string> | null = null

function invertedMap(): Map<string, string> {
  if (!inverted) {
    inverted = new Map()
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      const en = (entry as { en?: string }).en
      if (en && !inverted.has(en)) inverted.set(en, key)
    }
  }
  return inverted
}

export function translateEnglishLabel(label: string, locale: Locale): string {
  if (locale === 'en') return label
  const key = invertedMap().get(label)
  if (!key) return label
  return (DICTIONARY as Record<string, { ko: string }>)[key]?.ko ?? label
}
