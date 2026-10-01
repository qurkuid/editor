import { generateId } from '../schema/base'
import type { Collection, CollectionId } from '../schema/collections'
import { getScaledDimensions, type ItemNode } from '../schema/nodes/item'
import { WallNode, type WallNode as WallNodeData } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { getLinkedWallUpdates } from '../systems/wall/wall-move'

const EPSILON = 1e-6

type Vec2 = [number, number]

export type WallSceneState = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections: Record<CollectionId, Collection>
}

export type WallMutation = WallSceneState & {
  primaryWallId: AnyNodeId
  createdNodeIds: AnyNodeId[]
  deletedNodeIds: AnyNodeId[]
  changedNodeIds: AnyNodeId[]
}

export class WallOperationError extends RangeError {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WallOperationError'
    this.code = code
  }
}

type WallAttachment = AnyNode & {
  wallId?: string
  wallT?: number
  position?: [number, number, number]
  parentId: string | null
  side?: 'front' | 'back'
}

type WallEndpoint = {
  wallId: AnyNodeId
  end: 'start' | 'end'
  point: Vec2
}

function isWall(node: AnyNode | undefined): node is WallNodeData {
  return node?.type === 'wall'
}

function asAttachment(node: AnyNode): WallAttachment {
  return node as WallAttachment
}

