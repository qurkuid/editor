# Pascal Editor: SketchUp급 제품 로드맵

작성일: 2026-08-02

## 목표

Pascal Editor를 SketchUp의 복제품으로 만들지 않는다. 이미 강한 건축·설비 파라메트릭 모델과 2D/3D 동시 편집을 유지하면서, SketchUp 사용자가 기대하는 정밀 조작·자유 형상·재사용·도면화·호환성·확장성을 제품 수준으로 완성한다. 모델은 INTM 프로젝트의 독립된 섬이 아니라 Annotation, 마감재, 수량, 견적, 발주, 현장 이슈로 이어지는 설계 원장이어야 한다.

성공 기준은 다음 다섯 가지다.

1. 초보자가 10분 안에 벽, 슬래브, 지붕, 가구를 정확한 치수로 배치한다.
2. 숙련자가 키보드 치수, 추론, 복사 배열, 그룹/컴포넌트, 자유 형상 편집만으로 중형 건축 모델을 막힘없이 만든다.
3. 모델에서 축척 도면과 수량을 다시 작성하지 않고 산출한다.
4. 대형 프로젝트를 잃지 않고 열고, 공유하고, 버전 복구하고, 표준 포맷으로 교환한다.
5. 동일한 INTM 프로젝트와 모델 버전을 기준으로 Annotation과 마감재가 양방향 연결되고, 승인된 수량만 견적·발주·현장 업무로 전달된다.

## 현재 기반

- Core, Viewer, Editor, Nodes가 분리된 플러그인형 구조다. 도메인 데이터와 UI/렌더링의 책임 경계가 이미 명확하다. (`README.md:52-58`)
- 씬은 IndexedDB에 저장되고 50단계 undo/redo를 제공한다. (`README.md:123-139`)
- 2D, 3D, split 보기와 site/structure/furnish 작업 단계가 있다. (`packages/editor/src/store/use-editor.tsx:108-110`, `packages/editor/src/store/use-editor.tsx:142-204`)
- 벽·펜스·지붕·계단·설비 배관 등 건축/MEP 파라메트릭 요소가 이미 넓다. (`packages/editor/src/store/use-editor.tsx:160-198`)
- 그리드, 각도, 자석, 정렬선 스냅이 작업 문맥별로 관리된다. (`packages/editor/src/store/use-editor.tsx:470-493`)
- 거리·각도·면적·둘레·체적 치수와 의미 기반 연결 치수가 2D/3D에 있다. (`wiki/architecture/measurements.md:9-19`)
- GLB/STL/OBJ 내보내기가 있다. (`packages/viewer/src/store/use-viewer.ts:149-151`)
- 외부 노드 팩용 API v1과 프로젝트별 설치 모델이 있으나, 네트워크 로더와 일부 확장 슬롯은 아직 미완성이다. (`wiki/architecture/plugin-authoring.md:3-8`, `wiki/architecture/plugin-authoring.md:135-157`)
- IFC 변환기는 존재하지만 현재 문서상 early alpha이며 요소 누락과 근사 변환이 남아 있다. (`apps/ifc-converter/README.md:8-20`, `apps/ifc-converter/README.md:43-51`)
- INTM은 프로젝트별 모델 버전, GLB/meta/SKP/장면 이미지, 현장 자재 시트, 회사별 통합 자재, 견적 항목, 위치, 현장 이슈를 이미 보유한다. Editor는 이 데이터를 복제하지 않고 안정된 ID와 버전 계약으로 연결해야 한다. (`/Users/changseok/Documents/intm/src/app/newportal/site/[projectId]/ModelingTab.tsx`, `/Users/changseok/Documents/intm/src/app/api/newportal/materials/search/route.ts`, `/Users/changseok/Documents/intm/src/app/api/newportal/estimates/[id]/items/route.ts`)
- Pascal의 material-paint는 표면별 slot, 미리보기, 단일/전체/동일/공간 범위, 지우기, 스포이드, 단일 undo를 이미 제공한다. RawPainter는 온라인 카탈로그, 실제 크기의 텍스처 다운로드·캐시·가져오기, 자재 메타데이터를 제공한다. 두 기능은 별도 도구가 아니라 하나의 Paint 작업공간으로 결합한다. (`packages/editor/src/components/ui/controls/material-paint-panel.tsx`, `packages/editor/src/lib/material-paint.ts`, `packages/editor/src/lib/paint-scope.ts`, `/Users/changseok/Documents/intm_studio/intm_studio/rawpainter/common/public_catalog.rb`, `/Users/changseok/Documents/intm_studio/intm_studio/rawpainter/common/material_importer.rb`)

