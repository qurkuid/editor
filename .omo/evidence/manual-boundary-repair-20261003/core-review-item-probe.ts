import {WallNode,ItemNode,LevelNode} from '../../../packages/core/src/schema'
import {buildManualRoomBoundaryRepair} from '../../../packages/core/src/lib/room-boundary'
import {writeFileSync} from 'node:fs'
const l=LevelNode.parse({id:'level_review'})
const w=(id:string,start:[number,number],end:[number,number])=>WallNode.parse({id,parentId:l.id,start,end})
const a=w('wall_a',[0,0],[1.8,0]),b=w('wall_b',[2,.2],[2,2]),c=w('wall_c',[2,.2],[3,.2])
const i=ItemNode.parse({id:'item_review',parentId:c.id,wallId:c.id,wallT:.35,position:[.35,1,0],rotation:[0,0,0],asset:{id:'cabinet',name:'Cabinet',category:'cabinet',thumbnail:'',src:'https://example.com/item.glb',dimensions:[.6,1,2],attachTo:'wall'}})
c.children=[i.id]
const ns=Object.fromEntries([l,a,b,c,i].map(n=>[n.id,n]))
const p=buildManualRoomBoundaryRepair(ns,{levelId:l.id,wallId:a.id,endpoint:'end',targetWallId:b.id})
const final={...ns};for(const u of p.updates)final[u.id]={...final[u.id],...u.data} as any
const fc=final[c.id] as typeof c,fi=final[i.id] as typeof i
const yaw=Math.atan2(fc.end[1]-fc.start[1],fc.end[0]-fc.start[0]);const half=(.6*Math.abs(Math.cos(yaw))+2*Math.abs(Math.sin(yaw)))/2
const out={ok:p.ok,reason:p.reason,updates:p.updates,finalHostLength:Math.hypot(fc.end[0]-fc.start[0],fc.end[1]-fc.start[1]),actualFootprintMin:fi.position[0]-half,actualFootprintMax:fi.position[0]+half}
writeFileSync('.omo/evidence/manual-boundary-repair-20261003/core-review-item-probe.json',JSON.stringify(out,null,2));console.log(out)
