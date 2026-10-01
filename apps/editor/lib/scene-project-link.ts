import type { AnyNode } from '@pascal-app/core'
import type { EstimateItemPayload } from './estimate-submit'

/**
 * Which INTM project a scene belongs to.
 *
 * `SceneGraph` has no scene-level metadata slot, and the scene store's own
 * `projectId` is written at creation and passed through unchanged on save — so
 * the link rides on a node's `metadata`, which every node has and which
 * persists with the graph. The building node holds it when there is one,
 * because that is the scene's own root object; otherwise the first root node
 * does, so a scene without a building still remembers its project.
 *
 * Deliberately not localStorage: a browser-local link would silently disagree
 * with what a colleague opening the same scene sees.
 */

export const SCENE_PROJECT_KEY = 'intmProjectId'
export const SCENE_ESTIMATE_SUBMISSIONS_KEY = 'intmEstimateSubmissions'
const MAX_SCENE_ESTIMATE_SUBMISSIONS = 10

export type SceneEstimateSubmissionV1 = {
  schemaVersion: 1
  projectId: string
  title: string
  estimateId: string
  estimateUrl: string
  submittedAt: string
  itemCount: number
  failedItems: number
  items: EstimateItemPayload[]
}

/** `metadata` is `JSONType` on the node; narrow it to the record we store. */
type MetadataRecord = Record<string, unknown>
type NodeWithMetadata = AnyNode & { metadata?: MetadataRecord }

function asRecord(value: unknown): MetadataRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as MetadataRecord) }
    : {}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function isEstimateItem(value: unknown): value is EstimateItemPayload {
  if (!isPlainRecord(value)) return false
  const item = value
  if (
    typeof item.quantity !== 'number' ||
    !Number.isFinite(item.quantity) ||
    item.quantity < 0 ||
    typeof item.unitPrice !== 'number' ||
    !Number.isFinite(item.unitPrice) ||
    item.unitPrice < 0 ||
    !nonEmptyString(item.description)
  ) {
    return false
  }
  return (
    (item.materialId === undefined || nonEmptyString(item.materialId)) &&
    (item.productCategoryId === undefined || nonEmptyString(item.productCategoryId))
  )
}

function isSceneEstimateSubmission(value: unknown): value is SceneEstimateSubmissionV1 {
  if (!isPlainRecord(value)) return false
  const record = value
  if (
    record.schemaVersion !== 1 ||
    !nonEmptyString(record.projectId) ||
    !nonEmptyString(record.title) ||
    !nonEmptyString(record.estimateId) ||
    !nonEmptyString(record.estimateUrl) ||
    !isIsoTimestamp(record.submittedAt) ||
    !Number.isSafeInteger(record.itemCount) ||
    !Number.isSafeInteger(record.failedItems) ||
    (record.itemCount as number) < 0 ||
    (record.failedItems as number) < 0 ||
    !Array.isArray(record.items)
  ) {
    return false
  }
  const items = record.items as unknown[]
  return (
    items.length === (record.itemCount as number) + (record.failedItems as number) &&
    items.every(isEstimateItem)
  )
}

/** The node that should carry the link, or null for an empty scene. */
export function projectLinkHost(
  nodes: Readonly<Record<string, AnyNode>>,
  rootNodeIds: readonly string[] = [],
): AnyNode | null {
  const building = Object.values(nodes).find((node) => node.type === 'building')
  if (building) return building

  for (const id of rootNodeIds) {
    const node = nodes[id]
    if (node) return node
  }
  // No declared roots (or stale ids): fall back to any parentless node so the
  // link still lands somewhere stable rather than being dropped.
  return Object.values(nodes).find((node) => !node.parentId) ?? null
}

export function readSceneProjectId(
  nodes: Readonly<Record<string, AnyNode>>,
  rootNodeIds: readonly string[] = [],
): string | null {
  const host = projectLinkHost(nodes, rootNodeIds) as NodeWithMetadata | null
  const value = host?.metadata?.[SCENE_PROJECT_KEY]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The patch that records (or clears) the link. Returns null when there is
 * nowhere to put it, so callers can tell "not linked" from "cannot link".
 */
export function sceneProjectPatch(
  nodes: Readonly<Record<string, AnyNode>>,
  projectId: string | null,
  rootNodeIds: readonly string[] = [],
): { nodeId: string; metadata: MetadataRecord } | null {
  const host = projectLinkHost(nodes, rootNodeIds) as NodeWithMetadata | null
  if (!host) return null

  const metadata = asRecord(host.metadata)
  if (projectId) metadata[SCENE_PROJECT_KEY] = projectId
  else delete metadata[SCENE_PROJECT_KEY]

  return { nodeId: host.id, metadata }
}

export function readSceneEstimateSubmissions(
  nodes: Readonly<Record<string, AnyNode>>,
  rootNodeIds: readonly string[] = [],
): SceneEstimateSubmissionV1[] {
  const host = projectLinkHost(nodes, rootNodeIds) as NodeWithMetadata | null
  const value = host?.metadata?.[SCENE_ESTIMATE_SUBMISSIONS_KEY]
  if (!Array.isArray(value)) return []
  return value.filter(isSceneEstimateSubmission).slice(0, MAX_SCENE_ESTIMATE_SUBMISSIONS)
}

/**
 * The patch that appends a created estimate to the scene's audit history.
 * Invalid records are ignored so old or hand-edited scene metadata cannot
 * make the editor throw while opening a scene.
 */
export function sceneEstimateSubmissionPatch(
  nodes: Readonly<Record<string, AnyNode>>,
  record: SceneEstimateSubmissionV1,
  rootNodeIds: readonly string[] = [],
): { nodeId: string; metadata: MetadataRecord } | null {
  if (!isSceneEstimateSubmission(record)) return null
  const host = projectLinkHost(nodes, rootNodeIds) as NodeWithMetadata | null
  if (!host) return null

  const metadata = asRecord(host.metadata)
  const existing = readSceneEstimateSubmissions(nodes, rootNodeIds)
  metadata[SCENE_ESTIMATE_SUBMISSIONS_KEY] = [
    record,
    ...existing.filter(
      (item) => !(item.projectId === record.projectId && item.estimateId === record.estimateId),
    ),
  ].slice(0, MAX_SCENE_ESTIMATE_SUBMISSIONS)

  return { nodeId: host.id, metadata }
}

function trustedOrigin(value: string | null | undefined): string | null {
  if (!nonEmptyString(value)) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function canonicalSceneEstimateUrl(
  serverBaseUrl: string | null | undefined,
  record: Pick<SceneEstimateSubmissionV1, 'estimateId' | 'estimateUrl'>,
): string | null {
  const origin = trustedOrigin(serverBaseUrl)
  if (!origin || !nonEmptyString(record.estimateId) || !nonEmptyString(record.estimateUrl)) {
    return null
  }

  const canonical = `${origin}/newportal/estimates/${encodeURIComponent(record.estimateId)}/edit`
  try {
    const stored = new URL(record.estimateUrl)
    if (stored.username || stored.password || stored.search || stored.hash) return null
    return stored.href === canonical ? canonical : null
  } catch {
    return null
  }
}