## SketchUp 대비 핵심 격차

### 1. 자유 형상 모델링 커널

현재 제품의 중심은 노드별 파라메트릭 요소다. SketchUp의 핵심인 edge/face 기반 직접 모델링, 임의 면 Push/Pull, Offset, Follow Me, 면 교차, 범용 Solid 연산이 사용자 도구로 완결되어 있지 않다. SketchUp은 임의 면을 정확한 거리로 돌출/절삭하고, Union/Subtract/Trim/Intersect/Split을 그룹·컴포넌트에 적용한다.

보완 방향:

- Core에 렌더러 독립적인 `SketchNode` 또는 `BodyNode` B-rep/half-edge 토폴로지 모델을 둔다.
- 선/호/사각형/원 → 면 생성 → Push/Pull → Offset → Follow Path 순으로 도구를 세운다.
- 기존 `three-bvh-csg`는 미리보기/제한된 연산에 쓰고, 영속 토폴로지와 manifold 검증은 별도 커널 계약으로 분리한다.
- 파라메트릭 벽/슬래브는 자유 형상으로 폭파할 수 있어야 하지만, 기본값은 의미 있는 노드를 보존한다.

상세 실행·검증 계약은 [Direct Modeling Kernel 실행 명세](./modeling-kernel-execution.md)를 따른다.

### 2. 추론과 정밀 입력의 일관성

스냅 기반은 강하지만 도구마다 키 입력과 커밋 규칙이 흩어질 위험이 있다. 이번 exact-length 기능은 공통 파서와 방향 제약을 만들었지만, 장기적으로 길이·각도·좌표·배열 수량을 모두 한 Measurements Box 계약으로 통합해야 한다.

보완 방향:

- `DraftConstraintSession`을 Editor SSOT로 만들고 길이, 각도, 축 잠금, 상대/절대 좌표, `xN` 배열을 표현한다.
- 모든 2점·다점·이동·회전·스케일 도구가 같은 입력 버퍼와 HUD를 사용한다.
- 2D/3D 동작 parity contract test를 도구 정의마다 필수로 둔다.
- 축 색, 추론선, endpoint/midpoint/on-face/intersection 상태를 같은 시각 언어로 통일한다.

### 3. 그룹·컴포넌트·대량 재사용

선택 계층과 플러그인 노드는 있지만, SketchUp급 워크플로에는 편집 컨텍스트 격리, 인스턴스 공유, Make Unique, 재로드, 축 재설정, 중첩 Outliner, 복사 배열이 필요하다.

보완 방향:

- `Definition`과 `Instance`를 분리해 하나의 지오메트리를 여러 인스턴스가 공유하도록 한다.
- 그룹 편집 진입/탈출과 외부 컨텍스트 fade/hide를 interaction scope에 추가한다.
- Move/Rotate에 복사 모드, 선형/방사형 `xN`, `÷N` 배열을 추가한다.
- 카탈로그 항목을 로컬 객체가 아닌 버전된 컴포넌트 자산으로 승격한다.

### 4. 재질·표면 배치·마감재

현재 PBR map, 1 m UV 규칙, GLB paint slot, 범위 칠하기 기반은 강하다. 그러나 재사용 가능한 외형, 면마다 다른 texture positioning, INTM 제품·수량 linkage가 하나의 명확한 모델로 분리되어 있지 않다. 이 상태로 catalog만 늘리면 같은 재질을 면별로 정렬하기 어렵고, topology 편집 뒤 제품 연결을 잃을 수 있다.

