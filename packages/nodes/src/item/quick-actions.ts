import type { NodeQuickAction } from '@pascal-app/core'
import { useWallAlignPick, type WallAlignSide } from '@pascal-app/editor'
import type { ItemNode } from './schema'

/**
 * Align-to-wall quick actions for floor items: pick a side, then click the
 * reference wall (2D or 3D) — the `WallAlignPickController` applies the
 * flush placement. Wall/ceiling-attached items have their own hosts, so
 * they contribute nothing.
 */
export function itemQuickActions({ node }: { node: ItemNode }): NodeQuickAction[] {
  if (node.asset.attachTo !== undefined) return []
  const armed = useWallAlignPick.getState().request
  const action = (side: WallAlignSide, label: string): NodeQuickAction => ({
    id: `align-wall-${side}`,
    label: armed?.side === side && armed.nodeId === node.id ? `${label}…` : label,
    title: '벽에 정렬 — 버튼을 누른 뒤 기준 벽을 클릭하세요',
    run: ({ node: target }) => {
      useWallAlignPick.getState().arm(target.id, side)
      return undefined
    },
  })
  return [action('left', '◀ 벽정렬'), action('center', '벽정렬 중앙'), action('right', '벽정렬 ▶')]
}
