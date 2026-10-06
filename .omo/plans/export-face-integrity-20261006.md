# SketchUp DXF 면 무결성 수정 계획 — Sol/high 재검토

## 결정
이 문서는 이전 내부선 숨김 중심 계획을 전면 대체한다. **최소 수정은 prepareSceneForExport에서 wall-owned 하위 Mesh에도 기존 conformWallGeometry를 적용하는 것**이다. 다른 등록 node 소유권 경계에서는 재귀를 멈춘다. DXF code70 edge classifier, native wall replacement, CSG/conform 알고리즘 변경은 이번 범위에서 제외한다.

## 직접 확인한 원인
- construction-preview.tsx의 export presentation은 envelope를 숨기고 구성재 layer meshes를 표시한다.
- construction-geometry.ts의 buildWallConstructionGeometry는 CSG INTERSECTION으로 구성재를 만들며 결과에 T-junction이 남는다.
- glb-export.ts는 sceneRegistry wall root Mesh만 정합하므로 실제 export되는 하위 construction Mesh는 누락된다.
- dxf-export.ts는 그 하위 Mesh triangle을 그대로 기록한다. 내부선 flag 누락과 shell topology 결손은 별개다.

## 증거와 재현
원본 파일:
- /Users/changseok/Downloads/model_2026-10-06_dxf.zip
- ZIP SHA256: 48a82c672982efd13c054e5eaf3ad2cc549f7c574fd394648b09398d4a3e78c8
- /Users/changseok/Downloads/layout_2026-10-06.json
- JSON SHA256: 68694c949cde3759a974111a39d208cdc25b767dcdce79de54f47a98f39d0997

직접 ZIP을 파싱한 결과 42개 wall block 모두 unmatched/orientation-invalid edge > 0이다. wall_16nowemc6e1hp4sm은 183 triangles, 133 bad edges, .0254mm보다 짧은 edge occurrence 52개다. ZIP triangles를 wall-local Float32 geometry로 역변환하고 기존 conformWallGeometry를 적용하면 42개 모두 badEdges=0, DXF degenerate drop=0이다. 문제 벽은 334 triangles로 정합된다.

동일 JSON을 실제 producer로 재생성하여 다시 검증했다. **sceneRegistry wall host Mesh를 먼저 등록해야 collectCutoutBrushes가 opening을 생성한다.** 미등록 exploratory run은 opening이 누락되므로 근거에서 제외한다.

- 실행: bun .omo/evidence/export-face-integrity-plan-20261006/replay.ts /Users/changseok/Downloads/layout_2026-10-06.json
- 시나리오: registered wall → opening/support CSG → construction CSG → existing conformance
- binary observable: exit=0, walls=42, allRawBroken=true, allClosed=true
- 모든 conformed part: badEdges=0, dropped=0
- 실제 캡처: .omo/evidence/export-face-integrity-plan-20261006/replay.json (17,261 bytes)
- 재현 코드: .omo/evidence/export-face-integrity-plan-20261006/replay.ts
- short-edge occurrence는 남는다. topology 통과만으로 SketchUp importer 성공을 주장하지 않는다.
- 원본 JSON/guide/material은 repo에 복사하지 않는다. script는 외부 scene path 인자를 받는다.
- omo-agent-toolkit ulw-loop status --json은 runtime target missing으로 currentAttemptDir를 반환하지 못했다. 증거는 .omo/evidence에 기록한다.

## 구현
1. glb-wall-topology.test.ts / dxf-export.test.ts에서 root envelope material colorWrite=false → Group → visible construction Mesh fixture를 만든다. 실제 buildWallConstructionGeometry, 등록된 wall host, opening/support case를 사용한다. 현재 prepareSceneForExport 후 descendant shell이 broken인 실패를 먼저 확인한다.
2. glb-export.ts의 기존 conformance 위치(prune 이후 sanitizeMaterialGroups 이전)에서 wall root부터 owned descendant Mesh를 방문한다. 기존 identityNodes/cloneByOriginal/sceneRegistry를 재사용한다.
3. root 외의 registered identity node를 만나면 subtree를 건너뛴다. hosted door/window/item은 wall 정합 범위 밖이다. nested wall은 자기 loop에서 처리한다. Group root도 처리할 수 있다.
4. 각 solid geometry를 독립 정합한다. layer/part 사이를 merge/weld하지 않는다. 원본 scene, geometry attributes/groups, material, visibility는 수정하지 않는다.
5. 기존 conformWallGeometry의 tolerance와 알고리즘을 유지한다. 실제 42-wall replay가 기존 함수로 통과하므로 수정 근거가 없다.

