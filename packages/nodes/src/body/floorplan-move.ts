import type { BodyNode, FloorplanMoveTarget, FloorplanMoveTargetSession } from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'
import { bodyPlanCenter, createBodyMoveSession } from './move-session'

export const createBodyFloorplanMoveTarget: FloorplanMoveTarget<BodyNode> = ({
  node,
}): FloorplanMoveTargetSession => {
  const center = bodyPlanCenter(node)
  const session = createBodyMoveSession({ body: node, preview: 'override' })

  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      const step = getSegmentGridStep()
      const snap = (value: number) =>
        modifiers.shiftKey || step <= 0 ? value : Math.round(value / step) * step
      const x = snap(planPoint[0])
      const z = snap(planPoint[1])
      session.preview([x - center[0], 0, z - center[1]])
    },
    canCommit: () => session.canCommit(),
    commit: () => {
      session.commit()
    },
  }
}

export const bodyFloorplanMoveTarget = createBodyFloorplanMoveTarget
