'use client'

import { useCallback } from 'react'
import useLocale from './locale-store'
import { translateEnglishLabel } from './translate-english'

/** Reactive English-label translator for registry-declared strings (tool
 * hints, `presentation.label`, chip labels). Unknown labels pass through. */
export function useTLabel() {
  const locale = useLocale((state) => state.locale)
  return useCallback((label: string) => translateEnglishLabel(label, locale), [locale])
}
