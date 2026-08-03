# Pascal Editor: SketchUp급 실행·검증 마스터 플랜

작성일: 2026-08-02

연결 문서:

- [제품 로드맵](./sketchup-parity-roadmap.md)
- [INTM·Annotation·마감재 연동 계획](./intm-editor-integration.md)
- [Direct Modeling Kernel 실행 명세](./modeling-kernel-execution.md)
- [Material·Finish System 실행 명세](./material-system-execution.md)

## 1. 목표와 완료 정의

목표는 SketchUp UI를 복제하는 것이 아니다. 건축·인테리어 실무자가 Pascal Editor만으로 다음 흐름을 중단 없이 완료하는 수준을 만든다.

1. 정확하게 그린다.
2. 자유 형상과 파라메트릭 건축 요소를 함께 편집한다.
3. 그룹·컴포넌트·자산으로 반복 사용한다.
4. 재질과 실제 INTM 마감재를 표면에 적용한다.
5. 치수·Annotation·장면·도면을 모델 변경과 연결한다.
6. CAD/IFC와 교환하고 손실을 확인한다.
7. 저장·복구·공유·권한·버전 이력을 신뢰한다.
8. INTM 견적·발주·현장 업무로 연결한다.

“SketchUp급 완료”는 아래 조건을 모두 만족한 상태다.

- 기준 작업 120개가 사용자의 수동 보정 없이 통과한다.
- 모든 적용 대상 조작은 2D/3D parity 표를 가지며 차이는 의도적으로 문서화된다.
- 저장 → 종료 → 재열기 → 편집 → undo/redo → export에서 의미 데이터가 보존된다.
- 지원한다고 표시한 DWG/DXF/IFC 요소는 golden corpus round-trip 기준을 만족한다.
- 중형 기준 모델은 편집 중 p95 프레임 33 ms 이하, 포인터 피드백 p95 50 ms 이하를 만족한다.
- crash-safe checkpoint에서 마지막 확정 작업까지 복구된다.
- INTM 프로젝트에서 Annotation·마감재·수량·견적 linkage가 실제 운영 화면에서 재현된다.
- 각 에픽의 Gate 0~7이 모두 통과하고 재현 가능한 증거 묶음이 남는다.

SketchUp의 모든 역사적 기능과 확장을 1:1로 복제하는 것은 완료 조건이 아니다. 공식 핵심 작업 흐름을 기준으로 하고, Pascal의 건축 의미 모델·2D/3D 동시성·INTM 연결에서 더 강한 결과를 만든다.

## 2. 현재 공식 기준선

2026-08-02에 확인한 SketchUp 공식 문서를 기준으로 비교한다.

| 기준 영역 | SketchUp 기준 기능 | Pascal 목표 |
|---|---|---|
| 직접 모델링 | 선/면, Push/Pull, Offset, Follow Me, 교차 | 동일 핵심 흐름 + 파라메트릭 노드와 안전한 변환 |
| 재질 | PBR 재질, 실물 크기, texture positioning, 면/그룹 적용, In Model 관리 | PBR asset + 표면별 placement + INTM finish assignment의 분리·연결 |
| Solid | Outer Shell, Union, Subtract, Trim, Intersect, Split, Solid Inspector | 동일 연산 + manifold 진단과 비파괴 preview |
| 재사용 | Definition/Instance, Make Unique, 교체, 중첩, Outliner | 동일 동작 + 버전된 팀/INTM 자산 |
| 정밀 조작 | inference, 축 잠금, Measurements 입력, 배열 | 길이·각도·좌표·배열 공통 입력과 2D/3D parity |
| 장면 | 카메라, 숨김, tag, section, style, shadow, environment, axes | `ScenePreset`으로 같은 상태 저장·전환·발표 |
| 도면 | LayOut page/template/title block, model reference, associative dimension | 모델 참조형 `DrawingDocument`와 갱신/preflight |
| 상호운용 | DWG/DXF 2D·3D, IFC2x3/IFC4, 분류·재질·공간 계층 | 지원 범위·손실을 명시하는 검증된 round-trip |
| 확장 | Ruby API, Desktop SDK, Extension Warehouse | 서명·권한·격리·호환성 검증이 있는 플러그인 SDK |
| 협업 | 공유/참조/업데이트 흐름 | INTM 프로젝트·권한·Annotation·현장 업무 통합 |

