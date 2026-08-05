import type { ConstructionGuideNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'

// Far past any plausible plan extent — the line reads as infinite while the
// SVG clips it to the viewport.
export const CONSTRUCTION_GUIDE_EXTENT = 1000
export const CONSTRUCTION_GUIDE_COLOR = '#64748b'
// Plan-unit dashes (like a printed drawing) so the pattern stays anchored to
// the plan while zooming.
export const CONSTRUCTION_GUIDE_DASH = '0.3 0.2'

export type GuideFrame = {
  origin: readonly [number, number]
  /** Unit direction along the line. */
  direction: readonly [number, number]
  /** Unit normal (direction rotated +90° in plan). */
  normal: readonly [number, number]
}

export function guideFrame(
  origin: readonly [number, number],
  direction: readonly [number, number],
): GuideFrame {
  const length = Math.hypot(direction[0], direction[1]) || 1
  const unit: [number, number] = [direction[0] / length, direction[1] / length]
  return { origin, direction: unit, normal: [-unit[1], unit[0]] }
}

export function guideLineEndpoints(frame: GuideFrame): {
  a: [number, number]
  b: [number, number]
} {
  return {
    a: [
      frame.origin[0] - frame.direction[0] * CONSTRUCTION_GUIDE_EXTENT,
      frame.origin[1] - frame.direction[1] * CONSTRUCTION_GUIDE_EXTENT,
    ],
    b: [
      frame.origin[0] + frame.direction[0] * CONSTRUCTION_GUIDE_EXTENT,
      frame.origin[1] + frame.direction[1] * CONSTRUCTION_GUIDE_EXTENT,
    ],
  }
}

export function buildConstructionGuideFloorplan(
  node: ConstructionGuideNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null
  const frame = guideFrame(node.origin, node.direction)
  const { a, b } = guideLineEndpoints(frame)
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = selected
    ? (ctx.viewState?.palette.selectedStroke ?? '#2563eb')
    : CONSTRUCTION_GUIDE_COLOR

  const children: FloorplanGeometry[] = [
    {
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke,
      strokeWidth: selected ? 2 : 1.5,
      strokeDasharray: CONSTRUCTION_GUIDE_DASH,
      strokeOpacity: selected ? 0.95 : 0.75,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'none',
    },
    // Wide transparent stroke so the thin dashed line is clickable
    // (select in select mode, delete in delete mode).
    {
      kind: 'hit-line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      strokeWidthPx: 10,
      cursor: 'pointer',
    },
  ]

  if (selected) {
    // Selection mounts the overlay pass: dragging the line slides it
    // along its normal through the kind-owned affordance.
    children.push({
      kind: 'edge-handle',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      affordance: 'slide-construction-guide',
      payload: null,
    })
  }

  return { kind: 'group', children }
}
