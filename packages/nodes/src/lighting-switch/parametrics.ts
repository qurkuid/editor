import type { ParametricDescriptor } from '@pascal-app/core'
import type { LightingSwitchNode } from './schema'

export const lightingSwitchParametrics: ParametricDescriptor<LightingSwitchNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
