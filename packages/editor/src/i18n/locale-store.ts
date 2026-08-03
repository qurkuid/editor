'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Locale = 'ko' | 'en'

type LocaleState = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const LOCALES = ['ko', 'en'] as const

function pickLocale(value: unknown): Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale) ? (value as Locale) : 'ko'
}

/**
 * Single source of truth for the editor's UI language. Lives in
 * `packages/editor` (not an app) so `apps/editor` and `@pascal-app/nodes`
 * (which depends on `@pascal-app/editor`) can both read and drive it —
 * flipping `locale` switches every surface across those layers at once.
 */
const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'ko',
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'pascal-locale',
      merge: (persistedState, currentState) => ({
        ...currentState,
        locale: pickLocale((persistedState as Partial<LocaleState> | undefined)?.locale),
      }),
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
)

export default useLocale
