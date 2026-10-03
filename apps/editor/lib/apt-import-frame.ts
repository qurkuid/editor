import type { AnyNode, GuideNode, WallNode } from '@pascal-app/core'
import { detectSpacesForLevel, planAutoSlabsForLevel } from '@pascal-app/core'

export type AptPlanOrientation = {
  flipX: boolean
  flipY: boolean
}

export type AptGuideImportFrame = {
  position: [number, number, number]
  rotationY: number
  scale?: number
}

const PLANAR_EPSILON = 1e-6

function metadataOf(node: AnyNode): Record<string, unknown> {
  return node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function pointKey([x, z]: [number, number]): string {
  return `${x.toFixed(3)},${z.toFixed(3)}`
}

function minRotationSignature(keys: string[]): string {
  if (keys.length === 0) return ''
  let best = ''
  for (let index = 0; index < keys.length; index += 1) {
    const rotated = [...keys.slice(index), ...keys.slice(0, index)]
    const value = rotated.join('|')
    if (!best || value < best) best = value
  }
  return best
}

function polygonSignature(polygon: Array<[number, number]>): string {
  const keys = polygon.map(pointKey)
  const forward = minRotationSignature(keys)
  const reversed = minRotationSignature([...keys].reverse())
  return forward < reversed ? forward : reversed
}

export function matchesAptPlan(node: AnyNode, apartmentId: string, planId: string): boolean {
  const metadata = metadataOf(node)
  if (metadata.planId !== planId) return false
  return typeof metadata.apartmentId !== 'string' || metadata.apartmentId === apartmentId
}

export function findAptGuideForLevel(
  nodes: Record<string, AnyNode>,
  levelId: string,
  apartmentId: string,
  planId: string,
): GuideNode | null {
  return (Object.values(nodes).find(
    (node) =>
      node.type === 'guide' &&
      node.parentId === levelId &&
      matchesAptPlan(node, apartmentId, planId),
  ) ?? null) as GuideNode | null
}

export function isAptVectorNodeForLevel(
  node: AnyNode,
  levelId: string,
  apartmentId: string,
  planId: string,
): boolean {
  return (
    metadataOf(node).source === 'apt-vector' &&
    node.parentId === levelId &&
    matchesAptPlan(node, apartmentId, planId)
  )
}

/**
 * Space detection may have derived old auto surfaces from the walls being
 * replaced. Remove only those exact room footprints before the final import
 * graph is published; manual or unrelated surfaces remain untouched.
 */
export function findAptDerivedSurfaceIdsForLevel(
  nodes: Record<string, AnyNode>,
  levelId: string,
  apartmentId: string,
  planId: string,
): string[] {
  const staleWalls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && isAptVectorNodeForLevel(node, levelId, apartmentId, planId),
  )
  if (staleWalls.length === 0) return []

  const staleWallIds = new Set(staleWalls.map((wall) => wall.id))
  const allLevelWalls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
  const roomPolygons = detectSpacesForLevel(levelId, allLevelWalls)
    .spaces.filter((space) => space.wallIds.some((wallId) => staleWallIds.has(wallId)))
    .map((space) => space.polygon.map(([x, y]) => ({ x, y })))
  const staleRoomSignatures = new Set(
    planAutoSlabsForLevel(roomPolygons, []).create.map((slab) => polygonSignature(slab.polygon)),
  )
  if (staleRoomSignatures.size === 0) return []

  return Object.values(nodes)
    .filter(
      (node) =>
        (node.type === 'slab' || node.type === 'ceiling') &&
        node.parentId === levelId &&
        node.autoFromWalls === true &&
        staleRoomSignatures.has(polygonSignature(node.polygon)),
    )
    .map((node) => node.id)
}

export function getAptGuideTransformError(guide: GuideNode): string | null {
  if (guide.perspectiveCorners) {
    return '원근 보정된 도면은 자동 모델링을 지원하지 않습니다. 원근 보정을 해제한 뒤 다시 시도해 주세요.'
  }
  const [rotationX, rotationY, rotationZ] = guide.rotation
  if (![rotationX, rotationY, rotationZ].every(Number.isFinite)) {
    return '도면 회전값을 읽을 수 없습니다. 도면을 평면 상태로 되돌린 뒤 다시 시도해 주세요.'
  }
  if (Math.abs(rotationX) > PLANAR_EPSILON || Math.abs(rotationZ) > PLANAR_EPSILON) {
    return '자동 모델링은 수평면 도면만 지원합니다. X/Z 기울기를 0으로 되돌린 뒤 다시 시도해 주세요.'
  }
  if (!Number.isFinite(guide.scale) || guide.scale <= 0) {
    return '도면 배율이 올바르지 않습니다. 도면을 다시 보정한 뒤 시도해 주세요.'
  }
  return null
}

export function getAptGuideImportFrame(guide: GuideNode) {
  return {
    position: [...guide.position] as [number, number, number],
    rotationY: guide.rotation[1],
    ...(guide.scale === 1 && guide.scaleReference === null ? {} : { scale: guide.scale }),
  } satisfies AptGuideImportFrame
}

export function aptImageTransform({ flipX, flipY }: AptPlanOrientation): string {
  return `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`
}