function getCollectionIds(node: AnyNode | undefined): CollectionId[] {
  const value = (node as (AnyNode & { collectionIds?: unknown }) | undefined)?.collectionIds
  return Array.isArray(value)
    ? value.filter((id): id is CollectionId => typeof id === 'string')
    : []
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function direction(start: Vec2, end: Vec2): Vec2 {
  const length = distance(start, end)
  return [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
}

function dot(a: Vec2, b: Vec2) {
  return a[0] * b[0] + a[1] * b[1]
}

function cross(a: Vec2, b: Vec2) {
  return a[0] * b[1] - a[1] * b[0]
}

function pointsEqual(a: Vec2, b: Vec2) {
  return distance(a, b) <= EPSILON
}

function endpointPoint(wall: WallNodeData, end: 'start' | 'end') {
  return end === 'start' ? wall.start : wall.end
}

function oppositeEnd(end: 'start' | 'end'): 'start' | 'end' {
  return end === 'start' ? 'end' : 'start'
}

function pointAt(wall: WallNodeData, localX: number): Vec2 {
  const length = distance(wall.start, wall.end)
  const t = localX / length
  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * t,
    wall.start[1] + (wall.end[1] - wall.start[1]) * t,
  ]
}

function hasDirectionalAsymmetry(wall: WallNodeData) {
  const slots = wall.slots ?? {}
  if (slots.interior !== slots.exterior) return true
  for (const [key, value] of Object.entries(slots)) {
    if (key.endsWith('Interior') && value !== slots[`${key.slice(0, -8)}Exterior`]) return true
    if (key.endsWith('Exterior') && value !== slots[`${key.slice(0, -8)}Interior`]) return true
  }
  if (wall.frontSide !== wall.backSide) return true
  for (const trim of [wall.skirting, wall.crown, wall.chairRail]) {
    if (trim?.sides !== undefined && trim.sides !== 'both') return true
  }
  return (
    JSON.stringify(wall.interiorMaterial) !== JSON.stringify(wall.exteriorMaterial) ||
    wall.interiorMaterialPreset !== wall.exteriorMaterialPreset
  )
}

function compatibleWallStyle(a: WallNodeData, b: WallNodeData) {
  const keys = [
    'parentId',
    'visible',
    'material',
    'materialPreset',
    'interiorMaterial',
    'interiorMaterialPreset',
    'exteriorMaterial',
    'exteriorMaterialPreset',
    'slots',
    'thickness',
    'height',
    'curveOffset',
    'supportSlabId',
    'supportOffset',
    'fillToTerrain',
    'faceBands',
    'skirting',
    'crown',
    'chairRail',
    'frontSide',
    'backSide',
  ] as const

  return keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

function requireWall(nodes: Record<AnyNodeId, AnyNode>, id: AnyNodeId) {
  const node = nodes[id]
  if (!isWall(node)) {
    throw new WallOperationError('wall-not-found', `Node ${id} is not a wall`)
  }
  return node
}

function listWallAttachments(nodes: Record<AnyNodeId, AnyNode>, wall: WallNodeData) {
  const listed = new Set<AnyNodeId>(wall.children as AnyNodeId[])
  return Object.values(nodes).filter((node) => {
    const attachment = asAttachment(node)
    return listed.has(node.id) || attachment.wallId === wall.id || attachment.parentId === wall.id
  })
}

function updateParentChildren(
  nodes: Record<AnyNodeId, AnyNode>,
  parentId: AnyNodeId | null,
  removeIds: Set<AnyNodeId>,
  additions: AnyNodeId[],
) {
  if (!parentId) return
  const parent = nodes[parentId]
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) return
  const children = (parent.children as AnyNodeId[]).filter((id) => !removeIds.has(id))
  nodes[parentId] = {
    ...parent,
    children: Array.from(new Set([...children, ...additions])),
  } as AnyNode
}

function updateCollectionsForMerge(
  nodes: Record<AnyNodeId, AnyNode>,
  collections: Record<CollectionId, Collection>,
  primary: WallNodeData,
  deletedIds: Set<AnyNodeId>,
) {
  const primaryCollectionIds = new Set<CollectionId>(getCollectionIds(primary))
  const nextCollections = { ...collections }
  for (const [id, collection] of Object.entries(collections) as [CollectionId, Collection][]) {
    if (!collection.nodeIds.some((nodeId) => deletedIds.has(nodeId))) continue
    primaryCollectionIds.add(id)
    nextCollections[id] = {
      ...collection,
      nodeIds: Array.from(
        new Set(collection.nodeIds.map((nodeId) => (deletedIds.has(nodeId) ? primary.id : nodeId))),
      ),
      controlNodeId: deletedIds.has(collection.controlNodeId as AnyNodeId)
        ? primary.id
        : collection.controlNodeId,
    }
  }

  const nextPrimary = {
    ...nodes[primary.id],
    ...(primaryCollectionIds.size > 0 ? { collectionIds: [...primaryCollectionIds] } : {}),
  } as AnyNode
  nodes[primary.id] = nextPrimary
  return nextCollections
}

function updateCollectionsForSplit(
  nodes: Record<AnyNodeId, AnyNode>,
  collections: Record<CollectionId, Collection>,
  wall: WallNodeData,
  secondId: AnyNodeId,
) {
  const nextCollections = { ...collections }
  const collectionIds = new Set<CollectionId>(getCollectionIds(wall))
  for (const [id, collection] of Object.entries(collections) as [CollectionId, Collection][]) {
    if (!collection.nodeIds.includes(wall.id)) continue
    collectionIds.add(id)
    nextCollections[id] = {
      ...collection,
      nodeIds: Array.from(new Set([...collection.nodeIds, secondId])),
    }
  }
  if (collectionIds.size > 0) {
    nodes[wall.id] = { ...nodes[wall.id], collectionIds: [...collectionIds] } as AnyNode
    nodes[secondId] = { ...nodes[secondId], collectionIds: [...collectionIds] } as AnyNode
  }
  return nextCollections
}

function getAttachmentLocalX(node: AnyNode) {
  const attachment = asAttachment(node)
  return attachment.position?.[0]
}

function getAttachmentSpan(node: AnyNode, wall: WallNodeData) {
  const attachment = asAttachment(node)
  const center = getAttachmentLocalX(node)
  if (center === undefined) return null
  if (node.type === 'door' || node.type === 'window') {
    return { center, half: node.width / 2 }
  }
  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') return null
    const [width, , depth] = getScaledDimensions(item)
    const wallYaw = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
    const yaw = (item.rotation[1] ?? 0) - wallYaw
    return {
      center,
      // A rotated wall item occupies the projection of both local footprint
      // axes along the wall, so splitting cannot bisect its actual span.
      half: (Math.abs(width * Math.cos(yaw)) + Math.abs(depth * Math.sin(yaw))) / 2,
    }
  }
  return { center, half: 0 }
}

