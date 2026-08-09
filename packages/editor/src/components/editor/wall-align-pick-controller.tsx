'use client'

import { type AnyNode, emitter, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useWallAlignPick, { alignNodeToWall } from '../../lib/wall-align-pick'

/**
 * While an align-to-wall request is armed (item quick action), consume the
 * next canvas node click — `selection:canvas-node-click` fires from both the
 * 3D selection manager and the 2D floor-plan layer, so one listener covers
 * both views. A wall click applies the alignment and restores the item's
 * selection; Escape or any other node click cancels. Renders a fixed hint
 * banner while armed. Mounted on the DOM side (not inside the R3F canvas).
 */
export function WallAlignPickController() {
  const request = useWallAlignPick((s) => s.request)

  useEffect(() => {
    if (!request) return
    const onPick = (node: AnyNode) => {
      // Clicking the item being aligned keeps the pick armed.
      if (node.id === request.nodeId) return
      if (node.type === 'wall') {
        alignNodeToWall(request.nodeId, node as WallNode, request.side)
        // The click that picked the wall also selected it; put the item's
        // selection back after the click's sync handlers finish.
        queueMicrotask(() =>
          useViewer.getState().setSelection({ selectedIds: [request.nodeId] }),
        )
      }
      useWallAlignPick.getState().cancel()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useWallAlignPick.getState().cancel()
    }
    emitter.on('selection:canvas-node-click', onPick)
    window.addEventListener('keydown', onKey)
    return () => {
      emitter.off('selection:canvas-node-click', onPick)
      window.removeEventListener('keydown', onKey)
    }
  }, [request])

  if (!request) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
      <div className="rounded-lg border border-border bg-background/95 px-3 py-1.5 text-foreground text-sm shadow-xl backdrop-blur-md">
        기준 벽을 클릭하세요 <span className="text-muted-foreground">(Esc 취소)</span>
      </div>
    </div>
  )
}
