import { type BodyNode, type FloorplanGeometry, getBodyLoopVertices } from '@pascal-app/core'

export function buildBodyFloorplan(body: BodyNode): FloorplanGeometry | null {
  const polygons = body.faces.flatMap((face) => {
    const points = getBodyLoopVertices(body, face.outerLoopId).map(([x, , z]) => [x, z] as const)
    let area = 0
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]!
      const next = points[(index + 1) % points.length]!
      area += current[0] * next[1] - next[0] * current[1]
    }
    if (points.length < 3 || Math.abs(area) <= 1e-9) return []
    return [
      {
        kind: 'polygon' as const,
        points,
        fill: '#94a3b8',
        fillOpacity: 0.28,
        stroke: '#475569',
        strokeWidth: 1.5,
        vectorEffect: 'non-scaling-stroke' as const,
      },
    ]
  })
  if (polygons.length === 0) return null
  if (polygons.length === 1) return polygons[0]!
  return { kind: 'group', children: polygons }
}
