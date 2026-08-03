import type { NodeDefinition } from '@pascal-app/core'
import { LightingCircuitNode } from './schema'

export const lightingCircuitDefinition: NodeDefinition<typeof LightingCircuitNode> = {
  kind: 'lighting-circuit',
  schemaVersion: 1,
  schema: LightingCircuitNode,
  category: 'utility',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Lighting circuit',
    enabled: true,
    circuitNumber: 1,
  }),
  capabilities: {
    duplicable: false,
    deletable: true,
    presettable: false,
  },
  dirtyTracking: false,
  presentation: {
    label: 'Lighting Circuit',
    description: 'Electrical control group for lights and switches.',
    icon: { kind: 'iconify', name: 'lucide:circuit-board' },
    hidden: true,
  },
  mcp: {
    description: 'A switchable electrical circuit referenced by lighting fixtures and switches.',
  },
}
