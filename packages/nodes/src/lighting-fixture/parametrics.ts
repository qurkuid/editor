import type { ParametricDescriptor } from '@pascal-app/core'
import type { LightingFixtureNode } from './schema'

export const lightingFixtureParametrics: ParametricDescriptor<LightingFixtureNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
