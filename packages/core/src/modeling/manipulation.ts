import type {
  MeasurementFeature,
  MeasurementFeatureBinding,
  MeasurementSnapKind,
} from '../registry/types'
import type { MeasurementPoint } from '../schema/nodes/measurement'

export const MANIPULATION_SNAP_TIERS = ['endpoint', 'midpoint', 'edge', 'face'] as const

export type ManipulationSnapTier = (typeof MANIPULATION_SNAP_TIERS)[number]

export type ManipulationSnapMarkerToken = `manipulation-snap:${MeasurementSnapKind}`

export type ManipulationSnapCandidate = {
  readonly featureId: string
  readonly point: MeasurementPoint
  readonly normal?: MeasurementPoint
  readonly snapKind: MeasurementSnapKind
  readonly tier: ManipulationSnapTier | null
  readonly markerToken: ManipulationSnapMarkerToken
}

export function manipulationSnapTier(kind: MeasurementSnapKind): ManipulationSnapTier | null {
  if (kind === 'endpoint') return 'endpoint'
  if (kind === 'midpoint' || kind === 'center') return 'midpoint'
  if (kind === 'edge') return 'edge'
  if (kind === 'face') return 'face'
  return null
}

export function manipulationSnapMarkerToken(
  kind: MeasurementSnapKind,
): ManipulationSnapMarkerToken {
  return `manipulation-snap:${kind}`
}

export function manipulationSnapCandidateFromFeature(
  feature: MeasurementFeature,
  binding: MeasurementFeatureBinding,
): ManipulationSnapCandidate {
  return {
    featureId: feature.id,
    point: [...binding.point],
    ...(feature.normal ? { normal: [...feature.normal] } : {}),
    snapKind: feature.snapKind,
    tier: manipulationSnapTier(feature.snapKind),
    markerToken: manipulationSnapMarkerToken(feature.snapKind),
  }
}
