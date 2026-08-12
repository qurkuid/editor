import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRectangleBody, getBodySemanticHash } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  executeImprintBodyFace,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  executeTransformBody,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { BodyNode, SceneMaterial } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import {
  commitModelingResult,
  evaluateModelingOperation,
  parseModelingOperationInput,
} from '../tools/modeling-operation-shared'
import {
  resolveDefaultDatabasePath,
  SqliteSceneStore,
  type SqliteSceneStoreOptions,
} from './sqlite-scene-store'
import {
  SceneInvalidError,
  SceneTooLargeError,
  SceneVersionConflictError,
  SceneWipeBlockedError,
} from './types'

function makeGraph(overrides: Partial<SceneGraph> = {}): SceneGraph {
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
      building_def: {
        object: 'node',
        id: 'building_def',
        type: 'building',
        parentId: 'site_abc',
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
    ...overrides,
  }
}

async function mkTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pascal-sqlite-test-'))
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

function createStore(rootDir: string, opts: Partial<SqliteSceneStoreOptions> = {}) {
  return new SqliteSceneStore({
    databasePath: path.join(rootDir, 'pascal.db'),
    ...opts,
  })
}

describe('resolveDefaultDatabasePath', () => {
  test('respects PASCAL_DB_PATH when set', () => {
    expect(resolveDefaultDatabasePath({ PASCAL_DB_PATH: '/tmp/custom.db' })).toBe('/tmp/custom.db')
  })

  test('resolves PASCAL_DATA_DIR to pascal.db', () => {
    expect(resolveDefaultDatabasePath({ PASCAL_DATA_DIR: '/tmp/pascal-data' })).toBe(
      path.join('/tmp/pascal-data', 'pascal.db'),
    )
  })

  test('falls back to XDG_DATA_HOME on Unix', () => {
    if (process.platform === 'win32') return
    expect(resolveDefaultDatabasePath({ XDG_DATA_HOME: '/xdg/share' })).toBe(
      path.join('/xdg/share', 'pascal', 'data', 'pascal.db'),
    )
  })

  test('falls back to homedir + .pascal/data/pascal.db', () => {
    if (process.platform === 'win32') return
    expect(resolveDefaultDatabasePath({}).endsWith(path.join('.pascal', 'data', 'pascal.db'))).toBe(
      true,
    )
  })
})

