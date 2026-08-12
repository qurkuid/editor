import type { BodyNode } from '@pascal-app/core'
import { createFaceProjection } from './face-imprint-geometry'

type Point2 = readonly [number, number]
type Point3 = readonly [number, number, number]

type OffsetEdge = {
  readonly id: string
  readonly start: Point2
  readonly end: Point2
}

export type OffsetPointerInteraction = {
  readonly faceId: string
  readonly edgeId: string
  readonly edgeIndex: number
  readonly edgeStart: Point2
  readonly edgeEnd: Point2
  readonly outwardNormal: Point2
  readonly projection: ReturnType<typeof createFaceProjection> extends infer Projection
    ? Projection extends null
      ? never
      : Projection
    : never
}

const EPSILON = 1e-10

function isFinitePoint(point: readonly number[]): point is Point3 {
  return point.length === 3 && point.every(Number.isFinite)
}

function orderedLoopEdges(body: BodyNode, loopId: string) {
  const byId = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  const candidates = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const start = candidates[0]
  if (!start) return []
  const ordered = []
  const visited = new Set<string>()
  let current = start
  while (!visited.has(current.id)) {
    visited.add(current.id)
    ordered.push(current)
    const next = byId.get(current.nextId)
    if (!next || next.loopId !== loopId) return []
    current = next
  }
  return current.id === start.id && ordered.length === candidates.length ? ordered : []
}

function signedArea(points: readonly Point2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function closestPointOnSegment(point: Point2, start: Point2, end: Point2): Point2 | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (!Number.isFinite(lengthSquared) || lengthSquared <= EPSILON) return null
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return [start[0] + dx * t, start[1] + dy * t]
}

function buildEdges(
  body: BodyNode,
  faceId: string,
): {
  readonly edges: OffsetEdge[]
  readonly polygon: Point2[]
  readonly projection: NonNullable<ReturnType<typeof createFaceProjection>>
} | null {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face || face.innerLoopIds.length > 0) return null
  const projection = createFaceProjection(body, faceId)
  if (!projection) return null
  const vertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex.position]))
  const halfEdges = orderedLoopEdges(body, face.outerLoopId)
  if (halfEdges.length < 3) return null
  const edges: OffsetEdge[] = []
  for (const edge of halfEdges) {
    const start = vertices.get(edge.vertexId)
    const next = body.halfEdges.find((candidate) => candidate.id === edge.nextId)
    const end = next ? vertices.get(next.vertexId) : undefined
    if (!start || !end || !isFinitePoint(start) || !isFinitePoint(end)) return null
    if (edge.curveId !== undefined) {
      const curve = body.curves.find((candidate) => candidate.id === edge.curveId)
      if (curve?.kind !== 'line') return null
    }
    edges.push({ id: edge.id, start: projection.toPlane(start), end: projection.toPlane(end) })
  }
  const polygon = edges.map((edge) => edge.start)
  if (Math.abs(signedArea(polygon)) <= EPSILON) return null
  return { edges, polygon, projection }
}

export function createOffsetPointerInteraction(
  body: BodyNode,
  faceId: string,
  hitPoint: Point3,
): OffsetPointerInteraction | null {
  if (!isFinitePoint(hitPoint)) return null
  const built = buildEdges(body, faceId)
  if (!built) return null
  const hit = built.projection.toPlane(hitPoint)
  if (!hit.every(Number.isFinite)) return null
  const area = signedArea(built.polygon)
  let nearest: { edge: OffsetEdge; index: number; distanceSquared: number } | null = null
  for (const [index, edge] of built.edges.entries()) {
    const closest = closestPointOnSegment(hit, edge.start, edge.end)
    if (!closest) return null
    const distanceSquared = (hit[0] - closest[0]) ** 2 + (hit[1] - closest[1]) ** 2
    if (nearest === null || distanceSquared < nearest.distanceSquared) {
      nearest = { edge, index, distanceSquared }
    }
  }
  if (!nearest) return null
  const dx = nearest.edge.end[0] - nearest.edge.start[0]
  const dy = nearest.edge.end[1] - nearest.edge.start[1]
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length <= EPSILON) return null
  const outwardNormal: Point2 = area > 0 ? [dy / length, -dx / length] : [-dy / length, dx / length]
  return {
    faceId,
    edgeId: nearest.edge.id,
    edgeIndex: nearest.index,
    edgeStart: nearest.edge.start,
    edgeEnd: nearest.edge.end,
    outwardNormal,
    projection: built.projection,
  }
}

export function resolveOffsetPointerDistance(
  interaction: OffsetPointerInteraction,
  point: Point3,
): number | null {
  if (!isFinitePoint(point)) return null
  const projected = interaction.projection.toPlane(point)
  if (!projected.every(Number.isFinite)) return null
  const distance =
    (projected[0] - interaction.edgeStart[0]) * interaction.outwardNormal[0] +
    (projected[1] - interaction.edgeStart[1]) * interaction.outwardNormal[1]
  return Number.isFinite(distance) ? distance : null
}
