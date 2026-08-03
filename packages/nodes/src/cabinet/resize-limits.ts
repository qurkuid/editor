export const MIN_CABINET_WIDTH = 0.3
export const MIN_CABINET_DEPTH = 0.3
export const MAX_CABINET_WIDTH = 1.2
export const MAX_CABINET_DEPTH = 0.8

// A furniture assembly (wardrobe/tall/island/etc.) is a whole cabinet run
// packed into one node, not a single module — it needs the furniture panel's
// own, much larger bounds (see the "Overall dimensions" limits in
// packages/nodes/src/cabinet/panel.tsx and apps/editor/components/furniture-tab.tsx).
export const MAX_FURNITURE_WIDTH = 10
export const MAX_FURNITURE_DEPTH = 4

export function cabinetResizeUpperBound(currentValue: number, limit: number) {
  return Math.max(currentValue, limit)
}

export function connectedCabinetDepthUpperBound(currentDepth: number, sourceWidth?: number) {
  return cabinetConnectedDepthBounds(
    currentDepth,
    typeof sourceWidth === 'number' ? [sourceWidth] : [],
  ).max
}

export function cabinetConnectedDepthBounds(
  currentDepth: number,
  compensatedWidths: readonly number[],
) {
  let min = MIN_CABINET_DEPTH
  let max = MAX_CABINET_DEPTH
  for (const width of compensatedWidths) {
    min = Math.max(min, currentDepth - (MAX_CABINET_WIDTH - width))
    max = Math.min(max, currentDepth + width - MIN_CABINET_WIDTH)
  }
  return {
    min: Math.min(currentDepth, min),
    max: Math.max(currentDepth, max),
  }
}
