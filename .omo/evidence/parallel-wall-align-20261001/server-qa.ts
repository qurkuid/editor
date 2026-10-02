import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { homedir } from 'node:os'

const [mode, commit] = process.argv.slice(2)
if (!['capture', 'apply', 'undo'].includes(mode ?? '')) {
  throw new Error('Usage: bun server-qa.ts <capture|apply|undo> <40-char-commit>')
}
if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source commit')

const sceneId = '8552ea8b9254'
const selectedWallId = 'wall_ev1580n36u0mzfek'
const referenceWallId = 'wall_9d671l2wsc0l2z0i'
const linkedWallId = 'wall_gga4jfp1oa10dy2g'
let levelId = 'level_aw8kqyoj7ugmgm9t'
const release = `/Volumes/DATABASE/floorplan-releases/20261001-${commit.slice(0, 8)}`
const backupDirectory = `/Volumes/DATABASE/floorplan-deploy-backups/20261001-${commit.slice(0, 8)}`
const backupPath = `${backupDirectory}/parallel-wall-qa.json`

const core = await import(`${release}/packages/core/dist/index.js`)
const {
  CeilingNode,
  SlabNode,
  buildWallParallelAlignmentUpdates,
  detectSpacesForLevel,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
} = core as Record<string, any>

const db = new Database(`${homedir()}/.pascal/data/pascal.db`, { readonly: true })
const row = db
  .query('SELECT version,graph_json FROM scenes WHERE id=?')
  .get(sceneId) as { version: number; graph_json: string } | null
if (!row) throw new Error(`QA scene missing: ${sceneId}`)
const raw = row.graph_json.startsWith('gzip:')
  ? gunzipSync(Buffer.from(row.graph_json.slice(5), 'base64')).toString()
  : row.graph_json
const graph = JSON.parse(raw) as { nodes: Record<string, any>; [key: string]: any }
if (!graph.nodes || typeof graph.nodes !== 'object') throw new Error('QA graph missing nodes')

function counts(nodes: Record<string, any>) {
  const values = Object.values(nodes)
  return {
    nodes: values.length,
    walls: values.filter((node) => node.type === 'wall').length,
    zones: values.filter((node) => node.type === 'zone').length,
    slabs: values.filter((node) => node.type === 'slab').length,
    ceilings: values.filter((node) => node.type === 'ceiling').length,
  }
}

function wallGeometrySignature(wall: any): string {
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

function applyUpdate(nodes: Record<string, any>, id: string, data: Record<string, any>) {
  if (!nodes[id]) throw new Error(`Update references missing node: ${id}`)
  nodes[id] = { ...nodes[id], ...data }
}

function removeFromParentChildren(nodes: Record<string, any>, id: string) {
  const node = nodes[id]
  const parent = node?.parentId ? nodes[node.parentId] : undefined
  if (Array.isArray(parent?.children)) {
    parent.children = parent.children.filter((childId: string) => childId !== id)
  }
}

function applySurfacePlan(
  expectedNodes: Record<string, any>,
  beforeNodes: Record<string, any>,
  actualNodes: Record<string, any>,
  roomPolygons: Array<[number, number][]>,
  type: 'slab' | 'ceiling',
) {
  const existing = Object.values(expectedNodes).filter(
    (node: any) => node.type === type && node.parentId === levelId,
  )
  const plan =
    type === 'slab'
      ? planAutoSlabsForLevel(roomPolygons, existing.map((node) => SlabNode.parse(node)))
      : planAutoCeilingsForLevel(roomPolygons, existing.map((node) => CeilingNode.parse(node)), {
          storeyHeight: Number(expectedNodes[levelId]?.height ?? 2.5),
        })

  for (const id of plan.delete) {
    removeFromParentChildren(expectedNodes, id)
    delete expectedNodes[id]
  }
  for (const update of plan.update) applyUpdate(expectedNodes, update.id, update.data)

  const actualCreated = Object.values(actualNodes).filter(
    (node: any) => node.type === type && node.parentId === levelId && !beforeNodes[node.id],
  )
  if (actualCreated.length !== plan.create.length) {
    throw new Error(`${type} create count mismatch`)
  }
  const actualByName = new Map(actualCreated.map((node: any) => [node.name, node]))
  const createdIds: string[] = []
  for (const planned of plan.create) {
    const actual = actualByName.get(planned.name)
    if (!actual) throw new Error(`${type} create missing: ${planned.name}`)
    expectedNodes[actual.id] = { ...planned, id: actual.id, parentId: levelId }
    createdIds.push(actual.id)
  }

  const expectedLevel = expectedNodes[levelId]
  const actualLevel = actualNodes[levelId]
  if (Array.isArray(expectedLevel?.children) && Array.isArray(actualLevel?.children)) {
    const created = new Set(createdIds)
    expectedLevel.children.push(...actualLevel.children.filter((id: string) => created.has(id)))
  }

  return { created: plan.create.length, updated: plan.update.length, deleted: plan.delete.length }
}

function expectedAppliedGraph(beforeGraph: Record<string, any>, actualGraph: Record<string, any>) {
  const expectedNodes = structuredClone(beforeGraph.nodes) as Record<string, any>
  const updates = buildWallParallelAlignmentUpdates(expectedNodes, selectedWallId)
  for (const update of updates) applyUpdate(expectedNodes, update.id, update.data)

  const selected = expectedNodes[selectedWallId]
  if (!selected?.parentId) throw new Error('Selected wall parent missing')
  const changedLevelIds = new Set<string>()
  for (const update of updates) {
    const before = beforeGraph.nodes[update.id]
    const after = expectedNodes[update.id]
    if (
      before?.type === 'wall' &&
      after?.type === 'wall' &&
      before.parentId &&
      wallGeometrySignature(before) !== wallGeometrySignature(after)
    ) {
      changedLevelIds.add(before.parentId)
    }
  }

  let zoneUpdates = 0
  let surfaceCreates = 0
  for (const changedLevelId of changedLevelIds) {
    const beforeWalls = Object.values(beforeGraph.nodes).filter(
      (node: any) => node.type === 'wall' && node.parentId === changedLevelId,
    )
    const afterWalls = Object.values(expectedNodes).filter(
      (node: any) => node.type === 'wall' && node.parentId === changedLevelId,
    )
    const previousSpaces = detectSpacesForLevel(changedLevelId, beforeWalls).spaces
    const nextDetection = detectSpacesForLevel(changedLevelId, afterWalls)
    for (const sideUpdate of nextDetection.wallUpdates) {
      const wall = expectedNodes[sideUpdate.wallId]
      if (!wall || wall.type !== 'wall') continue
      applyUpdate(expectedNodes, sideUpdate.wallId, {
        frontSide: sideUpdate.frontSide,
        backSide: sideUpdate.backSide,
      })
    }

    const slabResult = applySurfacePlan(
      expectedNodes,
      beforeGraph.nodes,
      actualGraph.nodes,
      nextDetection.roomPolygons,
      'slab',
    )
    const ceilingResult = applySurfacePlan(
      expectedNodes,
      beforeGraph.nodes,
      actualGraph.nodes,
      nextDetection.roomPolygons,
      'ceiling',
    )
    surfaceCreates += slabResult.created + ceilingResult.created

    const existingZones = Object.values(expectedNodes).filter(
      (node: any) => node.type === 'zone' && node.parentId === changedLevelId,
    )
    const changedWalls = [...Object.values(beforeGraph.nodes), ...afterWalls].filter((node: any) => {
      if (node.type !== 'wall' || node.parentId !== changedLevelId) return false
      const before = beforeGraph.nodes[node.id]
      const after = expectedNodes[node.id]
      return !before || !after || wallGeometrySignature(before) !== wallGeometrySignature(after)
    })
    const zonePlan = planAutoZonesForLevel(nextDetection.spaces, existingZones, {
      previousSpaces,
      changedWalls,
    })
    for (const update of zonePlan.update) {
      zoneUpdates += 1
      applyUpdate(expectedNodes, update.id, update.data)
    }
  }

  return {
    graph: { ...beforeGraph, nodes: expectedNodes },
    updates: updates.length,
    zoneUpdates,
    surfaceCreates,
  }
}

function assertGraph(actual: any, expected: any, tolerance: number) {
  let maxNumericDelta = 0
  const visit = (left: any, right: any, path: string) => {
    if (typeof left === 'number' && typeof right === 'number') {
      const delta = Math.abs(left - right)
      maxNumericDelta = Math.max(maxNumericDelta, delta)
      if (delta > tolerance) throw new Error(`numeric mismatch at ${path}`)
      return
    }
    if (left === right) return
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      throw new Error(`value mismatch at ${path}`)
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        throw new Error(`array mismatch at ${path}`)
      }
      left.forEach((value, index) => visit(value, right[index], `${path}[${index}]`))
      return
    }
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
      throw new Error(`keys mismatch at ${path}`)
    }
    for (const key of leftKeys) visit(left[key], right[key], `${path}.${key}`)
  }
  visit(actual, expected, 'graph')
  return maxNumericDelta
}

