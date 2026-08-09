import {
  type AnyNodeId,
  nodeRegistry,
  resolveWallAlignedPlacement,
  useScene,
  wallAnchorForViewerSide,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'

/**
 * "Align to wall" pick flow: an item quick action arms a request, the
 * `WallAlignPickController` listens for the next canvas node click (2D or 3D
 * — both funnel through `selection:canvas-node-click`), and a wall click
 * applies the placement. Escape or any non-wall click cancels.
 */

export type WallAlignSide = 'left' | 'center' | 'right'

type WallAlignPickState = {
  request: { nodeId: AnyNodeId; side: WallAlignSide } | null
  arm: (nodeId: AnyNodeId, side: WallAlignSide) => void
  cancel: () => void
}

const useWallAlignPick = create<WallAlignPickState>((set) => ({
  request: null,
  arm: (nodeId, side) => set({ request: { nodeId, side } }),
  cancel: () => set({ request: null }),
}))

export default useWallAlignPick

/**
 * Place `nodeId` flush against `wall`'s near face, at the wall's left end /
 * centre / right end as seen from the node looking at the wall. Works for any
 * kind with a floor-placed box footprint; rotation is preserved.
 */
export function alignNodeToWall(nodeId: AnyNodeId, wall: WallNode, side: WallAlignSide): boolean {
  const node = useScene.getState().nodes[nodeId]
  if (!node) return false
  const footprint = nodeRegistry.get(node.type)?.capabilities?.floorPlaced?.footprint?.(node)
  const position = (node as { position?: [number, number, number] }).position
  if (!footprint || !Array.isArray(position)) return false

  const anchor =
    side === 'center' ? 'center' : wallAnchorForViewerSide(wall, [position[0], position[2]], side)
  const placed = resolveWallAlignedPlacement({
    wall,
    x: position[0],
    z: position[2],
    dimensions: footprint.dimensions,
    rotationY: footprint.rotation[1] ?? 0,
    anchor,
  })
  if (!placed) return false
  useScene
    .getState()
    .updateNodes([{ id: nodeId, data: { position: [placed.x, position[1], placed.z] } }])
  return true
}
