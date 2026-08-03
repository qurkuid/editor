import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { LightingSwitchNode } from './schema'

export function buildLightingSwitchFloorplan(
  node: LightingSwitchNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: x - 0.12,
      y: z - 0.08,
      width: 0.24,
      height: 0.16,
      rx: 0.03,
      fill: '#f5f5f4',
      stroke: '#0f766e',
      strokeWidth: 0.02,
    },
    {
      kind: 'line',
      x1: x,
      y1: z - 0.05,
      x2: x,
      y2: z + 0.05,
      stroke: '#0f766e',
      strokeWidth: 0.025,
    },
  ]
  if (ctx?.viewState?.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