function output(status: 'PASS' | 'FAIL', extra: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      status,
      mode,
      sceneId,
      commit: commit!.slice(0, 8),
      linkedWallPresent: Boolean(graph.nodes[linkedWallId]),
      ...extra,
    }),
  )
}

try {
  if (mode === 'capture') {
    if (!graph.nodes[selectedWallId]) throw new Error('Selected wall missing')
    if (!graph.nodes[referenceWallId]) throw new Error('Reference wall missing')
    if (!graph.nodes[selectedWallId].parentId) throw new Error('Selected wall level missing')
    levelId = graph.nodes[selectedWallId].parentId
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(
      backupPath,
      JSON.stringify({ sceneId, sourceCommit: commit, version: row.version, graph, selectedWallId }),
      { mode: 0o600 },
    )
    chmodSync(backupPath, 0o600)
    output('PASS', { version: row.version, ...counts(graph.nodes) })
  } else {
    const before = JSON.parse(readFileSync(backupPath, 'utf8')) as {
      graph: Record<string, any>
      selectedWallId: string
    }
    if (before.selectedWallId !== selectedWallId) throw new Error('Backup selected wall mismatch')
    if (!before.graph.nodes[selectedWallId]?.parentId) throw new Error('Backup wall level missing')
    levelId = before.graph.nodes[selectedWallId].parentId
    const beforeCounts = counts(before.graph.nodes)
    const currentCounts = counts(graph.nodes)
    if (mode === 'undo') {
      const maxNumericDelta = assertGraph(graph, before.graph, 0)
      output('PASS', {
        version: row.version,
        ...currentCounts,
        expectedNodes: beforeCounts.nodes,
        updates: 0,
        maxNumericDelta,
      })
    } else {
      const expected = expectedAppliedGraph(before.graph, graph)
      const maxNumericDelta = assertGraph(graph, expected.graph, 1e-10)
      output('PASS', {
        version: row.version,
        ...currentCounts,
        expectedNodes: counts(expected.graph.nodes).nodes,
        updates: expected.updates,
        zoneUpdates: expected.zoneUpdates,
        surfaceCreates: expected.surfaceCreates,
        maxNumericDelta,
      })
    }
  }
} catch (error) {
  output('FAIL', {
    error: error instanceof Error ? error.message : String(error),
    ...counts(graph.nodes),
  })
  process.exitCode = 1
} finally {
  db.close()
}
