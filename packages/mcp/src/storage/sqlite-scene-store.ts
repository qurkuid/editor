import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SceneMaterial } from '@pascal-app/core/schema'
import { z } from 'zod'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-driver'
import {
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneEvent,
  type SceneEventAppendOptions,
  type SceneEventListOptions,
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneRevisionMeta,
  type SceneSaveOptions,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  SceneWipeBlockedError,
  type SceneWithGraph,
} from './types'

const DEFAULT_MAX_SCENE_BYTES = 10 * 1024 * 1024
const DEFAULT_LIST_LIMIT = 100

// Wipe guard of last resort: a stored scene at least this populated refuses a
// save that would collapse it to (near) empty. The client-side autosave guard
// has been bypassed once already — a failed load reset its node-count baseline
// and a 355-node scene was overwritten with an empty graph.
const WIPE_GUARD_MIN_STORED_NODES = 20
const WIPE_GUARD_FLOOR_NODES = 5
const WIPE_GUARD_RATIO = 0.1

// Rotating whole-file DB backups: at most one `VACUUM INTO` snapshot per
// interval, newest BACKUP_KEEP kept (48 × hourly ≈ two days of snapshots).
const BACKUP_INTERVAL_MS = 60 * 60 * 1000
const BACKUP_KEEP = 48
const MAX_NAME_LENGTH = 200
const MIN_NAME_LENGTH = 1

export interface SqliteSceneStoreOptions {
  /** Exact SQLite database file path. If omitted, resolved from env. */
  databasePath?: string
  /** Optional env override for default path and size-limit resolution. */
  env?: NodeJS.ProcessEnv
  /** Maximum UTF-8 byte length of graph JSON. Defaults to 10 MB. */
  maxSceneBytes?: number
}

interface SceneRow {
  id: string
  name: string
  project_id: string | null
  owner_id: string | null
  thumbnail_url: string | null
  version: number
  created_at: string
  updated_at: string
  size_bytes: number
  node_count: number
  graph_json: string
}

interface SceneEventRow {
  event_id: number
  scene_id: string
  version: number
  kind: string
  created_at: string
  graph_json: string
}

interface ProjectPlaceholder {
  id: string
  name: string
  ownerId: string | null
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
}

const GraphSchema = z.object({
  nodes: z.record(z.string(), z.unknown()),
  rootNodeIds: z.array(z.string()),
  collections: z.record(z.string(), z.unknown()).optional(),
  materials: z.record(z.string(), SceneMaterial).optional(),
})

/**
 * Resolves Pascal's local SQLite database path.
 *
 * Precedence:
 * 1. `PASCAL_DB_PATH`
 * 2. `PASCAL_DATA_DIR/pascal.db`
 * 3. On Windows: `%APPDATA%/Pascal/data/pascal.db`
 * 4. `$XDG_DATA_HOME/pascal/data/pascal.db`
 * 5. `$HOME/.pascal/data/pascal.db`
 */
export function resolveDefaultDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PASCAL_DB_PATH && env.PASCAL_DB_PATH.length > 0) {
    return env.PASCAL_DB_PATH
  }
  if (env.PASCAL_DATA_DIR && env.PASCAL_DATA_DIR.length > 0) {
    return path.join(env.PASCAL_DATA_DIR, 'pascal.db')
  }
  if (process.platform === 'win32') {
    const appData = env.APPDATA
    if (appData && appData.length > 0) {
      return path.join(appData, 'Pascal', 'data', 'pascal.db')
    }
    return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
  }
  const xdg = env.XDG_DATA_HOME
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'pascal', 'data', 'pascal.db')
  }
  return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
}

function resolveMaxSceneBytes(
  env: NodeJS.ProcessEnv | undefined,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) {
      throw new SceneInvalidError('maxSceneBytes must be a positive integer')
    }
    return explicit
  }

  const raw = env?.PASCAL_MAX_SCENE_BYTES
  if (raw === undefined || raw === '') return DEFAULT_MAX_SCENE_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SceneInvalidError('PASCAL_MAX_SCENE_BYTES must be a positive integer')
  }
  return parsed
}

