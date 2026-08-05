import {
  type AnyNodeId,
  type ConstructionGuideNode,
  type FloorplanAffordance,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive } from '@pascal-app/editor'
import { guideFrame } from './floorplan'

/**
 * Drag the selected guide line to slide it along its normal. The offset is
 * snapped so the line's signed distance from the level origin lands on grid
 * multiples (an on-grid guide stays on-grid), previewed through live
 * overrides and committed as one tracked write.
 */
export const slideConstructionGuideAffordance: FloorplanAffordance<ConstructionGuideNode> = {
  start({ node, initialPlanPoint, gridSnapStep }) {
    const frame = guideFrame(node.origin, node.direction)
    const startOffset = node.origin[0] * frame.normal[0] + node.origin[1] * frame.normal[1]
    const pointerStart =
      initialPlanPoint[0] * frame.normal[0] + initialPlanPoint[1] * frame.normal[1]
    let moved = false
    let lastOrigin: [number, number] = [node.origin[0], node.origin[1]]

    return {
      affectedIds: [node.id as AnyNodeId],
      apply({ planPoint }) {
        const pointerOffset = planPoint[0] * frame.normal[0] + planPoint[1] * frame.normal[1]
        let nextOffset = startOffset + (pointerOffset - pointerStart)
        if (isGridSnapActive() && gridSnapStep > 0) {
          nextOffset = Math.round(nextOffset / gridSnapStep) * gridSnapStep
        }
        const delta = nextOffset - startOffset
        if (Math.abs(delta) > 1e-9) moved = true
        lastOrigin = [
          node.origin[0] + frame.normal[0] * delta,
          node.origin[1] + frame.normal[1] * delta,
        ]
        useLiveNodeOverrides.getState().set(node.id, { origin: lastOrigin })
      },
      canCommit: () => moved,
      commit() {
        useLiveNodeOverrides.getState().clear(node.id)
        useScene.getState().updateNode(node.id as AnyNodeId, { origin: lastOrigin })
      },
    }
  },
}
