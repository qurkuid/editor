# Expert Dimension Edit — Actual Scene Feasibility Proof

## Inputs

- Scene snapshot: `browser-before.json`
- Generated labels: `labels-before.json`
- Scene id: `128765970842`
- Graph: 87 nodes, including 51 walls, 16 openings, and 12 zones
- Analysis date: 2026-10-01
- Analysis lane: `gpt-5.6-sol`, high reasoning

No product source or user scene was mutated. All geometry checks were performed from the saved JSON snapshot.

## Live 2067mm span

Measured endpoints:

```text
start = (-4.596221249620497, -2.7958181493905245)
end   = (-2.529644901868916, -2.795912981271388)
```

Derived basis:

```text
length   = 2.066576349927422 m
target   = 2.2 m
delta    = 0.133423650072578 m
midpoint = (-3.5629330757447066, -2.7958655653309563)
u        = (0.9999999989471273, -0.000045888399364919)
angle    = -0.002629211613143409 deg
```

The infinite midpoint cut crosses five straight walls:

| Wall | Maximum angular deviation from `u` | Curve |
|---|---:|---|
| `wall_c22hlkqgh2ytvqnf` | 0.0026292116° | none |
| `wall_5qyptzh6g8yjff4t` | approximately 0° | none |
| `wall_qupju3raxae0jagy` | 0.0026292116° | none |
| `wall_6ev5gw72927oqept` | 0.0026292116° | none |
| `wall_a4y07mts2pzhcpsh` | 0.0026292116° | none |

Maximum deviation is `4.58884e-5 rad`, below the planned normalized angular tolerance of `1e-3 rad`.

Exact-`u` piecewise transforms were evaluated for both fixed-end choices:

- selected displayed length after transform: exactly `2.2m` for both choices;
- wall contact pairs: `83` before and `83` after;
- changed contact pairs: `0`;
- curved crossing walls: `0`;
- minimum final wall length: `0.13391288212864383m`;
- no wall reversals or collapses.

Two openings are hosted by crossing walls:

- `window_bw4a5iv1gi7s1ehj` on `wall_6ev5gw72927oqept`
- `window_afqhqylbytgjfmna` on `wall_a4y07mts2pzhcpsh`

With the start fixed, both centers remain on the fixed half and their hosts lengthen. With the end fixed, each center moves rigidly with the selected host start. Their local spans remain valid in both cases.

### Proved blocker in the old axis predicate

Rotating the saved graph into the exact dimension basis and invoking the existing axis planner rejects both fixed-end choices at the first crossing wall:

```text
unsupported-crossing-wall: Oblique wall wall_c22hlkqgh2ytvqnf crosses the construction guide
```

This is caused by the old raw `1e-6` perpendicular-coordinate test. It is not a topology failure. The minimal repair is:

1. classify a crossing wall with normalized angular error (`abs(cross(wallDirection, u)) / wallLength`);
2. accept error within the established angular tolerance (`1e-3 rad` is sufficient here);
3. retain movement along the exact displayed unit vector `u`;
4. preserve the existing contact, attachment, reversal, collapse, and zone validation.

Axis-snapping this dimension is not an acceptable repair.

The live 2067mm → 2200mm case is therefore a required successful regression, not an allowed typed rejection.

## Common 3828mm construction total +300mm candidate

The generated 3828mm span in the right-side rectangular room uses:

```text
start  = (4.729801352710662, 3.624534235140441)
end    = (4.729801352710662, -0.20396576485955809)
length = 3.8285 m
target = 4.1285 m
delta  = 0.3 m
u      = (0, -1)
```

This visible label is the `interior-overall` construction dimension owned by `wall_20u774w8dl2rty02`. Its midpoint cut crosses five vertical straight walls, all with `0°` deviation and no curves. The saved baseline's automatic zones all have `clearDimensionPolicy: 'none'`; room-clear editing therefore needs a separate fixture or an explicit UI policy change before testing.

The current full `buildAxisGuideStretchPlan` was run against the actual 87-node graph with a temporary in-memory horizontal guide at the span midpoint:

- fixed start / move negative Z: **PASS**, 53 updates;
- fixed end / move positive Z: **PASS**, 21 updates;
- wall contact changes: `0` for both choices;
- hosted attachment validation: pass;
- automatic and manual zone planning: pass.

The regenerated construction-total result is exactly `4.1285m`, so this is the preferred 3828mm +300mm browser acceptance case. A room-clear acceptance must first enable `inside-faces` on a QA zone and verify that generated dimension independently.

## Reproduction commands

### Inspect snapshot and generated labels

```sh
python3 - <<'PY'
import json, math
scene = json.load(open('.omo/evidence/expert-dimension-edit-20261001/browser-before.json'))
labels = json.load(open('.omo/evidence/expert-dimension-edit-20261001/labels-before.json'))
nodes = scene['graph']['nodes']
print(len(nodes), labels[1], labels[2])
for index in (1, 2):
    start = labels[index]['start']
    end = labels[index]['end']
    length = math.dist(start, end)
    unit = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)
    print(index, length, unit, math.degrees(math.atan2(unit[1], unit[0])))
PY
```

