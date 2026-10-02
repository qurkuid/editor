import { writeFileSync, readFileSync } from 'node:fs'
import type { AnyNode, GeometryContext, ZoneNode } from '@pascal-app/core'
import { createFloorplanContextExtensions } from '../../../packages/editor/src/lib/floorplan/floorplan-extension'
import { preflightZoneDimensionEdit } from '../../../packages/nodes/src/shared/dimension-edit-preflight'
import { buildRoomClearDimensions } from '../../../packages/nodes/src/zone/room-clear-dimensions'

const evidenceDir = '.omo/evidence/expert-dimension-edit-20261001'
const selectedZoneId = 'zone_ay2nmt8at4dd9zkc'
const selectedSemanticKey =
  'level_aw8kqyoj7ugmgm9t:room-clear:zone_ay2nmt8at4dd9zkc:span:wall_0700ib9yi3rq4yta:back|wall_zgzg7oxteij89e1h:back'
const numericTolerance = 1e-10

type SceneDocument = {
  graph: { nodes: Record<string, AnyNode> }
}

type Diff = {
  path: string
  kind: 'numeric' | 'exact'
  expected: unknown
  actual: unknown
  delta?: number
}

function readScene(name: string): SceneDocument {
  return JSON.parse(readFileSync(`${evidenceDir}/${name}`, 'utf8')) as SceneDocument
}

function roomZones(nodes: Readonly<Record<string, AnyNode>>): ZoneNode[] {
  return Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' && node.autoFromWalls === true && node.spaceRole === 'room',
  )
}

function contextFor(
  nodes: Readonly<Record<string, AnyNode>>,
  siblings: readonly ZoneNode[],
): GeometryContext {
  return {
    resolve: (id) => nodes[id],
    children: [],
    siblings,
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

function dimensionsFor(
  nodes: Readonly<Record<string, AnyNode>>,
  zone: ZoneNode,
): Array<Extract<ReturnType<typeof buildRoomClearDimensions>[number], { kind: 'dimension' }>> {
  const candidate = { ...zone, clearDimensionPolicy: 'inside-faces' as const }
  return buildRoomClearDimensions(candidate, contextFor(nodes, roomZones(nodes))).filter(
    (entry): entry is Extract<typeof entry, { kind: 'dimension' }> => entry.kind === 'dimension',
  )
}

function compare(expected: unknown, actual: unknown, path: string, diffs: Diff[]): number {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const delta = Math.abs(actual - expected)
    if (delta > numericTolerance) {
      diffs.push({ path, kind: 'numeric', expected, actual, delta })
    }
    return delta
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    if (expected !== actual) diffs.push({ path, kind: 'exact', expected, actual })
    return 0
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      diffs.push({ path, kind: 'exact', expected, actual })
      return 0
    }
    if (expected.length !== actual.length) {
      diffs.push({ path: `${path}.length`, kind: 'exact', expected: expected.length, actual: actual.length })
    }
    let maxDelta = 0
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      maxDelta = Math.max(maxDelta, compare(expected[index], actual[index], `${path}[${index}]`, diffs))
    }
    return maxDelta
  }
  const expectedRecord = expected as Record<string, unknown>
  const actualRecord = actual as Record<string, unknown>
  const keys = new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])
  let maxDelta = 0
  for (const key of keys) {
    if (!(key in expectedRecord) || !(key in actualRecord)) {
      diffs.push({ path: `${path}.${key}`, kind: 'exact', expected: expectedRecord[key], actual: actualRecord[key] })
      continue
    }
    maxDelta = Math.max(maxDelta, compare(expectedRecord[key], actualRecord[key], `${path}.${key}`, diffs))
  }
  return maxDelta
}

const before = readScene('room-enabled-before.json')
const after = readScene('local-room-1216.json')
const beforeNodes = before.graph.nodes
const afterNodes = after.graph.nodes
const beforeZone = beforeNodes[selectedZoneId]
if (beforeZone?.type !== 'zone') throw new Error(`Missing selected zone ${selectedZoneId}`)
const selectedZone = { ...beforeZone, clearDimensionPolicy: 'inside-faces' as const }
const selectedDimensions = dimensionsFor(beforeNodes, selectedZone)
const selectedDimension = selectedDimensions.find(
  (entry) => entry.editDescriptor?.semanticKey === selectedSemanticKey,
)
const descriptor = selectedDimension?.editDescriptor
if (!(descriptor && descriptor.status === 'editable')) {
  throw new Error(`Missing editable descriptor ${selectedSemanticKey}`)
}

