'use client'

import { type MessageId, useT } from '@pascal-app/editor'

/** Client-side translated text for server-rendered pages (the locale lives in
 * localStorage, which the server cannot read). */
export function TText({ k }: { k: MessageId }) {
  const t = useT()
  return <>{t(k)}</>
}
