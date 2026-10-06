import { WallNode, LevelNode } from '/Users/changseok/editor/packages/core/src/schema'
import { buildManualRoomBoundaryRepair } from '/Users/changseok/editor/packages/core/src/lib/room-boundary'
import { getWallPlanFootprint } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-footprint'
import { calculateLevelMiters } from '/Users/changseok/editor/packages/core/src/systems/wall/wall-mitering'
import { pointInPolygon } from '/Users/changseok/editor/packages/core/src/lib/polygon-relations'
const level=LevelNode.parse({id:'level_probe'});
const make=(id:string,start:number[],end:number[],curveOffset?:number)=>WallNode.parse({id,parentId:level.id,start,end,thickness:.1,curveOffset});
const source=make('wall_source',[-1,0],[0,0]);
const target=make('wall_target',[.16,.08],[.16,1]);
const walls=[source,target,make('wall_first',[0,0],[.16,0]),make('wall_second',[.16,0],[.16,.08])];
const nodes=Object.fromEntries([level,source,target].map(w=>[w.id,w]));
const input={levelId:level.id,wallId:source.id,endpoint:'end' as const,targetWallId:target.id,targetEndpoint:'start' as const,mode:'l-corner' as const,createdWallIds:['wall_first','wall_second'] as const};
const plan=buildManualRoomBoundaryRepair(nodes,input);
const miters=calculateLevelMiters(walls);
const footprints=walls.map(w=>({id:w.id,polygon:getWallPlanFootprint(w,miters).map(p=>[p.x,p.y] as [number,number])}));
const point:[number,number]=[.095,.06];
const targetInside=pointInPolygon(point,footprints[1].polygon,{includeBoundary:false});
const firstInside=pointInPolygon(point,footprints[2].polygon,{includeBoundary:false});
console.log(JSON.stringify({scenario:'synthetic-horizontal-source-vertical-target-160x80mm-100mm-thick',plan:{ok:plan.ok,reason:plan.reason},footprints,witness:{point,targetInside,firstInside},note:'Synthetic geometry; actual user wall orientations must be checked separately.'},null,2));
const clearTarget=make('wall_target',[1,1],[1,2]);
const farCurve=make('wall_far_curve',[100,100],[102,100],.5);
const farNodes=Object.fromEntries([level,source,clearTarget,farCurve].map(w=>[w.id,w]));
const farPlan=buildManualRoomBoundaryRepair(farNodes,input);
console.log(JSON.stringify({scenario:'far-curved-obstacle',ok:farPlan.ok,reason:farPlan.reason}));
