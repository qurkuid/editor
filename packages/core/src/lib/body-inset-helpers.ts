import type { BodyHalfEdge, BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyById, orderedBodyLoopEdges } from './body-imprint-helpers'

const COLLAPSE_EPSILON = 1e-9

function dot(left: readonly [number, number, number], right: readonly [number, number, number]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function resolveInsetBoundaryEdge(
  body: BodyNodeType,
  edge: BodyHalfEdge,
): BodyHalfEdge | null {
  const edges = bodyById(body.halfEdges)
  const loops = bodyById(body.loops)
  let twinId = edge.twinId
  const visited = new Set<string>()
  while (twinId && !visited.has(twinId)) {
    visited.add(twinId)
    const twin = edges.get(twinId)
    if (!twin) return null
    const loop = loops.get(twin.loopId)
    if (!loop) return null
    if (loop.kind === 'inner') return twin
    const sideEdges = orderedBodyLoopEdges(body, twin.loopId)
    if (sideEdges.length !== 4) return null
    const bottom = sideEdges.find((candidate) => candidate.id.includes(':bottom:'))
    if (!bottom?.twinId) return null
    twinId = bottom.twinId
  }
  return null
}

export function nearestInsetBlockingPlane(
  body: BodyNodeType,
  movedVertexIds: ReadonlySet<string>,
  centroid: readonly [number, number, number],
  normal: readonly [number, number, number],
  distance: number,
): number | null {
  return body.vertices.reduce<number | null>((nearest, vertex) => {
    if (movedVertexIds.has(vertex.id)) return nearest
    const offset: [number, number, number] = [
      vertex.position[0] - centroid[0],
      vertex.position[1] - centroid[1],
      vertex.position[2] - centroid[2],
    ]
    const projection = dot(offset, normal)
    if (Math.abs(projection) <= COLLAPSE_EPSILON || projection * distance <= 0) return nearest
    return nearest === null || Math.abs(projection) < nearest ? Math.abs(projection) : nearest
  }, null)
}
