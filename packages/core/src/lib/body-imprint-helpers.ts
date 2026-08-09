import type { BodyHalfEdge, BodyNode as BodyNodeType } from '../schema/nodes/body'

export const bodyById = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]))

export function orderedBodyLoopEdges(body: BodyNodeType, loopId: string): BodyHalfEdge[] {
  const edges = bodyById(body.halfEdges)
  const candidates = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const start = candidates[0]
  if (!start) return []
  const ordered: BodyHalfEdge[] = []
  const visited = new Set<string>()
  let current = start
  while (!visited.has(current.id)) {
    visited.add(current.id)
    ordered.push(current)
    const next = edges.get(current.nextId)
    if (!next || next.loopId !== loopId) return []
    current = next
  }
  return current.id === start.id && ordered.length === candidates.length ? ordered : []
}

export function bodyFeatureIds(body: BodyNodeType): string[] {
  return [
    ...body.vertices.map((vertex) => vertex.id),
    ...body.halfEdges.map((edge) => edge.id),
    ...body.loops.map((loop) => loop.id),
    ...body.faces.map((face) => face.id),
    ...body.shells.map((shell) => shell.id),
    ...body.curves.map((curve) => curve.id),
  ]
}