### Run the full existing planner for the 3828mm +300mm candidate

```sh
bun -e 'import { readFileSync } from "node:fs"; import { buildAxisGuideStretchPlan } from "./packages/core/src/lib/axis-guide-stretch.ts"; const doc=JSON.parse(readFileSync(".omo/evidence/expert-dimension-edit-20261001/browser-before.json","utf8")); const nodes=structuredClone(doc.graph.nodes); const levelId=Object.values(nodes).find((n:any)=>n.type==="level").id; nodes.__qa={object:"node",id:"__qa",type:"construction-guide",name:"QA",parentId:levelId,visible:true,metadata:{},origin:[4.729801352710662,1.7102842351404415],direction:[1,0]}; for (const [fixed,side] of [["start",-1],["end",1]] as const){ try { const p=buildAxisGuideStretchPlan(nodes,{guideId:"__qa",side,distance:0.3}); console.log(fixed,"PASS",p.updates.length); } catch(e:any){ console.log(fixed,"FAIL",e.code,e.message); } }'
```

Expected output:

```text
start PASS 53
end PASS 21
```

### Reproduce the old strict-axis false rejection for the 2067mm basis

```sh
bun -e 'import { readFileSync } from "node:fs"; import { buildAxisGuideStretchPlan } from "./packages/core/src/lib/axis-guide-stretch.ts"; const doc=JSON.parse(readFileSync(".omo/evidence/expert-dimension-edit-20261001/browser-before.json","utf8")); const nodes=structuredClone(doc.graph.nodes); const a=[-4.596221249620497,-2.7958181493905245], b=[-2.529644901868916,-2.795912981271388]; const L=Math.hypot(b[0]-a[0],b[1]-a[1]); const u=[(b[0]-a[0])/L,(b[1]-a[1])/L]; const v=[-u[1],u[0]]; const m=[(a[0]+b[0])/2,(a[1]+b[1])/2]; const tx=(p:any)=>{const x=p[0]-m[0],z=p[1]-m[1];return [x*u[0]+z*u[1],x*v[0]+z*v[1]]}; for(const n of Object.values(nodes) as any[]){if(n.type==="wall"){n.start=tx(n.start);n.end=tx(n.end)} if(n.type==="zone")n.polygon=n.polygon.map(tx)} const levelId=(Object.values(nodes) as any[]).find(n=>n.type==="level").id; nodes.__qa={object:"node",id:"__qa",type:"construction-guide",name:"QA",parentId:levelId,visible:true,metadata:{},origin:[0,0],direction:[0,1]}; for (const [fixed,side] of [["start",1],["end",-1]] as const){ try { const p=buildAxisGuideStretchPlan(nodes,{guideId:"__qa",side,distance:2.2-L}); console.log(fixed,"PASS",p.updates.length); } catch(e:any){ console.log(fixed,"FAIL",e.code,e.message); } }'
```

Old predicate output:

```text
start FAIL unsupported-crossing-wall Oblique wall wall_c22hlkqgh2ytvqnf crosses the construction guide
end FAIL unsupported-crossing-wall Oblique wall wall_c22hlkqgh2ytvqnf crosses the construction guide
```

After the generic normalized-angle repair, this command's transformed-basis equivalent must pass and the direct dimension planner must return a graph whose regenerated visible span is exactly 2.2m.

## Current source: apply then regenerate proof

The current in-progress dimension planner was exercised against the saved 87-node graph without writing the scene. For each case the script:

1. generated the live `interior-overall` descriptor with `buildLevelWallConstructionDimensionPlan`;
2. built the mutation plan with `buildDimensionStretchPlan`;
3. applied every returned patch to an in-memory clone;
4. reran `buildLevelWallConstructionDimensionPlan`; and
5. resolved the regenerated dimension by stable owner wall plus `interior-overall` tier.

The live labels are construction totals:

- `2067`: owner `wall_5qyptzh6g8yjff4t`, exact source length `2.066576349927422m`;
- `3828`: owner `wall_20u774w8dl2rty02`, exact source length `3.828499999999999m`.

Command:

