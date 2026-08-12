import { describe, expect, test } from 'bun:test'
import { resolveItemModelSource } from './model-source'

describe('resolveItemModelSource', () => {
  test('preserves local asset URLs for asynchronous IndexedDB resolution', () => {
    expect(resolveItemModelSource('asset://generated-chair')).toBe('asset://generated-chair')
  })

  test('keeps the existing CDN resolution for catalog models', () => {
    expect(resolveItemModelSource('/items/chair.glb')).toContain('/items/chair.glb')
    expect(resolveItemModelSource('https://example.test/chair.glb')).toBe(
      'https://example.test/chair.glb',
    )
  })
})
