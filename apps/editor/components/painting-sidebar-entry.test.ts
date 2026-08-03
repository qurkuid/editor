import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const PAGE_SOURCE = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const SCENE_LOADER_SOURCE = readFileSync(new URL('./scene-loader.tsx', import.meta.url), 'utf8')

test('keeps the primary creation workspaces directly accessible from every editor sidebar', () => {
  // Given: both standalone editor entry points define their own sidebar tabs.
  const editorEntries = [PAGE_SOURCE, SCENE_LOADER_SOURCE]

  // When: a user opens either editor surface without navigating through another workspace.
  // Tab labels resolve through `t()` at render time (see `buildSidebarTabs`), so
  // the stable identifier to check for in source is each tab's `id`, not its label.
  const workspaceEntries = editorEntries.map((source) => ({
    furniture: source.includes("id: 'furniture'"),
    lighting: source.includes("id: 'lighting'"),
    modeling: source.includes("id: 'build'"),
    painting: source.includes("id: 'painting'"),
  }))

  // Then: modeling, lighting, and painting are first-class destinations in both.
  expect(workspaceEntries).toEqual([
    { furniture: true, lighting: true, modeling: true, painting: true },
    { furniture: true, lighting: true, modeling: true, painting: true },
  ])
})
