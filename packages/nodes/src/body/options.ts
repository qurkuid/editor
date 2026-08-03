import { create } from 'zustand'

export type BodyPrimitive = 'line' | 'rectangle' | 'circle'

type BodyToolOptions = {
  primitive: BodyPrimitive
  setPrimitive: (primitive: BodyPrimitive) => void
}

export const useBodyToolOptions = create<BodyToolOptions>((set) => ({
  primitive: 'rectangle',
  setPrimitive: (primitive) => set({ primitive }),
}))
