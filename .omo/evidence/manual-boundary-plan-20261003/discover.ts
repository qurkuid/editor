import { diagnoseRoomBoundaries, buildRoomBoundaryRepairUpdates } from '../../../packages/core/src/lib/room-boundary'
import { buildWallEndpointUpdates } from '../../../packages/core/src/lib/wall-operations'
import { readFileSync, writeFileSync } from 'node:fs'
const graph = JSON.parse(readFileSync('.omo/evidence/boundary-marker-focus-20261003/fixed-scene-baseline.json','utf8')).graph
const nodes=graph.nodes
const a=nodes.wall_ggf99ydyqrsc817f, b=nodes.wall_m5sb1yvia8zx4239
const walls=Object.values(nodes).filter((n:any)=>n.type==='wall'&&n.parentId===a.parentId)
const d=diagnoseRoomBoundaries(a.parentId,walls as any)
const issue=d.issues.find(i=>i.wallId===a.id&&i.endpoint==='end')!
const p=[b.end[0],a.end[1]] as [number,number]
const snapshot={...nodes}, updates=[]
for(const id of [a.id,b.id]){
 const w=snapshot[id]
 for(const u of buildWallEndpointUpdates(snapshot,id,w.start,p)){
  snapshot[u.id]={...snapshot[u.id],...u.data};updates.push(u)
 }
}
const out={issue,autoPlan:buildRoomBoundaryRepairUpdates(nodes,a.parentId,issue.id),intersection:p,extensionLengths:[p[0]-a.end[0],b.end[1]-p[1]],validatedTwoEndpointUpdates:updates,sourceUnchanged:JSON.stringify(nodes)===JSON.stringify(graph.nodes)}
writeFileSync('.omo/evidence/manual-boundary-plan-20261003/discovery.json',JSON.stringify(out,null,2))
console.log(JSON.stringify({issueId:issue.id,autoOk:out.autoPlan.ok,autoReason:out.autoPlan.reason,candidateCount:issue.candidates.length,sameIntersectionTargets:issue.candidates.filter(c=>Math.hypot(c.targetPoint[0]-p[0],c.targetPoint[1]-p[1])<1e-6).map(c=>c.targetWallId),intersection:p,extensionLengths:out.extensionLengths,validatedUpdateIds:updates.map(u=>u.id)},null,2))
