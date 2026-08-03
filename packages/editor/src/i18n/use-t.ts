'use client'

import { useCallback } from 'react'
import useLocale from './locale-store'
import { type MessageId, translate } from './translate'

/** Reactive translator bound to the current locale — re-renders the caller
 * on `setLocale`. Use `translate(key, locale)` instead outside React. */
export function useT() {
  const locale = useLocale((state) => state.locale)
  return useCallback((key: MessageId) => translate(key, locale), [locale])
}
