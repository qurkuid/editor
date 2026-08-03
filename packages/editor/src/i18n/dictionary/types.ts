export type DictionaryEntry = {
  /** Always present — the default language and the runtime fallback for
   * every other locale. */
  ko: string
  en?: string
}

export type Dictionary = Record<string, DictionaryEntry>
