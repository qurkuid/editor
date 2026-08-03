import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { resolveLinearLightLength } from '../lighting/placement'
import type { LightingFixtureNode } from './schema'

export function buildLightingFixtureFloorplan(
  node: LightingFixtureNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const color = node.enabled ? '#f59e0b' : '#78716c'
  const children: FloorplanGeometry[] = [
    { kind: 'circle', cx: x, cy: z, r: 0.16, fill: '#fffbeb', stroke: color, strokeWidth: 0.025 },
    {
      kind: 'line',
      x1: x - 0.1,
      y1: z - 0.1,
      x2: x + 0.1,
      y2: z + 0.1,
      stroke: color,
      strokeWidth: 0.02,
    },
    {
      kind: 'line',
      x1: x + 0.1,
      y1: z - 0.1,
      x2: x - 0.1,
      y2: z + 0.1,
      stroke: color,
      strokeWidth: 0.02,
    },
  ]
  if (node.lightType === 'spot') {
    children.push({
      kind: 'path',
      d: `M ${x} ${z} L ${x - 0.24} ${z + 0.42} L ${x + 0.24} ${z + 0.42} Z`,
      fill: '#fef3c7',
      stroke: color,
      strokeWidth: 0.015,
      opacity: 0.45,
    })
  }
  if (node.lightType === 'linear') {
    // The tube's world endpoints, derived from `position` (live midpoint)
    // and `rotation` (live bearing) rather than the drafted `start`/`end` —
    // those two only feed the length, so a later move/rotate of the fixture
    // can't leave this glyph pointing at a stale segment.
    const length = resolveLinearLightLength(node.start, node.end)
    const worldAngle = -node.rotation[1]
    const halfDx = (length / 2) * Math.cos(worldAngle)
    const halfDz = (length / 2) * Math.sin(worldAngle)
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
