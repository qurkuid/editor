import { create } from 'zustand'

export type BodyPrimitive = 'line' | 'rectangle' | 'circle'

export type BodyFaceDraft = {
  readonly bodyId: string
  readonly faceId: string
}

type BodyToolOptions = {
  primitive: BodyPrimitive
  setPrimitive: (primitive: BodyPrimitive) => void
  faceDraft: BodyFaceDraft | null
  setFaceDraft: (draft: BodyFaceDraft | null) => void
  clearFaceDraftIfMatches: (draft: BodyFaceDraft) => void
  pendingFace: BodyFaceDraft | null
  setPendingFace: (draft: BodyFaceDraft | null) => void
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
  pendingFace: null,
  setPendingFace: (pendingFace) => set({ pendingFace }),
}))
