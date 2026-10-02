import { readFileSync } from 'node:fs'
const source = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
const graph = source.graph ?? source
const nodes = Object.values(graph.nodes) as any[]
const walls = nodes.filter((n) => n.type === 'wall')
const scale = 21.984
const toLevel = ([x,y]:number[]) => [(x-621)*scale/1000,(y-414)*scale/1000]
const targets = {
 leftBedroom: [[366.6,477.1],[481.9,361.9]],
 kitchenLiving: [[674.3,584],[674.3,463]],
 entranceDress: [[540,322.3],[587.5,321.5]],
} as const
function distance(p:number[], w:any) {
 const d=w.end.map((v:number,i:number)=>v-w.start[i]); const len2=d[0]*d[0]+d[1]*d[1]
 const t=Math.max(0,Math.min(1,((p[0]-w.start[0])*d[0]+(p[1]-w.start[1])*d[1])/len2))
 return Math.hypot(p[0]-w.start[0]-d[0]*t,p[1]-w.start[1]-d[1]*t)
}
const coverage = Object.fromEntries(Object.entries(targets).map(([name,ends])=> {
 const a=toLevel([...ends[0]]), b=toLevel([...ends[1]])
 const maxDistance=Math.max(...Array.from({length:19},(_,i)=>{
  const t=(i+1)/20;const p=a.map((v,j)=>v+(b[j]-v)*t)
  const sourceY=ends[0][1]+(ends[1][1]-ends[0][1])*t
  if(name==='kitchenLiving'&&sourceY>=500&&sourceY<=572)return 0
  return Math.min(...walls.map(w=>distance(p,w)))
 }))
 return [name,{maxDistance,covered:maxDistance<0.15}]
}))
const entrance=toLevel([591,221])
const doors=nodes.filter(n=>n.type==='door')
function openingCenter(n:any) {
 const w=walls.find(w=>w.id===n.wallId); if(!w)return false
 const d=w.end.map((v:number,i:number)=>v-w.start[i]);const len=Math.hypot(...d)
 return w.start.map((v:number,i:number)=>v+d[i]*n.position[0]/len)
}
const entranceDoors=doors.filter(n=> {
 const c=openingCenter(n)
 return c&&Math.hypot(c[0]-entrance[0],c[1]-entrance[1])<0.4
})
const bathroom=toLevel([471.8,294.4])
const bathroomDoors=doors.filter(n=> {
 const c=openingCenter(n)
 return c&&Math.hypot(c[0]-bathroom[0],c[1]-bathroom[1])<0.4
})
const kitchenGap=toLevel([674.3,536])
const kitchenOpenings=nodes.filter(n=>n.type==='door'||n.type==='window').filter(n=>{
 const c=openingCenter(n)
 return c&&n.width>0.2&&Math.hypot(c[0]-kitchenGap[0],c[1]-kitchenGap[1])<0.4
})
const kitchenGapClear=kitchenOpenings.length>0||Math.min(...walls.map(w=>distance(kitchenGap,w)))>0.15
console.log(JSON.stringify({walls:walls.length,doors:doors.length,coverage,entranceDoors:entranceDoors.map(n=>({id:n.id,width:n.width,wallId:n.wallId})),bathroomDoors:bathroomDoors.map(n=>({id:n.id,width:n.width,wallId:n.wallId})),kitchenOpenings:kitchenOpenings.map(n=>({id:n.id,type:n.type,width:n.width,wallId:n.wallId})),kitchenGapClear},null,2))
if(Object.values(coverage).some((c:any)=>!c.covered)||entranceDoors.length!==1||bathroomDoors.length!==1||!kitchenGapClear)process.exitCode=1
