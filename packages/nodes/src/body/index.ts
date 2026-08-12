export { bodyDefinition } from './definition'
export {
  isBodyFaceImprintEligible,
  isBodyFaceOffsetEligible,
  isBodyFacePushPullEligible,
  isBodyFaceSplitEligible,
  isBodyFaceSweepEligible,
} from './face-imprint-geometry'
export {
  createOffsetPointerInteraction,
  resolveOffsetPointerDistance,
} from './offset-interaction'
export {
  type BodyFaceDraft,
  type BodyFeatureSelection,
  type BodyPrimitive,
  DEFAULT_ARC_SEGMENTS,
  DEFAULT_POLYGON_SIDES,
  MAX_ARC_SEGMENTS,
  MAX_POLYGON_SIDES,
  MIN_ARC_SEGMENTS,
  MIN_POLYGON_SIDES,
  useBodyToolOptions,
} from './options'
export { BodyNode } from './schema'
export { type BodySweepSession, createBodySweepSession } from './sweep-session'
