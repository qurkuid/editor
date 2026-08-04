import { describe, expect, test } from 'bun:test'
import { isPublicAssetPath } from './auth-gate'

const BASE = '/floorplan'

describe('what the login gate must not intercept', () => {
  // The bug this exists for: chunks were answered with a login page, so the
  // app loaded a blank shell and never booted.
  test.each([
    ['/floorplan/_next/static/chunks/webpack.js'],
    ['/floorplan/_next/static/css/app.css'],
    ['/floorplan/icons/pascal.svg'],
    ['/floorplan/hdri/studio.hdr'],
    ['/floorplan/fonts/pretendard.woff2'],
    ['/floorplan/favicon.ico'],
    ['/floorplan/manifest.webmanifest'],
  ])('%s is served as a file', (path) => {
    expect(isPublicAssetPath(path, BASE)).toBe(true)
  })

  test.each([['/_next/static/chunks/webpack.js'], ['/icons/pascal.svg'], ['/favicon.ico']])(
    '%s is a file with no basePath configured too',
    (path) => {
      expect(isPublicAssetPath(path, '')).toBe(true)
    },
  )
})

describe('what the login gate must still guard', () => {
  test.each([
    ['/floorplan'],
    ['/floorplan/'],
    ['/floorplan/scenes'],
    ['/floorplan/scene/99d6a18740a0'],
    ['/floorplan/api/intm/materials'],
    ['/floorplan/api/scenes'],
  ])('%s goes through the gate', (path) => {
    expect(isPublicAssetPath(path, BASE)).toBe(false)
  })

  // A path that merely starts with the same letters is not under the basePath.
  test('a lookalike prefix is not stripped', () => {
    expect(isPublicAssetPath('/floorplanner/scenes', BASE)).toBe(false)
  })
})
