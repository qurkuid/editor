import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildLightingFixtureFloorplan } from './floorplan'
import { lightingFixtureParametrics } from './parametrics'
import { LightingFixtureNode } from './schema'

export const lightingFixtureDefinition: NodeDefinition<typeof LightingFixtureNode> = {
  kind: 'lighting-fixture',
  schemaVersion: 1,
  schema: LightingFixtureNode,
  category: 'structure',
  snapProfile: 'item',
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
    position: [0, 2.4, 0],
    rotation: [0, 0, 0],
    lightType: 'point',
    lumens: 800,
    colorTemperature: 3000,
    range: 8,
    beamAngle: 45,
    areaSize: [0.6, 0.6],
    linearWidth: 0.05,
    enabled: true,
    circuitId: null,
  }),
  capabilities: {
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  floorplan: buildLightingFixtureFloorplan,
  parametrics: lightingFixtureParametrics,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place light' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Light',
    description: 'A controllable point, spot, or area light.',
    icon: { kind: 'iconify', name: 'lucide:lightbulb' },
    hidden: true,
  },
  mcp: {
    description:
      'A controllable physical light source. Assign circuitId to control it with switches.',
  },
}
