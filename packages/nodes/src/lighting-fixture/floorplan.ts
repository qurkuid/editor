import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { resolveLightingRunOffsets, resolveLinearLightLength } from '../lighting/placement'
import type { LightingFixtureNode } from './schema'

export function buildLightingFixtureFloorplan(
  node: LightingFixtureNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const color = node.enabled ? '#f59e0b' : '#78716c'
  const marker = (cx: number, cy: number): FloorplanGeometry[] => [
    { kind: 'circle', cx, cy, r: 0.16, fill: '#fffbeb', stroke: color, strokeWidth: 0.025 },
    {
      kind: 'line',
      x1: cx - 0.1,
      y1: cy - 0.1,
      x2: cx + 0.1,
      y2: cy + 0.1,
      stroke: color,
      strokeWidth: 0.02,
    },
    {
      kind: 'line',
      x1: cx + 0.1,
      y1: cy - 0.1,
      x2: cx - 0.1,
      y2: cy + 0.1,
      stroke: color,
      strokeWidth: 0.02,
    },
    ...(node.lightType === 'spot'
      ? [
          {
            kind: 'path' as const,
            d: `M ${cx} ${cy} L ${cx - 0.24} ${cy + 0.42} L ${cx + 0.24} ${cy + 0.42} Z`,
            fill: '#fef3c7',
            stroke: color,
            strokeWidth: 0.015,
            opacity: 0.45,
          },
        ]
      : []),
  ]

  // World placement of the segment, derived from `position` (live midpoint)
  // and `rotation` (live bearing) rather than the drafted `start`/`end` —
  // those two only feed the length, so a later move/rotate of the fixture
  // can't leave the glyph pointing at a stale segment.
  const worldAngle = -node.rotation[1]
  const cos = Math.cos(worldAngle)
  const sin = Math.sin(worldAngle)
  const isRun = (node.lightType === 'point' || node.lightType === 'spot') && node.start && node.end

  const children: FloorplanGeometry[] = isRun
    ? resolveLightingRunOffsets(
        resolveLinearLightLength(node.start, node.end),
        node.count ?? 2,
      ).flatMap((offset) => marker(x + offset * cos, z + offset * sin))
    : marker(x, z)

  if (node.lightType === 'linear') {
    const length = resolveLinearLightLength(node.start, node.end)
    const halfDx = (length / 2) * cos
    const halfDz = (length / 2) * sin
    children.push({
      kind: 'line',
      x1: x - halfDx,
      y1: z - halfDz,
      x2: x + halfDx,
      y2: z + halfDz,
      stroke: color,
      strokeWidth: Math.max(node.linearWidth, 0.03),
    })
  }
  if (ctx?.viewState?.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
