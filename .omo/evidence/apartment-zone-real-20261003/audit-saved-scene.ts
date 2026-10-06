import { diagnoseRoomBoundaries, buildRoomBoundaryRepairUpdates } from '../../../packages/core/src/lib/room-boundary'
import { planAutoZonesForLevel } from '../../../packages/core/src/lib/space-detection'
import { strict as assert } from 'node:assert'
const root = '.omo/evidence/apartment-zone-real-20261003'
const scene = await Bun.file(`${root}/parent-current-scene.json`).json()
const nodes = scene.graph.nodes
const all = Object.values(nodes) as any[]
const level = all.find(node => node.type === 'level')
const walls = all.filter(node => node.type === 'wall')
const zones = all.filter(node => node.type === 'zone')
const diagnostics = diagnoseRoomBoundaries(level.id, walls, zones)
const source = await Bun.file(`${root}/hwmyeong/imported.json`).json()
const originalWindow = source.openings.find((opening: any) => opening.metadata.sourceOpeningId === 'o12')
const originalWall = source.walls.find((wall: any) => wall.id === originalWindow.wallId)
const savedWindow = nodes.window_ugdq9djrw5cwss1n
const savedWall = nodes[savedWindow.wallId]
const worldPosition = (wall: any, opening: any) => {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const dx = (wall.end[0] - wall.start[0]) / length
  const dz = (wall.end[1] - wall.start[1]) / length
  return [wall.start[0] + dx * opening.position[0] - dz * opening.position[2], opening.position[1], wall.start[1] + dz * opening.position[0] + dx * opening.position[2]]
}
assert.deepEqual(worldPosition(savedWall, savedWindow), worldPosition(originalWall, originalWindow))
assert.ok(Math.abs(savedWindow.width - originalWindow.width) < 1e-9)
assert.equal(savedWindow.parentId, savedWall.id)
assert.ok(savedWall.children.includes(savedWindow.id))
const result = {
  sceneId: scene.id, sceneVersion: scene.version,
  counts: all.reduce((counts, node) => ({ ...counts, [node.type]: (counts[node.type] ?? 0) + 1 }), {}),
  closedSpaces: diagnostics.spaces.length,
  enclosedZones: zones.filter(zone => zone.enclosureStatus === 'enclosed').length,
  reviewZones: zones.filter(zone => zone.metadata.boundaryNeedsReview).map(zone => ({ id: zone.id, name: zone.name, sourceRoomId: zone.metadata.sourceRoomId })),
  issues: diagnostics.issues.length,
  safeRepairs: diagnostics.issues.filter(issue => buildRoomBoundaryRepairUpdates(nodes, level.id, issue.id, diagnostics).ok).length,
  missingZones: planAutoZonesForLevel(diagnostics.spaces, zones, { createMissingZones: true }).create.length,
  repairedEnd: nodes.wall_ushm2vi3uhnwnt2d.end,
  window: nodes.window_ugdq9djrw5cwss1n,
  hostedWindowWorldPosition: worldPosition(savedWall, savedWindow),
  hostedWindowPreserved: true,
}
assert.equal(result.closedSpaces, 8)
assert.equal(result.enclosedZones, 5)
assert.equal(result.reviewZones.length, 9)
assert.equal(result.counts.wall, 61)
assert.equal(result.counts.door + result.counts.window, 21)
assert.equal(result.counts.zone, 14)
assert.equal(result.issues, 8)
assert.equal(result.safeRepairs, 0)
assert.equal(result.missingZones, 0)
await Bun.write(`${root}/saved-scene-audit.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
