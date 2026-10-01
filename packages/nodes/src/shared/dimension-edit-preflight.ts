import {
  type AnyNode,
  type AnyNodeId,
  AxisGuideStretchError,
  buildDimensionStretchPlan,
  type DimensionStretchPlan,
  type DimensionStretchRequest,
  type FloorplanDimensionEditDescriptor,
  type FloorplanDimensionEditLeaf,
  type FloorplanGeometry,
  type GeometryContext,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import type {
  FloorplanDimensionEditPreflightArgs,
  FloorplanDimensionEditPreflightResult,
} from '@pascal-app/editor'
import {
  buildLevelWallConstructionDimensionPlan,
  type PlannedConstructionDimension,
} from '../wall/construction-dimensions'
import { buildRoomClearDimensions } from '../zone/room-clear-dimensions'
import { constructionDimensionStandard } from './construction-dimension-standards'

const REGENERATION_TOLERANCE = 2e-5

type RegeneratedDimension = {
  descriptor: FloorplanDimensionEditDescriptor
}

/**
 * Node-owned dimension preflight. The core planner computes the scene update;
 * this layer applies it only to a clone, regenerates the node's own dimension
 * source, and rejects a stale or resegmented chain before the editor writes it.
 */
export function preflightWallDimensionEdit(
  args: FloorplanDimensionEditPreflightArgs<WallNode>,
): FloorplanDimensionEditPreflightResult {
  const descriptor = validateEditableDescriptor(args.request)
  if (descriptor.kind === 'room-clear') {
    throw dimensionFailure('unsupported-dimension', 'A wall cannot own a room-clear dimension')
  }
  const plan = buildDimensionStretchPlan(args.nodes, args.request)
  const nextNodes = applyPlanToClone(args.nodes, plan)
  const levelWalls = Object.values(nextNodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === descriptor.levelId,
  )
  const standard = standardForConstructionGenerator(descriptor.generatorKey)
  const regenerated = flattenWallDimensions(
    buildLevelWallConstructionDimensionPlan(levelWalls, nextNodes, standard),
  )
  verifyRegeneratedDimension(descriptor, args.request, regenerated)
  return { descriptorId: plan.descriptorId, updates: plan.updates }
}

/**
 * Room-clear dimensions use the same core planar planner but regenerate from
 * the zone's pure builder. Keeping this callback in nodes avoids an editor to
 * nodes runtime import and keeps the final history transaction in the editor.
 */
export function preflightZoneDimensionEdit(
  args: FloorplanDimensionEditPreflightArgs<ZoneNode>,
): FloorplanDimensionEditPreflightResult {
  const descriptor = validateEditableDescriptor(args.request)
  if (descriptor.kind !== 'room-clear') {
    throw dimensionFailure('unsupported-dimension', 'A zone can only own room-clear dimensions')
  }
  const plan = buildDimensionStretchPlan(args.nodes, args.request)
  const nextNodes = applyPlanToClone(args.nodes, plan)
  const zone = nextNodes[descriptor.sourceNodeId!]
  if (zone?.type !== 'zone') {
    throw dimensionFailure('unsupported-dimension', 'The room source no longer exists')
  }
  const regenerated = buildRoomClearDimensions(zone, createDimensionContext(nextNodes)).flatMap(
    dimensionGeometries,
  )
  verifyRegeneratedDimension(descriptor, args.request, regenerated)
  return { descriptorId: plan.descriptorId, updates: plan.updates }
}

function validateEditableDescriptor(
  request: DimensionStretchRequest,
): FloorplanDimensionEditDescriptor {
  const descriptor = request.descriptor
  if (
    descriptor.status !== 'editable' ||
    descriptor.sourceNodeId === undefined ||
    !descriptor.chainId ||
    !descriptor.semanticKey ||
    !descriptor.generatorKey
  ) {
    throw dimensionFailure(
      'unsupported-dimension',
      'This dimension is missing stable node-owned regeneration provenance',
    )
  }
  return descriptor
}

function applyPlanToClone(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  plan: DimensionStretchPlan,
): Record<AnyNodeId, AnyNode> {
  const nextNodes = { ...nodes } as Record<AnyNodeId, AnyNode>
  for (const update of plan.updates) {
    const current = nextNodes[update.id]
    if (!current) {
      throw dimensionFailure(
        'dimension-level-missing',
        `Updated node ${String(update.id)} no longer exists`,
      )
    }
    nextNodes[update.id] = { ...current, ...update.data } as AnyNode
  }
  return nextNodes
}

function standardForConstructionGenerator(
  generatorKey: string | undefined,
): ReturnType<typeof constructionDimensionStandard> {
  if (!generatorKey) {
    throw dimensionFailure('unsupported-dimension', 'The wall dimension standard is missing')
  }
  const match = /^(?:facade|interior-wall|exterior-wall):datum=([^:]+):intersections=([^:]+)$/.exec(
    generatorKey,
  )
  if (!match) {
    throw dimensionFailure('unsupported-dimension', 'The wall dimension standard is unavailable')
  }
  const [, datumPolicy, intersectionReferencePolicy] = match
  if (
    datumPolicy !== 'centerline' &&
    datumPolicy !== 'wall-face' &&
    datumPolicy !== 'structural-face' &&
    datumPolicy !== 'finish-face'
  ) {
    throw dimensionFailure('unsupported-dimension', 'The wall dimension datum is unavailable')
  }
  if (intersectionReferencePolicy !== 'single' && intersectionReferencePolicy !== 'both-faces') {
    throw dimensionFailure('unsupported-dimension', 'The wall intersection standard is unavailable')
  }
  return constructionDimensionStandard({
    datumPolicy,
    intersectionReferencePolicy,
  })
}

function flattenWallDimensions(
  plan: ReadonlyMap<string, readonly PlannedConstructionDimension[]>,
): RegeneratedDimension[] {
  return [...plan.values()].flatMap((entries) =>
    entries.flatMap((entry) =>
      entry.editDescriptor ? [{ descriptor: entry.editDescriptor }] : [],
    ),
  )
}

function dimensionGeometries(geometry: FloorplanGeometry): RegeneratedDimension[] {
  if (geometry.kind === 'dimension' && geometry.editDescriptor) {
    return [{ descriptor: geometry.editDescriptor }]
  }
  if (geometry.kind === 'dimension-string') {
    return geometry.segments.flatMap((segment) =>
      segment.editDescriptor ? [{ descriptor: segment.editDescriptor }] : [],
    )
  }
  return []
}

function verifyRegeneratedDimension(
  descriptor: FloorplanDimensionEditDescriptor,
  request: DimensionStretchRequest,
  regenerated: readonly RegeneratedDimension[],
): void {
  const candidates = regenerated.filter(
    ({ descriptor: candidate }) =>
      candidate.sourceNodeId === descriptor.sourceNodeId &&
      candidate.chainId === descriptor.chainId &&
      candidate.kind === descriptor.kind &&
      candidate.generatorKey === descriptor.generatorKey,
  )
  const matching = candidates.find(
    ({ descriptor: candidate }) => candidate.semanticKey === descriptor.semanticKey,
  )
  if (!matching) {
    throw dimensionFailure(
      'dimension-total-mismatch',
      'The edited dimension chain could not be regenerated from its source node',
    )
  }

  const selected = resolveSelectedLeaf(descriptor, request)
  const regeneratedLeaves = matching.descriptor.leaves
  const regeneratedByKey = new Map(
    regeneratedLeaves
      .filter(
        (leaf): leaf is FloorplanDimensionEditLeaf & { semanticKey: string } => !!leaf.semanticKey,
      )
      .map((leaf) => [leaf.semanticKey, leaf]),
  )
  const regeneratedSelected = selected.semanticKey
    ? regeneratedByKey.get(selected.semanticKey)
    : undefined
  if (!regeneratedSelected) {
    throw dimensionFailure(
      'dimension-total-mismatch',
      'The selected dimension leaf was regenerated differently',
    )
  }

  const expectedSelected = expectedSelectedDisplayedLength(descriptor, selected, request)
  if (Math.abs(displayedLength(regeneratedSelected) - expectedSelected) > REGENERATION_TOLERANCE) {
    throw dimensionFailure(
      'dimension-total-mismatch',
      'The selected dimension leaf did not reach its target',
    )
  }
  for (const peer of descriptor.leaves) {
    if (peer.semanticKey === selected.semanticKey) continue
    const regeneratedPeer = peer.semanticKey ? regeneratedByKey.get(peer.semanticKey) : undefined
    if (
      !regeneratedPeer ||
      Math.abs(displayedLength(regeneratedPeer) - displayedLength(peer)) > REGENERATION_TOLERANCE
    ) {
      throw dimensionFailure(
        'dimension-total-mismatch',
        'Another dimension leaf changed during regeneration',
      )
    }
  }
  if (descriptor.kind === 'total') {
    const total = regeneratedLeaves.reduce((sum, leaf) => sum + displayedLength(leaf), 0)
    if (Math.abs(total - request.targetDistance) > REGENERATION_TOLERANCE) {
      throw dimensionFailure(
        'dimension-total-mismatch',
        'The regenerated dimension total did not reach its target',
      )
    }
  }
}

function resolveSelectedLeaf(
  descriptor: FloorplanDimensionEditDescriptor,
  request: DimensionStretchRequest,
): FloorplanDimensionEditLeaf {
  const id =
    request.selectedLeafId ??
    (descriptor.kind === 'total'
      ? request.fixedEnd === 'start'
        ? descriptor.leaves.at(-1)?.id
        : descriptor.leaves[0]?.id
      : descriptor.defaultLeafId)
  const leaf = descriptor.leaves.find((candidate) => candidate.id === id) ?? descriptor.leaves[0]
  if (!leaf)
    throw dimensionFailure(
      'dimension-leaf-not-found',
      'The selected dimension leaf no longer exists',
    )
  return leaf
}

function expectedSelectedDisplayedLength(
  descriptor: FloorplanDimensionEditDescriptor,
  selected: FloorplanDimensionEditLeaf,
  request: DimensionStretchRequest,
): number {
  if (descriptor.kind !== 'total') return request.targetDistance
  const currentTotal = descriptor.leaves.reduce((sum, leaf) => sum + displayedLength(leaf), 0)
  return displayedLength(selected) + (request.targetDistance - currentTotal)
}

function displayedLength(leaf: FloorplanDimensionEditLeaf): number {
  // Generated leaves already measure the displayed opening datum. The offset
  // is used only by the core planner to derive the physical hosted width.
  return leaf.currentLength
}

function createDimensionContext(nodes: Readonly<Record<AnyNodeId, AnyNode>>): GeometryContext {
  const allNodes = Object.values(nodes)
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: allNodes.filter((node) => node.type === 'zone'),
    parent: null,
  }
}

function dimensionFailure(
  code: ConstructorParameters<typeof AxisGuideStretchError>[0],
  message: string,
): AxisGuideStretchError {
  return new AxisGuideStretchError(code, message)
}