export function buildWallLengthUpdates(
  nodes: Record<AnyNodeId, AnyNode>,
  wallId: AnyNodeId,
  newLength: number,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const wall = requireWall(nodes, wallId)
  const length = distance(wall.start, wall.end)
  if (!Number.isFinite(newLength) || newLength <= EPSILON || length <= EPSILON) {
    throw new WallOperationError('invalid-wall-length', '벽 길이는 0보다 커야 합니다.')
  }
  if (Math.abs(wall.curveOffset ?? 0) > EPSILON) {
    throw new WallOperationError('curved-wall', '곡선 벽은 곡률을 해제한 후 길이를 변경하세요.')
  }
  const end = pointAt(wall, newLength)
  const siblings = Object.values(nodes).filter(
    (node): node is WallNodeData =>
      isWall(node) && node.parentId === wall.parentId && node.id !== wallId,
  )
  const linked = getLinkedWallUpdates(
    siblings.map((other) => ({ wall: other })),
    wall.start,
    wall.end,
    wall.start,
    end,
  ).filter((update) => {
    const other = requireWall(nodes, update.id)
    return !pointsEqual(other.start, update.start) || !pointsEqual(other.end, update.end)
  })
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [
    { id: wallId, data: { end } },
    ...linked.map(({ id, start, end }) => ({ id, data: { start, end } })),
  ]
  const nextWalls = new Map([wall, ...siblings].map((other) => [other.id, other]))
  for (const update of updates) {
    nextWalls.set(
      update.id as WallNodeData['id'],
      { ...requireWall(nodes, update.id), ...update.data } as WallNodeData,
    )
  }
  const onSegment = (point: Vec2, host: WallNodeData) => {
    const axis: Vec2 = [host.end[0] - host.start[0], host.end[1] - host.start[1]]
    const delta: Vec2 = [point[0] - host.start[0], point[1] - host.start[1]]
    const lengthSquared = dot(axis, axis)
    const t = dot(delta, axis) / lengthSquared
    return (
      Math.abs(cross(delta, axis)) <= EPSILON * Math.sqrt(lengthSquared) &&
      t >= -EPSILON &&
      t <= 1 + EPSILON
    )
  }
  for (const update of [...updates]) {
    const before = requireWall(nodes, update.id)
    const after = nextWalls.get(before.id)!
    const nextLength = distance(after.start, after.end)
    if (nextLength <= EPSILON) {
      throw new WallOperationError(
        'zero-length-wall',
        '연결된 벽이 길이 0으로 줄어드는 변경은 적용할 수 없습니다.',
      )
    }
    if (dot(direction(before.start, before.end), direction(after.start, after.end)) <= 0) {
      throw new WallOperationError(
        'reversed-wall',
        '연결된 벽의 방향이 뒤집히는 길이 변경은 적용할 수 없습니다.',
      )
    }
    if (Math.abs(before.curveOffset ?? 0) > EPSILON) {
      throw new WallOperationError(
        'curved-wall',
        '연결된 곡선 벽의 곡률을 해제한 후 길이를 변경하세요.',
      )
    }
    for (const child of listWallAttachments(nodes, before)) {
      const span = getAttachmentSpan(child, after)
      if (
        span &&
        (span.center - span.half < -EPSILON || span.center + span.half > nextLength + EPSILON)
      ) {
        throw new WallOperationError(
          'attachment-outside-wall',
          '문·창 또는 부착물이 벽 밖으로 나가는 길이 변경은 적용할 수 없습니다.',
        )
      }
      if (span && child.type === 'item') {
        updates.push({ id: child.id, data: { wallT: span.center / nextLength } })
      }
    }
    for (const other of [wall, ...siblings]) {
      if (other.id === before.id) continue
      const nextOther = nextWalls.get(other.id)!
      for (const endpoint of ['start', 'end'] as const) {
        if (
          (onSegment(before[endpoint], other) && !onSegment(after[endpoint], nextOther)) ||
          (onSegment(other[endpoint], before) && !onSegment(nextOther[endpoint], after))
        ) {
          throw new WallOperationError(
            'detached-wall-junction',
            'T자 벽 접합을 끊는 길이 변경은 적용할 수 없습니다.',
          )
        }
      }
    }
  }
  return updates
}

function uniqueWallId(nodes: Record<AnyNodeId, AnyNode>, requested?: AnyNodeId) {
  if (requested) {
    if (nodes[requested]) {
      throw new WallOperationError('wall-id-conflict', `Wall id ${requested} is already in use`)
    }
    return requested
  }
  let id = generateId('wall') as AnyNodeId
  while (nodes[id]) id = generateId('wall') as AnyNodeId
  return id
}