보완 방향:

- `MaterialAsset`, `MaterialPlacement`, `FinishAssignment`를 분리한다.
- baseColor/normal/roughness/metalness/AO/opacity/emissive의 color space와 export 계약을 고정한다.
- 실제 폭·높이, move/scale/rotate, fixed/free pin, planar/projected/box/cylindrical mapping을 표면별로 저장한다.
- Push/Pull, split, merge, boolean의 `TopologyRemap`으로 pattern origin과 INTM product linkage를 보존한다.
- provider 장애나 제품 판매 중단에도 저장된 appearance와 frozen metadata를 유지한다.
- 100/1,000 material scene에서 texture LOD, dedupe, cache, GPU memory budget을 검증한다.

상세 실행·검증 계약은 [Material·Finish System 실행 명세](./material-system-execution.md)를 따른다.

### 5. 모델 표현·장면·검토

현재는 stacked/exploded/solo, preview/studio, walkthrough가 있지만, 장면별 카메라·가시성·스타일·단면·그림자 상태를 저장하고 발표하는 Scene 시스템이 부족하다. SketchUp Scene은 카메라뿐 아니라 스타일, 그림자, section cut, tag visibility까지 저장하고 애니메이션한다.

보완 방향:

- `ScenePresetNode`에 카메라, level/tag visibility, section planes, render theme, shadow/time 상태를 저장한다.
- 단면 평면/단면 박스와 2D section fill을 구현한다.
- 태그는 geometry ownership이 아니라 가시성 분류로 한정하고, Outliner와 별도 관리한다.
- 장면 전환, 발표 모드, 동영상/이미지 일괄 출력까지 연결한다.

### 6. 도면화와 납품

현재 측정과 floorplan PDF 기반은 강점이지만 완전한 drawing-set 편집기는 아니다. SketchUp LayOut은 모델 참조 갱신, paper/model space 치수, 페이지·템플릿·타이틀 블록, PDF/DWG 출력 흐름을 제공한다.

보완 방향:

- 모델과 분리된 `DrawingDocument`를 만들고 페이지, viewport, 축척, 레이어, 스타일, 텍스트, 라벨, 치수를 저장한다.
- viewport는 ScenePreset을 참조하고 모델 변경 시 치수·라벨 연결을 갱신한다.
- 평면/입면/단면/상세 뷰 자동 생성, 타이틀 블록 변수, 시트 번호, 개정 표를 제공한다.
- PDF 먼저 제품화하고, 2D DWG/DXF는 검증된 변환 계층 뒤에 추가한다.

### 7. 상호운용성

현재 GLB/STL/OBJ export와 IFC alpha import 사이에 실무 교환의 큰 공백이 있다. SketchUp은 DWG/DXF 양방향과 IFC2x3/IFC4를 제공하며 IFC 클래스와 계층을 보존한다.

보완 방향:

- import/export capability matrix와 golden corpus를 만들고 포맷별 손실을 UI에 명시한다.
- IFC는 wall/opening/slab/roof/stair뿐 아니라 beam, furnishing, classification, property set, material, spatial hierarchy를 round-trip한다.
- DWG/DXF는 우선 2D 배경 참조 import, 다음 editable linework, 마지막 scaled drawing export 순으로 확장한다.
- 큰 파일은 worker 스트리밍, 진행률, 취소, 진단 보고서를 기본 계약으로 둔다.

### 8. 협업·복구·확장 생태계

로컬 50단계 undo는 단일 세션 안전망일 뿐, 팀 협업과 장기 버전 이력은 아니다. 또한 플러그인 계약은 있으나 배포·권한·마이그레이션·검증 체계가 아직 좁다.

보완 방향:

- 프로젝트 snapshot/version, named checkpoint, diff preview, 복원 기능을 먼저 만든다.
- 다음으로 comment/markup, 공유 링크, 역할 권한, presence를 추가한다.
- 플러그인 manifest에 권한, 호스트 호환 범위, 데이터 마이그레이션, 서명/무결성을 추가한다.
- 공식 registry와 검증 샌드박스, crash isolation, per-plugin performance budget을 둔다.

