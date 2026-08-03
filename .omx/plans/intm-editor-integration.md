# Pascal Editor × INTM 연동 실행 계획

작성일: 2026-08-02

## 목표와 범위

Pascal Editor의 모델을 INTM 프로젝트 운영의 기준 데이터와 연결한다. 1차 우선순위는 Annotation과 마감재이며, 이후 수량·견적·발주·현장 점검으로 확장한다.

이 계획은 두 저장소의 현재 기능을 전제로 한다.

- Pascal Editor: 의미 feature에 연결되는 측정/시공 치수, 2D/3D Annotation, wall/slab/ceiling/item material slot, 씬 material snapshot.
- INTM: 회사/프로젝트 권한, 프로젝트별 모델 버전, GLB/meta/SKP/장면 이미지, 통합 자재 검색, 위치별 견적 항목, 현장 자재 시트, 댓글과 점검 이슈.

## 제품 원칙

1. INTM이 프로젝트, 회사 권한, 자재 원장, 견적, 발주, 현장 업무의 SSOT다.
2. Pascal 씬이 편집 가능한 모델 형상과 설계 Annotation의 SSOT다.
3. 표시 이름이 아닌 불변 ID로 연결한다.
4. 모델 버전은 재현 가능한 snapshot이고, 현재 가격·재고·판매 상태는 live data다.
5. 형상 변경은 견적을 자동 덮어쓰지 않는다. 항상 차이 미리보기와 승인을 거친다.
6. 로컬 undo/redo와 서버 동기화를 분리한다. 서버 응답이 씬 history를 오염시키면 안 된다.
7. 앱이 독립 실행될 때는 INTM 기능이 비활성화될 뿐 모델링 기능이 깨지지 않아야 한다.

## 통합 경계

`packages/core`는 INTM API, 인증, 프로젝트, 견적 개념을 알지 않는다. 외부 참조를 보존해야 하면 중립적인 extension metadata 계약만 소유한다.

`packages/viewer`는 동기화나 INTM UI를 알지 않는다. 선택 가능한 node/feature와 viewpoint 표현만 제공한다.

`packages/editor`는 Annotation 작성, 마감재 선택, 연결 상태, 차이 검토 UI를 소유한다. 네트워크 호출은 호스트가 주입하는 adapter를 통한다.

`apps/editor` 또는 INTM embed shell은 인증된 adapter, 프로젝트 컨텍스트, 동기화 outbox, deep link를 조립한다.

```ts
interface IntmIntegrationAdapter {
  getContext(): Promise<IntmProjectContext | null>
  listModelVersions(projectId: string): Promise<IntmModelVersion[]>
  publishModelVersion(input: PublishModelVersionInput): Promise<IntmModelVersion>
  listAnnotations(input: AnnotationQuery): Promise<IntmCollaborationAnnotation[]>
  upsertAnnotation(input: AnnotationMutation): Promise<IntmCollaborationAnnotation>
  searchMaterials(input: MaterialSearchQuery): Promise<IntmMaterialPage>
  getMaterialAsset(materialId: string): Promise<IntmMaterialAsset>
  previewEstimateChanges(input: FinishQuantitySnapshot): Promise<EstimateChangeSet>
  applyEstimateChanges(changeSetId: string): Promise<EstimateApplyResult>
}
```

실제 HTTP route를 편집기 컴포넌트에 직접 박지 않는다. 현재 `/api/newportal/...` 구조가 바뀌어도 adapter만 교체할 수 있어야 한다.

## 공통 식별자와 버전 계약

필수 연결 키:

- `intmCompanyId`: tenant 격리 검증용. 클라이언트가 권한 판단의 SSOT가 되어서는 안 된다.
- `intmProjectId`: Pascal 문서가 연결된 INTM 프로젝트.
- `pascalDocumentId`: 모델 원본의 영속 ID.
- `intmModelVersionId`: INTM에 게시된 immutable 모델 버전.
- `pascalNodeId` + `featureId`: Annotation과 마감 위치의 의미 기반 대상.
- `intmMaterialId`: INTM 통합 자재 원장의 ID.
- `intmEstimateId` + `intmEstimateItemId`: 승인된 견적 연결.
- `syncRevision` 또는 ETag: 낙관적 동시성 제어.

