import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildLightingSwitchFloorplan } from './floorplan'
import { lightingSwitchParametrics } from './parametrics'
import { LightingSwitchNode } from './schema'

export const lightingSwitchDefinition: NodeDefinition<typeof LightingSwitchNode> = {
  kind: 'lighting-switch',
  schemaVersion: 1,
  schema: LightingSwitchNode,
  category: 'structure',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    } satisfies FloorplanNodeExtension,
  },
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 1.2, 0],
    rotation: 0,
    circuitId: null,
    gangCount: 1,
    switchShape: 'rectangle',
  }),
  capabilities: {
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  system: { module: () => import('./system'), priority: 10 },
  floorplan: buildLightingSwitchFloorplan,
  parametrics: lightingSwitchParametrics,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place switch' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Switch',
    description: 'A physical switch assigned to a lighting circuit.',
    icon: { kind: 'iconify', name: 'lucide:toggle-left' },
    hidden: true,
  },
  mcp: { description: 'A physical lighting switch. Clicking it toggles its assigned circuit.' },
}
