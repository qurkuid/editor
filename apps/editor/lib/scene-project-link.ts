import type { AnyNode } from '@pascal-app/core'

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

/** `metadata` is `JSONType` on the node; narrow it to the record we store. */
type MetadataRecord = Record<string, unknown>
type NodeWithMetadata = AnyNode & { metadata?: MetadataRecord }

function asRecord(value: unknown): MetadataRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as MetadataRecord) }
    : {}
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
