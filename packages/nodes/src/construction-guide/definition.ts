import { ConstructionGuideNode, type NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildConstructionGuideFloorplan } from './floorplan'
import { slideConstructionGuideAffordance } from './floorplan-affordances'

export const constructionGuideDefinition: NodeDefinition<typeof ConstructionGuideNode> = {
  kind: 'construction-guide',
  bake: 'strip',
  schemaVersion: 1,
  schema: ConstructionGuideNode,
  category: 'analysis',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<ConstructionGuideNode>,
  },
  snapProfile: 'item',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    origin: [0, 0],
    direction: [1, 0],
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: false,
    presettable: false,
  },

  dirtyTracking: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildConstructionGuideFloorplan,
  floorplanAffordances: {
    'slide-construction-guide': slideConstructionGuideAffordance,
  },
  toolHints: [
    { key: 'Left click', label: 'Pick a wall or guide as reference' },
    { key: 'Move', label: 'Slide the parallel guide' },
    { key: 'Type + Enter', label: 'Exact offset distance' },
    { key: 'Left click', label: 'Place the guide' },
    { key: 'Esc', label: 'Step back or exit' },
  ],

  presentation: {
    label: 'Guide Line',
    description: 'Infinite dashed construction guide, parallel-offset from a picked edge.',
    icon: { kind: 'iconify', name: 'lucide:pencil-ruler' },
    hidden: true,
    actionMenu: false,
  },

  mcp: {
    description:
      'An infinite construction guide line on the floor plan, defined by an origin point and direction, used as a drafting reference.',
  },
}
