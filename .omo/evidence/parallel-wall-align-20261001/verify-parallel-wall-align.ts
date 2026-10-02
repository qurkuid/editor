import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWallParallelAlignmentUpdates } from '../../../packages/core/src/lib/wall-operations'
import {
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  detectSpacesForLevel,
  planAutoZonesForLevel,
} from '../../../packages/core/src/lib/space-detection'
import { CeilingNode, SlabNode, ZoneNode } from '../../../packages/core/src/schema'

const numericTolerance = 1e-10
const selectedWallId = 'wall_ev1580n36u0mzfek'
const referenceWallId = 'wall_9d671l2wsc0l2z0i'
const linkedWallId = 'wall_gga4jfp1oa10dy2g'
const fixedCornerWallId = 'wall_spwze3zf32wqvlss'

type AnyRecord = Record<string, any>
type Graph = {
  nodes: AnyRecord
  rootNodeIds: string[]
  collections: AnyRecord
  materials: AnyRecord
  [key: string]: any
}

type SceneDocument = {
  graph: Graph
}

type Diff = {
  path: string
  expected: unknown
  actual: unknown
  delta?: number
}

const [beforeArg, afterArg, undoArg] = process.argv.slice(2)
const beforePath = resolve(beforeArg ?? '.omo/evidence/parallel-wall-align-20261001/before.json')
const afterPath = resolve(afterArg ?? '.omo/evidence/parallel-wall-align-20261001/after.json')
const undoPath = resolve(undoArg ?? '.omo/evidence/parallel-wall-align-20261001/undo.json')

function readScene(path: string): SceneDocument {
  const document = JSON.parse(readFileSync(path, 'utf8')) as SceneDocument
  if (!document.graph || !document.graph.nodes) {
    throw new Error(`Missing graph.nodes in ${path}`)
  }
  return document
}

function wallGeometrySignature(wall: AnyRecord): string {
  return [
    wall.id,
    Number(wall.start[0]).toFixed(4),
    Number(wall.start[1]).toFixed(4),
    Number(wall.end[0]).toFixed(4),
    Number(wall.end[1]).toFixed(4),
    Number(wall.thickness ?? 0.2).toFixed(4),
    wall.height == null ? 'plane' : Number(wall.height).toFixed(4),
    wall.supportSlabId ?? 'elected',
    Number(wall.supportOffset ?? 0).toFixed(4),
    Number(wall.curveOffset ?? 0).toFixed(4),
  ].join('|')
}

function applyUpdate(nodes: AnyRecord, id: string, data: AnyRecord): void {
  const current = nodes[id]
  if (!current) throw new Error(`Update references missing node ${id}`)
  nodes[id] = { ...current, ...data }
}

function removeFromParentChildren(nodes: AnyRecord, id: string): void {
  const node = nodes[id]
  if (!node?.parentId) return
  const parent = nodes[node.parentId]
  if (!parent || !Array.isArray(parent.children)) return
  parent.children = parent.children.filter((childId: string) => childId !== id)
}

function applyAutoSurfacePlan(
  expectedNodes: AnyRecord,
  beforeNodes: AnyRecord,
  actualNodes: AnyRecord,
  levelId: string,
  roomPolygons: Array<[number, number][]>,
  type: 'slab' | 'ceiling',
): { createdIds: string[]; updateCount: number; deleteCount: number } {
  const existing = Object.values(expectedNodes)
    .filter((node): node is AnyRecord => node.type === type && node.parentId === levelId)
    .map((node) => (type === 'slab' ? SlabNode.parse(node) : CeilingNode.parse(node)))
  const plan =
    type === 'slab'
      ? planAutoSlabsForLevel(roomPolygons, existing as any)
      : planAutoCeilingsForLevel(roomPolygons, existing as any, { storeyHeight: 2.5 })

  for (const id of plan.delete) {
    if (!expectedNodes[id]) continue
    removeFromParentChildren(expectedNodes, id)
    delete expectedNodes[id]
  }
  for (const update of plan.update) applyUpdate(expectedNodes, update.id, update.data as AnyRecord)

  const actualCreated = Object.values(actualNodes).filter(
    (node): node is AnyRecord =>
      node.type === type && node.parentId === levelId && !beforeNodes[node.id],
  )
  if (actualCreated.length !== plan.create.length) {
    throw new Error(
      `${type} create count mismatch: expected ${plan.create.length}, actual ${actualCreated.length}`,
    )
  }
  const createdByName = new Map(actualCreated.map((node) => [node.name, node]))
  const createdIds: string[] = []
  for (const planned of plan.create) {
    const actual = createdByName.get(planned.name)
    if (!actual) throw new Error(`${type} create missing: ${planned.name}`)
    expectedNodes[actual.id] = { ...planned, id: actual.id, parentId: levelId }
    createdIds.push(actual.id)
  }

  const expectedLevel = expectedNodes[levelId]
  const actualLevel = actualNodes[levelId]
  if (expectedLevel && actualLevel && Array.isArray(expectedLevel.children)) {
    const createdSet = new Set(createdIds)
    const actualCreatedOrder = actualLevel.children.filter((id: string) => createdSet.has(id))
    expectedLevel.children.push(...actualCreatedOrder)
  }

  return {
    createdIds,
    updateCount: plan.update.length,
    deleteCount: plan.delete.length,
  }
}

