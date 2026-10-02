import { readFileSync } from 'node:fs'
import { detectSpacesForLevel } from '../../../packages/core/src/lib/space-detection'
const scene = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
const nodes = Object.values(scene.graph.nodes) as any[]
const zones = nodes.filter(n => n.type === 'zone' && n.autoFromWalls)
let maxError = 0
for (const zone of zones) {
  const walls = nodes.filter(n => n.type === 'wall' && n.parentId === zone.parentId)
  const spaces = detectSpacesForLevel(zone.parentId, walls).spaces
  const room = spaces.find(s => s.wallIds.length === zone.boundaryWallIds.length && s.wallIds.every(id => zone.boundaryWallIds.includes(id)))
  if (!room) throw new Error(`No enclosure for ${zone.id}`)
  for (const [a, b] of [[zone.polygon, room.polygon], [room.polygon, zone.polygon]]) {
    for (const p of a) maxError = Math.max(maxError, Math.min(...b.map((q: number[]) => Math.hypot(p[0] - q[0]!, p[1] - q[1]!))))
  }
}
if (maxError > 1e-7) throw new Error(`Zone boundary error: ${maxError}`)
console.log(JSON.stringify({autoZones: zones.length, maxVertexErrorM: maxError}))