describe('SqliteSceneStore', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('backend is "sqlite"', () => {
    expect(store.backend).toBe('sqlite')
  })

  test('round-trips a saved scene through a reopened database', async () => {
    const graph = makeGraph()
    const saved = await store.save({ id: 'kitchen', name: 'Kitchen', graph })

    expect(saved.id).toBe('kitchen')
    expect(saved.version).toBe(1)
    expect(saved.nodeCount).toBe(2)
    expect(saved.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(graph), 'utf8'))

    store.close()
    store = createStore(rootDir)

    const loaded = await store.load('kitchen')
    expect(loaded).not.toBeNull()
    expect(loaded!.graph).toEqual(graph)
    expect(loaded!.name).toBe('Kitchen')
  })

  test('preserves a painted SceneMaterial through save and reopen', async () => {
    const base = makeGraph()
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const material = SceneMaterial.parse({
      id: 'mat_painted_red',
      name: 'Painted red',
      material: {
        preset: 'custom',
        properties: { color: '#b91c1c' },
      },
    })
    const graph = {
      ...base,
      nodes: {
        ...base.nodes,
        [body.id]: {
          ...body,
          faces: body.faces.map((face) =>
            face.id === 'face:0'
              ? { ...face, surface: { ...face.surface, materialRef: 'scene:mat_painted_red' } }
              : face,
          ),
        },
      },
      materials: { [material.id]: material },
    }

    await store.save({ id: 'painted', name: 'Painted', graph })
    store.close()
    store = createStore(rootDir)

    const loaded = await store.load('painted')
    expect(loaded?.graph).toEqual(graph)
  })

  test('proves operation commit, SQLite save, close/reopen, and semantic hash parity', async () => {
    const material = SceneMaterial.parse({
      id: 'mat_sqlite_operation',
      name: 'SQLite operation paint',
      material: { preset: 'custom', properties: { color: '#b91c1c' } },
    })
    const cases = [
      {
        id: 'sqlite-push-pull',
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        source: createRectangleBody({ width: 2, depth: 2 }),
        input: { faceId: 'face:0', distance: 1 },
        build: executePushPullBodyFace,
      },
      {
        id: 'sqlite-sweep',
        operationId: MODELING_OPERATION_IDS.sweepBodyFace,
        source: createRectangleBody({ width: 2, depth: 2 }),
        input: {
          faceId: 'face:0',
          pathPoints: [
            [0, 0, 0],
            [0, 1, 0],
            [0, 1, 1],
          ],
        },
        build: executeSweepBodyFace,
      },
      {
        id: 'sqlite-imprint',
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        source: executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
          faceId: 'face:0',
          distance: 1,
        }).body,
        input: {
          faceId: 'face:0',
          profilePoints: [
            [0.5, 1, 0.5],
            [1.5, 1, 0.5],
            [1.5, 1, 1.5],
            [0.5, 1, 1.5],
          ],
          distance: 0.25,
        },
        build: executeImprintBodyFace,
      },
      {
        id: 'sqlite-transform',
        operationId: MODELING_OPERATION_IDS.transformBody,
        source: createRectangleBody({ width: 2, depth: 2 }),
        input: {
          translation: [0.2, 0.3, -0.1],
          rotationAxis: [0, 1, 0],
          rotationAngle: 0,
          scale: [1, 1, 1],
          pivot: [0, 0, 0],
        },
        build: executeTransformBody,
      },
      {
        id: 'sqlite-paint',
        operationId: MODELING_OPERATION_IDS.paintBodyFace,
        source: createRectangleBody({ width: 2, depth: 2 }),
        input: { faceId: 'face:0', material },
        build: executePaintBodyFace,
      },
    ] as const

    for (const item of cases) {
      const source = BodyNode.parse({ ...item.source, id: `body_${item.id}` })
      const expected = item.build(source, item.input)
      const bridge = new SceneBridge()
      bridge.setScene({ [source.id]: source }, [source.id])
      bridge.clearHistory()
      const operations = createSceneOperations({ bridge })
      const parsed = parseModelingOperationInput(item.operationId, item.input)
      if (!parsed.success) throw new Error(parsed.message)
      commitModelingResult(operations, source.id, evaluateModelingOperation(source, parsed.data))
      expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(
        getBodySemanticHash(expected.body),
      )

      const graph = operations.exportJSON()
      await store.save({ id: item.id, name: item.id, graph })
      store.close()
      store = createStore(rootDir)
      const reopened = await store.load(item.id)
      expect(reopened).not.toBeNull()
      const reopenedBody = BodyNode.parse(reopened!.graph.nodes[source.id])
      expect(getBodySemanticHash(reopenedBody)).toBe(getBodySemanticHash(expected.body))
      if (item.operationId === MODELING_OPERATION_IDS.paintBodyFace) {
        expect(reopened!.graph.materials).toMatchObject({ [material.id]: material })
      }
    }
  })

  test('stores optional metadata verbatim', async () => {
    await store.save({
      id: 'meta-test',
      name: 'Meta',
      graph: makeGraph(),
      projectId: 'proj-1',
      ownerId: 'user-42',
      thumbnailUrl: 'https://example.com/t.png',
    })

    const loaded = await store.load('meta-test')
    expect(loaded?.projectId).toBe('proj-1')
    expect(loaded?.ownerId).toBe('user-42')
    expect(loaded?.thumbnailUrl).toBe('https://example.com/t.png')
  })

  test('generates ids for new scenes and rejects explicit slug collisions', async () => {
    const a = await store.save({ name: 'A', graph: makeGraph() })
    const b = await store.save({ name: 'B', graph: makeGraph() })
    expect(a.id).not.toBe(b.id)

    await store.save({ id: 'kitchen', name: 'K1', graph: makeGraph() })
    await expect(store.save({ id: 'kitchen', name: 'K2', graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  test('sanitizes explicit ids', async () => {
    const meta = await store.save({ id: '../My Kitchen!', name: 'Kitchen', graph: makeGraph() })
    expect(meta.id).toBe('my-kitchen')
    expect(await store.load('my-kitchen')).not.toBeNull()
  })

  test('increments version and preserves createdAt on overwrite', async () => {
    const first = await store.save({ id: 'bump', name: 'Bump', graph: makeGraph() })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await store.save({
      id: 'bump',
      name: 'Bump 2',
      graph: makeGraph(),
      expectedVersion: 1,
    })

    expect(second.version).toBe(2)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
  })

  test('enforces optimistic locking for save, rename, and delete', async () => {
    await store.save({ id: 'locked', name: 'Locked', graph: makeGraph() })

    await expect(
      store.save({ id: 'locked', name: 'Locked', graph: makeGraph(), expectedVersion: 99 }),
    ).rejects.toThrow(SceneVersionConflictError)
    await expect(store.rename('locked', 'New', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
    await expect(store.delete('locked', { expectedVersion: 99 })).rejects.toThrow(
      SceneVersionConflictError,
    )
  })

  test('expectedVersion=0 creates a brand-new explicit id', async () => {
    const meta = await store.save({
      id: 'fresh',
      name: 'Fresh',
      graph: makeGraph(),
      expectedVersion: 0,
    })
    expect(meta.version).toBe(1)
  })

  test('lists newest first and supports project, owner, and limit filters', async () => {
    await store.save({ id: 'a', name: 'A', graph: makeGraph(), projectId: 'p1', ownerId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.save({ id: 'b', name: 'B', graph: makeGraph(), projectId: 'p2', ownerId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.save({ id: 'c', name: 'C', graph: makeGraph(), projectId: 'p1', ownerId: 'u2' })

    expect((await store.list()).map((m) => m.id)).toEqual(['c', 'b', 'a'])
    expect((await store.list({ projectId: 'p1' })).map((m) => m.id)).toEqual(['c', 'a'])
    expect((await store.list({ ownerId: 'u1' })).map((m) => m.id)).toEqual(['b', 'a'])
    expect((await store.list({ limit: 2 })).map((m) => m.id)).toEqual(['c', 'b'])
  })

  test('rename writes a revision row and delete cascades revisions', async () => {
    await store.save({ id: 'rev', name: 'Rev', graph: makeGraph() })
    await store.rename('rev', 'Renamed', { expectedVersion: 1 })

    const dbPath = path.join(rootDir, 'pascal.db')
    const db = new Database(dbPath)
    try {
      const beforeDelete = db
        .query('SELECT COUNT(*) AS count FROM scene_revisions WHERE scene_id = ?')
        .get('rev') as { count: number }
      expect(beforeDelete.count).toBe(2)
    } finally {
      db.close()
    }

    expect(await store.delete('rev', { expectedVersion: 2 })).toBe(true)

    const reopened = new Database(dbPath)
    try {
      const afterDelete = reopened
        .query('SELECT COUNT(*) AS count FROM scene_revisions WHERE scene_id = ?')
        .get('rev') as { count: number }
      expect(afterDelete.count).toBe(0)
    } finally {
      reopened.close()
    }
  })

  test('appends and lists scene events in order', async () => {
    const graph = makeGraph()
    const meta = await store.save({ id: 'live', name: 'Live', graph })
    const first = await store.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'save_scene',
      graph,
    })
    const updatedGraph = makeGraph({
      nodes: {
        ...graph.nodes,
        wall_new: {
          object: 'node',
          id: 'wall_new',
          type: 'wall',
          parentId: 'building_def',
          visible: true,
          metadata: {},
          children: [],
          start: [0, 0],
          end: [1, 0],
          thickness: 0.1,
          height: 2.5,
          frontSide: 'unknown',
          backSide: 'unknown',
        },
      } as SceneGraph['nodes'],
    })
    const second = await store.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'create_wall',
      graph: updatedGraph,
    })

    expect(second.eventId).toBeGreaterThan(first.eventId)
    expect((await store.listSceneEvents('live')).map((event) => event.kind)).toEqual([
      'save_scene',
      'create_wall',
    ])
    const afterFirst = await store.listSceneEvents('live', { afterEventId: first.eventId })
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]!.eventId).toBe(second.eventId)
    expect(afterFirst[0]!.graph.nodes.wall_new).toBeDefined()
  })

  test('validates name and scene size', async () => {
    await expect(store.save({ name: '', graph: makeGraph() })).rejects.toThrow(SceneInvalidError)
    await expect(store.save({ name: 'x'.repeat(201), graph: makeGraph() })).rejects.toThrow(
      SceneInvalidError,
    )

    const tinyStore = createStore(rootDir, {
      databasePath: path.join(rootDir, 'tiny.db'),
      maxSceneBytes: 100,
    })
    try {
      await expect(tinyStore.save({ id: 'big', name: 'Big', graph: makeGraph() })).rejects.toThrow(
        SceneTooLargeError,
      )
    } finally {
      tinyStore.close()
    }
  })

  test('load returns null for missing scenes and errors on corrupt graph rows', async () => {
    expect(await store.load('missing')).toBeNull()

    const db = new Database(path.join(rootDir, 'pascal.db'), { create: true })
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scenes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_id TEXT,
          owner_id TEXT,
          thumbnail_url TEXT,
          version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          node_count INTEGER NOT NULL,
          graph_json TEXT NOT NULL
        );
      `)
      db.query(
        `INSERT INTO scenes (
           id, name, version, created_at, updated_at, size_bytes, node_count, graph_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('bad', 'Bad', 1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 2, 0, '{}')
    } finally {
      db.close()
    }

    await expect(store.load('bad')).rejects.toThrow(SceneInvalidError)
  })
})

describe('wipe guard and rotating backups', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  function populatedGraph(count: number): SceneGraph {
    const nodes: Record<string, unknown> = {
      site_abc: {
        object: 'node',
        id: 'site_abc',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    }
    for (let i = 0; i < count - 1; i++) {
      nodes[`wall_${i}`] = {
        object: 'node',
        id: `wall_${i}`,
        type: 'wall',
        parentId: 'site_abc',
        visible: true,
        metadata: {},
      }
    }
    return {
      nodes: nodes as SceneGraph['nodes'],
      rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
    }
  }

  const emptyGraph = (): SceneGraph => ({ nodes: {}, rootNodeIds: [] }) as unknown as SceneGraph

  test('blocks a save that collapses a populated scene to empty', async () => {
    await store.save({ id: 's', name: 'S', graph: populatedGraph(30) })

    await expect(
      store.save({ id: 's', name: 'S', graph: emptyGraph(), expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(SceneWipeBlockedError)

    // The stored graph is untouched and the version did not advance.
    const kept = await store.load('s')
    expect(kept?.nodeCount).toBe(30)
    expect(kept?.version).toBe(1)
  })

  test('allowWipe overrides the guard for intentional clears', async () => {
    await store.save({ id: 's', name: 'S', graph: populatedGraph(30) })
    const cleared = await store.save({
      id: 's',
      name: 'S',
      graph: emptyGraph(),
      expectedVersion: 1,
      allowWipe: true,
    })
    expect(cleared.version).toBe(2)
    expect(cleared.nodeCount).toBe(0)
  })

  test('small scenes and gradual shrinks stay unguarded', async () => {
    await store.save({ id: 'small', name: 'Small', graph: populatedGraph(10) })
    const clearedSmall = await store.save({
      id: 'small',
      name: 'Small',
      graph: emptyGraph(),
      expectedVersion: 1,
    })
    expect(clearedSmall.nodeCount).toBe(0)

    await store.save({ id: 'big', name: 'Big', graph: populatedGraph(30) })
    const shrunk = await store.save({
      id: 'big',
      name: 'Big',
      graph: populatedGraph(20),
      expectedVersion: 1,
    })
    expect(shrunk.nodeCount).toBe(20)
  })

  test('save writes one rotating backup snapshot per interval', async () => {
    await store.save({ id: 's', name: 'S', graph: populatedGraph(3) })
    const backupsDir = path.join(rootDir, 'backups')
    const first = (await fs.readdir(backupsDir)).filter((f) => f.endsWith('.db'))
    expect(first.length).toBe(1)

    // A second save inside the backup interval reuses the snapshot.
    await store.save({ id: 's', name: 'S', graph: populatedGraph(4), expectedVersion: 1 })
    const second = (await fs.readdir(backupsDir)).filter((f) => f.endsWith('.db'))
    expect(second).toEqual(first)

    // The snapshot is a readable SQLite database containing the scene.
    const snapshot = new Database(path.join(backupsDir, first[0]!), { readonly: true })
    const row = snapshot.query('SELECT node_count FROM scenes WHERE id = ?').get('s') as {
      node_count: number
    }
    expect(row.node_count).toBe(3)
    snapshot.close()
  })
})

describe('revisions and thumbnails', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  test('listRevisions returns per-version metadata, newest first', async () => {
    await store.save({ id: 's', name: 'S', graph: makeGraph() })
    const single = makeGraph()
    delete (single.nodes as Record<string, unknown>).building_def
    await store.save({ id: 's', name: 'S', graph: single, expectedVersion: 1 })

    const revisions = await store.listRevisions('s')
    expect(revisions.map((r) => r.version)).toEqual([2, 1])
    expect(revisions[0]!.nodeCount).toBe(1)
    expect(revisions[1]!.nodeCount).toBe(2)
    expect(revisions[0]!.authorKind).toBe('mcp')
    expect(revisions[0]!.sizeBytes).toBeGreaterThan(0)
    expect(new Date(revisions[0]!.createdAt).getTime()).not.toBeNaN()
  })

  test('loadRevision round-trips an old graph', async () => {
    const original = makeGraph()
    await store.save({ id: 's', name: 'S', graph: original })
    const single = makeGraph()
    delete (single.nodes as Record<string, unknown>).building_def
    await store.save({ id: 's', name: 'S', graph: single, expectedVersion: 1 })

    const old = await store.loadRevision('s', 1)
    expect(Object.keys(old?.nodes ?? {})).toEqual(Object.keys(original.nodes))
    expect(await store.loadRevision('s', 99)).toBeNull()
  })

  test('setThumbnailUrl stores without bumping version or updatedAt', async () => {
    const saved = await store.save({ id: 's', name: 'S', graph: makeGraph() })
    const ok = await store.setThumbnailUrl('s', 'data:image/webp;base64,AAAA')
    expect(ok).toBe(true)

    const loaded = await store.load('s')
    expect(loaded?.thumbnailUrl).toBe('data:image/webp;base64,AAAA')
    expect(loaded?.version).toBe(saved.version)
    expect(loaded?.updatedAt).toBe(saved.updatedAt)

    expect(await store.setThumbnailUrl('missing', 'x')).toBe(false)
  })
})
