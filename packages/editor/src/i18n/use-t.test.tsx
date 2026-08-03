import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import useLocale from './locale-store'
import { useT } from './use-t'

function Probe() {
  const t = useT()
  return <>{t('settings.units.label')}</>
}

describe('useT', () => {
  // `renderToStaticMarkup` never commits or runs effects, so a zustand
  // selector hook rendered a second time in the same process reuses its
  // first snapshot instead of re-reading the store (no testing-library /
  // react-test-renderer is set up in this repo to drive a real update
  // cycle). One render is still a real end-to-end check that `useT` wires
  // `translate` to the live store value; the locale-flip logic itself is
  // covered directly in `translate.test.ts`.
  test('resolves the current locale through the real store', () => {
    useLocale.getState().setLocale('ko')
    expect(renderToStaticMarkup(<Probe />)).toBe('단위')
  })
})