모델 게시 시 `pascalDocumentId`, 씬 schema version, 단위, 좌표계, node/feature index, material assignment snapshot, 생성자, 생성 시각을 meta에 포함한다. GLB만으로 연결 정보를 추측하지 않는다.

## Annotation 연동

### 1. Annotation 종류를 분리한다

설계 Annotation은 모델 문서의 일부다.

- construction dimension
- distance/angle/area/perimeter/volume measurement
- annotation text, leader, mark bubble
- room label, finish tag, revision mark

협업 Annotation은 INTM 업무 데이터다.

- 핀 댓글과 답글
- 검토 요청과 승인/반려
- 현장 점검 이슈
- 담당자, 마감일, 심각도, open/resolved 상태

협업 댓글을 모델 노드로 저장하지 않고, 설계 치수를 댓글 테이블에 평탄화하지 않는다. 둘은 링크만 공유한다.

### 2. Anchor 계약

Annotation anchor는 다음 순서로 강해야 한다.

1. `pascalNodeId + semantic featureId + parameters`
2. node-local fallback point
3. model-version world point와 viewpoint

모델 변경 뒤 semantic feature를 재해석한다. 대상이 사라지면 Annotation을 자동 삭제하거나 조용히 고정하지 않고 `dangling`으로 표시한다. 사용자는 새 대상 연결, 자유점 분리, 해결 처리를 선택한다.

INTM 협업 Annotation payload 최소 필드:

- `id`, `projectId`, `modelVersionId`
- `kind`, `status`, `body`, `author`, `assignee`
- `anchor` (`nodeId`, `featureId`, parameters, fallback point)
- `viewpoint` (camera, target, projection, section state)
- `createdAt`, `updatedAt`, `revision`

### 3. 동기화 규칙

- 로컬 입력은 즉시 UI에 반영하고 outbox에 기록한다.
- 동일 mutation ID의 재전송은 중복 생성하지 않는다.
- 서로 다른 필드의 수정은 병합하고, 같은 본문/anchor의 충돌은 사용자 선택을 요구한다.
- 모델 버전이 바뀌면 기존 Annotation은 원본 버전을 보존하고, 재연결 결과를 새 revision으로 기록한다.
- 서버 권한 거부는 로컬 Annotation을 삭제하지 않고 `sync-error`로 표시한다.

### 4. Annotation 완료 기준

- Editor에서 만든 핀 댓글이 같은 INTM 프로젝트/모델 버전에 5초 이내 나타나거나 명시적 재시도 상태를 보인다.
- INTM에서 resolved로 바꾼 항목이 Editor에 중복 없이 반영된다.
- 벽 길이/위치 변경 후 연결 치수와 핀이 semantic feature를 따라간다.
- 호스트 노드 삭제 후 Annotation이 `dangling`으로 남고 재연결할 수 있다.
- 2D, 3D, PDF, INTM 현장 화면에서 같은 Annotation ID와 상태를 추적한다.
- 다른 회사 사용자는 URL이나 ID를 알아도 조회·수정할 수 없다.

## 마감재 연동

### 1. INTM 자재 원장과 Pascal 표현을 분리한다

Pascal의 PBR 표현은 렌더링 자산이고, INTM 자재는 구매·견적 가능한 업무 자산이다. 한 객체로 억지로 합치지 않고 assignment로 연결한다.

```ts
type FinishAssignment = {
  nodeId: string
  surfaceSlot: string
  intmMaterialId: string
  intmMaterialRevision?: string
  locationId?: string
  application: 'finish' | 'substrate' | 'accessory'
  coverage?: number
  wasteFactor?: number
  renderMaterialRef?: string
}
```

초기 대상 slot:

- wall: interior/exterior와 높이 구간별 면
- slab/floor: surface
- ceiling: surface
- item/furniture: authored `slot_` surface
- door/window/stair/fence: 노드가 공개한 named slot

