import { describe, expect, test } from 'bun:test'
import { resolveMessage, translate } from './translate'

describe('resolveMessage', () => {
  test('returns the requested locale string when present', () => {
    expect(resolveMessage({ ko: '단위', en: 'Units' }, 'test.key', 'ko')).toBe('단위')
    expect(resolveMessage({ ko: '단위', en: 'Units' }, 'test.key', 'en')).toBe('Units')
  })

  test('falls back to ko when the entry has no en string', () => {
    expect(resolveMessage({ ko: '단위' }, 'test.key', 'en')).toBe('단위')
  })

  test('falls back to the id itself when the message id is unknown', () => {
    expect(resolveMessage(undefined, 'test.unknown', 'ko')).toBe('test.unknown')
  })
})

describe('translate', () => {
  test('resolves a real dictionary id for both locales', () => {
    expect(translate('settings.units.label', 'ko')).toBe('단위')
    expect(translate('settings.units.label', 'en')).toBe('Units')
  })
})
