import {
  type CeilingNode,
  ceilingFeatureEdgeFrame,
  ceilingProfileBounds,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for ceiling. Dashed boundary (ceilings sit
 * above the slab); when selected, mounts the same boundary editor as
 * slab — vertex + midpoint + edge handles on the outer ring AND every
 * hole, with `holeIndex` carried in the handle payloads.
 */
export function buildCeilingFloorplan(
  node: CeilingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const outer: FloorplanPoint[] = polygon.map(([x, z]) => [x, z] as FloorplanPoint)

  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }

  const segments: string[] = [ring(outer)]
  const holes = node.holes ?? []
  for (const hole of holes) {
    if (hole.length < 3) continue
    segments.push(ring(hole.map(([x, z]) => [x, z] as FloorplanPoint)))
  }

  const stroke = showSelectedChrome && palette ? palette.selectedStroke : '#94a3b8'

  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: segments.join(' '),
      fill: 'none',
      stroke,
      strokeWidth: showSelectedChrome ? 0.04 : 0.03,
      strokeDasharray: '0.15 0.1',
      opacity: showSelectedChrome ? 0.95 : 0.7,
    },
  ]

  // Profile-swept feature footprints (curtain box / bulkhead / custom) —
  // the swept band [minU, maxU] off the feature's edge, drawn as a solid
  // thin outline so it reads apart from the dashed ceiling boundary.
  const featureSegments: string[] = []
  for (const feature of node.features ?? []) {
    const frame = ceilingFeatureEdgeFrame(polygon, feature.edgeIndex)
    if (!frame) continue
    const bounds = ceilingProfileBounds(feature.profile)
    const corner = (u: number, atEnd: boolean): FloorplanPoint => {
      const base = atEnd ? frame.end : frame.start
      return [base[0] + frame.inward[0] * u, base[1] + frame.inward[1] * u]
    }
    featureSegments.push(
      ring([
        corner(bounds.minU, false),
        corner(bounds.minU, true),
        corner(bounds.maxU, true),
        corner(bounds.maxU, false),
      ]),
    )
  }
  if (featureSegments.length > 0) {
    children.push({
      kind: 'path',
      d: featureSegments.join(' '),
      fill: 'none',
      stroke,
      strokeWidth: 0.02,
      opacity: showSelectedChrome ? 0.85 : 0.55,
    })
  }

  if (isSelected) {
    appendRingEditor(children, polygon, undefined)
    holes.forEach((hole, holeIndex) => {
      if (hole.length >= 3) appendRingEditor(children, hole, holeIndex)
    })
  }

  return { kind: 'group', children }
}

/**
 * Same boundary editor as slab — see `nodes/src/slab/floorplan.ts` for
 * the contract. The kinds differ only in their fill / stroke chrome;
 * the editor primitives are identical.
 */
function appendRingEditor(
  children: FloorplanGeometry[],
  ring: ReadonlyArray<readonly [number, number]>,
  holeIndex: number | undefined,
): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'edge-handle',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      affordance: 'move-edge',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'midpoint-handle',
      point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      affordance: 'add-vertex',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i]!
    children.push({
      kind: 'endpoint-handle',
      point: [x, z],
      state: 'idle',
      affordance: 'move-vertex',
      payload: { holeIndex, vertexIndex: i },
    })
  }
}