function makeMutation(
  scene: WallSceneState,
  primaryWallId: AnyNodeId,
  createdNodeIds: AnyNodeId[],
  deletedNodeIds: AnyNodeId[],
  changedNodeIds: Set<AnyNodeId>,
): WallMutation {
  return {
    ...scene,
    primaryWallId,
    createdNodeIds,
    deletedNodeIds,
    changedNodeIds: [...changedNodeIds].filter((id) => scene.nodes[id] !== undefined),
  }
}

function buildMergeChain(nodes: Record<AnyNodeId, AnyNode>, wallIds: AnyNodeId[]) {
  if (wallIds.length < 2) {
    throw new WallOperationError('merge-requires-two-walls', 'Select at least two walls to merge')
  }
  const walls = wallIds.map((id) => requireWall(nodes, id))
  const primary = walls[0]!
  if (walls.some((wall) => distance(wall.start, wall.end) <= EPSILON)) {
    throw new WallOperationError('zero-length-wall', 'Zero-length walls cannot be merged')
  }
  if (walls.some((wall) => Math.abs(wall.curveOffset ?? 0) > EPSILON)) {
    throw new WallOperationError('curved-wall', 'Only straight walls can be merged')
  }
  for (const wall of walls.slice(1)) {
    if (!compatibleWallStyle(primary, wall)) {
      throw new WallOperationError(
        'incompatible-wall-style',
        'Selected walls have incompatible construction',
      )
    }
  }

  const endpointMatches = new Map<string, WallEndpoint[]>()
  const endpoints = walls.flatMap((wall) =>
    (['start', 'end'] as const).map((end) => ({
      wallId: wall.id,
      end,
      point: endpointPoint(wall, end),
    })),
  )
  for (const endpoint of endpoints) {
    const matches = endpoints.filter(
      (candidate) =>
        candidate.wallId !== endpoint.wallId && pointsEqual(candidate.point, endpoint.point),
    )
    endpointMatches.set(`${endpoint.wallId}:${endpoint.end}`, matches)
    if (matches.length > 1) {
      throw new WallOperationError(
        'branched-walls',
        'A branched junction cannot be merged into one wall',
      )
    }
  }
  const openEndpoints = endpoints.filter(
    (endpoint) => (endpointMatches.get(`${endpoint.wallId}:${endpoint.end}`) ?? []).length === 0,
  )
  if (openEndpoints.length !== 2) {
    throw new WallOperationError(
      'non-contiguous-walls',
      'Walls must form one exact contiguous chain',
    )
  }
  const traceChain = (open: WallEndpoint) => {
    const chain: { wall: WallNodeData; from: WallEndpoint; to: WallEndpoint }[] = []
    let current: WallEndpoint = open
    const seen = new Set<AnyNodeId>()
    while (true) {
      const wall = requireWall(nodes, current.wallId)
      if (seen.has(wall.id)) {
        throw new WallOperationError('cyclic-walls', 'A closed wall loop cannot be merged')
      }
      seen.add(wall.id)
      const to = {
        wallId: wall.id,
        end: oppositeEnd(current.end),
        point: endpointPoint(wall, oppositeEnd(current.end)),
      } satisfies WallEndpoint
      chain.push({ wall, from: current, to })
      if (chain.length === walls.length) break
      const next = endpointMatches.get(`${to.wallId}:${to.end}`)?.[0]
      if (!next) {
        throw new WallOperationError(
          'non-contiguous-walls',
          'Walls must form one exact contiguous chain',
        )
      }
      current = next
    }
    if (seen.size !== walls.length) {
      throw new WallOperationError(
        'non-contiguous-walls',
        'Walls must form one exact contiguous chain',
      )
    }
    return chain
  }

  // Either open end describes the same physical chain in reverse. Prefer the
  // orientation that keeps the first selected wall authored in its direction;
  // this also avoids reversing hosted local frames when possible.
  const candidateChains = openEndpoints.map(traceChain)
  const primaryAligned = candidateChains.find((candidate) => {
    const segment = candidate.find(({ wall }) => wall.id === primary.id)
    if (!segment) return false
    return (
      dot(
        direction(segment.wall.start, segment.wall.end),
        direction(segment.from.point, segment.to.point),
      ) >=
      1 - EPSILON
    )
  })
  const chain = primaryAligned ?? candidateChains[0]!

  for (let index = 1; index < chain.length; index++) {
    const previous = chain[index - 1]!
    const next = chain[index]!
    const previousDirection = direction(previous.from.point, previous.to.point)
    const nextDirection = direction(next.from.point, next.to.point)
    if (
      Math.abs(cross(previousDirection, nextDirection)) > EPSILON ||
      dot(previousDirection, nextDirection) < 1 - EPSILON
    ) {
      throw new WallOperationError(
        'non-collinear-walls',
        'Only straight collinear walls can be merged',
      )
    }
  }

  for (const segment of chain) {
    const authoredDirection = direction(segment.wall.start, segment.wall.end)
    const chainDirection = direction(segment.from.point, segment.to.point)
    if (dot(authoredDirection, chainDirection) < 1 - EPSILON) {
      if (listWallAttachments(nodes, segment.wall).length > 0) {
        throw new WallOperationError(
          'reversed-hosted-wall',
          'Reverse a hosted wall before merging it',
        )
      }
      if (hasDirectionalAsymmetry(segment.wall)) {
        throw new WallOperationError(
          'reversed-painted-wall',
          'Reverse a painted wall before merging it',
        )
      }
    }
  }

  return { primary, chain, start: chain[0]!.from.point, end: chain.at(-1)!.to.point }
}

