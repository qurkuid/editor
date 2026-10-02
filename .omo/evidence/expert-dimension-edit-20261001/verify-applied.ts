import { readFileSync } from 'node:fs'
import { buildLevelWallConstructionDimensionPlan } from '../../../packages/nodes/src/wall/construction-dimensions'
import { constructionDimensionStandard } from '../../../packages/nodes/src/shared/construction-dimension-standards'
import { preflightWallDimensionEdit } from '../../../packages/nodes/src/shared/dimension-edit-preflight'
const [beforeFile, afterFile, wallId, tier, target, fixedEnd='start', selectedIndex] = process.argv.slice(2)
const before=JSON.parse(readFileSync(beforeFile!,'utf8')).graph
const after=JSON.parse(readFileSync(afterFile!,'utf8')).graph
const wall=before.nodes[wallId!]
const walls=Object.values(before.nodes).filter((n:any)=>n.type==='wall' && n.parentId===wall.parentId)
const standard=constructionDimensionStandard({datumPolicy:'wall-face',intersectionReferencePolicy:'both-faces'})
const descriptor=buildLevelWallConstructionDimensionPlan(walls as any,before.nodes,standard).get(wallId!)?.find(e=>e.tier===tier)?.editDescriptor
if(!descriptor) throw Error('Descriptor missing')
const request={descriptor,targetDistance:Number(target),fixedEnd:fixedEnd as 'start'|'end',selectedLeafId:selectedIndex===undefined?undefined:descriptor.leaves[Number(selectedIndex)]!.id}
const plan=preflightWallDimensionEdit({node:wall,nodes:before.nodes,request})
const expected=structuredClone(before)
for(const {id,data} of plan.updates) expected.nodes[id]={...expected.nodes[id],...data}
let maxNumericDelta=0
function compare(actual:any, expected:any, path:string):void {
 if(typeof actual==='number' && typeof expected==='number') {
  const delta=Math.abs(actual-expected); maxNumericDelta=Math.max(maxNumericDelta,delta)
  if(delta>1e-10) throw Error('Numeric mismatch at '+path)
  return
 }
 if(actual===expected) return
 if(actual && expected && typeof actual==='object' && typeof expected==='object') {
  const keys=Object.keys(actual).sort(), expectedKeys=Object.keys(expected).sort()
  if(JSON.stringify(keys)!==JSON.stringify(expectedKeys)) throw Error('Keys mismatch at '+path)
  for(const key of keys) compare(actual[key],expected[key],path+'.'+key)
  return
 }
 throw Error('Value mismatch at '+path)
}
compare(after,expected,'graph')
console.log(JSON.stringify({plannedGraph:'PASS',numericTolerance:1e-10,maxNumericDelta,target:Number(target),fixedEnd,updates:plan.updates.length,leaves:descriptor.leaves.map(x=>x.currentLength)}))