Native wall contract는 대안으로 사용하지 않는다. 외피 계약으로 대체하면 assembly/cavity/stud 정보가 사라질 수 있으며, 실제 wall_16nowemc6e1hp4sm 및 wall_6umucmp37yy5g18y는 nonmanifold-shell incompatible을 반환했다.

## 검증 계약
| 시나리오 | invocation / binary observable | artifact |
|---|---|---|
| construction child ownership | focused bun test; prepared/serialized part badEdges=0, degenerate=0 | focused.log |
| opening/support/junction | focused bun test; bounds/volume/cutout 보존 | focused.log |
| nested non-wall owner | focused bun test; child geometry 및 owner 그대로 | focused.log |
| source preservation | focused bun test; original geometry/material/visibility 그대로 | focused.log |
| multi-layer/cavity | focused bun test; layer part count/bounds/empty cavity 보존 | focused.log |
| actual 42-wall producer | replay.ts invocation above; 42/42 closed | replay.json |
| actual settings export | Settings > Export > SketchUp DXF; new ZIP 42 wall blocks closed, degenerate=0 | downloaded ZIP + parsed metrics + UI screenshot |
| SketchUp import | mm, Merge Coplanar Faces, unflattened; missing face 없음, openings 보존, face 선택 | import screenshot/report |

명령:
```sh
bun test packages/editor/src/lib/glb-wall-topology.test.ts packages/editor/src/lib/dxf-export.test.ts
bun test packages/editor/src/lib/glb-export.test.ts packages/editor/src/lib/stl-export.test.ts packages/editor/src/lib/sketchup-wall-contract.test.ts
bun run --cwd packages/editor check-types
bun run --cwd apps/editor check-types
bunx biome check <changed source/test files>
bun run --cwd apps/editor build
git diff --check
```

packages/editor에는 build script가 없으므로 이전 잘못된 package build gate를 제거한다. nodes source를 변경하지 않으므로 nodes build는 이번 수정의 필수 gate가 아니다. 실패 gate는 수정 후 다시 수행하고 실제 로그를 보관한다. 타입/빌드의 기존 실패는 변경 관련 여부를 구분하되 통과라고 쓰지 않는다.

localhost:3002 기존 사용자 서버를 교체하지 않는다. 실제 UI export ZIP, browser console, 파일 hash와 parsed DXF per-wall 통계를 수집한다. 부모 보고에 따르면 SketchUp native tool startup이 실패했으므로 현재 **실제 SketchUp import gate는 미검증**이다. 이 실패는 importer 성공 근거가 아니며 최종 결과에 명시한다. code70 classifier를 추측으로 추가하지 않는다.

## 모델 및 handoff
요청된 계획 profile은 gpt-5.6-sol / high이다. 실제 resolved model/effort를 독립적으로 읽는 API는 이 child에 제공되지 않았으므로 부모의 spawn/runtime metadata로 확인해야 한다. 요청값만으로 resolved profile 검증을 주장하지 않는다. 이전 Sol/medium artifact는 이 계획으로 대체한다.

Luna 구현자는 승인된 descendant conformance만 구현한다. 부모는 사용자 요청의 전체 변경 reviewed manifest, fork/deploy/floorplan commit/push, remote HEAD 확인을 소유한다. 기존 zone quantities 및 다른 변경을 되돌리거나 blind stage하지 않는다. 계획자는 source/commit/push를 하지 않았다.

완료 보고는 source/test/build/UI와 실제 SketchUp gate를 구분한다. 현재 importer 미검증을 완료로 표시하지 않는다.

