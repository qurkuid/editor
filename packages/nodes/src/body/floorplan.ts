import { type BodyNode, type FloorplanGeometry, getBodyLoopVertices } from '@pascal-app/core'

export function buildBodyFloorplan(body: BodyNode): FloorplanGeometry | null {
  const face = body.faces[0]
  if (!face) return null
  const points = getBodyLoopVertices(body, face.outerLoopId).map(([x, , z]) => [x, z] as const)
  if (points.length < 3) return null
  return {
    kind: 'polygon',
    points,
    fill: '#94a3b8',
    fillOpacity: 0.28,
    stroke: '#475569',
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke',
  }
}
