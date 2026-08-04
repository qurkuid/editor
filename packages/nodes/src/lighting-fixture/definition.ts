import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { resolveLinearLightLength } from '../lighting/placement'
import { buildLightingFixtureFloorplan } from './floorplan'
import { lightingFixtureParametrics } from './parametrics'
import { LightingFixtureNode } from './schema'

const ROTATE_GIZMO_OFFSET = 0.3
const ROTATE_RING_OFFSET = 0.06

// Half of the fixture's extent along its local +X axis — the tube/run length
// for segment-placed kinds, the plate width for area, a nominal grab radius
// for a lone point/spot puck.
function fixtureHalfExtent(node: LightingFixtureNode): number {
  if (node.lightType === 'linear' || node.start) {
    return resolveLinearLightLength(node.start, node.end) / 2
  }
  if (node.lightType === 'area') return node.areaSize[0] / 2
  return 0.2
}

// Whole-fixture rotation handle — the two-headed curved arrow, same rig items
// use. `arc-resize` does the angular drag math; rotation snaps to 15° unless
// Shift is held (generic `shape: 'rotate'` behaviour in node-arrow-handles).
function lightingRotateHandle(): HandleDescriptor<LightingFixtureNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    // Negate the cursor delta to match three.js Y-rotation handedness.
    apply: (initial, delta) => {
      const [rx, ry, rz] = initial.rotation ?? [0, 0, 0]
      return { rotation: [rx, ry - delta, rz] }
    },
    placement: {
      position: (n) => [fixtureHalfExtent(n) + ROTATE_GIZMO_OFFSET, 0, ROTATE_GIZMO_OFFSET],
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => fixtureHalfExtent(n) + ROTATE_RING_OFFSET,
      y: () => 0,
    },
  }
}

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
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  dirtyTracking: false,
  handles: [lightingRotateHandle()],
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
