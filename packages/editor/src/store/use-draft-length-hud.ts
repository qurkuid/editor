import { create } from 'zustand'

interface DraftLengthHudState {
  raw: string
  setRaw: (raw: string) => void
  clear: () => void
}

export const useDraftLengthHud = create<DraftLengthHudState>((set) => ({
  raw: '',
  setRaw: (raw) => set({ raw }),
  clear: () => set({ raw: '' }),
}))
