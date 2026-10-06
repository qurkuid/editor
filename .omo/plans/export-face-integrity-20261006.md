# SketchUp DXF 면 무결성 수정 계획 — Sol/high 재검토

## 결정
이 문서는 이전 내부선 숨김 중심 계획을 전면 대체한다. **최소 수정은 prepareSceneForExport에서 wall-owned 하위 Mesh에도 기존 conformWallGeometry를 적용하는 것**이다. 다른 등록 node 소유권 경계에서는 재귀를 멈춘다. 아래 54-wall 경계 사례 보강에 한해 공유 conformance의 면 방향 정정을 추가 승인한다. DXF code70 edge classifier, native wall replacement, CSG 생성기 변경은 이번 범위에서 제외한다.

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
5. 기존 conformWallGeometry의 tolerance를 유지한다. 최초 42-wall replay는 기존 함수로 통과한다. 후속 54-wall 경계 사례에서 입증된 뒤집힌 면 방향에 한해 아래 정정을 적용한다.

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

Luna 구현자는 승인된 descendant conformance와 아래 검증된 normal 기반 winding 정정을 구현한다. 부모는 사용자 요청의 전체 변경 reviewed manifest, fork/deploy/floorplan commit/push, remote HEAD 확인을 소유한다. 기존 zone quantities 및 다른 변경을 되돌리거나 blind stage하지 않는다. 계획자는 source/commit/push를 하지 않았다.

완료 보고는 source/test/build/UI와 실제 SketchUp gate를 구분한다. 현재 importer 미검증을 완료로 표시하지 않는다.

## 후속 경계 사례 — 54-wall CSG 면 방향 정정 승인

사용자가 진행한 automatic 100mm concrete / unsupported-wall uniform-baseline 이후 scene을 별도로 재검증했다. 이 보강은 저장 scene의 높이, 바닥 지지, slab, opening, wall endpoints를 변경할 권한을 부여하지 않는다.

- source: /Users/changseok/Downloads/layout_2026-10-06 (12).json
- SHA256: 1e6c7b8556a100e6d13299d3198599b38fb5d48adc3f42bdea9d5ab0634ddd10
- invocation: bun .omo/evidence/auto-wall-concrete-100mm-20261006/replay.ts '/Users/changseok/Downloads/layout_2026-10-06 (12).json'
- fresh artifact: .omo/evidence/export-face-integrity-plan-20261006/boundary-replay.json
- observed exit=1, walls=54, allClosed=false. 실패는 wall_sr35mt3zfcn6iscc 하나이며 raw 103 triangles/94 bad edges → conformed 208 triangles/4 bad edges, dropped=0이다.
- 진단 invocation: bun .omo/evidence/export-face-integrity-plan-20261006/boundary-inspect.ts '/Users/changseok/Downloads/layout_2026-10-06 (12).json'
- 진단 artifact: .omo/evidence/export-face-integrity-plan-20261006/boundary-inspect.json
- 4개 bad edge는 모두 use count=2이지만 방향이 같다. 열린 경계가 아니므로 arbitrary weld/gap filling으로 해결하지 않는다.
- raw CSG triangle offset195의 점은 (2.050699949,0.899999976,-0.050000001), (2.050699949,2.450000048,-0.050000001), (1.695900440,2.026116133,-0.050000001)이다. cross normal은 +Z(0.549939264)인데 세 stored vertex normal은 모두 [0,0,-1]이다. 원천 CSG triangle의 역방향 winding이 conformance fan 4개에 전파된다.

승인된 수정 범위:

1. export_fix가 공유 conform-wall-geometry.ts와 해당 회귀를 소유한다. 계획자는 product file을 편집하지 않는다.
2. 기존 CSG normal attribute를 사용한 unanimous-normal guard로 source triangle winding을 복원한다. normal itemSize/count가 맞고 세 normal이 모두 finite/nonzero이며 각 정규화 normal이 geometric cross 방향과 반대인 경우에만 input indices[1]/[2]를 교환한다. 혼합·0·누락 normal은 그대로 둔다. 별도의 edge-adjacency graph를 추가하지 않는다. 로컬 정정 이후 기존 export matrix determinant의 mirrored-winding 보정을 유지한다.
3. 뒤집는 triangle은 vertex 순서와 함께 모든 per-corner attributes를 같은 순서로 재배열한다. 위치 집합, UV 대응, material group, draw range 의미를 보존한다. unrelated mesh/owner에 확장하지 않는다.
4. EPSILON=1e-6 확대, source CSG 재구성, arbitrary hole fill, support baseline/scene data 변경을 수행하지 않는다. finite/nonzero guard는 잘못된 normal을 방향 권위로 사용하지 않는다. 이 수정은 reliable normals가 없는 임의 mesh의 방향을 복구한다는 보장이 아니다.
5. 최소 회귀에서 winding과 반대인 세 normal을 가진 triangle을 넣고 geometric cross 방향 정정, UV/color per-corner 대응, 원본 geometry 불변을 검증한다. missing/zero/mixed normal 입력은 변경하지 않는다. 단일 triangle 회귀는 guard 동작을 증명하며, 실제 54-wall producer의 badEdges=0 및 degenerate=0은 폐쇄 shell 복구를 별도로 증명한다.
6. 최초 42-wall 및 새 54-wall producer replay를 모두 재실행하고 실제 UI에서 54-wall DXF를 새로 내려받아 검증한다. 전자는 geometry producer proof, 후자는 export pipeline proof로 각각 로그와 실제 파일을 보관한다. 54/54 closure, same-direction shared edge=0, degenerate=0이어야 한다.
7. parent가 browser/build/remote gate를 소유한다. SketchUp native import는 여전히 미검증으로 구분한다. repaired DXF topology만으로 importer 완료를 주장하지 않는다.

이 보강은 원래 42-wall 경로의 descendant ownership 수정을 유지하면서 새로운 역방향 triangle 경계 사례만 해결한다. 단순히 오류 개수 검사를 완화하거나 문제 wall을 제외하는 것은 합격이 아니다.

### 최종 read-only 검토

실제 31-line guard 및 per-corner UV/color 회귀를 읽고 커밋 차단 소견 없음으로 판단했다. 제품 파일은 수정하지 않았다.
- invocation: bun test packages/editor/src/lib/glb-wall-topology.test.ts -t 'reversed CSG face'
- binary observable: exit=0, 1 pass, 0 fail, 7 assertions
- artifact: .omo/evidence/export-face-integrity-plan-20261006/final-normal-guard-test.log
- invocation: bun .omo/evidence/auto-wall-concrete-100mm-20261006/replay.ts '/Users/changseok/Downloads/layout_2026-10-06 (12).json'
- binary observable: exit=0, walls=54, allClosed=true
- artifact: .omo/evidence/export-face-integrity-plan-20261006/final-normal-guard-54.json
- 이 검토는 parent의 browser DXF/전체 회귀/types/build/remote gate를 대체하지 않으며 SketchUp importer 미검증 상태는 유지된다.
