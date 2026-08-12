import type { NodeDefinition } from '@pascal-app/core'
import { ComponentNode } from './schema'

export const componentDefinition: NodeDefinition<typeof ComponentNode> = {
  kind: 'component',
  schemaVersion: 1,
  schema: ComponentNode,
  category: 'structure',
  defaults: () => {
    const stub = ComponentNode.parse({
      id: 'component_default' as never,
      type: 'component',
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
    label: 'Component',
    description: 'A linked reusable Body component instance.',
    icon: { kind: 'url', src: '/icons/component.webp' },
    paletteSection: 'structure',
    paletteOrder: 27,
  },
  mcp: {
    description: 'A linked reusable Body component instance.',
  },
}
