import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('keeps the runtime database directory outside Turbopack file tracing', () => {
  const source = readFileSync(new URL('./sqlite-scene-store.ts', import.meta.url), 'utf8')

  expect(source.match(/turbopackIgnore: true/g)).toHaveLength(3)
})
