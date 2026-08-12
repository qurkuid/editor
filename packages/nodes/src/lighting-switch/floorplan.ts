import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { LightingSwitchNode } from './schema'

export function buildLightingSwitchFloorplan(
  node: LightingSwitchNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const width = Math.max(0.24, node.gangCount * 0.09 + 0.08)
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: x - width / 2,
      y: z - 0.08,
      width,
      height: 0.16,
      rx: 0.03,
      fill: '#f5f5f4',
      stroke: '#0f766e',
      strokeWidth: 0.02,
    },
  ]
  for (let index = 0; index < node.gangCount; index += 1) {
    const controlX = x + (index - (node.gangCount - 1) / 2) * 0.09
    children.push(
      node.switchShape === 'round'
        ? {
            kind: 'circle',
            cx: controlX,
            cy: z,
            r: 0.03,
            fill: '#d6d3d1',
            stroke: '#0f766e',
            strokeWidth: 0.015,
          }
        : {
            kind: 'line',
            x1: controlX,
            y1: z - 0.05,
            x2: controlX,
            y2: z + 0.05,
            stroke: '#0f766e',
            strokeWidth: 0.025,
          },
    )
  }
  if (ctx?.viewState?.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