현재 WallNode는 전체 두께와 finish material만 가지므로 1차는 보이는 finish face를 대상으로 한다. 스터드, 석고보드, 접착제 등 다층 assembly는 별도 wall assembly 모델이 생긴 뒤 substrate/부자재로 확장한다.

### 2. Paint와 RawPainter를 하나의 작업공간으로 결합한다

사용자에게 `Paint`와 `RawPainter`라는 두 개의 경쟁 도구를 제공하지 않는다. 기존 `material-paint`가 유일한 칠하기 interaction이고, RawPainter 기능은 그 안의 카탈로그·가져오기·메타데이터 공급원이다.

통합 Paint 패널의 재질 공급원:

- **INTM/RawPainter**: 온라인 카테고리, 상품 검색, 상세 이미지, 실제 규격, 가격/브랜드/코드, 다운로드 상태
- **Project materials**: 현재 프로젝트에서 사용 중인 INTM 연결 자재
- **Scene materials**: 이 모델에만 존재하는 사용자 정의 재질
- **Pascal library**: 내장 PBR preset
- **Local import**: 이미지/SKM 호환 자산을 가져온 사용자 재질

공통 사용자 흐름:

1. Paint 모드 진입
2. 표면 hover로 대상 slot과 적용 범위 확인
3. INTM/RawPainter, Scene, Pascal 중 재질 선택 또는 스포이드 샘플링
4. 카탈로그 자산이 없으면 비동기 다운로드·캐시·웹용 변환
5. 실제 규격으로 텍스처 미리보기
6. 클릭하면 기존 `PaintCapability`를 통해 한 번의 undo transaction으로 적용
7. 동시에 `FinishAssignment`를 갱신하고 마감표/수량을 dirty 상태로 표시

RawPainter에서 재사용할 제품 기능:

- category/product paging과 상세 조회
- 동일 제품 중복 다운로드 방지와 안정된 cache key
- 이미지 또는 SKM 계열 자산 가져오기
- 텍스처 실제 폭/높이와 seamless 옵션
- 제품 ID, 코드, 분류, 브랜드, 가격, 이미지 메타데이터
- 현재 재질 샘플링과 활성 재질 상태

SketchUp Ruby 구현 자체를 브라우저에 이식하지 않는다. `PublicCatalog`와 `MaterialImporter`의 동작 계약을 INTM API와 웹 asset pipeline으로 옮기고, Pascal의 기존 slot paint dispatcher를 유지한다.

### 3. 자재 선택과 snapshot

- 검색은 회사별 활성 자재와 공통 자재를 INTM 권한으로 조회한다.
- 선택 시 ID, 이름, 단위, 브랜드, 카테고리, 이미지, 당시 단가/통화, revision을 모델 버전 snapshot에 기록한다.
- 화면에는 live 상태와 snapshot 상태를 구분해 보여준다.
- 단종/숨김/권한 변경 자재는 모델에서 사라지지 않는다. `unavailable` 표시와 대체 자재 선택 흐름을 제공한다.
- 자재 교체는 동일 slot 전체, 선택 노드, 선택 공간, 프로젝트 전체 범위를 명시한다.
- RawPainter 자산의 실제 폭/높이를 텍스처 repeat 계산에 사용하고, 사용자가 회전·축척·offset을 조정하면 assignment에 비파괴 transform으로 보존한다.
- 온라인 자재를 선택한 즉시 빈 재질로 칠하지 않는다. 저해상도 preview를 먼저 보여주고 asset 준비가 끝난 뒤 동일 material ref를 고해상도로 갱신한다.

### 4. 수량과 견적 연결

수량 엔진은 geometry에서 다음 basis를 산출한다.

- 면 마감: 순면적, opening 공제, 적용률, 로스율, 구매 단위 환산
- 선형 마감: 길이, 이음/로스율
- 개별 품목: 개수
- 공간 기준: INTM `locationId`에 매핑된 room/zone별 집계

