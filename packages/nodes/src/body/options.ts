import { emitter } from '@pascal-app/core'
import { create } from 'zustand'

export type BodyPrimitive = 'line' | 'rectangle' | 'circle' | 'arc' | 'polygon'

export const MIN_ARC_SEGMENTS = 2
export const MAX_ARC_SEGMENTS = 256
export const DEFAULT_ARC_SEGMENTS = 32
export const MIN_POLYGON_SIDES = 3
export const MAX_POLYGON_SIDES = 256
export const DEFAULT_POLYGON_SIDES = 6

export type BodyFaceDraft = {
  readonly bodyId: string
  readonly faceId: string
}

export type BodyFeatureSelection =
  | { readonly bodyId: string; readonly kind: 'vertex'; readonly featureId: string }
  | { readonly bodyId: string; readonly kind: 'edge'; readonly featureId: string }
  | { readonly bodyId: string; readonly kind: 'face'; readonly featureId: string }

export type BodyPoint = readonly [number, number, number]

export function bodyActionToolChanged<T>(armedTool: T, currentTool: T): boolean {
  return armedTool !== currentTool
}

export type BodySelectionAction =
  | { readonly bodyId: string; readonly kind: 'move' }
  | { readonly bodyId: string; readonly kind: 'rotate' }
  | { readonly bodyId: string; readonly kind: 'scale' }
  | { readonly bodyId: string; readonly kind: 'push-pull'; readonly faceId: string | null }
  | {
      readonly bodyId: string
      readonly kind: 'offset'
      readonly faceId: string | null
      readonly hitPoint: BodyPoint | null
    }
  | {
      readonly bodyId: string
      readonly kind: 'sweep'
      readonly faceId: string | null
      readonly hitPoint: BodyPoint | null
    }

type BodyToolOptions = {
  primitive: BodyPrimitive
  setPrimitive: (primitive: BodyPrimitive) => void
  arcSegments: number
  setArcSegments: (segments: number) => void
  polygonSides: number
  setPolygonSides: (sides: number) => void
  faceDraft: BodyFaceDraft | null
  setFaceDraft: (draft: BodyFaceDraft | null) => void
  clearFaceDraftIfMatches: (draft: BodyFaceDraft) => void
  selectedFeature: BodyFeatureSelection | null
  setSelectedFeature: (selection: BodyFeatureSelection | null) => void
  autofold: boolean
  setAutofold: (enabled: boolean) => void
  selectionAction: BodySelectionAction | null
  setSelectionAction: (action: BodySelectionAction | null) => void
}

export function clampArcSegments(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ARC_SEGMENTS
  return Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.round(value)))
}

export function clampPolygonSides(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POLYGON_SIDES
  return Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, Math.round(value)))
}

function readAutofoldPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('pascal.body.autofold') === 'true'
  } catch {
    return false
  }
}

export const useBodyToolOptions = create<BodyToolOptions>((set) => ({
  primitive: 'rectangle',
  setPrimitive: (primitive) => set({ primitive }),
  arcSegments: DEFAULT_ARC_SEGMENTS,
  setArcSegments: (segments) => set({ arcSegments: clampArcSegments(segments) }),
  polygonSides: DEFAULT_POLYGON_SIDES,
  setPolygonSides: (sides) => set({ polygonSides: clampPolygonSides(sides) }),
  faceDraft: null,
  setFaceDraft: (faceDraft) => set({ faceDraft }),
  clearFaceDraftIfMatches: (draft) =>
    set((state) =>
      state.faceDraft?.bodyId === draft.bodyId && state.faceDraft.faceId === draft.faceId
        ? { faceDraft: null }
        : state,
    ),
  selectedFeature: null,
  setSelectedFeature: (selectedFeature) => set({ selectedFeature }),
  autofold: readAutofoldPreference(),
  setAutofold: (autofold) => set({ autofold }),
  selectionAction: null,
  setSelectionAction: (selectionAction) => set({ selectionAction }),
}))

emitter.on('body:autofold-change', ({ enabled }) => {
  useBodyToolOptions.getState().setAutofold(enabled)
})
