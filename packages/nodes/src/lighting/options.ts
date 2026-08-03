import type { LightingFixtureNode } from '@pascal-app/core'
import { create } from 'zustand'

type LightingToolOptions = {
  lightType: LightingFixtureNode['lightType']
  circuitId: string | null
  fixtureHeight: number
  switchHeight: number
  setLightType: (lightType: LightingFixtureNode['lightType']) => void
  setCircuitId: (circuitId: string | null) => void
  setFixtureHeight: (fixtureHeight: number) => void
  setSwitchHeight: (switchHeight: number) => void
}

export const useLightingToolOptions = create<LightingToolOptions>((set) => ({
  lightType: 'point',
  circuitId: null,
  fixtureHeight: 2.4,
  switchHeight: 1.2,
  setLightType: (lightType) => set({ lightType }),
  setCircuitId: (circuitId) => set({ circuitId }),
  setFixtureHeight: (fixtureHeight) => set({ fixtureHeight }),
  setSwitchHeight: (switchHeight) => set({ switchHeight }),
}))
