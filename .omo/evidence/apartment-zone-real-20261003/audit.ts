import { buildVectorNodes } from '../../../apps/editor/lib/apt-vector-scene'
import { diagnoseRoomBoundaries, buildRoomBoundaryRepairUpdates } from '../../../packages/core/src/lib/room-boundary'
import { planAutoZonesForLevel } from '../../../packages/core/src/lib/space-detection'
const root = '.omo/evidence/apartment-zone-real-20261003'
const cases = await Bun.file(`${root}/cases.json`).json()
const results = []
for (const item of cases) {
  const response = await Bun.file(`${root}/${item.key}/vector-api.json`).json()
  const built = buildVectorNodes(response.data)
  if (!built) throw new Error(`import rejected ${item.key}`)
  const levelId = `level_real_${item.key}`
  const walls = built.walls.map(wall => ({ ...wall, parentId: levelId, metadata: { ...wall.metadata, apartmentId: item.apartmentId, planId: item.planId } }))
  const zones = built.zones.map(zone => ({ ...zone, parentId: levelId }))
  const nodes = Object.fromEntries([...walls, ...built.openings, ...zones].map(node => [node.id, node]))
  const start = performance.now()
  const diagnostics = diagnoseRoomBoundaries(levelId, walls, zones)
  const repairPlans = diagnostics.issues.map(issue => ({ issue, plan: buildRoomBoundaryRepairUpdates(nodes, levelId, issue.id, diagnostics) }))
  const zonePlan = planAutoZonesForLevel(diagnostics.spaces, zones, { createMissingZones: true })
  const audit = {
    ...item, sceneId: undefined, docVersion: response.data.docVersion,
    raw: { walls: response.data.walls.length, rooms: response.data.rooms.length, openings: response.data.openings.length },
    imported: { walls: walls.length, zones: zones.length, openings: built.openings.length },
    closedSpaces: diagnostics.spaces.length,
    enclosedZones: zones.filter(zone => zone.enclosureStatus === 'enclosed').length,
    reviewZones: zones.filter(zone => zone.metadata.boundaryNeedsReview).map(zone => ({ name: zone.name, sourceRoomId: zone.metadata.sourceRoomId, polygon: zone.polygon })),
    missingZoneCreates: zonePlan.create.length,
    danglingEndpoints: diagnostics.danglingEndpoints.length,
    safeRepairs: repairPlans.filter(({ plan }) => plan.ok).map(({ issue, plan }) => ({ issueId: issue.id, point: issue.point, candidates: plan.candidates ?? [plan.candidate], updates: plan.updates, beforeSpaces: plan.beforeSpaceCount, afterSpaces: plan.afterSpaceCount })),
    manual: repairPlans.filter(({ plan }) => !plan.ok).map(({ issue, plan }) => ({ issueId: issue.id, point: issue.point, reason: plan.reason, nearest: issue.candidates[0] })),
    importDiagnostics: built.diagnostics, elapsedMs: +(performance.now() - start).toFixed(1),
  }
  await Bun.write(`${root}/${item.key}/imported.json`, JSON.stringify(built, null, 2))
  await Bun.write(`${root}/${item.key}/audit.json`, JSON.stringify(audit, null, 2))
  results.push(audit)
  console.log(JSON.stringify({ name: item.name, type: item.type, walls: walls.length, zones: zones.length, closedSpaces: audit.closedSpaces, enclosedZones: audit.enclosedZones, reviewZones: audit.reviewZones.length, dangling: audit.danglingEndpoints, safeRepairs: audit.safeRepairs.length, missing: audit.missingZoneCreates, elapsedMs: audit.elapsedMs }))
}
await Bun.write(`${root}/audit.json`, JSON.stringify(results, null, 2))
