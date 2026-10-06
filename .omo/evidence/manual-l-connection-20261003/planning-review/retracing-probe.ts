import { WallNode, LevelNode } from '/Users/changseok/editor/packages/core/src/schema'
import { buildManualRoomBoundaryRepair } from '/Users/changseok/editor/packages/core/src/lib/room-boundary'
import { getWallPlanFootprint } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-footprint'
import { calculateLevelMiters } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-mitering'
import { pointInPolygon } from '/Users/changseok/editor/packages/core/src/lib/polygon-relations'
const level=LevelNode.parse({id:'level_probe'})
const source=WallNode.parse({id:'wall_source',parentId:level.id,start:[0,0],end:[1,.001],thickness:.1})
const target=WallNode.parse({id:'wall_target',parentId:level.id,start:[-1,2],end:[-2,2],thickness:.1})
const nodes=Object.fromEntries([level,source,target].map(w=>[w.id,w]))
const plan=buildManualRoomBoundaryRepair(nodes,{levelId:level.id,wallId:source.id,endpoint:'end',targetWallId:target.id,targetEndpoint:'start',mode:'l-corner',createdWallIds:['wall_probe1','wall_probe2']})
const walls=[source,target,...plan.creates],m=calculateLevelMiters(walls)
const polygons=walls.map(w=>getWallPlanFootprint(w,m).map(p=>[p.x,p.y] as [number,number]))
console.log(JSON.stringify({ok:plan.ok,reason:plan.reason,source:{start:source.start,end:source.end},created:plan.creates.map(w=>({start:w.start,end:w.end})),witness:{point:[.5,.01],insideSource:pointInPolygon([.5,.01],polygons[0],{includeBoundary:false}),insideFirst:polygons[2]?pointInPolygon([.5,.01],polygons[2],{includeBoundary:false}):false}},null,2))