```sh
bun -e 'import {readFileSync} from "node:fs"; import {buildDimensionStretchPlan} from "./packages/core/src/lib/axis-guide-stretch.ts"; import {buildLevelWallConstructionDimensionPlan} from "./packages/nodes/src/wall/construction-dimensions.ts"; import {constructionDimensionStandard} from "./packages/nodes/src/shared/construction-dimension-standards.ts"; const base=JSON.parse(readFileSync(".omo/evidence/expert-dimension-edit-20261001/browser-before.json","utf8")).graph.nodes; const std=constructionDimensionStandard({datumPolicy:"wall-face",intersectionReferencePolicy:"both-faces"}); function descriptor(nodes,wallId){const walls=Object.values(nodes).filter(n=>n.type==="wall"); const p=buildLevelWallConstructionDimensionPlan(walls,nodes,std); return p.get(wallId)?.find(e=>e.tier==="interior-overall")?.editDescriptor;} for(const [wallId,target] of [["wall_5qyptzh6g8yjff4t",2.2],["wall_20u774w8dl2rty02",4.1285]]){for(const fixedEnd of ["start","end"]){const nodes=structuredClone(base); const d=descriptor(nodes,wallId); try{const plan=buildDimensionStretchPlan(nodes,{descriptor:d,targetDistance:target,fixedEnd}); for(const u of plan.updates) nodes[u.id]={...nodes[u.id],...u.data}; const after=descriptor(nodes,wallId); console.log(wallId,fixedEnd,"PASS",d.leaves.map(x=>x.currentLength),after?.leaves.map(x=>x.currentLength),"span",after&&Math.hypot(after.measuredEnd[0]-after.measuredStart[0],after.measuredEnd[1]-after.measuredStart[1]),"updates",plan.updates.length);}catch(e){console.log(wallId,fixedEnd,"FAIL",e.code,e.message)}}}'
```

Observed output:

```text
wall_5qyptzh6g8yjff4t start PASS [ 2.066576349927422 ] [ 2.1999999999999997 ] span 2.1999999999999997 updates 59
wall_5qyptzh6g8yjff4t end PASS [ 2.066576349927422 ] [ 2.1999999999999997 ] span 2.1999999999999997 updates 17
wall_20u774w8dl2rty02 start PASS [ 3.828499999999999 ] [ 4.1285 ] span 4.1285 updates 53
wall_20u774w8dl2rty02 end PASS [ 3.828499999999999 ] [ 4.1285 ] span 4.1285 updates 21
```

This proves the live 2067 and 3828 geometry succeeds for both fixed-end choices with actual regeneration. The final Nodes-owned preflight still has to automate the same apply-and-regenerate check before Editor commits. Since both live totals currently have one leaf, peer preservation must also remain covered by a separate multi-leaf opening-chain regression.

## Final Nodes-owned preflight proof

After the wall definition was wired to the Nodes-owned preflight, the same four actual-scene cases were run through `preflightWallDimensionEdit`. This path builds the core plan, applies it to an in-memory clone, regenerates the exact construction standard encoded by `generatorKey`, matches the stable descriptor/leaf semantic keys, and returns updates only after the regenerated target passes.

Command:

```sh
bun -e 'import {readFileSync} from "node:fs"; import {preflightWallDimensionEdit} from "./packages/nodes/src/shared/dimension-edit-preflight.ts"; import {buildLevelWallConstructionDimensionPlan} from "./packages/nodes/src/wall/construction-dimensions.ts"; import {constructionDimensionStandard} from "./packages/nodes/src/shared/construction-dimension-standards.ts"; const base=JSON.parse(readFileSync(".omo/evidence/expert-dimension-edit-20261001/browser-before.json","utf8")).graph.nodes; const std=constructionDimensionStandard({datumPolicy:"wall-face",intersectionReferencePolicy:"both-faces"}); function descriptor(nodes,wallId){const walls=Object.values(nodes).filter((n)=>n.type==="wall"); return buildLevelWallConstructionDimensionPlan(walls,nodes,std).get(wallId)?.find((e)=>e.tier==="interior-overall")?.editDescriptor;} for(const [wallId,target] of [["wall_5qyptzh6g8yjff4t",2.2],["wall_20u774w8dl2rty02",4.1285]]) for(const fixedEnd of ["start","end"]){const nodes=structuredClone(base); const d=descriptor(nodes,wallId); try{const result=preflightWallDimensionEdit({node:nodes[d.sourceNodeId],nodes,request:{descriptor:d,targetDistance:target,fixedEnd}}); console.log(wallId,fixedEnd,"PASS",result.updates.length,d.semanticKey,d.generatorKey);}catch(e){console.log(wallId,fixedEnd,"FAIL",e.code,e.message)}}'
```

Observed output:

```text
wall_5qyptzh6g8yjff4t start PASS 59 level_aw8kqyoj7ugmgm9t:wall:wall_5qyptzh6g8yjff4t:interior:total interior-wall:datum=wall-face:intersections=both-faces
wall_5qyptzh6g8yjff4t end PASS 17 level_aw8kqyoj7ugmgm9t:wall:wall_5qyptzh6g8yjff4t:interior:total interior-wall:datum=wall-face:intersections=both-faces
wall_20u774w8dl2rty02 start PASS 53 level_aw8kqyoj7ugmgm9t:wall:wall_20u774w8dl2rty02:interior:total interior-wall:datum=wall-face:intersections=both-faces
wall_20u774w8dl2rty02 end PASS 21 level_aw8kqyoj7ugmgm9t:wall:wall_20u774w8dl2rty02:interior:total interior-wall:datum=wall-face:intersections=both-faces
```

The former coordinate-bearing total semantic key failed this gate before the final repair. The passing result therefore also proves that the total descriptor key remains stable across regeneration.
