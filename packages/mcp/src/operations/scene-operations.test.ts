import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { LevelNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import { createSceneOperations, NoActiveProjectError } from './scene-operations'

function makeGraph(): SceneGraph {
  return {
    nodes: {
      site_abc: {
        object: 'node',
        id: 'site_abc',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
  }
}

describe('SceneOperationsFacade scene events', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-scene-ops-test-'))
    store = new SqliteSceneStore({ databasePath: path.join(rootDir, 'pascal.db') })
  })

  afterEach(async () => {
    store.close()
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  // Regression: appendSceneEvent/listSceneEvents were detached from the store
  // before invocation, so `this` was undefined inside store methods that rely
  // on it (e.g. SqliteSceneStore.withWriteTransaction).
  test('appendSceneEvent and listSceneEvents preserve the store receiver', async () => {
    const operations = createSceneOperations({ store })
    const graph = makeGraph()
    const meta = await store.save({ id: 'live', name: 'Live', graph })

    const appended = await operations.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'save_scene',
      graph,
    })
    expect(appended?.sceneId).toBe(meta.id)

    const events = await operations.listSceneEvents(meta.id)
    expect(events.map((event) => event.kind)).toEqual(['save_scene'])
  })

  test('appendSceneEvent returns null and listSceneEvents throws when the store lacks scene events', async () => {
    const operations = createSceneOperations({
      store: {
        ...store,
        backend: 'sqlite',
        appendSceneEvent: undefined,
        listSceneEvents: undefined,
      } as never,
    })

    expect(
      await operations.appendSceneEvent({
        sceneId: 'live',
        version: 1,
        kind: 'save_scene',
        graph: makeGraph(),
      }),
    ).toBeNull()
    await expect(operations.listSceneEvents('live')).rejects.toThrow('scene_events_unavailable')
  })
})

describe('SceneOperationsFacade project binding', () => {
  test('rejects store-backed mutations until a project is active', () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store: Parameters<typeof createSceneOperations>[0]['store'] = {
      backend: 'sqlite',
      save: async () => {
        throw new Error('not used')
      },
      load: async () => null,
      list: async () => [],
      delete: async () => false,
      rename: async () => {
        throw new Error('not used')
      },
    }
    const operations = createSceneOperations({ bridge, store })
    const level = bridge.findNodes({ type: 'level' })[0]
    if (level?.type !== 'level') throw new Error('test fixture missing level')
    const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })

    expect(() => operations.createNode(wall, level.id)).toThrow(NoActiveProjectError)
    expect(() => operations.updateNode(level.id, { label: 'blocked' })).toThrow(
      NoActiveProjectError,
    )
    expect(() => operations.deleteNode(level.id)).toThrow(NoActiveProjectError)
    expect(() =>
      operations.applyPatch([{ op: 'update', id: level.id, data: { label: 'blocked' } }]),
    ).toThrow(NoActiveProjectError)
    expect(() => operations.undo()).toThrow(NoActiveProjectError)
    expect(() => operations.redo()).toThrow(NoActiveProjectError)
  })

  test('keeps bridge-only embedded mutations available without a project', () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    const operations = createSceneOperations({ bridge })
    const level = LevelNode.parse({ level: 0, children: [], height: 2.5 })

    expect(operations.createNode(level)).toBe(level.id)
    expect(operations.getNode(level.id)).toEqual(level)
  })
})
