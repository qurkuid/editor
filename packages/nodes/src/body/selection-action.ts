import type { BodyNode } from '@pascal-app/core'
import {
  isBodyFaceOffsetEligible,
  isBodyFacePushPullEligible,
  isBodyFaceSweepEligible,
} from './face-imprint-geometry'
import type { BodyPoint, BodySelectionAction } from './options'

type FaceActionTarget = {
  readonly action: BodySelectionAction | null
  readonly body: BodyNode
  readonly faceId: string
  readonly hitPoint: BodyPoint
}

export function retargetBodySelectionAction({
  action,
  body,
  faceId,
  hitPoint,
}: FaceActionTarget): BodySelectionAction | null {
  if (!action || action.bodyId !== body.id) return null
  if (action.kind === 'push-pull' && isBodyFacePushPullEligible(body, faceId)) {
    return { bodyId: body.id, kind: 'push-pull', faceId }
  }
  if (action.kind === 'offset' && isBodyFaceOffsetEligible(body, faceId)) {
    return { bodyId: body.id, kind: 'offset', faceId, hitPoint }
  }
  if (action.kind === 'sweep' && isBodyFaceSweepEligible(body, faceId)) {
    return { bodyId: body.id, kind: 'sweep', faceId, hitPoint }
  }
  return null
}