const currentDistance = descriptor.leaves[0]?.currentLength
if (currentDistance === undefined) throw new Error('Selected descriptor has no leaf length')
const targetDistance = currentDistance + 0.1
const preflightNodes = { ...beforeNodes, [selectedZoneId]: selectedZone } satisfies Record<string, AnyNode>
const plan = preflightZoneDimensionEdit({
  node: selectedZone,
  nodes: preflightNodes,
  request: { descriptor, targetDistance, fixedEnd: 'start' },
})

const expectedNodes = structuredClone(preflightNodes)
for (const update of plan.updates) {
  const current = expectedNodes[update.id]
  if (!current) throw new Error(`Preflight update references missing node ${String(update.id)}`)
  expectedNodes[update.id] = { ...current, ...update.data } as AnyNode
}

const diffs: Diff[] = []
let maxNumericDelta = 0
const nodeIds = new Set([...Object.keys(expectedNodes), ...Object.keys(afterNodes)])
for (const id of nodeIds) {
  maxNumericDelta = Math.max(
    maxNumericDelta,
    compare(expectedNodes[id], afterNodes[id], `graph.nodes.${id}`, diffs),
  )
}
const expectedGraph = { ...before.graph, nodes: expectedNodes }
const afterGraph = after.graph
for (const key of ['rootNodeIds', 'collections', 'materials'] as const) {
  maxNumericDelta = Math.max(
    maxNumericDelta,
    compare(expectedGraph[key], afterGraph[key], `graph.${key}`, diffs),
  )
}

const afterZone = afterNodes[selectedZoneId]
if (afterZone?.type !== 'zone') throw new Error(`Missing applied zone ${selectedZoneId}`)
const afterDimensions = dimensionsFor(afterNodes, afterZone)
const otherBefore = selectedDimensions
  .filter((entry) => entry.editDescriptor?.semanticKey !== selectedSemanticKey)
  .map((entry) => ({ label: entry.text, descriptor: entry.editDescriptor }))
  .find((entry) => Math.abs((entry.descriptor?.leaves[0]?.currentLength ?? 0) - 1.83625) < 1e-4)
const otherAfter = afterDimensions.find(
  (entry) => entry.editDescriptor?.semanticKey === otherBefore?.descriptor?.semanticKey,
)
if (!(otherBefore?.descriptor && otherAfter?.editDescriptor)) {
  throw new Error('Could not find the unchanged 1.83625 m room span')
}
const otherBeforeLength = otherBefore.descriptor.leaves[0]?.currentLength
const otherAfterLength = otherAfter.editDescriptor.leaves[0]?.currentLength
if (otherBeforeLength === undefined || otherAfterLength === undefined) {
  throw new Error('Unchanged room span has no leaf length')
}
const otherRoomSpanDelta = Math.abs(otherAfterLength - otherBeforeLength)
if (otherRoomSpanDelta > numericTolerance) {
  diffs.push({
    path: 'regenerated.otherRoomSpan',
    kind: 'numeric',
    expected: otherBeforeLength,
    actual: otherAfterLength,
    delta: otherRoomSpanDelta,
  })
}

const result = {
  status: diffs.length === 0 ? 'PASS' : 'FAIL',
  nodeCount: Object.keys(afterNodes).length,
  updateCount: plan.updates.length,
  currentDistance,
  targetDistance,
  maxNumericDelta,
  otherRoomSpan: {
    semanticKey: otherBefore.descriptor.semanticKey,
    before: otherBeforeLength,
    after: otherAfterLength,
    delta: otherRoomSpanDelta,
  },
  diffs: diffs.slice(0, 20),
}
writeFileSync(`${evidenceDir}/room-apply-verification.json`, `${JSON.stringify(result, null, 2)}\n`)
console.log(`${result.status} maxNumericDelta=${result.maxNumericDelta} otherRoomSpanDelta=${otherRoomSpanDelta}`)
if (diffs.length > 0) process.exitCode = 1
