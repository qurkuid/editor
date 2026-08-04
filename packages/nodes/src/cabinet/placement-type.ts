// Ephemeral placement option for the cabinet tool.

import { create } from 'zustand'

import type { FurnitureRunKind } from './furniture-presets'

// 'cabinet' is the kitchen base run the tool has always placed; the rest are
// the furniture gallery's presets, which build the same kind of run with
// different tier/depth/stack (see furniture-presets.ts).
export type CabinetPlacementType = 'cabinet' | 'island' | 'wardrobe' | 'upper-run' | 'tall'

const PLACEMENT_RUN_KIND: Record<CabinetPlacementType, FurnitureRunKind> = {
  cabinet: 'base-run',
  island: 'island',
  wardrobe: 'wardrobe',
  'upper-run': 'upper-run',
  tall: 'tall',
}

export function placementRunKind(type: CabinetPlacementType): FurnitureRunKind {
  return PLACEMENT_RUN_KIND[type]
}

type CabinetPlacementTypeState = {
  type: CabinetPlacementType
  /** null = divide the drawn span automatically; a number pins the bay count. */
  bayCount: number | null
  setType(type: CabinetPlacementType): void
  setBayCount(bayCount: number | null): void
  cycleType(): CabinetPlacementType
}

const nextCabinetPlacementType = (type: CabinetPlacementType): CabinetPlacementType =>
  type === 'cabinet' ? 'island' : 'cabinet'

const useCabinetPlacementType = create<CabinetPlacementTypeState>((set, get) => ({
  type: 'cabinet',
  bayCount: null,
  setType: (type) => set({ type }),
  setBayCount: (bayCount) =>
    set({ bayCount: bayCount == null ? null : Math.max(1, Math.min(24, Math.floor(bayCount))) }),
  cycleType: () => {
    const next = nextCabinetPlacementType(get().type)
    set({ type: next })
    return next
  },
}))

export default useCabinetPlacementType