export function buildWallMerge(scene: WallSceneState, wallIds: AnyNodeId[]): WallMutation {
  const { nodes: sourceNodes, collections: sourceCollections, rootNodeIds } = scene
  const { primary, chain, start, end } = buildMergeChain(sourceNodes, wallIds)
  const nodes = { ...sourceNodes }
  const deletedIds = new Set<AnyNodeId>(wallIds.filter((id) => id !== primary.id))
  const changedIds = new Set<AnyNodeId>(wallIds)
  const mergedChildren: AnyNodeId[] = []
  const attachmentsByWall = new Map<AnyNodeId, AnyNode[]>()
  for (const segment of chain) {
    const attachments = listWallAttachments(sourceNodes, segment.wall)
    attachmentsByWall.set(segment.wall.id, attachments)
    for (const child of attachments) {
      if (!mergedChildren.includes(child.id)) mergedChildren.push(child.id)
    }
  }

  const mergedLength = distance(start, end)
  const mergedDirection = direction(start, end)
  const allWallIds = new Set(wallIds)
  for (const segment of chain) {
    for (const child of attachmentsByWall.get(segment.wall.id) ?? []) {
      const attachment = asAttachment(child)
      const localX = getAttachmentLocalX(child)
      const worldPoint = localX === undefined ? segment.wall.start : pointAt(segment.wall, localX)
      const mergedX = dot([worldPoint[0] - start[0], worldPoint[1] - start[1]], mergedDirection)
      const position = attachment.position
      const nextPosition = position
        ? ([mergedX, position[1], position[2]] as [number, number, number])
        : undefined
      const nextAttachment = {
        ...attachment,
        ...(nextPosition ? { position: nextPosition } : {}),
        ...(attachment.wallId || allWallIds.has(attachment.parentId as AnyNodeId)
          ? { wallId: primary.id }
          : {}),
        ...(attachment.parentId && allWallIds.has(attachment.parentId as AnyNodeId)
          ? { parentId: primary.id }
          : {}),
        ...(attachment.wallT !== undefined || child.type === 'item'
          ? { wallT: Math.max(0, Math.min(1, mergedX / mergedLength)) }
          : {}),
      }
      nodes[child.id] = nextAttachment as AnyNode
      changedIds.add(child.id)
    }
  }

  const mergedWall = WallNode.parse({
    ...primary,
    start,
    end,
    children: mergedChildren,
  })
  nodes[primary.id] = mergedWall
  const parentId = primary.parentId as AnyNodeId | null
  updateParentChildren(nodes, parentId, deletedIds, [])
  if (parentId) changedIds.add(parentId)
  for (const deletedId of deletedIds) delete nodes[deletedId]
  for (const node of Object.values(nodes)) {
    const attachment = asAttachment(node)
    if (attachment.parentId && deletedIds.has(attachment.parentId as AnyNodeId)) {
      nodes[node.id] = { ...node, parentId: primary.id } as AnyNode
      changedIds.add(node.id)
    }
  }
  const collections = updateCollectionsForMerge(nodes, sourceCollections, primary, deletedIds)
  const nextRootNodeIds = rootNodeIds.filter((id) => !deletedIds.has(id))
  return makeMutation(
    { nodes, rootNodeIds: nextRootNodeIds, collections },
    primary.id,
    [],
    [...deletedIds],
    changedIds,
  )
}

