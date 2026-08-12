import { create } from 'zustand'

interface DraftLengthHudState {
  raw: string
  signedMode: boolean
  previewInvalid: boolean
  setRaw: (raw: string) => void
  setSignedMode: (signedMode: boolean) => void
  setPreviewInvalid: (previewInvalid: boolean) => void
  clear: () => void
}

export const useDraftLengthHud = create<DraftLengthHudState>((set) => ({
  raw: '',
  signedMode: false,
  previewInvalid: false,
  setRaw: (raw) => set({ raw }),
  setSignedMode: (signedMode) => set({ signedMode }),
  setPreviewInvalid: (previewInvalid) => set({ previewInvalid }),
  clear: () => set({ raw: '', signedMode: false, previewInvalid: false }),
}))
