'use client'

import type {
  BodyNode,
  ManipulationSnapCandidate,
  MeasurementFeatureBinding,
  MeasurementPoint,
  MeasurementSnapKind,
} from '@pascal-app/core'
import {
  manipulationSnapCandidateFromFeature,
  manipulationSnapMarkerToken,
  manipulationSnapTier,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import type { associateSurfaceHit } from '../measurement/surface-query'
import { bodyMeasurementFeatures } from './measurement'

type BodyMoveSnapKind = Extract<
  MeasurementSnapKind,
  'endpoint' | 'midpoint' | 'edge' | 'center' | 'face'
>

export type BodyMoveSnap = Pick<
  ManipulationSnapCandidate,
  'featureId' | 'point' | 'normal' | 'snapKind'
> & {
  label: string
  snapKind: BodyMoveSnapKind
  tier: ReturnType<typeof manipulationSnapTier>
  markerToken: ReturnType<typeof manipulationSnapMarkerToken>
}

const BODY_MOVE_SNAP_COLORS: Record<BodyMoveSnapKind, string> = {
  endpoint: '#22c55e',
  midpoint: '#22d3ee',
  edge: '#ef4444',
  center: '#22d3ee',
  face: '#3b82f6',
}

function isBodyMoveSnapKind(kind: MeasurementSnapKind): kind is BodyMoveSnapKind {
  return (
    kind === 'endpoint' ||
    kind === 'midpoint' ||
    kind === 'edge' ||
    kind === 'center' ||
    kind === 'face'
  )
}

function bodyMoveSnapLabel(snapKind: MeasurementSnapKind, featureLabel = ''): string | null {
  if (snapKind === 'endpoint') return '꼭짓점'
  if (snapKind === 'midpoint') return '선 중점'
  if (snapKind === 'edge') return '선 위'
  if (snapKind === 'face') return '면 위'
  if (snapKind === 'center') {
    return /face\s+center/i.test(featureLabel) ? '면 중심' : '요소 중심'
  }
  return null
}

export function bodyMoveSnapFromBinding(
  body: BodyNode,
  binding: MeasurementFeatureBinding | null,
): BodyMoveSnap | null {
  if (!binding) return null
  const feature = bodyMeasurementFeatures(body).find(
    (candidate) => candidate.id === binding.featureId,
  )
  if (!feature || !isBodyMoveSnapKind(feature.snapKind)) return null
  const label = bodyMoveSnapLabel(feature.snapKind, feature.label)
  if (!label) return null
  const candidate = manipulationSnapCandidateFromFeature(feature, binding)
  return {
    ...candidate,
    label,
    snapKind: feature.snapKind,
  }
}

export function bodyMoveSnapFromSurfaceHit(
  hit: ReturnType<typeof associateSurfaceHit>,
): BodyMoveSnap | null {
  if (!hit.semantic || !isBodyMoveSnapKind(hit.semantic.snapKind) || !hit.anchor) return null
  const label = bodyMoveSnapLabel(hit.semantic.snapKind, hit.semantic.label)
  if (!label) return null
  return {
    featureId: hit.anchor.reference.featureId,
    label,
    normal: [...hit.normal],
    point: [...hit.point],
    snapKind: hit.semantic.snapKind,
    tier: manipulationSnapTier(hit.semantic.snapKind),
    markerToken: manipulationSnapMarkerToken(hit.semantic.snapKind),
  }
}

export function BodyMoveSnapMarker({
  persistent,
  snap,
}: {
  persistent: boolean
  snap: BodyMoveSnap
}) {
  const color = BODY_MOVE_SNAP_COLORS[snap.snapKind]
  const labelOffset: MeasurementPoint = snap.normal
    ? [snap.normal[0] * 0.08, snap.normal[1] * 0.08, snap.normal[2] * 0.08]
    : [0, 0.08, 0]

  return (
    <group position={snap.point} renderOrder={1006}>
      <Html
        center
        style={{
          height: '8px',
          pointerEvents: 'none',
          width: '8px',
        }}
        zIndexRange={[120, 0]}
      >
        <span
          style={{
            backgroundColor: color,
            border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
            boxSizing: 'border-box',
            display: 'block',
            height: '8px',
            opacity: persistent ? 1 : 0.85,
            width: '8px',
          }}
        />
      </Html>
      <Html center position={labelOffset} style={{ pointerEvents: 'none' }} zIndexRange={[120, 0]}>
        <div className="whitespace-nowrap rounded border border-white/70 bg-zinc-950/95 px-1.5 py-0.5 font-semibold text-[10px] text-white shadow-lg">
          {snap.label}
        </div>
      </Html>
    </group>
  )
}