산출 결과에는 `sourceNodeIds`, surface slot, 계산식 버전, 원수량, 공제, 로스, 최종수량을 보존한다. 숫자 하나만 견적에 보내지 않는다.

견적 흐름:

1. 현재 모델 버전에서 마감 수량 snapshot 생성
2. INTM 견적 항목과 stable linkage로 비교
3. 추가/변경/삭제/단가변경을 change set으로 표시
4. 사용자가 항목별 포함 여부와 수량 override 검토
5. 승인된 change set만 원자적으로 반영
6. 적용 결과와 원본 모델 버전을 audit log에 기록

수동 override는 모델 재계산 시 지우지 않는다. 새 계산값과 차이를 보여주고 사용자가 유지/갱신하도록 한다.

### 5. Paint·RawPainter·마감재 완료 기준

- INTM 자재 검색 결과를 ID로 wall/slab/ceiling/item slot에 지정하고 저장·재열기 후 유지한다.
- 같은 Paint 패널에서 Pascal 기본 재질, Scene 재질, INTM/RawPainter 자재를 전환하며 별도 도구 재진입 없이 칠한다.
- RawPainter 제품을 처음 선택하면 다운로드 상태와 실패/재시도가 표시되고, 두 번째 선택은 동일 asset을 중복 다운로드하지 않는다.
- 제품 규격 600 × 1200 mm fixture가 6 × 12 m 벽에서 각 방향 10회 반복되며 텍스처 scale 허용오차가 1% 이내다.
- 단일 표면, 전체 객체, 동일 재질, 공간 범위 칠하기와 스포이드가 RawPainter 자재에도 기존 재질과 동일하게 동작한다.
- 한 번의 범위 칠하기는 한 번의 undo로 모두 되돌아가며 `FinishAssignment`도 함께 복원된다.
- 같은 이름의 회사 자재와 공통 자재가 섞여도 올바른 ID와 가격 정책을 사용한다.
- 문/창 opening을 공제한 면적과 로스율이 fixture corpus 기대값의 0.5% 이내다.
- 위치별 finish schedule이 INTM 현장 자재 시트와 동일한 material/location/source linkage를 가진다.
- 자재 단가가 바뀌어도 과거 모델 버전 snapshot은 바뀌지 않고 live 차이만 표시한다.
- 단종 자재를 열 수 있고, 대체 후 영향 범위와 견적 차이를 확인한다.
- 승인 없이 견적 항목이 생성·수정·삭제되지 않는다.

## 실행 순서

### Epic A — Project Bridge 기반

- host-injected adapter와 no-INTM fallback
- 프로젝트 연결 UI와 모델 문서 metadata
- INTM 인증/권한 오류 계약
- 모델 버전 게시 및 상태 표시
- durable outbox, mutation idempotency, observability

### Epic B — Annotation Bridge MVP

- 협업 Annotation DTO와 API
- 2D/3D 핀 작성, 댓글, resolve
- semantic anchor와 viewpoint 캡처
- dangling/relink UI
- INTM 모델링/현장 화면 표시

### Epic C — Unified Paint + Finish Material Bridge MVP

- `MaterialPaintPanel` 안에 INTM/RawPainter provider 추가
- 카테고리·검색·상세·다운로드·cache 상태 adapter
- 실제 규격 texture transform과 웹 asset 변환
- Pascal library/Scene/INTM 재질을 하나의 picker contract로 통합
- Pascal surface slot assignment
- material snapshot과 unavailable/substitution 상태
- room/location 매핑과 finish schedule
- INTM 현장 자재 시트 표시

### Epic D — Quantity to Estimate

- surface/linear/count quantity engine
- opening 공제, coverage, waste, unit conversion
- estimate change-set preview API/UI
- override 보존, 원자적 apply, audit log

### Epic E — 현장 운영 확장

- Annotation을 현장 점검 이슈와 연결
- 사진, 담당자, 심각도, 마감일
- 발주/입고 상태와 모델 surface 역추적
- 모바일/field viewer의 viewpoint 열기
- 모델 버전 간 Annotation과 마감재 영향 비교

