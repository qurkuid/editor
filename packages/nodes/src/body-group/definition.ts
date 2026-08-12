import type { NodeDefinition } from '@pascal-app/core'
import { BodyGroupNode } from './schema'

export const bodyGroupDefinition: NodeDefinition<typeof BodyGroupNode> = {
  kind: 'body-group',
  schemaVersion: 1,
  schema: BodyGroupNode,
  category: 'structure',
  defaults: () => {
    const stub = BodyGroupNode.parse({
      id: 'body-group_default' as never,
      type: 'body-group',
      children: ['body_default' as never],
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'mesh' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['x', 'y', 'z'] },
    duplicable: true,
    deletable: true,
    presettable: false,
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Body group',
    description: 'A persistent transform container for sibling Body nodes.',
    icon: { kind: 'url', src: '/icons/group.webp' },
    paletteSection: 'structure',
    paletteOrder: 26,
  },
  mcp: {
    description: 'A persistent transform container for sibling Body nodes.',
  },
}