export function buildWallSplit(
  scene: WallSceneState,
  wallId: AnyNodeId,
  distanceFromStart: number,
  requestedSecondWallId?: AnyNodeId,
): WallMutation {
  const wall = requireWall(scene.nodes, wallId)
  const length = distance(wall.start, wall.end)
  if (
    !Number.isFinite(distanceFromStart) ||
    distanceFromStart <= EPSILON ||
    distanceFromStart >= length - EPSILON
  ) {
    throw new WallOperationError('invalid-split-distance', 'Split distance must be inside the wall')
  }
  if (Math.abs(wall.curveOffset ?? 0) > EPSILON) {
    throw new WallOperationError('curved-wall', 'Only straight walls can be split')
  }
  const secondId = uniqueWallId(scene.nodes, requestedSecondWallId)
  const splitPoint = pointAt(wall, distanceFromStart)
  const attachments = listWallAttachments(scene.nodes, wall)
  const firstChildren: AnyNodeId[] = []
  const secondChildren: AnyNodeId[] = []
  for (const child of attachments) {
    const localX = getAttachmentLocalX(child)
    const span = getAttachmentSpan(child, wall)
    if (
      localX !== undefined &&
      span &&
      span.center - span.half < distanceFromStart - EPSILON &&
      span.center + span.half > distanceFromStart + EPSILON
    ) {
      throw new WallOperationError(
        'attachment-crosses-split',
        `Attachment ${child.id} crosses the split`,
      )
    }
    if (localX !== undefined && localX > distanceFromStart + EPSILON) secondChildren.push(child.id)
    else firstChildren.push(child.id)
  }

  const nodes = { ...scene.nodes }
  const firstWall = WallNode.parse({
    ...wall,
    start: wall.start,
    end: splitPoint,
    children: firstChildren,
  })
  const secondWall = WallNode.parse({
    ...wall,
    id: secondId,
    start: splitPoint,
    end: wall.end,
    children: secondChildren,
  })
  nodes[wall.id] = firstWall
  nodes[secondWall.id] = secondWall
  const changedIds = new Set<AnyNodeId>([wall.id, secondWall.id])
  for (const child of attachments) {
    const attachment = asAttachment(child)
    const localX = getAttachmentLocalX(child)
    const goesToSecond = localX !== undefined && localX > distanceFromStart + EPSILON
    const nextWallId = goesToSecond ? secondWall.id : wall.id
    const nextX = goesToSecond ? (localX ?? 0) - distanceFromStart : localX
    nodes[child.id] = {
      ...child,
      ...(attachment.wallId ||
      child.type === 'door' ||
      child.type === 'window' ||
      child.type === 'item'
        ? { wallId: nextWallId }
        : {}),
      ...(attachment.parentId === wall.id ? { parentId: nextWallId } : {}),
      ...(attachment.position && nextX !== undefined
        ? { position: [nextX, attachment.position[1], attachment.position[2]] }
        : {}),
      ...(attachment.wallT !== undefined || child.type === 'item'
        ? {
            wallT: Math.max(
              0,
              Math.min(
                1,
                (nextX ?? 0) / (goesToSecond ? length - distanceFromStart : distanceFromStart),
              ),
            ),
          }
        : {}),
    } as AnyNode
    changedIds.add(child.id)
  }

  const parentId = wall.parentId as AnyNodeId | null
  if (parentId) {
    const parent = nodes[parentId]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      const children = parent.children as AnyNodeId[]
      const index = children.indexOf(wall.id)
      const nextChildren =
        index >= 0
          ? [...children.slice(0, index + 1), secondWall.id, ...children.slice(index + 1)]
          : [...children, secondWall.id]
      nodes[parentId] = { ...parent, children: Array.from(new Set(nextChildren)) } as AnyNode
      changedIds.add(parentId)
    }
  }
  const nextRootNodeIds = parentId
    ? [...scene.rootNodeIds]
    : scene.rootNodeIds.includes(wall.id)
      ? [...scene.rootNodeIds, secondWall.id]
      : [...scene.rootNodeIds]
  const collections = updateCollectionsForSplit(nodes, scene.collections, wall, secondWall.id)
  return makeMutation(
    { nodes, rootNodeIds: nextRootNodeIds, collections },
    wall.id,
    [secondWall.id],
    [],
    changedIds,
  )
}
