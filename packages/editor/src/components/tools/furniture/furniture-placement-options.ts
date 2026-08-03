// Ephemeral placement options for the furniture placement tool — the armed
// preset (kind + dimensions + bay count) picked in the furniture tab before
// pointing at the scene.

import type { FurnitureKind } from '@pascal-app/core'
import { create } from 'zustand'

export type FurnitureDimensions = { width: number; height: number; depth: number }

type FurniturePlacementOptions = {
  kind: FurnitureKind
  dimensions: FurnitureDimensions
  bayCount: number
  setKind: (kind: FurnitureKind) => void
  setDimensions: (dimensions: FurnitureDimensions) => void
  setBayCount: (bayCount: number) => void
}

export const useFurniturePlacementOptions = create<FurniturePlacementOptions>((set) => ({
  kind: 'wardrobe',
  dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
  bayCount: 2,
  setKind: (kind) => set({ kind }),
  setDimensions: (dimensions) => set({ dimensions }),
  setBayCount: (bayCount) => set({ bayCount }),
}))
