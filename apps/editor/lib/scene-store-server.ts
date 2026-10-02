import type { SceneOperations } from '@pascal-app/mcp/operations'
import type { SceneStore, SqliteSceneStore } from '@pascal-app/mcp/storage'

/**
 * Per-process singleton. The factory is async because backend modules are
 * dynamically imported — we cache the in-flight promise so concurrent calls
 * during a cold start share a single instantiation.
 */
let cachedStore: Promise<SqliteSceneStore> | null = null
let cachedOperations: Promise<SceneOperations> | null = null

export function getSceneStore(): Promise<SqliteSceneStore> {
  if (!cachedStore) {
    cachedStore = (async () => {
      const mod = (await import('@pascal-app/mcp/storage')) as unknown as {
        createSceneStore: (env?: NodeJS.ProcessEnv) => Promise<SqliteSceneStore>
      }
      return mod.createSceneStore(process.env)
    })()
  }
  return cachedStore
}

export function getSceneOperations(): Promise<SceneOperations> {
  if (!cachedOperations) {
    cachedOperations = (async () => {
      const store = await getSceneStore()
      const mod = (await import('@pascal-app/mcp/operations')) as {
        createSceneOperations: (options: { store: SceneStore }) => SceneOperations
      }
      return mod.createSceneOperations({ store })
    })()
  }
  return cachedOperations
}

/**
 * Test-only helper to reset the cached singleton. Not exported for production
 * callers.
 */
export function __resetSceneStoreForTests(): void {
  cachedStore = null
  cachedOperations = null
}
