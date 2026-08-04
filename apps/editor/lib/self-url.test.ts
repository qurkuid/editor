import { describe, expect, test } from 'bun:test'
import { appUrl } from './self-url'

const BASE = '/floorplan'

describe('a server component fetching its own API', () => {
  // The bug: without the basePath this resolves against the origin and hits
  // INTM, which 404s — so every scene reported itself missing.
  test('the basePath is part of the URL', () => {
    expect(appUrl('https://intm.kr', '/api/scenes/abc', BASE)).toBe(
      'https://intm.kr/floorplan/api/scenes/abc',
    )
  })

  test('no basePath configured leaves the path alone', () => {
    expect(appUrl('http://localhost:3002', '/api/scenes/abc', '')).toBe(
      'http://localhost:3002/api/scenes/abc',
    )
  })

  // NEXT_PUBLIC_APP_URL is written by hand and may or may not carry the
  // sub-path or a trailing slash; the result must not depend on which.
  test.each([
    ['https://intm.kr'],
    ['https://intm.kr/'],
    ['https://intm.kr/floorplan'],
    ['https://intm.kr/floorplan/'],
  ])('%s yields the same URL', (origin) => {
    expect(appUrl(origin, '/api/scenes/abc', BASE)).toBe('https://intm.kr/floorplan/api/scenes/abc')
  })

  test('a path already carrying the basePath is not prefixed twice', () => {
    expect(appUrl('https://intm.kr', '/floorplan/api/scenes/abc', BASE)).toBe(
      'https://intm.kr/floorplan/api/scenes/abc',
    )
  })
})