### 9. INTM 프로젝트·Annotation·마감재 연결

기존 INTM 모델링 화면은 SketchUp/INTM Studio가 만든 GLB와 meta.json을 프로젝트 버전으로 관리한다. Pascal Editor는 여기에 단순 파일 업로더로 붙지 않고, 편집 가능한 원본 모델과 업무 데이터를 연결하는 통합 계층이 되어야 한다. 상세 계약과 단계는 [INTM 연동 실행 계획](./intm-editor-integration.md)을 따른다.

보완 방향:

- `intmProjectId`, `intmModelVersionId`, `intmMaterialId`, `intmEstimateItemId` 같은 불변 식별자를 이름·표시 문자열과 분리한다.
- 치수·문자·마크·룸 라벨 같은 설계 Annotation은 씬에 남기고, 댓글·핀·현장 이슈 같은 협업 Annotation은 서버 업무 데이터로 분리한다.
- 두 Annotation 유형 모두 모델 노드, 의미 feature, viewpoint, 모델 버전에 연결하며 호스트 변경 시 연결 상태를 명시한다.
- INTM 통합 자재를 마감재 원장으로 사용하고 Pascal의 wall/slab/ceiling/item material slot에 자재 ID와 적용 위치를 매핑한다.
- 기존 Paint 패널 안에서 Pascal 기본 재질, 씬 재질, INTM/RawPainter 카탈로그를 한 번에 검색·샘플링·적용한다. RawPainter는 재질 공급원이고 실제 칠하기는 기존 `PaintCapability`와 범위 적용 계약을 재사용한다.
- 모델 버전에는 자재 스냅샷을 보존하고, 현재 가격·판매 상태·대체품은 INTM에서 실시간 조회한다.
- 형상에서 산출한 면적·길이·개수를 견적 변경 미리보기로 만들고, 사용자의 명시적 승인 전에는 기존 견적을 덮어쓰지 않는다.

## 실행 단계

### Phase 0 — 정밀 조작 기반 통합

목표: 모든 기본 조작이 예측 가능하고 2D/3D가 동일하게 동작한다.

- 공통 `DraftConstraintSession` 설계 및 현재 exact-length 입력 이관
- 이동/회전/스케일/복제에 숫자 입력과 HUD 적용
- 상대 좌표, 절대 좌표, 각도, 배열 수량 문법
- 축 잠금, hover inference, snap priority SSOT
- undo transaction, cancel, chained placement contract test
- 2D/3D parity E2E suite

완료 기준:

- 벽·펜스·덕트·배관·라인을 mm/m/ft 입력으로 1 mm 허용오차 이내 생성한다.
- 입력 중 HUD와 미리보기가 한 프레임 내 갱신된다.
- Esc/Backspace/클릭/더블클릭/연속 배치가 모든 보기 모드에서 같은 결과를 만든다.
- 100개 핵심 조작 시나리오가 브라우저 자동화로 통과한다.

### Phase 0.5 — AI Control Plane

목표: AI가 화면 캡처가 아닌 장면 그래프와 노드 스키마를 이해하고, 앱 대화창과 CLI에서 동일한 모델링 계약으로 세부 작업과 내부 디버깅을 수행한다.

- 구조화 scene context와 전체 node JSON Schema
- Editor AI 대화창과 서버측 model provider adapter
- MCP semantic tool/범용 patch 공통 실행 계약
- dry-run, 변경 미리보기, 단일 Undo, validate-after-apply
- stdio/HTTP CLI 연결과 scene/history/validation 실행 trace

완료 기준:

- AI context와 실행이 screenshot/pixel에 의존하지 않는다.
- 잘못된 plan은 장면 변경 0건, 정상 plan은 Undo 1회로 복원된다.
- 앱과 CLI가 같은 저장 장면을 읽고 mutation/version을 추적한다.
- `pascal://debug/state`에서 현재 scene/history/validation/recent operation을 확인한다.

