import { create } from 'zustand'

export type WallConstructionDisplayMode = 'finish' | 'frame' | 'layers'

type WallConstructionDisplayState = {
  mode: WallConstructionDisplayMode
  setMode: (mode: WallConstructionDisplayMode) => void
}

export const useWallConstructionDisplay = create<WallConstructionDisplayState>((set) => ({
  mode: 'finish',
  setMode: (mode) => set({ mode }),
}))
