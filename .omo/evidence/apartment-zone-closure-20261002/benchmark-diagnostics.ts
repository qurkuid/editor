import { WallNode } from '../../../packages/core/src/schema'
import { diagnoseRoomBoundaries, buildRoomBoundaryRepairUpdates } from '../../../packages/core/src/lib/room-boundary'
const results=[]
for (const rooms of [20,30]) {
  const walls=Array.from({length:rooms},(_,i)=>{
    const x=i*6
    return [[x,0,x+3.8,0],[x+4,0,x+4,3],[x+4,3,x,3],[x,3,x,0]].map((p,j)=>WallNode.parse({id:`wall_perf_${i}_${j}`,parentId:'level_perf',start:[p[0],p[1]],end:[p[2],p[3]]}))
  }).flat()
  const nodes=Object.fromEntries(walls.map(w=>[w.id,w]))
  const started=performance.now()
  const diagnostics=diagnoseRoomBoundaries('level_perf',walls)
  const diagnosed=performance.now()
  for (const issue of diagnostics.issues) buildRoomBoundaryRepairUpdates(nodes,'level_perf',issue.id,diagnostics)
  results.push({walls:walls.length,issues:diagnostics.issues.length,diagnosticsMs:+(diagnosed-started).toFixed(1),validatedPlansMs:+(performance.now()-diagnosed).toFixed(1)})
}
console.log(JSON.stringify(results,null,2))