function applyWallUpdatesAndReactiveState(beforeGraph: Graph, actualGraph: Graph) {
  const expectedNodes = structuredClone(beforeGraph.nodes) as AnyRecord
  const updates = buildWallParallelAlignmentUpdates(beforeGraph.nodes, selectedWallId)
  for (const update of updates) applyUpdate(expectedNodes, update.id, update.data)

  const changedLevels = new Set<string>()
  for (const update of updates) {
    const before = beforeGraph.nodes[update.id]
    const after = expectedNodes[update.id]
    if (before?.type === 'wall' && after?.type === 'wall' && before.parentId) {
      if (wallGeometrySignature(before) !== wallGeometrySignature(after)) {
        changedLevels.add(before.parentId)
      }
    }
  }

  const reactiveZoneUpdateIds: string[] = []
  const surfaceResults: Array<{
    levelId: string
    slabResult: { createdIds: string[]; updateCount: number; deleteCount: number }
    ceilingResult: { createdIds: string[]; updateCount: number; deleteCount: number }
  }> = []
  for (const levelId of changedLevels) {
    const beforeWalls = Object.values(beforeGraph.nodes).filter(
      (node): node is AnyRecord => node.type === 'wall' && node.parentId === levelId,
    )
    const afterWalls = Object.values(expectedNodes).filter(
      (node): node is AnyRecord => node.type === 'wall' && node.parentId === levelId,
    )
    const previousSpaces = detectSpacesForLevel(levelId, beforeWalls as any).spaces
    const nextDetection = detectSpacesForLevel(levelId, afterWalls as any)

    // Match initSpaceDetectionSync: side labels are a derived update from the
    // same post-alignment wall map and are applied before the zone plan.
    for (const sideUpdate of nextDetection.wallUpdates) {
      const before = expectedNodes[sideUpdate.wallId]
      if (!before || before.type !== 'wall') continue
      if (
        before.frontSide !== sideUpdate.frontSide ||
        before.backSide !== sideUpdate.backSide
      ) {
        applyUpdate(expectedNodes, sideUpdate.wallId, {
          frontSide: sideUpdate.frontSide,
          backSide: sideUpdate.backSide,
        })
      }
    }

    // initSpaceDetectionSync runs slab creation and ceiling creation before
    // zone reconciliation. New surface IDs are generated at runtime, so bind
    // the pure descriptors to actual nodes by stable name while comparing
    // every other field exactly.
    const slabResult = applyAutoSurfacePlan(
      expectedNodes,
      beforeGraph.nodes,
      actualGraph.nodes,
      levelId,
      nextDetection.roomPolygons as Array<[number, number][]>,
      'slab',
    )
    const ceilingResult = applyAutoSurfacePlan(
      expectedNodes,
      beforeGraph.nodes,
      actualGraph.nodes,
      levelId,
      nextDetection.roomPolygons as Array<[number, number][]>,
      'ceiling',
    )
    surfaceResults.push({ levelId, slabResult, ceilingResult })

    const existingZones = Object.values(expectedNodes)
      .filter((node): node is AnyRecord => node.type === 'zone' && node.parentId === levelId)
      .map((node) => ZoneNode.parse(node))
    const changedWalls = [...Object.values(beforeGraph.nodes), ...afterWalls].filter((node) => {
      if (node.type !== 'wall' || node.parentId !== levelId) return false
      const before = beforeGraph.nodes[node.id]
      const after = expectedNodes[node.id]
      return !before || !after || wallGeometrySignature(before) !== wallGeometrySignature(after)
    })
    const zonePlan = planAutoZonesForLevel(nextDetection.spaces, existingZones as any, {
      previousSpaces,
      changedWalls: changedWalls as any,
    })
    for (const update of zonePlan.update) {
      reactiveZoneUpdateIds.push(update.id)
      applyUpdate(expectedNodes, update.id, update.data as AnyRecord)
    }
  }

  return { expectedNodes, updates, reactiveZoneUpdateIds, surfaceResults }
}

