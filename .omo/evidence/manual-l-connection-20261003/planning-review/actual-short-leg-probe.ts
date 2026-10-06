import fs from 'node:fs'
import { WallNode } from '/Users/changseok/editor/packages/core/src/schema'
import { buildManualRoomBoundaryRepair } from '/Users/changseok/editor/packages/core/src/lib/room-boundary'
import { getWallPlanFootprint } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-footprint'
import { calculateLevelMiters } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-mitering'
import { pointInPolygon } from '/Users/changseok/editor/packages/core/src/lib/polygon-relations'
const nodes=JSON.parse(fs.readFileSync('.omo/evidence/manual-boundary-repair-20261003/stable-before.json','utf8')).graph.nodes
const source=nodes.wall_ggf99ydyqrsc817f,target=nodes.wall_m5sb1yvia8zx4239
const input={levelId:source.parentId,wallId:source.id,endpoint:'end' as const,targetWallId:target.id,targetEndpoint:'end' as const,mode:'l-corner' as const,createdWallIds:['wall_probe1','wall_probe2'] as const}
for(const bendOrder of ['horizontal-vertical','vertical-horizontal'] as const){
 const a=source.end,b=target.end,c=bendOrder==='horizontal-vertical'?[b[0],a[1]]:[a[0],b[1]]
 const news=[WallNode.parse({...source,id:'wall_probe1',children:[],start:a,end:c}),WallNode.parse({...source,id:'wall_probe2',children:[],start:c,end:b})]
 const walls=Object.values(nodes).filter((n:any)=>n.type==='wall'&&n.parentId===source.parentId).concat(news) as any[]
 const miters=calculateLevelMiters(walls)
 const fp=[source,target,...news].map(w=>({id:w.id,polygon:getWallPlanFootprint(w,miters).map(p=>[p.x,p.y] as [number,number])}))
 const witnesses=[]
 for(let x=Math.min(a[0],b[0])-.1;x<=Math.max(a[0],b[0])+.1;x+=.005)for(let y=Math.min(a[1],b[1])-.1;y<=Math.max(a[1],b[1])+.1;y+=.005){
  for(let k=2;k<4;k++) for(let j=0;j<2;j++)if(pointInPolygon([x,y],fp[k].polygon,{includeBoundary:false})&&pointInPolygon([x,y],fp[j].polygon,{includeBoundary:false})&&!witnesses.some(w=>w.new===k&&w.old===j)) witnesses.push({new:k,old:j,point:[x,y]})
 }
 const p=buildManualRoomBoundaryRepair(nodes,{...input,bendOrder})
 console.log(JSON.stringify({bendOrder,plan:{ok:p.ok,reason:p.reason},footprints:fp,positiveInteriorOverlapWitnesses:witnesses},null,2))
}
