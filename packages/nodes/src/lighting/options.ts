import type { AssetInput, LightingFixtureNode } from '@pascal-app/core'
import { create } from 'zustand'

/** How point/spot fixtures are dropped: one per click, or a two-click run
 * divided evenly into `arrayCount` fixtures. */
export type LightingPlacementMode = 'single' | 'array'

type LightingToolOptions = {
  lightType: LightingFixtureNode['lightType']
  circuitId: string | null
  fixtureHeight: number
  switchHeight: number
  placement: LightingPlacementMode
  arrayCount: number
  /** Catalog model combined into each placed fixture; null = bare light. */
  itemAsset: AssetInput | null
  setLightType: (lightType: LightingFixtureNode['lightType']) => void
  setCircuitId: (circuitId: string | null) => void
  setFixtureHeight: (fixtureHeight: number) => void
  setSwitchHeight: (switchHeight: number) => void
  setPlacement: (placement: LightingPlacementMode) => void
  setArrayCount: (arrayCount: number) => void
  setItemAsset: (itemAsset: AssetInput | null) => void
}

export const useLightingToolOptions = create<LightingToolOptions>((set) => ({
  lightType: 'point',
  circuitId: null,
  fixtureHeight: 2.4,
  switchHeight: 1.2,
  placement: 'single',
  arrayCount: 4,
  itemAsset: null,
  setLightType: (lightType) => set({ lightType }),
  setCircuitId: (circuitId) => set({ circuitId }),
  setFixtureHeight: (fixtureHeight) => set({ fixtureHeight }),
  setSwitchHeight: (switchHeight) => set({ switchHeight }),
  setPlacement: (placement) => set({ placement }),
  setArrayCount: (arrayCount) =>
    set({ arrayCount: Math.max(2, Math.min(50, Math.round(arrayCount) || 2)) }),
  setItemAsset: (itemAsset) => set({ itemAsset }),
}))