상세 실행·검증 계약은 [AI Control Plane 실행 명세](./ai-control-plane-execution.md)를 따른다. INTM Contract Foundation은 모델링·AI 기반 완료 뒤 별도 단계로 진행한다.

### Phase 1 — SketchUp급 직접 모델링 MVP

목표: 간단한 가구와 건축 디테일을 카탈로그 없이 직접 만든다.

- edge/face/body 토폴로지와 manifold validator
- Line, Rectangle, Circle, Arc, Eraser
- Push/Pull, Offset, Move, Rotate, Scale
- Group 및 편집 컨텍스트
- Union, Subtract, Intersect의 비파괴 미리보기와 단일 undo 커밋
- section plane과 X-ray/hidden geometry inspect

완료 기준:

- 공식 내부 benchmark 20개 형상을 처음부터 제작하고 다시 편집한다.
- boolean 후 열린 edge, 뒤집힌 face, self-intersection을 자동 진단한다.
- 10만 edge 모델에서 선택/궤도 30 FPS, 드래그 preview 20 FPS 이상을 목표로 한다.

### Phase 1.5 — Material·Finish Core

목표: 자유 형상과 파라메트릭 표면 모두에 실물 규격 재질과 INTM 마감재를 손실 없이 연결한다.

- canonical PBR `MaterialAsset`과 legacy scene material migration
- stable surface/slot별 `MaterialPlacement`와 texture positioning
- Pascal/Scene/Local/INTM·RawPainter 통합 provider
- topology remap에 따른 pattern·제품 linkage 보존
- offline frozen fallback, checksum cache, texture LOD/memory budget
- `FinishAssignment`, 위치별 수량, 견적 change-set preview

완료 기준:

- 600 × 1200 mm 재질의 world scale 오차가 1% 이하이다.
- Push/Pull과 face split 뒤 pattern origin과 INTM product ID가 보존된다.
- 오프라인 재열기에서도 사용 중 appearance와 assignment가 사라지지 않는다.
- 견적 반영은 차이 검토와 명시적 승인 뒤에만 수행된다.

### Phase 2 — 컴포넌트와 자산 생태계

목표: 반복 모델링 비용을 줄이고 커뮤니티 확장 기반을 만든다.

- Definition/Instance, Make Unique, nested component, component axis
- 선형/방사형 배열, 교체, reload, version pin
- 로컬/팀 자산 라이브러리와 썸네일 생성
- 플러그인 네트워크 로더, 권한/서명/마이그레이션
- 공개 SDK 예제, conformance tests, 오류 격리

완료 기준:

- 1개 정의의 10,000개 인스턴스가 메모리를 선형 복제하지 않는다.
- 정의 변경이 모든 인스턴스에 반영되고 Make Unique는 선택 인스턴스만 분리한다.
- 호환되지 않거나 실패한 플러그인이 씬 데이터와 호스트 UI를 손상시키지 않는다.

### Phase 3 — 장면·도면·납품

목표: 모델링 결과를 프레젠테이션과 시공 문서로 바로 납품한다.

- ScenePreset, section, tag visibility, style/shadow 저장
- DrawingDocument, page/template/title block
- 모델 참조 viewport, 평면/입면/단면 자동 뷰
- associative dimensions/labels, revision mark
- PDF 출력과 출력 전 preflight

완료 기준:

- 10장 도면 세트가 모델 변경 후 참조를 유지하며 일괄 갱신된다.
- A3/A1 PDF 축척 오차가 출력 기준 0.2% 이내다.
- 끊어진 치수 참조와 출력 누락을 preflight가 차단한다.

### Phase 4 — 호환성·협업·대형 모델

목표: 실무 프로젝트를 안전하게 교환하고 팀이 장기간 운영한다.

- IFC4/IFC2x3 production importer/exporter와 round-trip report
- DWG/DXF 2D import/export, origin/unit/layer mapping
- project version history, checkpoints, compare/restore
- comments, markup, share link, permissions
- spatial/geometry worker pipeline, LOD, instancing, memory budgets

