import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SceneMaterial } from '@pascal-app/core/schema'
import { z } from 'zod'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-driver'
import {
  FinishTemplateConflictError,
  type FinishTemplateCreateOptions,
  FinishTemplateForbiddenError,
  type FinishTemplateKind,
  type FinishTemplateListOptions,
  type FinishTemplateMutateOptions,
  type FinishTemplateRecord,
  type FinishTemplateScope,
  type FinishTemplateVisibility,
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

const DEFAULT_MAX_SCENE_BYTES = 300 * 1024 * 1024
const MAX_STORED_SCENE_BYTES = 40 * 1024 * 1024
const COMPRESS_SCENE_BYTES = 1024 * 1024
const COMPRESSED_GRAPH_PREFIX = 'gzip:'
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
const MAX_FINISH_TEMPLATE_ID_LENGTH = 160
const MAX_FINISH_TEMPLATE_BYTES = 2 * 1024 * 1024

export interface SqliteSceneStoreOptions {
  /** Exact SQLite database file path. If omitted, resolved from env. */
  databasePath?: string
  /** Optional env override for default path and size-limit resolution. */
  env?: NodeJS.ProcessEnv
  /** Maximum expanded UTF-8 byte length of graph JSON. Defaults to 300 MB. */
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

interface FinishTemplateRow {
  id: string
  kind: FinishTemplateKind
  name: string
  visibility: FinishTemplateVisibility
  owner_id: string
  company_id: string | null
  version: number
  created_at: string
  updated_at: string
  payload_json: string
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

function assertValidFinishTemplateName(name: string): void {
  if (typeof name !== 'string') {
    throw new SceneInvalidError('Finish template name must be a string')
  }
  const trimmed = name.trim()
  if (trimmed.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new SceneInvalidError(
      `Finish template name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters (got ${name.length})`,
    )
  }
}

function assertValidFinishTemplateId(id: string): void {
  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    id.length > MAX_FINISH_TEMPLATE_ID_LENGTH
  ) {
    throw new SceneInvalidError(
      `Finish template id must be 1-${MAX_FINISH_TEMPLATE_ID_LENGTH} characters`,
    )
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new SceneInvalidError('Finish template payload must be JSON')
  return serialized
}

function serializeFinishTemplatePayload(payload: unknown): string {
  const raw = JSON.stringify(payload)
  if (raw === undefined) throw new SceneInvalidError('Finish template payload must be JSON')
  const size = Buffer.byteLength(raw, 'utf8')
  if (size > MAX_FINISH_TEMPLATE_BYTES) {
    throw new SceneTooLargeError(
      `Finish template payload is ${size} bytes, exceeds cap of ${MAX_FINISH_TEMPLATE_BYTES} bytes`,
    )
  }
  return raw
}

function parseFinishTemplatePayload(raw: string, id: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new SceneInvalidError(`Finish template "${id}" has invalid JSON payload`)
  }
}

function rowToFinishTemplate(row: FinishTemplateRow): FinishTemplateRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    visibility: row.visibility,
    ownerId: row.owner_id,
    companyId: row.company_id,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: parseFinishTemplatePayload(row.payload_json, row.id),
  }
}

function finishTemplateVersionConflict(
  message: string,
  currentVersion: number,
): SceneVersionConflictError {
  const error = new SceneVersionConflictError(message) as SceneVersionConflictError & {
    currentVersion?: number
  }
  error.currentVersion = currentVersion
  return error
}

function serializeGraph(graph: SceneGraph): string {
  return JSON.stringify(graph)
}

function encodeGraph(raw: string): string {
  if (Buffer.byteLength(raw, 'utf8') < COMPRESS_SCENE_BYTES) return raw
  return `${COMPRESSED_GRAPH_PREFIX}${gzipSync(raw).toString('base64')}`
}

function decodeGraph(raw: string): string {
  if (!raw.startsWith(COMPRESSED_GRAPH_PREFIX)) return raw
  return gunzipSync(Buffer.from(raw.slice(COMPRESSED_GRAPH_PREFIX.length), 'base64')).toString(
    'utf8',
  )
}