## 검증 전략

### 단위 테스트

- DTO/schema parsing, ID와 revision validation
- semantic anchor resolve/dangling/relink
- material assignment과 snapshot migration
- RawPainter product DTO, cache key, 실제 규격 texture transform
- 면적·길이·개수·공제·로스·단위 환산
- change-set diff와 manual override 보존

### 통합 테스트

- adapter contract를 mock server와 검증
- RawPainter 원본/clone fallback 응답을 동일 DTO로 정규화
- catalog asset 다운로드 idempotency, cache hit, 취소, 재시도
- 회사/프로젝트 권한과 tenant isolation
- outbox 재전송 idempotency와 충돌
- 모델 버전 게시 후 meta/material/annotation round-trip
- 견적 preview/apply transaction과 audit record

### 브라우저 E2E

1. INTM 프로젝트에서 Editor 열기
2. 벽에 치수와 핀 댓글 추가
3. 동일 Paint 패널의 RawPainter 카탈로그에서 규격 자재를 골라 벽 interior에 적용
4. 벽/개구부 수정 후 anchor와 수량 갱신 확인
5. 모델 버전 게시
6. INTM 현장 모델링 화면에서 Annotation과 마감표 확인
7. 견적 change set 검토 후 일부만 승인
8. Editor 재열기 후 상태와 linkage 확인

### 운영 관측

- project/model version, mutation ID, 사용자, 회사 ID를 포함한 구조화 로그
- sync queue depth, retry count, conflict rate, publish latency, estimate apply failure율
- payload에는 댓글 본문과 민감 가격 전체를 남기지 않는다.

## 위험과 대응

- **기존 field-viewer가 파일 버전 중심**: editable Pascal document와 node/feature index를 별도 artifact/meta로 추가한다.
- **INTM route 변화**: UI가 route에 직접 의존하지 않고 adapter contract와 contract test를 사용한다.
- **tenant 정보 노출**: 모든 API에서 서버측 프로젝트 접근 권한과 company 범위를 재검증한다.
- **Annotation 이중 소유**: 설계 Annotation과 협업 Annotation의 저장소와 lifecycle을 분리한다.
- **가격 변동**: snapshot 가격과 live 가격을 동시에 표시하고 견적 반영 시 다시 확인한다.
- **RawPainter와 Paint 상태 이중화**: 활성 재질, 스포이드, 적용 범위, undo는 Pascal `material-paint`만 소유하고 RawPainter provider는 재질 선택/asset 상태만 반환한다.
- **브라우저와 SketchUp 재질 표현 차이**: 공통 product DTO와 물리 규격을 SSOT로 두고 SKM/SketchUp Material과 Pascal PBR은 별도 renderer adapter로 생성한다.
- **대용량 텍스처 지연**: thumbnail 우선, 취소 가능한 다운로드, 해상도별 cache, 실패 재시도를 제공한다.
- **수량 과신**: 계산 basis와 공제 내역을 공개하고 승인 없는 자동 반영을 금지한다.
- **wall assembly 부족**: 1차 finish face만 지원한다고 UI와 산출물에 명시한다.
- **오프라인 충돌**: outbox, revision, idempotency key, 명시적 conflict UI를 기본 기능으로 둔다.

## 구현 착수 조건

- INTM 측 Annotation API와 모델 version meta 확장안 승인
- Pascal document/project linkage 저장 위치 결정
- surface slot ↔ INTM 자재 assignment schema 확정
- RawPainter product/detail/asset 응답을 정규화한 공통 material provider contract 확정
- 제품 규격, 텍스처 축척/회전/offset, seamless 처리 규칙 확정
- location(room/zone) 매핑 규칙 확정
- 견적 change-set preview/apply 권한과 audit 계약 확정
- 두 저장소 공통 contract fixture와 staging 프로젝트 준비

위 조건은 구현을 미루기 위한 문서 절차가 아니라, 서로 다른 저장소가 같은 ID·버전·권한 의미를 사용하기 위한 최소 계약이다.
