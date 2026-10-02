import { writeFileSync } from 'node:fs'
import type { AnyNode, GeometryContext, ZoneNode } from '@pascal-app/core'
import { createFloorplanContextExtensions } from '../../../packages/editor/src/lib/floorplan/floorplan-extension'
import { preflightZoneDimensionEdit } from '../../../packages/nodes/src/shared/dimension-edit-preflight'
import { buildRoomClearDimensions } from '../../../packages/nodes/src/zone/room-clear-dimensions'
import graphDocument from './room-before.json'

type DimensionResult = {
  zoneId: string
  dimensionLabel: string
  semanticKey: string | null
  count: number
}

type PreflightResult = {
  zoneId: string
  semanticKey: string
  currentDistance: number
  targetDistance: number
  delta: number
  status: 'pass' | 'fail'
  descriptorId?: string
  updateCount?: number
  updatedIds?: string[]
  error?: string
}

const sourceNodes = graphDocument.graph.nodes as Record<string, AnyNode>
const sourceZones = Object.values(sourceNodes).filter(
  (node): node is ZoneNode =>
    node.type === 'zone' &&
    node.autoFromWalls === true &&
    node.spaceRole === 'room' &&
    node.parentId !== undefined,
)

function contextFor(nodes: Readonly<Record<string, AnyNode>>): GeometryContext {
  return {
    resolve: (id) => nodes[id],
    children: [],
    siblings: sourceZones,
    parent: null,
    viewState: {
      unit: 'metric',
      palette: { measurementStroke: '#475569' },
    },
    extensions: createFloorplanContextExtensions({
      purpose: 'edit',
      metricNotation: 'meters',
    }),
  }
}

const dimensions: DimensionResult[] = []
let preflight: PreflightResult | undefined

for (const zone of sourceZones) {
  const candidate = { ...zone, clearDimensionPolicy: 'inside-faces' as const }
  const geometry = buildRoomClearDimensions(candidate, contextFor(sourceNodes))
  for (const entry of geometry) {
    if (entry.kind !== 'dimension') continue
    const descriptor = entry.editDescriptor
    dimensions.push({
      zoneId: zone.id,
      dimensionLabel: entry.text,
      semanticKey: descriptor?.semanticKey ?? null,
      count: descriptor?.leaves.length ?? 0,
    })
    if (
      preflight ||
      descriptor?.status !== 'editable' ||
      descriptor.leaves.length === 0 ||
      descriptor.kind !== 'room-clear'
    ) {
      continue
    }

    const nodes = {
      ...sourceNodes,
      [zone.id]: candidate,
    } satisfies Record<string, AnyNode>
    const currentDistance = descriptor.leaves[0]!.currentLength
    const targetDistance = currentDistance + 0.1
    try {
      const result = preflightZoneDimensionEdit({
        node: candidate,
        nodes,
        request: {
          descriptor,
          targetDistance,
          fixedEnd: 'start',
        },
      })
      preflight = {
        zoneId: zone.id,
        semanticKey: descriptor.semanticKey,
        currentDistance,
        targetDistance,
        delta: targetDistance - currentDistance,
        status: 'pass',
        descriptorId: result.descriptorId,
        updateCount: result.updates.length,
        updatedIds: result.updates.map(({ id }) => String(id)),
      }
    } catch (error) {
      preflight = {
        zoneId: zone.id,
        semanticKey: descriptor.semanticKey,
        currentDistance,
        targetDistance,
        delta: targetDistance - currentDistance,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

const evidence = {
  source: {
    path: '.omo/evidence/expert-dimension-edit-20261001/room-before.json',
    nodeCount: Object.keys(sourceNodes).length,
    autoRoomCount: sourceZones.length,
    policy: 'inside-faces',
  },
  dimensions,
  preflight: preflight ?? null,
}

writeFileSync(
  '.omo/evidence/expert-dimension-edit-20261001/room-clear-qa.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
)
console.log(JSON.stringify(dimensions))