완료 기준:

- 공개 IFC corpus의 지원 요소 95% 이상이 분류·위치·주요 속성을 보존한다.
- 500 MB급 기준 모델을 취소 가능한 진행 UI로 열고 메모리 예산 내에서 탐색한다.
- 모든 저장은 crash-safe이며 직전 checkpoint 복구 훈련을 통과한다.

## 우선순위 원칙

1. `정확도와 조작 일관성`이 새 노드 종류보다 먼저다.
2. 파라메트릭 의미를 유지하되, 자유 형상이 필요한 순간만 직접 모델링으로 내려간다.
3. 2D와 3D는 별도 제품이 아니라 같은 도메인 행동의 두 표현이다.
4. import 개수보다 round-trip 신뢰성과 손실 보고를 우선한다.
5. 협업 전에 crash-safe 저장과 버전 복구를 완성한다.
6. 성능 목표는 기능 완료 조건이며 사후 최적화 항목이 아니다.
7. INTM 연동은 완성 뒤 붙이는 export가 아니라 프로젝트·Annotation·마감재 모델을 설계하는 초기 계약이다.
8. 자재명·Annotation 문구 같은 표시값을 연결 키로 사용하지 않는다.
9. 설계 원본, 협업 상태, 가격 스냅샷의 소유권과 갱신 주기를 섞지 않는다.

## 첫 3개 실행 에픽

1. **Precision Core**: 이번 exact-length 구현을 `DraftConstraintSession`으로 일반화하고 이동·회전·배열까지 확장한다.
2. **Direct Modeling Core**: 최소 `BodyNode`와 topology invariant, logical face selection, 정확한 Push/Pull, stable `TopologyRemap`을 한 세로 기능으로 완성한다.
3. **Material Core**: canonical PBR asset, per-face placement, 실제 규격, RawPainter/INTM provider, offline fallback을 Push/Pull face에 연결한다.

INTM Project Adapter와 Annotation Bridge의 식별자·권한 계약은 위 에픽과 함께 고정하되, 모델링·재질 SSOT보다 먼저 별도 상태를 만들지 않는다. 다음 세로 기능은 Group/Component, Solid Inspector, INTM finish schedule, Annotation, Drawing Reference 순으로 확장한다.

각 에픽은 구현 전에 PRD, interaction contract, 2D/3D parity 표, 성능 예산, 회귀 시나리오를 작성한다. 새 추상화는 이 세로 기능을 통과시키는 데 필요한 범위만 추가한다.

전체 구현 순서, SketchUp 기준 기능 매트릭스, 에픽별 차단 게이트와 반복 검증 방식은 [SketchUp급 실행·검증 마스터 플랜](./sketchup-grade-execution-verification.md)을 SSOT로 사용한다. 기능이 많아 보이는 것으로 완료를 판단하지 않고, 그 문서의 사용자 시나리오와 증거 묶음이 모두 통과한 에픽만 완료 처리한다.

## 외부 기준 자료

- [SketchUp Push/Pull](https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d)
- [SketchUp Solid Tools](https://help.sketchup.com/en/sketchup/modeling-complex-3d-shapes-solid-tools)
- [SketchUp drawing and modeling tools](https://help.sketchup.com/en/sketchup/drawing-lines-shapes-and-3d-objects)
- [SketchUp Scenes](https://help.sketchup.com/en/sketchup/creating-scenes)
- [LayOut documents](https://help.sketchup.com/en/layout/creating-documents-layout)
- [LayOut dimensions](https://help.sketchup.com/en/layout/marking-dimensions)
- [CAD import/export](https://help.sketchup.com/en/sketchup/importing-and-exporting-cad-files)
- [IFC import/export](https://help.sketchup.com/en/importing-and-exporting-ifc-files)
- [SketchUp Developer Center](https://developer.sketchup.com/)
- [Trimble Connect collaboration](https://help.sketchup.com/en/connect-and-collaborate)
