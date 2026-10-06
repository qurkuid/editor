import { WallNode, LevelNode, DoorNode } from '../../../packages/core/src/schema'
import { buildManualRoomBoundaryRepair as repair, roomBoundarySnapshot, buildRoomBoundaryOpenReviewUpdate, isRoomBoundaryReviewedOpen } from '../../../packages/core/src/lib/room-boundary'
import { writeFileSync } from 'node:fs'
const level=LevelNode.parse({id:'level_review'})
const wall=(id:string,start:[number,number],end:[number,number])=>WallNode.parse({id,parentId:level.id,start,end})
const scene=(...walls:any[])=>Object.fromEntries([level,...walls].map(n=>[n.id,n]))
const a=wall('wall_a',[0,0],[1,0]), b=wall('wall_b',[3,-1],[3,1]), overlap=wall('wall_overlap',[1.5,0],[2.5,0])
const input={levelId:level.id,wallId:a.id,endpoint:'end' as const,targetWallId:b.id}
const records:any[]=[]
const probe=(name:string,nodes:any,i:any=input)=>{
 const before=JSON.stringify(nodes);const p=repair(nodes,i)
 records.push({name,ok:p.ok,reason:p.reason,updates:p.updates,unchanged:before===JSON.stringify(nodes)});return p
}
probe('new_collinear_overlap',scene(a,b,overlap))
probe('preserve_existing_T',scene(wall(a.id,[0,0],[4,0]),wall(b.id,[2,-1],[2,1]),wall('wall_T',[3,0],[3,2])))
probe('collinear_valid',scene(a,wall(b.id,[2,0],[4,0])))
probe('collinear_target_overlap_reject',scene(a,wall(b.id,[2,0],[4,0])),{...input,targetEndpoint:'end'})
probe('parallel_reject',scene(a,wall(b.id,[2,1],[4,1])))
const hosted=DoorNode.parse({id:'door_review',parentId:b.id,wallId:b.id,width:.6,position:[.8,1,0]})
const hs=scene(wall(a.id,[0,0],[1.8,0]),wall(b.id,[2,.2],[2,2]),hosted)
probe('hosted_start_rebase',hs)
const ss=roomBoundarySnapshot(hs,level.id);hs[hosted.id]={...hosted,width:.7};probe('stale_child_width',hs,{...input,expectedSnapshot:ss})
const signed={...a,...buildRoomBoundaryOpenReviewUpdate(a,'end',true).data} as any
records.push({name:'intent_open',marked:isRoomBoundaryReviewedOpen(signed,'end'),reloaded:isRoomBoundaryReviewedOpen(JSON.parse(JSON.stringify(signed)),'end'),changed:isRoomBoundaryReviewedOpen({...signed,end:[1.0001,0]},'end')})
writeFileSync('.omo/evidence/manual-boundary-repair-20261003/core-review-probes.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2))
