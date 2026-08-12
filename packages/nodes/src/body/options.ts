import { create } from 'zustand'

export type BodyPrimitive = 'line' | 'rectangle' | 'circle'

export type BodyFaceDraft = {
  readonly bodyId: string
  readonly faceId: string
}

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
  faceDraft: BodyFaceDraft | null
  setFaceDraft: (draft: BodyFaceDraft | null) => void
  clearFaceDraftIfMatches: (draft: BodyFaceDraft) => void
  selectedFace: BodyFaceDraft | null
  setSelectedFace: (draft: BodyFaceDraft | null) => void
  selectionAction: BodySelectionAction | null
  setSelectionAction: (action: BodySelectionAction | null) => void
}

export const useBodyToolOptions = create<BodyToolOptions>((set) => ({
  primitive: 'rectangle',
  setPrimitive: (primitive) => set({ primitive }),
  faceDraft: null,
  setFaceDraft: (faceDraft) => set({ faceDraft }),
  clearFaceDraftIfMatches: (draft) =>
    set((state) =>
      state.faceDraft?.bodyId === draft.bodyId && state.faceDraft.faceId === draft.faceId
        ? { faceDraft: null }
        : state,
    ),
  selectedFace: null,
  setSelectedFace: (selectedFace) => set({ selectedFace }),
  selectionAction: null,
  setSelectionAction: (selectionAction) => set({ selectionAction }),
}))