function rowToMeta(row: SceneRow): SceneMeta {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sizeBytes: row.size_bytes,
    nodeCount: row.node_count,
    editorUrl,
    url: editorUrl,
    published: true,
    graphHash: hashGraphJson(row.graph_json),
  }
}

function editorUrlForScene(id: string): string {
  return `/editor/${id}`
}

function hashGraphJson(graphJson: string): string {
  return createHash('sha256').update(graphJson).digest('hex')
}

function rowToProjectStatus(row: SceneRow): ProjectStatus {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    projectId: row.project_id ?? row.id,
    name: row.name,
    editorUrl,
    url: editorUrl,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    publishedVersion: row.version,
    latestVersion: row.version,
    draftVersion: null,
    browserVisibleVersion: row.version,
    version: row.version,
    isEmpty: row.node_count === 0,
    sizeBytes: row.size_bytes,
    nodeCount: row.node_count,
    graphHash: hashGraphJson(row.graph_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function placeholderToProjectStatus(project: ProjectPlaceholder): ProjectStatus {
  const editorUrl = editorUrlForScene(project.id)
  return {
    id: project.id,
    projectId: project.id,
    name: project.name,
    editorUrl,
    url: editorUrl,
    ownerId: project.ownerId,
    thumbnailUrl: project.thumbnailUrl,
    publishedVersion: null,
    latestVersion: null,
    draftVersion: null,
    browserVisibleVersion: null,
    version: 0,
    isEmpty: true,
    sizeBytes: 0,
    nodeCount: 0,
    graphHash: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function assertValidName(name: string): void {
  if (typeof name !== 'string') {
    throw new SceneInvalidError('Scene name must be a string')
  }
  const trimmed = name.trim()
  if (trimmed.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new SceneInvalidError(
      `Scene name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters (got ${name.length})`,
    )
  }
}

function serializeGraph(graph: SceneGraph): string {
  return JSON.stringify(graph)
}

function parseGraph(raw: string, context: string): SceneGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new SceneInvalidError(
      `Failed to parse scene graph for ${context}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = GraphSchema.safeParse(parsed)
  if (!result.success) {
    throw new SceneInvalidError(`Scene graph for ${context} has invalid shape: ${result.error}`)
  }

  const graph = result.data
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new SceneInvalidError(`Scene graph for ${context} has non-object node at "${nodeId}"`)
    }
    const typeField = (node as { type?: unknown }).type
    if (typeof typeField !== 'string' || typeField.length === 0) {
      throw new SceneInvalidError(
        `Scene graph for ${context} has node "${nodeId}" missing a string "type"`,
      )
    }
  }

  return graph as SceneGraph
}

function asSceneRow(value: unknown): SceneRow | null {
  if (!value || typeof value !== 'object') return null
  return value as SceneRow
}

function rowToSceneEvent(row: SceneEventRow): SceneEvent {
  return {
    eventId: Number(row.event_id),
    sceneId: row.scene_id,
    version: Number(row.version),
    kind: row.kind,
    createdAt: row.created_at,
    graph: parseGraph(row.graph_json, `${row.scene_id}@${row.version}`),
  }
}

/**
 * SQLite-backed implementation of `SceneStore`.
 *
 * Uses one local database file, WAL mode, and transaction-scoped version checks
 * so a local editor and MCP process can safely share scenes on one machine.
 */
export class SqliteSceneStore implements SceneStore {
  readonly backend = 'sqlite' as const

  readonly databasePath: string

  private readonly maxSceneBytes: number
  private readonly projectPlaceholders = new Map<string, ProjectPlaceholder>()
  private db: SqliteDatabase | null = null
  private dbPromise: Promise<SqliteDatabase> | null = null

  constructor(opts: SqliteSceneStoreOptions = {}) {
    const env = opts.env ?? process.env
    this.databasePath = path.resolve(
      /* turbopackIgnore: true */ opts.databasePath ?? resolveDefaultDatabasePath(env),
    )
    this.maxSceneBytes = resolveMaxSceneBytes(env, opts.maxSceneBytes)
  }

  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    const db = await this.database()
    assertValidName(opts.name)
    const id = opts.id ? sanitizeSlug(opts.id) : this.generateUniqueId(db)
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid project id after sanitization: "${id}"`)
    }
    if (this.getRow(db, id)) {
      throw new SceneInvalidError(`Project with id "${id}" already exists`)
    }
    const now = new Date().toISOString()
    const project: ProjectPlaceholder = {
      id,
      name: opts.name,
      ownerId: opts.ownerId ?? null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    }
    this.projectPlaceholders.set(id, project)
    return placeholderToProjectStatus(project)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const db = await this.database()
    const safeId = sanitizeSlug(id)
    const row = this.getRow(db, safeId)
    if (row) return rowToProjectStatus(row)
    const placeholder = this.projectPlaceholders.get(safeId)
    return placeholder ? placeholderToProjectStatus(placeholder) : null
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    const meta = await this.withWriteTransaction((db) => {
      assertValidName(opts.name)
      if (!opts.graph || typeof opts.graph !== 'object') {
        throw new SceneInvalidError('graph is required')
      }

      const providedId = opts.id
      const id = providedId ? sanitizeSlug(providedId) : this.generateUniqueId(db)
      if (!isValidSlug(id)) {
        throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
      }

      const existing = this.getRow(db, id)
      const placeholder = this.projectPlaceholders.get(id)

      if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
        throw new SceneInvalidError(
          `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
        )
      }

      if (opts.expectedVersion !== undefined) {
        const currentVersion = existing?.version ?? 0
        if (currentVersion !== opts.expectedVersion) {
          throw new SceneVersionConflictError(
            `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${currentVersion}`,
          )
        }
      }

      const graphJson = serializeGraph(opts.graph)
      const sizeBytes = Buffer.byteLength(graphJson, 'utf8')
      if (sizeBytes > this.maxSceneBytes) {
        throw new SceneTooLargeError(
          `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${this.maxSceneBytes} bytes`,
        )
      }

      const now = new Date().toISOString()
      const version = (existing?.version ?? 0) + 1
      const createdAt = existing?.created_at ?? placeholder?.createdAt ?? now
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length

      if (
        existing &&
        !opts.allowWipe &&
        existing.node_count >= WIPE_GUARD_MIN_STORED_NODES &&
        nodeCount < Math.max(WIPE_GUARD_FLOOR_NODES, existing.node_count * WIPE_GUARD_RATIO)
      ) {
        throw new SceneWipeBlockedError(
          `Scene "${id}" has ${existing.node_count} stored nodes; saving ${nodeCount} would wipe it. Pass allowWipe to overwrite intentionally.`,
        )
      }
      const projectId = opts.projectId ?? existing?.project_id ?? (placeholder ? id : null)
      const ownerId = opts.ownerId ?? existing?.owner_id ?? placeholder?.ownerId ?? null
      const thumbnailUrl =
        opts.thumbnailUrl ?? existing?.thumbnail_url ?? placeholder?.thumbnailUrl ?? null

      if (existing) {
        db.query(
          `UPDATE scenes
             SET name = ?,
                 project_id = ?,
                 owner_id = ?,
                 thumbnail_url = ?,
                 version = ?,
                 updated_at = ?,
                 size_bytes = ?,
                 node_count = ?,
                 graph_json = ?
           WHERE id = ?`,
        ).run(
          opts.name,
          projectId,
          ownerId,
          thumbnailUrl,
          version,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
          id,
        )
      } else {
        db.query(
          `INSERT INTO scenes (
             id, name, project_id, owner_id, thumbnail_url, version,
             created_at, updated_at, size_bytes, node_count, graph_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          opts.name,
          projectId,
          ownerId,
          thumbnailUrl,
          version,
          createdAt,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
        )
      }

      db.query(
        `INSERT INTO scene_revisions (
           scene_id, version, graph_json, author_kind, author_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, version, graphJson, 'mcp', ownerId, now)

      this.projectPlaceholders.delete(id)

      return {
        id,
        name: opts.name,
        projectId,
        ownerId,
        thumbnailUrl,
        version,
        createdAt,
        updatedAt: now,
        sizeBytes,
        nodeCount,
        editorUrl: editorUrlForScene(id),
        url: editorUrlForScene(id),
        published: true,
        graphHash: hashGraphJson(graphJson),
      }
    })
    await this.maybeBackupDatabase()
    return meta
  }

  /**
   * Rotating whole-file backup beside the database (`<dir>/backups/`): at
   * most one `VACUUM INTO` snapshot per BACKUP_INTERVAL_MS, newest
   * BACKUP_KEEP kept. Best-effort — a backup failure must never fail the
   * save that triggered it.
   */
  private async maybeBackupDatabase(): Promise<void> {
    if (this.databasePath === ':memory:') return
    try {
      const dir = path.join(path.dirname(this.databasePath), 'backups')
      mkdirSync(dir, { recursive: true })
      const snapshots = readdirSync(dir)
        .filter((file) => file.startsWith('pascal-') && file.endsWith('.db'))
        .sort()
      const newest = snapshots[snapshots.length - 1]
      if (newest && Date.now() - statSync(path.join(dir, newest)).mtimeMs < BACKUP_INTERVAL_MS) {
        return
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = path.join(dir, `pascal-${stamp}.db`)
      const db = await this.database()
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length + 1 - BACKUP_KEEP))) {
        unlinkSync(path.join(dir, old))
      }
    } catch (error) {
      console.warn('[scene-store] database backup skipped:', error)
    }
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const db = await this.database()
    const row = this.getRow(db, sanitizeSlug(id))
    if (!row) return null
    return {
      ...rowToMeta(row),
      graph: parseGraph(row.graph_json, row.id),
    }
  }

  async setThumbnailUrl(id: string, thumbnailUrl: string | null): Promise<boolean> {
    return this.withWriteTransaction((db) => {
      const result = db
        .query('UPDATE scenes SET thumbnail_url = ? WHERE id = ?')
        .run(thumbnailUrl, sanitizeSlug(id))
      return result.changes > 0
    })
  }

  async listRevisions(id: string, opts: { limit?: number } = {}): Promise<SceneRevisionMeta[]> {
    const db = await this.database()
    const limit = Math.min(Math.max(1, opts.limit ?? 100), 500)
    const rows = db
      .query(
        `SELECT version,
                created_at,
                author_kind,
                author_id,
                length(graph_json) AS size_bytes,
                (SELECT count(*) FROM json_each(scene_revisions.graph_json, '$.nodes')) AS node_count
           FROM scene_revisions
          WHERE scene_id = ?
          ORDER BY version DESC
          LIMIT ?`,
      )
      .all(sanitizeSlug(id), limit) as Array<{
      version: number
      created_at: string
      author_kind: string
      author_id: string | null
      size_bytes: number
      node_count: number
    }>
    return rows.map((row) => ({
      version: row.version,
      createdAt: row.created_at,
      authorKind: row.author_kind,
      authorId: row.author_id,
      sizeBytes: row.size_bytes,
      nodeCount: row.node_count,
    }))
  }

  async loadRevision(id: string, version: number): Promise<SceneGraph | null> {
    const db = await this.database()
    const row = db
      .query('SELECT graph_json FROM scene_revisions WHERE scene_id = ? AND version = ?')
      .get(sanitizeSlug(id), version) as { graph_json: string } | undefined
    if (!row) return null
    return parseGraph(row.graph_json, id)
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    const clauses: string[] = []
    const bindings: Array<string | number> = []

    if (opts.projectId !== undefined) {
      clauses.push('project_id = ?')
      bindings.push(opts.projectId)
    }
    if (opts.ownerId !== undefined) {
      clauses.push('owner_id = ?')
      bindings.push(opts.ownerId)
    }

    const requestedLimit = opts.limit ?? DEFAULT_LIST_LIMIT
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 0 ? requestedLimit : 0
    bindings.push(limit)

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const db = await this.database()
    const rows = db
      .query(
        `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                created_at, updated_at, size_bytes, node_count, graph_json
           FROM scenes
           ${where}
          ORDER BY updated_at DESC, id ASC
          LIMIT ?`,
      )
      .all(...bindings)

    return rows.map((row) => rowToMeta(row as SceneRow))
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    return this.withWriteTransaction((db) => {
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) return false
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }
      db.query('DELETE FROM scenes WHERE id = ?').run(safeId)
      return true
    })
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    return this.withWriteTransaction((db) => {
      assertValidName(newName)
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }

      const now = new Date().toISOString()
      const nextVersion = existing.version + 1
      db.query('UPDATE scenes SET name = ?, version = ?, updated_at = ? WHERE id = ?').run(
        newName,
        nextVersion,
        now,
        safeId,
      )

      db.query(
        `INSERT INTO scene_revisions (
             scene_id, version, graph_json, author_kind, author_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(safeId, nextVersion, existing.graph_json, 'mcp', existing.owner_id, now)

      return {
        ...rowToMeta(existing),
        name: newName,
        version: nextVersion,
        updatedAt: now,
      }
    })
  }

  async appendSceneEvent(opts: SceneEventAppendOptions): Promise<SceneEvent> {
    return this.withWriteTransaction((db) => {
      const safeId = sanitizeSlug(opts.sceneId)
      const existing = this.getRow(db, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }

      const graphJson = serializeGraph(opts.graph)
      const now = new Date().toISOString()
      const result = db
        .query(
          `INSERT INTO scene_events (
             scene_id, version, kind, created_at, graph_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(safeId, opts.version, opts.kind, now, graphJson)

      return {
        eventId: Number(result.lastInsertRowid),
        sceneId: safeId,
        version: opts.version,
        kind: opts.kind,
        createdAt: now,
        graph: opts.graph,
      }
    })
  }

  async listSceneEvents(sceneId: string, opts: SceneEventListOptions = {}): Promise<SceneEvent[]> {
    const afterEventId = Math.max(0, opts.afterEventId ?? 0)
    const requestedLimit = opts.limit ?? 100
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100
    const db = await this.database()
    const rows = db
      .query(
        `SELECT event_id, scene_id, version, kind, created_at, graph_json
           FROM scene_events
          WHERE scene_id = ?
            AND event_id > ?
          ORDER BY event_id ASC
          LIMIT ?`,
      )
      .all(sanitizeSlug(sceneId), afterEventId, limit)

    return rows.map((row) => rowToSceneEvent(row as SceneEventRow))
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.dbPromise = null
  }

  private async database(): Promise<SqliteDatabase> {
    if (this.db) return this.db
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const databaseDirectory = path.dirname(/* turbopackIgnore: true */ this.databasePath)
        mkdirSync(/* turbopackIgnore: true */ databaseDirectory, { recursive: true })
        const db = await openSqliteDatabase(this.databasePath)
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('PRAGMA journal_mode = WAL')
        db.exec('PRAGMA busy_timeout = 5000')
        this.migrate(db)
        this.db = db
        return db
      })()
    }
    return this.dbPromise
  }

  private migrate(db: SqliteDatabase): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 200),
        project_id TEXT,
        owner_id TEXT,
        thumbnail_url TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        node_count INTEGER NOT NULL CHECK (node_count >= 0),
        graph_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS scenes_project_updated_idx
        ON scenes(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS scenes_owner_updated_idx
        ON scenes(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS scene_revisions (
        scene_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        graph_json TEXT NOT NULL,
        author_kind TEXT NOT NULL,
        author_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scene_id, version),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scene_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        scene_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS scene_events_scene_event_idx
        ON scene_events(scene_id, event_id);
    `)
  }

  private async withWriteTransaction<T>(fn: (db: SqliteDatabase) => T | Promise<T>): Promise<T> {
    const db = await this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(db)
      db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors so the original failure is preserved.
      }
      throw err
    }
  }

  private getRow(db: SqliteDatabase, id: string): SceneRow | null {
    return asSceneRow(
      db
        .query(
          `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                  created_at, updated_at, size_bytes, node_count, graph_json
             FROM scenes
            WHERE id = ?`,
        )
        .get(id),
    )
  }

  private generateUniqueId(db: SqliteDatabase): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateSlug()
      if (!this.getRow(db, id)) return id
    }
    throw new SceneInvalidError('Failed to generate a unique scene id')
  }
}
