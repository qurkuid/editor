import {readFileSync,writeFileSync} from 'node:fs'
import {buildVectorNodes} from '../../../apps/editor/lib/apt-vector-scene'
import {detectSpacesForLevel} from '../../../packages/core/src/lib/space-detection'
const doc=JSON.parse(readFileSync(process.argv[2]!, 'utf8')).data
const built=buildVectorNodes(doc)!
const graph=Object.fromEntries([...built.walls,...built.openings,...built.zones].map(n=>[n.id,n]))
const rooms=detectSpacesForLevel('apt-vector-import',built.walls).spaces
const auto=built.zones.filter(z=>z.autoFromWalls)
let maxError=0
for(const z of auto){
 const room=rooms.find(r=>r.wallIds.length===z.boundaryWallIds.length&&r.wallIds.every(id=>z.boundaryWallIds.includes(id)))
 if(!room) throw new Error('Auto zone lacks matching final walls')
 for(const p of z.polygon) maxError=Math.max(maxError,Math.min(...room.polygon.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1]))))
}
if(maxError>1e-7)throw new Error('Zone diverged')
const summary={walls:built.walls.length,openings:built.openings.length,zones:built.zones.length,autoZones:auto.length,zoneVertexMaxError:maxError,shortWalls:built.walls.filter(w=>Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1])<.12).length,diagnostics:built.diagnostics}
writeFileSync(process.argv[3]!,JSON.stringify({summary,graph},null,2)); console.log(JSON.stringify(summary))