function parseGraph(raw: string, context: string): SceneGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeGraph(raw))
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

      const rawGraphJson = serializeGraph(opts.graph)
      const sizeBytes = Buffer.byteLength(rawGraphJson, 'utf8')
      if (sizeBytes > this.maxSceneBytes) {
        throw new SceneTooLargeError(
          `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${this.maxSceneBytes} bytes`,
        )
      }
      const graphJson = encodeGraph(rawGraphJson)
      const storedSizeBytes = Buffer.byteLength(graphJson, 'utf8')
      if (storedSizeBytes > MAX_STORED_SCENE_BYTES) {
        throw new SceneTooLargeError(
          `Compressed scene "${id}" is ${storedSizeBytes} bytes, exceeds storage cap of ${MAX_STORED_SCENE_BYTES} bytes`,
        )
      }

      const now = new Date().toISOString()
      const version = (existing?.version ?? 0) + 1
      const createdAt = existing?.created_at ?? placeholder?.createdAt ?? now
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length

      if (
        existing &&
        !opts.allowWipe &&
        // A populated scene refuses a zero-node overwrite outright — the
        // threshold rule below left small scenes (the 4-node /apt/trace
        // bootstrap) unprotected against client-side unload transients.
        ((existing.node_count > 0 && nodeCount === 0) ||
          (existing.node_count >= WIPE_GUARD_MIN_STORED_NODES &&
            nodeCount < Math.max(WIPE_GUARD_FLOOR_NODES, existing.node_count * WIPE_GUARD_RATIO)))
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
                graph_json
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
      graph_json: string
    }>
    return rows.map((row) => {
      const rawGraphJson = decodeGraph(row.graph_json)
      const graph = parseGraph(rawGraphJson, `${id}@${row.version}`)
      return {
        version: row.version,
        createdAt: row.created_at,
        authorKind: row.author_kind,
        authorId: row.author_id,
        sizeBytes: Buffer.byteLength(rawGraphJson, 'utf8'),
        nodeCount: Object.keys(graph.nodes).length,
      }
    })
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

  /**
   * Lists the private templates owned by a principal and the company templates
   * visible through its verified company id. The local principal is only
   * available to loopback callers and sees the local shared library.
   */
  async listFinishTemplates(
    scope: FinishTemplateScope,
    options: FinishTemplateKind | FinishTemplateListOptions = {},
  ): Promise<FinishTemplateRecord[]> {
    if (!scope.ownerId || typeof scope.ownerId !== 'string') {
      throw new SceneInvalidError('Finish template owner is required')
    }

    const kind = typeof options === 'string' ? options : options.kind
    const requestedLimit = typeof options === 'string' ? undefined : options.limit
    const requestedScope = typeof options === 'string' ? undefined : options.scope
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(1, requestedLimit as number), 500)
      : 200

    const visibleClauses: string[] = []
    const bindings: Array<string | number> = []
    if (scope.local) {
      visibleClauses.push("(owner_id = 'local' AND visibility = 'local')")
    } else {
      if (requestedScope !== 'company') {
        visibleClauses.push("(owner_id = ? AND visibility = 'private')")
        bindings.push(scope.ownerId)
      }
      if (scope.companyId && requestedScope === 'mine') {
        visibleClauses.push("(owner_id = ? AND visibility = 'company' AND company_id = ?)")
        bindings.push(scope.ownerId, scope.companyId)
      }
      if (scope.companyId && requestedScope !== 'mine') {
        visibleClauses.push("(visibility = 'company' AND company_id = ?)")
        bindings.push(scope.companyId)
      }
    }
    if (visibleClauses.length === 0) return []
    const clauses = [`(${visibleClauses.join(' OR ')})`]
    if (kind) {
      clauses.push('AND kind = ?')
      bindings.push(kind)
    }

    const db = await this.database()
    const rows = db
      .query(
        `SELECT id, kind, name, visibility, owner_id, company_id, version,
                created_at, updated_at, payload_json
          FROM finish_templates
          WHERE ${clauses.join(' ')}
          ORDER BY updated_at DESC, id ASC
          LIMIT ?`,
      )
      .all(...bindings, limit) as FinishTemplateRow[]
    return rows.map((row) => rowToFinishTemplate(row))
  }

  async getFinishTemplate(
    id: string,
    scope: FinishTemplateScope,
  ): Promise<FinishTemplateRecord | null> {
    assertValidFinishTemplateId(id)
    const db = await this.database()
    const row = this.getFinishTemplateRow(db, id)
    if (!row || !this.canReadFinishTemplate(row, scope)) return null
    return rowToFinishTemplate(row)
  }

  /**
   * Creates an immutable snapshot. Retrying the same id and identical content
   * returns the existing row without changing its version or timestamps.
   */
  async createFinishTemplate(opts: FinishTemplateCreateOptions): Promise<FinishTemplateRecord> {
    const record = await this.withWriteTransaction((db) => {
      assertValidFinishTemplateId(opts.id)
      assertValidFinishTemplateName(opts.name)
      if (!['zone', 'home'].includes(opts.kind)) {
        throw new SceneInvalidError('Finish template kind is invalid')
      }
      if (!['private', 'company', 'local'].includes(opts.visibility)) {
        throw new SceneInvalidError('Finish template visibility is invalid')
      }
      if (!opts.ownerId || typeof opts.ownerId !== 'string') {
        throw new SceneInvalidError('Finish template owner is required')
      }
      if (opts.visibility === 'company' && !opts.companyId) {
        throw new SceneInvalidError('Company templates require a verified company')
      }
      if (opts.ownerId === 'local' && opts.visibility !== 'local') {
        throw new SceneInvalidError('The local principal can only create local templates')
      }
      if (opts.visibility === 'private' && opts.companyId !== null) {
        throw new SceneInvalidError('Private templates cannot carry a company scope')
      }
      if (opts.visibility === 'local' && (opts.ownerId !== 'local' || opts.companyId !== null)) {
        throw new SceneInvalidError('Local templates require the local principal')
      }

      const payloadJson = serializeFinishTemplatePayload(opts.payload)
      const existing = this.getFinishTemplateRow(db, opts.id)
      if (existing) {
        const same =
          existing.kind === opts.kind &&
          existing.name === opts.name &&
          existing.visibility === opts.visibility &&
          existing.owner_id === opts.ownerId &&
          existing.company_id === opts.companyId &&
          stableJson(parseFinishTemplatePayload(existing.payload_json, existing.id)) ===
            stableJson(opts.payload)
        if (same) return rowToFinishTemplate(existing)
        throw new FinishTemplateConflictError(`Finish template with id "${opts.id}" already exists`)
      }

      const now = new Date().toISOString()
      db.query(
        `INSERT INTO finish_templates (
           id, kind, name, visibility, owner_id, company_id, version,
           created_at, updated_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        opts.id,
        opts.kind,
        opts.name,
        opts.visibility,
        opts.ownerId,
        opts.companyId,
        1,
        now,
        now,
        payloadJson,
      )

      return {
        id: opts.id,
        kind: opts.kind,
        name: opts.name,
        visibility: opts.visibility,
        ownerId: opts.ownerId,
        companyId: opts.companyId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        payload: parseFinishTemplatePayload(payloadJson, opts.id),
      }
    })
    await this.maybeBackupDatabase()
    return record
  }

  async renameFinishTemplate(
    id: string,
    newName: string,
    opts: FinishTemplateMutateOptions,
  ): Promise<FinishTemplateRecord> {
    const record = await this.withWriteTransaction((db) => {
      assertValidFinishTemplateId(id)
      assertValidFinishTemplateName(newName)
      const existing = this.getFinishTemplateRow(db, id)
      if (!existing) throw new SceneNotFoundError(`Finish template "${id}" not found`)
      this.assertFinishTemplateOwner(existing, opts.scope)
      this.assertFinishTemplateVersion(existing, opts.expectedVersion)

      const now = new Date().toISOString()
      const nextVersion = existing.version + 1
      const payload = parseFinishTemplatePayload(existing.payload_json, existing.id)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new SceneInvalidError(`Finish template "${id}" payload must be an object`)
      }
      const renamedPayload = { ...(payload as Record<string, unknown>), name: newName }
      const payloadJson = serializeFinishTemplatePayload(renamedPayload)
      db.query(
        `UPDATE finish_templates
            SET name = ?, payload_json = ?, version = ?, updated_at = ?
          WHERE id = ? AND owner_id = ? AND version = ?`,
      ).run(newName, payloadJson, nextVersion, now, id, opts.scope.ownerId, existing.version)
      return rowToFinishTemplate({
        ...existing,
        name: newName,
        payload_json: payloadJson,
        version: nextVersion,
        updated_at: now,
      })
    })
    await this.maybeBackupDatabase()
    return record
  }

  async deleteFinishTemplate(id: string, opts: FinishTemplateMutateOptions): Promise<boolean> {
    const removed = await this.withWriteTransaction((db) => {
      assertValidFinishTemplateId(id)
      const existing = this.getFinishTemplateRow(db, id)
      if (!existing) return false
      this.assertFinishTemplateOwner(existing, opts.scope)
      this.assertFinishTemplateVersion(existing, opts.expectedVersion)
      const result = db
        .query('DELETE FROM finish_templates WHERE id = ? AND owner_id = ? AND version = ?')
        .run(id, opts.scope.ownerId, existing.version)
      if (result.changes !== 1) {
        throw finishTemplateVersionConflict(
          `Finish template "${id}" changed during delete`,
          existing.version,
        )
      }
      return true
    })
    if (removed) await this.maybeBackupDatabase()
    return removed
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

      const graphJson = encodeGraph(serializeGraph(opts.graph))
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

      CREATE TABLE IF NOT EXISTS finish_templates (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('zone', 'home')),
        name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 200),
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'company', 'local')),
        owner_id TEXT NOT NULL,
        company_id TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS finish_templates_owner_updated_idx
        ON finish_templates(owner_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS finish_templates_company_updated_idx
        ON finish_templates(company_id, visibility, updated_at DESC);
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

  private getFinishTemplateRow(db: SqliteDatabase, id: string): FinishTemplateRow | null {
    return (db
      .query(
        `SELECT id, kind, name, visibility, owner_id, company_id, version,
                created_at, updated_at, payload_json
           FROM finish_templates
          WHERE id = ?`,
      )
      .get(id) ?? null) as FinishTemplateRow | null
  }

  private assertFinishTemplateOwner(row: FinishTemplateRow, scope: FinishTemplateScope): void {
    if (!this.canReadFinishTemplate(row, scope)) {
      throw new SceneNotFoundError(`Finish template "${row.id}" not found`)
    }
    if (row.owner_id !== scope.ownerId) {
      throw new FinishTemplateForbiddenError('Finish template is read-only for this principal')
    }
  }

  private canReadFinishTemplate(row: FinishTemplateRow, scope: FinishTemplateScope): boolean {
    const ownerCanRead =
      row.owner_id === scope.ownerId &&
      (row.visibility === 'private' ||
        (row.visibility === 'company' &&
          row.company_id !== null &&
          row.company_id === scope.companyId) ||
        (row.visibility === 'local' && scope.local && scope.ownerId === 'local'))
    const companyPeerCanRead =
      row.visibility === 'company' && row.company_id !== null && row.company_id === scope.companyId
    return ownerCanRead || companyPeerCanRead
  }

  private assertFinishTemplateVersion(row: FinishTemplateRow, expectedVersion: number): void {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new SceneInvalidError('Finish template expectedVersion must be a positive integer')
    }
    if (row.version !== expectedVersion) {
      throw finishTemplateVersionConflict(
        `Finish template "${row.id}" version mismatch: expected ${expectedVersion}, got ${row.version}`,
        row.version,
      )
    }
  }

  private generateUniqueId(db: SqliteDatabase): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateSlug()
      if (!this.getRow(db, id)) return id
    }
    throw new SceneInvalidError('Failed to generate a unique scene id')
  }
}
