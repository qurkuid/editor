import { describe, expect, test } from 'bun:test'
import useLocale from './locale-store'

describe('locale store', () => {
  test('defaults to Korean', () => {
    expect(useLocale.getState().locale).toBe('ko')
  })

  test('setLocale updates the locale', () => {
    useLocale.getState().setLocale('en')

    expect(useLocale.getState().locale).toBe('en')

    useLocale.getState().setLocale('ko')
  })
})
