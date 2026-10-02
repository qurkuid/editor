import {buildAxisGuideStretchPlan} from '../../../packages/core/src/lib/axis-guide-stretch'
import {ConstructionGuideNode} from '../../../packages/core/src/schema'
const source=await Bun.file(new URL('./before-graph.json',import.meta.url)).json();
const graph=source.graph??source;const nodes=graph.nodes;
const level=Object.values(nodes).find((n:any)=>n.type==='level') as any;
for (const direction of [[0,1],[1,0]]) for(const side of [-1,1]){
 const guide=ConstructionGuideNode.parse({parentId:level.id,origin:[0,0],direction});
 try {const result=buildAxisGuideStretchPlan({...nodes,[guide.id]:guide},{guideId:guide.id,side:side as -1|1,distance:-0.1}); const before={graph:{...graph,nodes:{...nodes,[guide.id]:guide}}};const after=structuredClone(before);for(const update of result.updates)after.graph.nodes[update.id]={...after.graph.nodes[update.id],...update.data};
 await Bun.write(new URL(`./compression-${result.axis}-${side}-before.json`,import.meta.url),JSON.stringify(before));
 await Bun.write(new URL(`./compression-${result.axis}-${side}-after.json`,import.meta.url),JSON.stringify(after));
 console.log(JSON.stringify({direction,side,updates:result.updates.length,axis:result.axis,guideId:guide.id}));}
 catch(e){console.log(JSON.stringify({direction,side,error:String(e),code:(e as any).code}));}
}
