import {WallNode,LevelNode} from '../../../packages/core/src/schema'
import {buildManualRoomBoundaryRepair} from '../../../packages/core/src/lib/room-boundary'
import {writeFileSync} from 'node:fs'
const l=LevelNode.parse({id:'level_overlap_review'})
const w=(id:string,start:[number,number],end:[number,number])=>WallNode.parse({id,parentId:l.id,start,end})
const a=w('wall_source',[0,0],[1,0])
const cases=[
 {name:'unrelated_existing_overlap',walls:[w('wall_target',[3,-1],[3,1]),w('wall_far_a',[10,10],[12,10]),w('wall_far_b',[11,10],[13,10])],expected:true},
 {name:'changed_wall_unchanged_existing_overlap',walls:[w('wall_target',[3,-1],[3,1]),w('wall_existing',[.2,0],[.8,0])],expected:true},
 {name:'changed_wall_increased_existing_overlap',walls:[w('wall_target',[1.8,-1],[1.8,1]),w('wall_existing',[.5,0],[2,0])],expected:false},
]
const results=cases.map(c=>{
 const nodes=Object.fromEntries([l,a,...c.walls].map(n=>[n.id,n]));const before=JSON.stringify(nodes)
 const p=buildManualRoomBoundaryRepair(nodes,{levelId:l.id,wallId:a.id,endpoint:'end',targetWallId:'wall_target'})
 const result={name:c.name,expected:c.expected,ok:p.ok,reason:p.reason,updates:p.updates,unchanged:JSON.stringify(nodes)===before,pass:p.ok===c.expected&&JSON.stringify(nodes)===before}
 if(!result.pass)process.exitCode=1
 return result
})
writeFileSync('.omo/evidence/manual-boundary-repair-20261003/core-review-overlap-recheck.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
