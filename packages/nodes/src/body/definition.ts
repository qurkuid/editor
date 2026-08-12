import { type NodeDefinition, PASCAL_ARCHITECTURE_BODY_REF } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildBodyFloorplan } from './floorplan'
import { bodyFloorplanMoveTarget } from './floorplan-move'
import { buildBodyGeometry } from './geometry'
import {
  bodyMeasurementFeatures,
  matchBodyMeasurementFeature,
  resolveBodyMeasurementFeature,
} from './measurement'
import { bodyPaint } from './paint'
import { bodyParametrics } from './parametrics'
import { bodyScaleHandles } from './scale-handles'
import { BodyNode } from './schema'

export const bodyDefinition: NodeDefinition<typeof BodyNode> = {
  kind: 'body',
  schemaVersion: 1,
  schema: BodyNode,
  category: 'structure',
  semanticRef: PASCAL_ARCHITECTURE_BODY_REF,
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    } satisfies FloorplanNodeExtension,
  },
  snapProfile: 'structural',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    revision: 0,
    shells: [],
    vertices: [],
    halfEdges: [],
    loops: [],
    faces: [],
    curves: [],
    bodyDefaults: {},
  }),
  capabilities: {
    selectable: { hitVolume: 'mesh' },
    duplicable: true,
    deletable: true,
    presettable: false,
    paint: bodyPaint,
  },
  geometry: buildBodyGeometry,
  handles: bodyScaleHandles,
  floorplan: buildBodyFloorplan,
  measurement: {
    features: (node) => bodyMeasurementFeatures(node),
    match: (node, _ctx, point, maxDistance) =>
      matchBodyMeasurementFeature(node, point, maxDistance),
    resolve: (node, _ctx, reference) => resolveBodyMeasurementFeature(node, reference),
  },
  parametrics: bodyParametrics,
  affordanceTools: {
    selection: () => import('./selection'),
    move: () => import('./move-tool'),
  },
  floorplanMoveTarget: bodyFloorplanMoveTarget,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Draw active shape' },
    { key: 'Enter', label: 'Close line face' },
    { key: 'C', label: 'Close line face' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Direct',
    description: 'Draw line, rectangle, and circle faces, then push or pull their faces.',
    icon: { kind: 'url', src: '/icons/mesh.webp' },
    paletteSection: 'structure',
    paletteOrder: 25,
  },
  mcp: {
    description: 'A direct-modeling body with persistent vertex, edge, loop, and face topology.',
  },
}
