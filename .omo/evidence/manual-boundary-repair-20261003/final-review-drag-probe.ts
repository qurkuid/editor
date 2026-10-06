import {WallNode,LevelNode,useScene,useLiveNodeOverrides,DoorNode} from '../../../packages/core/dist/index.js'
import {useEditor,useInteractionScope} from '../../../packages/editor/src/index'
import {wallMoveEndpointAffordance} from '../../../packages/nodes/src/wall/floorplan-affordances'
import {writeFileSync} from 'node:fs'
globalThis.requestAnimationFrame ??= callback=>{callback(0);return 0};globalThis.cancelAnimationFrame??=()=>{}
const l=LevelNode.parse({id:'level_review_drag'})
const w=(id:string,start:[number,number],end:[number,number])=>WallNode.parse({id,parentId:l.id,start,end})
const records=[]
for(const scenario of ['new-overlap','normal-split-opening']){
 const a=w('wall_a',[0,0],[1,0]), b=w('wall_b',[3,-1],[3,3]),other=w('wall_overlap',[1.5,0],[2.5,0]);
 const d=DoorNode.parse({id:'door_host',parentId:b.id,wallId:b.id,position:[2.5,1,0],width:.6});b.children=[d.id]
 const members=scenario==='new-overlap'?[a,b,other]:[a,b,d];const nodes=Object.fromEntries([{...l,children:members.filter(n=>n.type==='wall').map(n=>n.id)},...members].map(n=>[n.id,n]));
 useScene.setState({nodes,readOnly:false,rootNodeIds:[l.id]});useScene.temporal.getState().resume();useScene.temporal.getState().clear();useLiveNodeOverrides.getState().clearAll();useEditor.getState().setSnappingMode('wall','off');
 useInteractionScope.getState().begin({kind:'reshaping',reshape:'endpoint',driver:'floorplan',nodeId:a.id,endpoint:'end'})
 const s=wallMoveEndpointAffordance.start({node:a,nodes:useScene.getState().nodes,payload:{wallId:a.id,endpoint:'end'},initialPlanPoint:a.end,gridSnapStep:.001})
 s.apply({planPoint:[3,0],modifiers:{shiftKey:false,ctrlKey:false,metaKey:false,altKey:false}})
 const canCommit=s.canCommit();if(canCommit)s.commit?.();const after=useScene.getState().nodes;const past=useScene.temporal.getState().pastStates.length
 useScene.temporal.getState().undo();records.push({scenario,canCommit,after,historySteps:past,undoExact:JSON.stringify(useScene.getState().nodes)===JSON.stringify(nodes)})
}
writeFileSync('.omo/evidence/manual-boundary-repair-20261003/final-review-drag-probe.json',JSON.stringify(records,null,2));console.log(records.map(r=>({scenario:r.scenario,canCommit:r.canCommit,sourceEnd:(r.after.wall_a as any).end,historySteps:r.historySteps,undoExact:r.undoExact,door:r.after.door_host})))
