import { afterEach, expect, test } from 'bun:test'
import { assetPath } from './asset-path'

const OLD_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH

afterEach(() => {
  if (OLD_BASE_PATH === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH
  else process.env.NEXT_PUBLIC_BASE_PATH = OLD_BASE_PATH
})

test('is a no-op when no basePath is set', () => {
  delete process.env.NEXT_PUBLIC_BASE_PATH
  expect(assetPath('/icons/wall.webp')).toBe('/icons/wall.webp')
})

test('prefixes an app-absolute path with the basePath', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/floorplan'
  expect(assetPath('/icons/wall.webp')).toBe('/floorplan/icons/wall.webp')
})

test('is idempotent on an already-prefixed path', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/floorplan'
  expect(assetPath('/floorplan/icons/wall.webp')).toBe('/floorplan/icons/wall.webp')
})

test('passes through absolute http(s) URLs unchanged', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/floorplan'
  expect(assetPath('https://cdn.example.com/icons/wall.webp')).toBe(
    'https://cdn.example.com/icons/wall.webp',
  )
  expect(assetPath('http://cdn.example.com/icons/wall.webp')).toBe(
    'http://cdn.example.com/icons/wall.webp',
  )
})

test('passes through data: and blob: URLs unchanged', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/floorplan'
  expect(assetPath('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  expect(assetPath('blob:https://editor.pascal.app/uuid')).toBe(
    'blob:https://editor.pascal.app/uuid',
  )
})

test('leaves a relative (non-leading-slash) path alone', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/floorplan'
  expect(assetPath('icons/wall.webp')).toBe('icons/wall.webp')
})
