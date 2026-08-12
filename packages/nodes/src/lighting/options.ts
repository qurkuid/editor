import type { AssetInput, LightingFixtureNode, LightingSwitchNode } from '@pascal-app/core'
import { create } from 'zustand'

/** How point/spot fixtures are dropped: one per click, or a two-click run
 * divided evenly into `arrayCount` fixtures. */
export type LightingPlacementMode = 'single' | 'array'

type LightingToolOptions = {
  lightType: LightingFixtureNode['lightType']
  circuitId: string | null
  fixtureHeight: number
  switchHeight: number
  switchGangCount: number
  switchShape: LightingSwitchNode['switchShape']
  placement: LightingPlacementMode
  arrayCount: number
  /** Catalog model combined into each placed fixture; null = bare light. */
  itemAsset: AssetInput | null
  setLightType: (lightType: LightingFixtureNode['lightType']) => void
  setCircuitId: (circuitId: string | null) => void
  setFixtureHeight: (fixtureHeight: number) => void
  setSwitchHeight: (switchHeight: number) => void
  setSwitchGangCount: (switchGangCount: number) => void
  setSwitchShape: (switchShape: LightingSwitchNode['switchShape']) => void
  setPlacement: (placement: LightingPlacementMode) => void
  setArrayCount: (arrayCount: number) => void
  setItemAsset: (itemAsset: AssetInput | null) => void
}

export const useLightingToolOptions = create<LightingToolOptions>((set) => ({
  lightType: 'point',
  circuitId: null,
  fixtureHeight: 2.4,
  switchHeight: 1.2,
  switchGangCount: 1,
  switchShape: 'rectangle',
  placement: 'single',
  arrayCount: 4,
  itemAsset: null,
  setLightType: (lightType) => set({ lightType }),
  setCircuitId: (circuitId) => set({ circuitId }),
  setFixtureHeight: (fixtureHeight) => set({ fixtureHeight }),
  setSwitchHeight: (switchHeight) => set({ switchHeight }),
  setSwitchGangCount: (switchGangCount) =>
    set({ switchGangCount: Math.max(1, Math.min(4, Math.round(switchGangCount) || 1)) }),
  setSwitchShape: (switchShape) => set({ switchShape }),
  setPlacement: (placement) => set({ placement }),
  setArrayCount: (arrayCount) =>
    set({ arrayCount: Math.max(2, Math.min(50, Math.round(arrayCount) || 2)) }),
  setItemAsset: (itemAsset) => set({ itemAsset }),
}))