공식 기준 자료:

- [SketchUp Solid Tools](https://help.sketchup.com/en/sketchup/modeling-complex-3d-shapes-solid-tools)
- [SketchUp drawing and modeling tools](https://help.sketchup.com/en/sketchup/drawing-lines-shapes-and-3d-objects)
- [SketchUp Push/Pull](https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d)
- [SketchUp materials and textures](https://help.sketchup.com/en/sketchup/adding-colors-and-textures-materials)
- [SketchUp texture positioning](https://help.sketchup.com/en/sketchup/positioning-textures)
- [SketchUp Components](https://help.sketchup.com/en/sketchup/components)
- [SketchUp Scenes](https://help.sketchup.com/en/sketchup/creating-scenes)
- [LayOut model references](https://help.sketchup.com/en/layout/managing-model-references)
- [LayOut dimensions](https://help.sketchup.com/en/layout/marking-dimensions)
- [CAD import/export](https://help.sketchup.com/en/sketchup/importing-and-exporting-cad-files)
- [IFC import/export](https://help.sketchup.com/en/importing-and-exporting-ifc-files)
- [SketchUp Developer Center](https://developer.sketchup.com/)

공식 기능이 바뀌면 분기별로 기준 매트릭스를 갱신하되, 이미 통과한 Pascal 회귀 기준을 임의로 낮추지 않는다.

## 3. 아키텍처 불변 조건

1. `packages/core`는 도메인 schema, 순수 geometry/topology, history, validation을 소유한다. Three.js, Editor mode, INTM route를 import하지 않는다. (`wiki/architecture/layers.md`, `wiki/architecture/node-schemas.md`)
2. `packages/viewer`는 렌더링, raycast, scene presentation을 소유하고 Editor tool을 알지 않는다. (`wiki/architecture/viewer-isolation.md`)
3. `packages/editor`는 tool, mode, interaction, HUD, 2D 편집, Paint, 도면 UI를 소유한다. (`wiki/architecture/tools.md`, `wiki/architecture/interaction-scope.md`)
4. 노드별 차이는 `NodeDefinition` capability로 주입한다. 범용 dispatcher에 type 분기를 계속 추가하지 않는다. (`wiki/architecture/node-definitions.md`)
5. placement, move, reshape, paint는 적용 가능한 경우 같은 PR에서 2D/3D 행동을 함께 구현한다. (`wiki/architecture/tools.md`)
6. INTM 네트워크와 인증은 host-injected adapter 뒤에 둔다. 독립 실행 Editor는 INTM 없이도 정상 동작한다. (`./intm-editor-integration.md`)
7. RawPainter는 Paint의 material provider다. 별도 paint state, 별도 undo, 별도 표면 dispatcher를 만들지 않는다. (`packages/editor/src/lib/material-paint.ts`, `packages/editor/src/lib/paint-scope.ts`)
8. 모든 영속 변경은 schema version, migration, round-trip test를 함께 가진다.

## 4. 작업 스트림과 실행 순서

의존성이 있는 스트림은 순차 진행한다. 서로 독립된 세로 기능은 같은 release train 안에서 병행할 수 있지만, 각 에픽은 단독으로 사용자 가치와 검증 증거를 완성해야 한다.

### Stream A — Precision Core

구현 범위:

- 현재 exact-length 입력을 `DraftConstraintSession`으로 일반화
- 길이, 각도, 상대/절대 좌표, 축 잠금, `xN`, `÷N`
- Move/Rotate/Scale/Copy와 모든 2점·다점 도구의 공통 HUD
- endpoint/midpoint/intersection/on-face inference 시각 언어
- touch/keyboard/pointer 동시 입력 충돌 해소

주요 파일:

- `packages/editor/src/lib/draft-length-input.ts`
- `packages/editor/src/hooks/use-draft-length-input.ts`
- `packages/editor/src/store/use-editor.tsx`
- `packages/editor/src/lib/interaction/scope.ts`
- `wiki/architecture/tools.md`

완료 기준:

- mm/m/ft-in 입력이 내부 meter 값으로 1 mm 이내 변환된다.
- 입력 HUD와 preview가 동일 animation frame에 반영된다.
- 2D/3D에서 click, Enter, Esc, Backspace, chain placement 결과가 동일하다.
- 1,000회 연속 조작에서 history transaction 누수와 ghost preview 잔류가 없다.

### Stream B — Direct Modeling Kernel

상세 SSOT: [Direct Modeling Kernel 실행 명세](./modeling-kernel-execution.md)

구현 범위:

- 렌더러 독립 half-edge/B-rep `BodyNode`
- Line, Rectangle, Circle, Arc, Freehand, Eraser
- face 생성/분할/병합, Push/Pull, Offset, Follow Path
- Move/Rotate/Scale와 geometry inference
- manifold validator, reversed face, stray/internal face, short edge 진단
- 모든 연산의 `TopologyRemap`으로 face 재질·Annotation·selection 보존
- 파라메트릭 노드의 명시적 “자유 형상으로 변환”

주요 위치:

- 새 topology/schema: `packages/core/src/schema/`, `packages/core/src/lib/`
- 정의/geometry: `packages/nodes/src/`
- 도구: `packages/editor/src/components/tools/`
- 렌더링: `packages/viewer/src/systems/`
- 계약: `wiki/architecture/node-schemas.md`, `renderers.md`, `systems.md`, `tools.md`

완료 기준:

- 기준 형상 48개를 생성, 저장, 재열기, 수정한다.
- topology invariant suite에서 twin/next/face/vertex 참조 오류가 0건이다.
- 실패 연산은 원본을 바꾸지 않고 원인과 문제 위치를 표시한다.
- split/merge/PushPull/boolean 뒤 stable face ID remap과 재질·Annotation 연결이 규칙대로 보존된다.
- 10만 edge 기준 모델에서 선택·orbit p95 33 ms 이하를 만족한다.

### Stream C — Groups, Components, Outliner

구현 범위:

- Group과 편집 context isolation
- Definition/Instance, Make Unique, replace/reload, component axes
- nested Outliner, selection sync, context fade/hide
- 선형/방사형 배열과 shared geometry
- asset version pin, migration, missing asset fallback

주요 위치:

- `packages/core/src/schema/`
- `packages/core/src/store/use-scene.ts`
- `packages/editor/src/components/editor/`
- `packages/viewer/src/store/use-viewer.ts`
- `wiki/architecture/selection-managers.md`

완료 기준:

- 1개 definition의 10,000 instances가 geometry를 복제 저장하지 않는다.
- definition 수정은 모든 instance에 반영되고 Make Unique는 선택 instance만 분리한다.
- 8단계 nested context에서 선택·undo·Outliner 위치가 일치한다.

### Stream D — Unified Paint, RawPainter, INTM Finishes

상세 SSOT: [Material·Finish System 실행 명세](./material-system-execution.md)

구현 범위:

- 기존 `MaterialPaintPanel`의 provider contract
- Pascal library, Scene, Local, INTM/RawPainter 재질 통합 검색
- 카테고리, 상세, thumbnail, 다운로드/cache/retry/cancel
- 실제 규격 texture scale, rotate, offset, seamless
- PBR asset, 표면별 `MaterialPlacement`, 업무용 `FinishAssignment` 분리
- fixed/free pin, planar/projected/box/cylindrical positioning과 pattern continuity
- asset provenance/version/checksum, offline frozen fallback, texture LOD/memory budget
- 기존 single/object/matching/room scope와 eyedropper 재사용
- `FinishAssignment`, location, finish schedule, quantity dirty state

주요 위치:

- `packages/editor/src/components/ui/controls/material-paint-panel.tsx`
- `packages/editor/src/lib/material-paint.ts`
- `packages/editor/src/lib/paint-scope.ts`
- `packages/core/src/schema/scene-material.ts`
- `/Users/changseok/Documents/intm/src/app/api/newportal/materials/search/route.ts`
- `/Users/changseok/Documents/intm_studio/intm_studio/rawpainter/common/public_catalog.rb`
- `./intm-editor-integration.md`

완료 기준:

- 세 재질 공급원을 오가며 mode 재진입 없이 칠한다.
- 600 × 1200 mm texture fixture의 world scale 오차가 1% 이하다.
- topology 연산 뒤 유지·분할 face의 pattern origin과 INTM product linkage가 보존된다.
- 지원 PBR channel의 color space와 GLB round-trip 손실이 0건이다.
- 범위 칠하기와 FinishAssignment가 한 undo로 함께 복원된다.
- 동일 product ID를 중복 다운로드하지 않는다.
- INTM 현장 마감표가 material/location/source node를 역추적한다.

### Stream E — Annotation and Collaboration

구현 범위:

- construction/measurement/text/leader/mark/room/finish/revision Annotation
- semantic feature anchor와 dangling/relink
- collaboration pin, thread, assignment, status, viewpoint
- 2D/3D/PDF/INTM field viewer 동일 ID 추적
- offline outbox, idempotency, revision conflict

주요 위치:

- `packages/core/src/schema/nodes/construction-dimension.ts`
- `packages/core/src/schema/nodes/measurement.ts`
- `packages/editor/src/store/use-drawing-view.ts`
- `packages/editor/src/lib/floorplan/`
- `/Users/changseok/Documents/intm/src/app/api/planner/designs/[designId]/comments/route.ts`
- `./intm-editor-integration.md`

완료 기준:

- host geometry 변경 시 연결 Annotation이 같은 semantic feature를 따른다.
- host 삭제 시 자동 삭제되지 않고 dangling/relink 상태가 된다.
- Editor ↔ INTM 상태 변경이 5초 이내 반영되거나 재시도 상태를 표시한다.
- 다른 company/project의 Annotation 접근 시 서버가 거부한다.

### Stream F — Scenes, Sections, Presentation

구현 범위:

- `ScenePreset`: camera, visibility, tag, section, style, shadow/time, environment, axes
- section plane/box와 plan fill
- scene ordering, update, duplicate, transition, animation
- thumbnail과 발표 모드

주요 위치:

- `packages/viewer/src/store/use-viewer.ts`
- `packages/editor/src/store/`
- `packages/editor/src/components/editor/`
- `packages/core/src/schema/`

완료 기준:

- 20개 scene을 순회해 저장된 속성 hash가 일치한다.
- section on/off와 tag visibility가 저장·재열기·export에서 보존된다.
- 60초 발표 sequence에서 camera jump, stale frame, hidden-state leak가 없다.

### Stream G — DrawingDocument and Delivery

구현 범위:

- page/template/title block/revision table
- model-reference viewport와 scale
- plan/elevation/section/detail 자동 생성
- associative dimension/label과 stale reference 표시
- PDF preflight, batch export, 이후 2D DWG/DXF

주요 위치:

- `packages/editor/src/lib/floorplan/floorplan-export.tsx`
- `packages/editor/src/lib/floorplan/floorplan-pdfkit-renderer.ts`
- 새 drawing schema: `packages/core/src/schema/`
- 새 drawing UI: `packages/editor/src/components/`

완료 기준:

- 10장 drawing set이 모델 변경 뒤 참조 상태를 정확히 갱신한다.
- stale/dangling dimension은 빨간 상태와 preflight 오류를 남긴다.
- A3/A1 PDF의 viewport 축척 오차가 0.2% 이하다.
- 동일 입력의 PDF 구조 hash와 golden image 차이가 허용 범위 안이다.

### Stream H — Interoperability

구현 범위:

- format capability matrix와 손실 보고서
- DWG/DXF 2D reference → editable linework → scaled export
- IFC2x3/IFC4 geometry, spatial hierarchy, classification, property set, material
- GLB/STL/OBJ 회귀와 source origin/unit/layer mapping
- worker, progress, cancel, diagnostics

주요 위치:

- `apps/ifc-converter/`
- `packages/ifc-converter/`
- `apps/ifc-converter/public/test-ifc-files/`
- `packages/editor/src/lib/glb-export.test.ts`

완료 기준:

- 지원 IFC corpus 요소의 95% 이상이 class, transform, 주요 property, material linkage를 보존한다.
- DWG/DXF 기준 파일의 unit/origin/layer/linework가 capability matrix대로 보존된다.
- 미지원 요소는 조용히 누락되지 않고 report에 개수와 위치가 기록된다.
- 500 MB 기준 입력을 취소할 수 있고 취소 후 worker/memory가 회수된다.

### Stream I — Persistence, Collaboration, Plugins, Scale

구현 범위:

- crash-safe autosave, named checkpoint, compare/restore
- project version, permissions, share links, presence
- plugin network loader, manifest permissions, signature, migration, isolation
- LOD, instancing, BVH/spatial worker, memory budget
- telemetry와 privacy controls

주요 위치:

- `packages/core/src/store/use-scene.ts`
- `packages/editor/src/hooks/use-auto-save.ts`
- `packages/core/src/registry/`
- `wiki/architecture/plugin-authoring.md`
- `packages/mcp/`

완료 기준:

- 강제 종료 100회 fault-injection에서 마지막 확정 transaction까지 복구한다.
- restore는 새 checkpoint를 만들며 기존 history를 파괴하지 않는다.
- 실패/악성 fixture plugin이 host DOM, scene data, network 권한을 벗어나지 못한다.
- 대형 모델 memory ceiling과 interaction latency 예산을 CI benchmark가 감시한다.

## 5. 에픽 검증 루프

모든 에픽은 아래 루프를 통과한다. 실패하면 바로 앞 구현 단계로 돌아가며, 마지막 gate만 재실행하지 않는다. 수정 영향을 받은 가장 이른 gate부터 다시 시작한다.

```text
Baseline → Contract → Implement → Static → Behavior → UX → Durability
    ↑                                                        ↓
    └────────────── Fix from earliest affected gate ← Integration
                                                             ↓
                                      Performance → Review → Release proof
```

### Gate 0 — Baseline과 계약

필수 산출물:

- 하나의 사용자 결과를 설명하는 PRD
- SketchUp 기준 동작과 Pascal 의도 차이
- interaction state diagram
- 2D/3D parity table
- schema/API/migration contract
- 성능·메모리 예산
- 최소 5개 정상, 3개 취소/실패, 2개 저장/복구 시나리오

차단 조건:

- 소유 layer가 불명확하다.
- 영속 데이터인데 migration/round-trip 계획이 없다.
- “빠르게”, “잘 동작”처럼 측정 불가능한 완료 기준이 있다.

### Gate 1 — Static integrity

실행:

```bash
bun run check
bun run check-types
bun run build
git diff --check
```

추가 검증:

- Core → Viewer/Editor/Three.js 역방향 import 금지
- Viewer → Editor mode/tool import 금지
- 신규 node registry/schema/export 누락 검사
- dead branch, compatibility shim, duplicate dispatcher 분기 검사

통과 조건: 신규 오류 0건. 기존 오류가 있으면 기준 commit과 비교해 악화 0건을 증명한다.

### Gate 2 — Domain behavior

실행:

```bash
bun test packages/core/src
bun test packages/nodes/src
bun test packages/editor/src
bun test packages/viewer/src
bun test packages/mcp/src
```

필수 범주:

- parser/schema/property invariants
- geometry golden values
- history: commit/cancel/undo/redo
- migration and save/load round-trip
- 2D/3D parity contract
- empty, minimum, maximum, invalid, dangling inputs

통과 조건: 영향 범위 테스트 100%, 전체 suite 100%, flaky retry 없이 통과한다.

### Gate 3 — Interaction and visual UX

브라우저에서 실제 pointer/keyboard/touch 경로를 실행한다.

- 클릭 좌표와 최종 scene state를 함께 assertion
- hover, cursor, snap/inference, preview, HUD, error state screenshot
- 2D, 3D, split, perspective/orthographic
- Escape, focus loss, mode switch, second pointer, rapid repeat
- light/dark theme와 최소 지원 viewport

통과 조건:

- 작업별 golden recording과 최종 scene snapshot이 일치한다.
- blocking visual defect 0건, 입력을 숨기는 overlap/clipping 0건이다.
- pointer feedback p95 50 ms 이하이다.

현재 저장소에 범용 browser E2E runner가 없으므로 첫 에픽에서 `apps/editor` 전용 Playwright 기반 scenario harness를 만들고 이후 모든 에픽이 재사용한다. 새 runner는 제품 코드를 변경하지 않고 public user surface만 조작한다.

### Gate 4 — Durability and interoperability

시나리오:

- 작업 → autosave → 강제 종료 → 재열기
- undo/redo → save → schema migration → 재열기
- duplicate/copy/paste/component instance → save/load
- export → import → semantic diff
- 실패 import/export 취소 후 원본 불변

통과 조건:

- node/material/annotation/component stable ID의 의도치 않은 변경 0건
- 지원 필드 손실 0건
- 부동소수 geometry 차이는 capability별 허용오차 안이다.
- 이전 두 schema version fixture를 현재 버전으로 연다.

### Gate 5 — INTM integration

INTM 관련 에픽에만 추가로 적용한다.

- 인증된 staging project에서 실행
- company/project 권한 positive/negative case
- model version publish와 artifact hash
- Annotation 양방향 상태와 conflict
- RawPainter material asset/cache/scale
- finish schedule와 estimate change-set preview/apply
- offline outbox replay와 idempotency

통과 조건:

- 로컬 mock뿐 아니라 실제 INTM staging 브라우저/API 응답을 증거로 남긴다.
- 승인 없는 estimate mutation 0건이다.
- cross-tenant read/write 0건이다.
- retry가 duplicate annotation/material/estimate item을 만들지 않는다.

### Gate 6 — Performance and resilience

고정 corpus:

- Small: 1천 nodes / 1만 edges
- Medium: 1만 nodes / 10만 edges
- Large: 5만 nodes / 50만 edges 또는 500 MB 교환 파일

측정:

- open/save/export 시간
- orbit/select/drag/paint p50, p95
- JS heap/GPU memory peak와 작업 후 회수
- component instancing 비율
- 30분 soak와 1,000회 반복 조작
- worker cancel, network timeout, asset 404, quota exceeded

초기 예산:

- Medium open p95 10초 이하
- Medium save p95 3초 이하
- Medium interactive frame p95 33 ms 이하
- drag/paint preview p95 50 ms 이하
- 취소 후 5초 내 worker 종료와 transient memory 90% 이상 회수

예산은 실제 baseline 측정 후 더 엄격하게 조정할 수 있지만 근거 없이 완화하지 않는다.

### Gate 7 — Independent review and release proof

필수 검토:

- architecture boundary review
- regression/diff review
- accessibility와 keyboard-only task pass
- security review: file/URL/plugin/tenant boundary
- evidence bundle completeness

release proof:

- clean build artifact
- preview 또는 staging의 exact route
- 대표 시나리오 녹화
- version/commit/artifact hash
- canary error와 performance dashboard
- rollback/checkpoint 복구 훈련

통과 뒤에만 capability matrix를 `Implemented`로 바꾼다. 코드 merge나 unit test 통과만으로 완료 표시하지 않는다.

## 6. 검증 증거 묶음

각 에픽은 다음 구조의 증거를 남긴다.

```text
evidence/<epic-id>/
  contract.md
  parity.md
  commands.json
  unit-summary.json
  scenario-results.json
  scene-before.json
  scene-after.json
  screenshots/
  recordings/
  performance.json
  integration.json
  review.md
  release.json
```

자동 생성 결과는 CI artifact로 보관한다. 저장소에는 작은 contract, fixture manifest, baseline만 버전 관리하고 동영상·대형 모델·빌드 artifact를 커밋하지 않는다.

`scenario-results.json` 최소 필드:

- scenario ID와 capability
- app version/commit/browser/GPU
- 입력 이벤트 sequence
- expected/actual scene hash
- screenshot/recording artifact link
- duration과 memory peak
- pass/fail과 최초 실패 gate

## 7. 기준 시나리오 카탈로그

초기 120개 중 84개를 모델링·재질 핵심 축에 배분한다. 모델링 48개와 재질 24개의 상세 시나리오는 각 실행 명세가 소유하고, 공통 정밀 입력 시나리오 12개가 두 축의 조합을 검증한다.

| 영역 | 개수 | 대표 시나리오 |
|---|---:|---|
| 정밀 입력·추론 | 12 | 길이/각도/좌표/축 잠금/배열/연속 배치 |
| 직접 모델링·Solid | 48 | topology/face/PushPull/Offset/FollowPath/boolean/repair/remap |
| Group·Component | 8 | context edit/instance/unique/replace/nesting/array |
| Material·RawPainter·Finish | 24 | PBR/positioning/provider/physical scale/topology/INTM/cache |
| Annotation·장면 | 8 | semantic anchor/dangling/section/tag/shadow/transition |
| 도면 | 6 | viewport/scale/dimension/stale reference/PDF preflight |
| 교환 | 7 | DWG/DXF/IFC unit/origin/class/material/loss report |
| 저장·협업·INTM | 7 | crash recovery/version/conflict/tenant/estimate approval |

각 시나리오는 novice path와 expert shortcut을 구분한다. 사용자 동작 수, 완료 시간, 오류 복구 가능 여부를 함께 측정한다.

## 8. 릴리스 전략

날짜 약속 대신 capability train으로 출시한다.

1. **Foundation Alpha**: Precision Core + E2E harness + persistence gates
2. **Modeling Core Alpha**: `BodyNode` + face selection + exact Push/Pull + topology remap
3. **Material Core Alpha**: canonical PBR asset + per-face placement + offline fallback
4. **Modeling Beta**: sketch/Offset/Follow Path + Group/Component + solid inspector
5. **Finish Beta**: positioning + Unified Paint + RawPainter + INTM finish schedule
6. **Documentation Beta**: Annotation + Scenes + DrawingDocument
7. **Exchange Beta**: DWG/DXF + IFC production matrix
8. **Operations RC**: collaboration + plugin security + large-model budgets
9. **Production**: 120 scenario pass + staging/live evidence + rollback rehearsal

각 train은 feature flag로 격리한다. schema를 이미 저장한 기능은 flag off 시 데이터를 삭제하지 않고 읽기 전용 또는 안전 fallback을 제공한다.

## 9. 실패 처리와 중단 기준

다음 상태에서는 다음 에픽으로 넘어가지 않는다.

- 같은 interaction defect가 2D/3D 중 한쪽에 남아 있다.
- save/load 또는 undo가 geometry/material/annotation을 손상한다.
- performance budget을 넘었는데 측정 없이 “나중에 최적화”로 넘긴다.
- INTM mock만 통과하고 실제 staging project 증거가 없다.
- import/export가 누락을 보고하지 않는다.
- flaky test를 retry로 숨긴다.
- migration 없이 schema를 변경한다.
- architecture layer violation이 남아 있다.

한 에픽이 세 번 연속 같은 gate에서 실패하면 새 기능 작업을 중단하고 root-cause 문서와 최소 재현 fixture를 만든다. 원인을 제거한 뒤 Gate 0 계약부터 다시 검토한다.

## 10. 위험과 대응

- **범위가 끝없이 커짐**: 120개 기준 시나리오와 capability matrix 밖의 기능은 별도 후보로 둔다.
- **파라메트릭/자유 형상 충돌**: 자동 왕복 변환을 약속하지 않고, 의미 손실 preview가 있는 명시적 변환만 제공한다.
- **geometry kernel 불안정**: topology invariant와 invalid-operation rollback을 기능 UI보다 먼저 완성한다.
- **테스트는 많지만 실제 UX가 나쁨**: browser event replay, screenshot, task time, 사용자 오류 복구를 필수 gate로 둔다.
- **대형 모델 성능 회귀**: 고정 corpus와 p95 budget을 CI에서 비교한다.
- **RawPainter/INTM 결합으로 독립 앱 손상**: provider adapter와 no-INTM fallback을 contract test한다.
- **협업 충돌로 데이터 유실**: immutable version, revision, idempotency, outbox, explicit conflict UI를 사용한다.
- **교환 포맷 과장**: capability matrix에 지원/부분/미지원과 손실을 공개한다.
- **검증 artifact가 저장소를 비대하게 함**: 대형 증거는 CI artifact/object storage, 작은 manifest만 git에 둔다.

## 11. 첫 실행 묶음

첫 구현 묶음은 기능 확장보다 검증 기반을 먼저 완성한다.

1. `capability-matrix.json` schema와 120 scenario manifest 작성
2. `apps/editor` public surface를 조작하는 browser scenario harness 구축
3. 현재 exact-length wall/fence/MEP 흐름을 첫 golden scenario로 등록
4. scene semantic snapshot/hash와 screenshot/recording artifact 생성
5. Medium model generator와 interaction benchmark 구축
6. Gate 0~7 CI summary와 실패 gate 표시
7. 위 기반 위에서 `DraftConstraintSession` 첫 세로 기능 구현
8. 모델링 세로 기능: rectangle face → 1,200 mm Push/Pull → stable face remap
9. 재질 세로 기능: 600 × 1200 mm INTM 자재 → per-face placement → offline 재열기

첫 묶음 완료 기준:

- 로컬과 CI에서 같은 scenario ID가 같은 최종 scene hash를 만든다.
- 의도적으로 parser, preview, save/load, performance를 각각 깨뜨린 fixture가 해당 gate에서 실패한다.
- exact-length 대표 2D/3D 시나리오가 녹화, scene diff, duration과 함께 통과한다.
- Push/Pull 뒤 face material placement와 Annotation anchor가 topology remap을 따라간다.
- 실제 규격 재질이 저장·오프라인 재열기 뒤에도 같은 scale·origin·제품 ID를 유지한다.
- 테스트 실패가 어느 gate와 capability를 막는지 한 화면에서 확인된다.

## 12. 계획 자체의 검증

구현 착수 전 다음을 확인한다.

- 모든 주요 요구가 Stream A~I 중 하나에 배정되어 있다.
- 모든 Stream은 정상·실패·저장·성능 완료 기준을 가진다.
- 각 영속 schema 변경에는 migration과 round-trip gate가 있다.
- 각 INTM mutation에는 권한·idempotency·audit 조건이 있다.
- 공식 SketchUp 기준 링크와 마지막 확인일이 기록되어 있다.
- 첫 실행 묶음이 독립적으로 시작 가능하며 제품 코드의 광범위한 선행 재작성에 의존하지 않는다.

이 문서는 구현 진행의 SSOT다. 제품 로드맵은 방향을 설명하고, INTM 계획은 통합 계약을 설명하며, 실제 에픽 상태와 검증 통과 여부는 이 문서의 Stream과 Gate를 기준으로 관리한다.