function compare(
  expected: unknown,
  actual: unknown,
  path: string,
  diffs: Diff[],
  tolerance: number,
): number {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const delta = Math.abs(actual - expected)
    if (delta > tolerance && diffs.length < 50) {
      diffs.push({ path, expected, actual, delta })
    }
    return delta
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    if (expected !== actual && diffs.length < 50) diffs.push({ path, expected, actual })
    return 0
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      if (diffs.length < 50) diffs.push({ path, expected, actual })
      return 0
    }
    let maxDelta = 0
    if (expected.length !== actual.length && diffs.length < 50) {
      diffs.push({ path: `${path}.length`, expected: expected.length, actual: actual.length })
    }
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      maxDelta = Math.max(
        maxDelta,
        compare(expected[index], actual[index], `${path}[${index}]`, diffs, tolerance),
      )
    }
    return maxDelta
  }
  const expectedRecord = expected as AnyRecord
  const actualRecord = actual as AnyRecord
  const keys = new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])
  let maxDelta = 0
  for (const key of keys) {
    if (!(key in expectedRecord) || !(key in actualRecord)) {
      if (diffs.length < 50) {
        diffs.push({ path: `${path}.${key}`, expected: expectedRecord[key], actual: actualRecord[key] })
      }
      continue
    }
    maxDelta = Math.max(
      maxDelta,
      compare(expectedRecord[key], actualRecord[key], `${path}.${key}`, diffs, tolerance),
    )
  }
  return maxDelta
}

function compareGraphs(expected: Graph, actual: Graph, tolerance: number) {
  const diffs: Diff[] = []
  const maxNumericDelta = compare(expected, actual, 'graph', diffs, tolerance)
  return { diffs, maxNumericDelta }
}

function exactNodeUnchanged(before: AnyRecord, after: AnyRecord, id: string): boolean {
  const diffs: Diff[] = []
  compare(before.nodes[id], after.nodes[id], `graph.nodes.${id}`, diffs, 0)
  return diffs.length === 0
}

function wallGeometryUnchanged(before: AnyRecord, after: AnyRecord, id: string): boolean {
  const beforeWall = before.nodes[id]
  const afterWall = after.nodes[id]
  if (beforeWall?.type !== 'wall' || afterWall?.type !== 'wall') return false
  const diffs: Diff[] = []
  compare(
    {
      start: beforeWall.start,
      end: beforeWall.end,
      curveOffset: beforeWall.curveOffset ?? 0,
    },
    {
      start: afterWall.start,
      end: afterWall.end,
      curveOffset: afterWall.curveOffset ?? 0,
    },
    `graph.nodes.${id}.geometry`,
    diffs,
    0,
  )
  return diffs.length === 0
}

try {
  const before = readScene(beforePath)
  const after = readScene(afterPath)
  const undo = readScene(undoPath)
  const planned = applyWallUpdatesAndReactiveState(before.graph, after.graph)
  const expectedGraph: Graph = { ...before.graph, nodes: planned.expectedNodes }

  const afterResult = compareGraphs(expectedGraph, after.graph, numericTolerance)
  const undoResult = compareGraphs(before.graph, undo.graph, 0)
  const referenceUnchanged = exactNodeUnchanged(before.graph, after.graph, referenceWallId)
  // Space detection may derive frontSide/backSide on this untouched wall. The
  // acceptance invariant for the fixed branch is its wall geometry.
  const fixedCornerGeometryUnchanged = wallGeometryUnchanged(
    before.graph,
    after.graph,
    fixedCornerWallId,
  )
  const linkedBefore = before.graph.nodes[linkedWallId]
  const linkedAfter = after.graph.nodes[linkedWallId]
  const linkedEndpointExpected =
    planned.expectedNodes[linkedWallId]?.type === 'wall'
      ? planned.expectedNodes[linkedWallId].start
      : undefined
  const linkedEndpointActual = linkedAfter?.type === 'wall' ? linkedAfter.start : undefined
  const linkedEndpointDelta =
    linkedEndpointExpected && linkedEndpointActual
      ? Math.max(
          Math.abs(linkedEndpointExpected[0] - linkedEndpointActual[0]),
          Math.abs(linkedEndpointExpected[1] - linkedEndpointActual[1]),
        )
      : Number.POSITIVE_INFINITY
  const passed =
    afterResult.diffs.length === 0 &&
    undoResult.diffs.length === 0 &&
    referenceUnchanged &&
    fixedCornerGeometryUnchanged &&
    linkedEndpointDelta <= numericTolerance &&
    Boolean(linkedBefore && linkedAfter)

  const result = {
    status: passed ? 'PASS' : 'FAIL',
    selectedWallId,
    updateCount: planned.updates.length,
    updateIds: planned.updates.map((update) => update.id),
    reactiveZoneUpdateCount: planned.reactiveZoneUpdateIds.length,
    reactiveZoneUpdateIds: [...new Set(planned.reactiveZoneUpdateIds)].sort(),
    surfaceResults: planned.surfaceResults,
    maxNumericDelta: afterResult.maxNumericDelta,
    undoExact: undoResult.diffs.length === 0,
    referenceUnchanged,
    fixedCornerGeometryUnchanged,
    linkedEndpointDelta,
    afterDiffCount: afterResult.diffs.length,
    undoDiffCount: undoResult.diffs.length,
    diffs: [...afterResult.diffs, ...undoResult.diffs].slice(0, 20),
  }
  console.log(JSON.stringify(result))
  if (!passed) process.exitCode = 1
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
