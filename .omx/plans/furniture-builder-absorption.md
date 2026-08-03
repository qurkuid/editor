# Furniture Builder 기능 흡수 계획

## 목표

Furniture Builder의 제작 중심 기능을 Pascal Editor의 기존 `cabinet` / `cabinet-module` 체계에 흡수한다. SketchUp Ruby 코드를 이식하지 않고, 가구의 의미·규칙·프리셋·산출물을 TypeScript 도메인으로 재구현한다. 사용자는 직접 UI와 AI 채팅 양쪽에서 동일한 기능을 사용할 수 있어야 하며, 두 경로는 같은 결정론적 furniture operation을 호출해야 한다.

완료 기준은 다음과 같다.

- 붙박이장, 주방 하부/상부장, 아일랜드, 싱크장과 통/단 구성이 저장·편집·재생성된다.
- 도어, 서랍, 선반, 옷봉, 찬넬, 상판, 필러, 마감판, 기기 개구가 실제 형상과 BOM에 함께 반영된다.
- 뷰포트와 속성 패널에서 모든 핵심 기능을 직접 조작할 수 있다.
- AI 채팅과 MCP가 같은 명령으로 가구를 생성·수정·검사·산출하며 한 작업은 한 번의 undo로 되돌아간다.
- 기존 Pascal cabinet 장면과 Furniture Builder JSON 프리셋을 손실 없이 정규화하거나 명시적인 경고와 함께 가져온다.

## 근거와 현재 격차

- Furniture Builder의 현행 스키마는 가구 전체 `W/H/D`, 통(bay), 단(tier), 깊이 기준, 도어, 선반, 옷봉, 찬넬, 단별 상판, 마커, 내부서랍, 조명/콘센트/SMPS까지 표현한다 (`/Users/changseok/Documents/furniture_builder/furniture_builder/furniture_schema.rb:43`, `:101`, `:113`).
- 타입별로 아일랜드 양면, 상하부 세트, 싱크/인덕션을 별도 구조로 가진다 (`furniture_schema.rb:132-210`).
- 기존 기능 목록에는 외/내서랍, 인출장, 슬라이딩, 플랩, 마감/필러, 5방향 여백, 상판 가공, 뷰포트 인라인 편집, 프리셋 CRUD, 판재·하드웨어 보고서가 포함된다 (`/Users/changseok/Documents/furniture_builder/docs/GAP_ANALYSIS.md:10-120`).
- Pascal의 현재 cabinet 스키마는 치수·몸통/상판·전면·재료와 compartment stack을 제공하지만, bay/tier 제작 의미와 개별 판재/하드웨어 산출 모델은 없다 (`packages/core/src/schema/nodes/cabinet.ts:23-111`).
- 현재 compartment는 선반/서랍/도어/싱크/가전/팬트리 종류를 이미 구분하므로 이를 폐기하지 않고 확장해야 한다 (`packages/core/src/schema/nodes/cabinet.ts:23-74`).
- 현재 전용 패널, 프리셋, 재배치, 코너 동기화가 이미 있으므로 새 앱을 만들지 않고 이 경로를 확장한다 (`packages/nodes/src/cabinet/panel.tsx:92-219`, `packages/nodes/src/cabinet/presets.ts:16-202`).
- AI는 현재 일반 patch와 일부 모델링 op를 스키마로 검증한다 (`apps/editor/lib/ai-contract.ts:14-97`). Furniture 명령도 같은 방식으로 명시적이고 검증 가능한 op가 되어야 한다.
- MCP의 장면 변경 표면은 create/update/delete/applyPatch와 history를 제공한다 (`packages/mcp/src/operations/scene-operations.ts:23-65`). Furniture op는 적용 전에 core에서 일반 patch로 정규화한다.

## 설계 원칙

1. `packages/core`는 저장 스키마, 정규화, 제작 규칙, BOM 계산처럼 Three.js와 무관한 순수 로직만 소유한다.
2. `packages/nodes/src/cabinet`은 geometry, selection affordance, viewport overlay, 전용 패널을 소유한다.
3. `apps/editor`는 Furniture 메뉴, 생성 흐름, AI 채팅 승인/미리보기와 직접 UI 조합을 소유한다.
4. `packages/mcp`는 core operation을 호출하는 얇은 도구만 제공한다.
5. UI·AI·MCP는 raw node patch를 제각각 만들지 않고 `FurnitureOperation -> validate -> plan -> patches -> single undo` 경로를 공유한다.
6. 기존 `cabinet` / `cabinet-module` node type과 장면을 유지한다. 호환 불가능한 새 의미만 버전된 `furniture` 필드 묶음으로 추가한다.
7. 생성 geometry와 BOM은 같은 정규화된 assembly model에서 파생한다. 화면에는 있으나 산출표에 없는 부재, 산출표에는 있으나 화면에 없는 부재를 허용하지 않는다.

## 목표 데이터 모델

`CabinetNode`는 run/가구 전체를, `CabinetModuleNode`는 bay를 계속 나타낸다. module의 기존 `stack`을 tier 목록의 저장 표면으로 확장하되 각 variant에 공통 제작 속성을 추가한다.

- Furniture-level: schemaVersion, furnitureKind(`wardrobe|base-run|upper-run|tall|island|set|sink`), location, overall constraints, margins, fillers, surround, curtain/ceiling-step, front/back side, material defaults.
- Bay/module-level: width, base(`plinth|legs|floating|none`), kickplate, end panels, visibility, lower stile, tiers.
- Tier/compartment-level: height, depth value/reference, face, opening/door kind, open method, extensions, shelves, hanger, internal drawers, channels, top/bottom panels, merge, fixtures, electrical components.
- Part specification: role, materialId, thickness, finished edges, grain direction, quantity rule, source node/feature IDs.
- Hardware specification: hinge/rail/support/handle/channel/light/outlet/SMPS product reference and quantity rule.
- Derived-only: generated panels, hardware, cutouts, BOM rows, warnings. 이를 장면에 중복 저장하지 않는다.

Furniture Builder의 mm 입력은 import와 UI 경계에서 프로젝트 단위로 변환하고 core 저장은 현재 Pascal 관례인 meter를 유지한다 (`packages/core/src/schema/nodes/cabinet.ts:85-106`).

## 단계별 실행 계획과 검증 게이트

### Gate 0 — 기준선과 수용 시나리오 고정

작업:

- 기존 cabinet 생성, run 편집, 프리셋, 이동/스냅, paint, undo 테스트를 기준선으로 기록한다.
- Furniture Builder 스키마 샘플을 최소 6개 고정한다: 붙박이장, 서랍장, 상하부 세트, 양면 아일랜드, 싱크/인덕션, 조명/전기 포함 가구.
- 아래 사용자 시나리오를 E2E 수용 기준으로 고정한다.

검증 게이트:

- 현행 cabinet 관련 unit test가 모두 통과한다.
- 각 샘플에 기대 치수, 판재 수, 하드웨어 수, 개구 위치의 golden fixture가 있다.
- 기존 장면 JSON을 load/save했을 때 semantic diff가 없다.

중단 조건: 기준선 실패가 있으면 기능 구현 전에 원인을 격리한다.

### Gate 1 — 버전된 스키마와 정규화/이관

예상 변경:

- `packages/core/src/schema/nodes/cabinet.ts`: 기존 필드를 유지하며 versioned furniture assembly 필드를 추가한다.
- `packages/core/src/lib/furniture/normalize.ts`: 기본값, 치수 제약, 타입별 규칙, 오래된 Pascal cabinet 변환.
- `packages/core/src/lib/furniture/import-furniture-builder.ts`: Ruby JSON의 camelCase/millimeter/type mapping.
- `packages/core/src/lib/furniture/operations.ts`: 이후 UI/AI/MCP가 공유할 명령 타입과 dry-run plan.

검증 게이트:

- 기존 cabinet fixture 100% parse.
- 6개 Furniture Builder fixture import 후 normalize를 두 번 실행해도 결과가 동일하다.
- 지원하지 않는 필드는 조용히 삭제하지 않고 structured warning을 낸다.
- m↔mm round-trip 허용 오차는 0.1 mm 이하이다.

### Gate 2 — 제작형 assembly와 geometry SSOT

예상 변경:

- `packages/core/src/lib/furniture/assembly.ts`: panel, hardware, cutout, fixture의 순수 assembly 생성.
- `packages/nodes/src/cabinet/geometry/`: assembly part 역할별 geometry adapter.
- `packages/nodes/src/cabinet/stack.ts`: tier 높이·깊이·기준·병합 제약 확장.

순서:

1. 몸통/뒷판/칸막이/선반/옷봉.
2. 여닫이/오픈/외서랍/내서랍.
3. 인출장/플랩/슬라이딩과 실제 pivot animation.
4. 좌대/다릿발/띄움, 걸레받이, EP, 필러, 서라운드, 마진.
5. L/U 찬넬, 단별 상판, 모따기/오버행.
6. 싱크/인덕션/수전 cutout, 조명/콘센트/SMPS.

검증 게이트:

- 각 part에 stable source/feature ID가 있고 재생성 후 선택·재질 binding이 유지된다.
- 치수 변경 후 self-intersection, 음수 판재, 중복 coplanar face가 없다.
- door/drawer animation 0%와 100%에서 몸통을 관통하지 않는다.
- geometry에서 집계한 role별 부재 수와 assembly part 수가 일치한다.
- 6개 golden fixture의 bounding box, part count, cutout 좌표가 허용 오차 내에서 일치한다.

### Gate 3 — 직접 UI/UX

예상 변경:

- Furniture를 Modeling/Paint/Lighting과 같은 독립 메뉴로 노출한다.
- 생성 패널: 가구 유형 → 전체 치수 → 통 배치 → 단 구성 → 재료/마감 → 배치 순서의 단계형 흐름.
- 선택 패널: 전체/통/단/부재 selection scope를 명시하고 breadcrumb를 제공한다.
- 뷰포트: W/H/D, bay/tier 경계, 활성 범위, ±/삽입/삭제 affordance, hover preview를 제공한다.
- 모든 수치 입력은 현재 프로젝트 단위를 따르고 입력 중 실시간 preview, Enter 확정, Esc 취소, 한 번의 undo를 보장한다.
- 고급 설정은 접되 핵심 생성/크기/통/단/재료/BOM은 숨기지 않는다.

검증 게이트:

- 마우스만으로 6개 샘플을 AI 없이 생성·수정할 수 있다.
- 키보드만으로 주요 필드와 추가/삭제/확정/취소에 접근할 수 있다.
- 선택 scope가 바뀔 때 편집 대상이 viewport와 panel 양쪽에서 동일하게 강조된다.
- 각 작업의 preview/commit/cancel/undo를 브라우저에서 실제 확인하고 스크린샷을 남긴다.

### Gate 4 — 재료, 제작정보, BOM/견적

예상 변경:

- 기존 SceneMaterial/RawPainter catalog ID를 carcass/front/countertop/edge/hardware 역할에 연결한다.
- material physical size, thickness, brand, product code, price unit, grain/finish 정보를 part spec이 참조한다.
- `packages/core/src/lib/furniture/bom.ts`: 판재, 엣지, 하드웨어, 조명/전기, 상판/가공을 그룹화하고 손실/수량 규칙을 계산한다.
- editor에 Furniture BOM 패널과 CSV/JSON export를 제공한다.
- 추후 INTM 연동은 catalog adapter 경계 뒤에 둔다. 이번 흡수 단계에서는 로컬 fixture와 adapter contract를 먼저 확정한다.

검증 게이트:

- geometry/assembly와 BOM source feature ID가 상호 추적된다.
- 같은 materialId·두께·가공 조건은 합산되고 다른 조건은 합쳐지지 않는다.
- 수정 전/후 BOM delta가 변경된 부재만 반영한다.
- fixture별 수동 산출표와 자동 BOM의 수량/치수가 일치한다.

### Gate 5 — AI 채팅과 MCP 동등성

추가할 대표 operation:

- `createFurniture`, `setFurnitureDimensions`, `setFurnitureKind`
- `insertBay`, `deleteBay`, `resizeBay`, `setBayBase`, `setBayFinish`
- `insertTier`, `deleteTier`, `resizeTier`, `setTierDepth`
- `setTierFront`, `setShelves`, `setHanger`, `setInternalDrawers`, `setChannel`
- `setTopPanel`, `setFillers`, `setSurround`, `setFixture`, `setFurnitureMaterial`
- `getFurnitureBom`, `validateFurniture`

예상 변경:

- `apps/editor/lib/ai-contract.ts`, `ai-provider.ts`, `ai-cli-provider.ts`, `ai-control.ts`에 operation schema/plan/normalization을 추가한다.
- `packages/mcp/src/tools/`에 같은 core operation을 호출하는 furniture 도구를 추가한다.
- AI chat에는 적용 전 구조화된 변경 요약, 예상 BOM delta, validation warning을 표시한다.

검증 게이트:

- 자연어 요청과 직접 UI 조작이 동일 normalized assembly hash를 만든다.
- AI가 임의의 raw cabinet data를 쓰지 못하고 operation schema 밖의 필드는 거부된다.
- 다중 operation 한 요청이 성공 시 한 undo, 중간 실패 시 전체 rollback된다.
- CLI OAuth 연결 상태에서 AI 채팅으로 6개 수용 시나리오를 실제 생성·수정하고 장면과 BOM을 검증한다.

### Gate 6 — 프리셋, 호환성, 성능, 릴리스 준비

작업:

- module/tier/furniture 프리셋 CRUD와 버전/태그/검색을 제공한다.
- Furniture Builder JSON batch import, import report, 실패 항목 격리를 제공한다.
- 큰 가구에서 dirty part만 재생성하도록 캐시 경계를 둔다.
- 이전 Pascal scene, import scene, 새 scene의 회귀 스위트를 통합한다.

검증 게이트:

- 100-bay 스트레스 fixture에서 편집 preview와 commit의 성능 예산을 정하고 초과 시 release gate를 닫는다.
- import → edit → save → reload → BOM export 전체 시나리오가 통과한다.
- lint, typecheck, changed-package unit tests, editor build, browser E2E가 모두 통과한다.
- 알려진 데이터 손실, geometry 오류, UI-only/AI-only 기능이 0개일 때만 흡수 완료로 판정한다.

## 우선순위와 제공 단위

1. **M1 기반 흡수**: Gate 0-2의 몸통/통/단/선반/옷봉/기본 도어/서랍. 기존 cabinet 사용성을 유지하면서 실사용 가구 구조를 만든다.
2. **M2 직접 편집**: Gate 3과 기본 재료 연결. 사용자가 AI 없이 완성할 수 있는 UI를 만든다.
3. **M3 제작 가능성**: 고급 문/인출/찬넬/상판/개구와 Gate 4 BOM.
4. **M4 AI 자동화**: Gate 5. 직접 UI에서 검증된 operation만 AI/MCP에 공개한다.
5. **M5 완전 흡수**: 프리셋 이관, 고급 타입, 성능/호환성, 실제 시나리오 검증.

각 milestone은 앞 gate가 통과하기 전 다음 단계로 넘어가지 않는다.

## 진행 기록

### 2026-08-03 — 통/단 내부 편집 슬라이스 통과

- 공통 core operation `setFurnitureTierInterior`로 안정 ID 기반 선반 0~8개와 행거 상태를 편집한다.
- 직접 UI는 `Furniture → Bay → Tier → Interior`에서 실시간 draft, Apply/Cancel, Enter/Escape를 제공한다.
- AI 채팅은 같은 operation만 사용하며 적용 전 `가구 내부 구성 1`을 표시하고 한 번의 undo 단위로 적용한다.
- 행거 형상은 봉 지름 25mm, 측면 여유 30mm, tier 상단 이격 60mm로 생성한다.
- 검증: core 14/14, nodes/UI 5/5, AI 36/36, Biome, core/nodes build, editor typecheck, production build 통과.
- 실제 브라우저: 직접 UI로 선반 2개+행거 적용, AI 채팅으로 선반 3개+행거 변경, 재진입 시 `Shelf count 3 / Hanger rod On`, console error 0건 확인.

이 기록은 Gate 3과 Gate 5 전체 통과가 아니라 첫 번째 공통 편집 슬라이스 통과를 의미한다. 다음 슬라이스는 통/단 삽입·삭제·크기 변경을 같은 operation/UI/AI 계약으로 구현한다.

### 2026-08-03 — 통/단 구조 편집 슬라이스 통과

- 공통 core operation 6개(`insert/delete/resizeFurnitureBay`, `insert/delete/resizeFurnitureTier`)를 추가했다.
- 전체 가구 W/H는 고정하며 인접 통/단이 치수를 보상한다. 마지막 통/단 삭제, 음수·비정상 치수, 존재하지 않는 stable ID, 보상 불가능한 변경은 적용 전에 거부한다.
- 복제되는 통/단/fixture ID는 결정론적으로 충돌을 피하고, tier 높이 변경 시 선반과 내부서랍 위치도 같은 비율로 조정한다.
- 직접 UI는 `Furniture → Bay/Tier`에서 폭·높이 입력과 추가/삭제를 제공한다. AI 채팅은 동일한 6개 core operation만 호출하고 구조 변경 라벨을 적용 전에 표시한다.
- 검증: 집중 회귀 52/52, core/nodes build, editor typecheck, Next.js production build, `git diff --check` 통과.
- 실제 브라우저: Bay 추가·삭제·폭 0.70m 변경, Tier 추가·삭제·높이 1.00m 변경, AI 채팅으로 300mm Bay 추가 및 한 번의 Undo 안내, console error 0건 확인.

이 기록도 Gate 3과 Gate 5 전체 통과가 아니다. 다음 슬라이스는 여닫이/서랍 전면을 assembly geometry에 추가하고 같은 직접 UI·AI 계약으로 편집하는 것이다.

## 테스트 구성

- Core unit: schema parsing, normalize idempotence, dimension constraints, operation planning, assembly/BOM determinism.
- Nodes unit: role geometry, material assignment, selection ID preservation, animation collision, partial regeneration.
- Editor integration: panel operation과 scene patch, preview/cancel/undo, unit display, selection scope.
- AI/MCP contract: schema rejection, dry-run, rollback, one-undo, UI equivalence hash.
- Browser E2E: 6개 수용 가구를 직접 UI와 AI chat으로 각각 생성하고 screenshot + scene summary + BOM artifact를 수집한다.

## 리스크와 방지책

- **스키마 과대화**: 모든 필드를 flat optional로 넣지 않고 furniture/bay/tier/part의 명시적 하위 스키마와 discriminated union을 사용한다.
- **geometry와 BOM 불일치**: 동일 assembly 출력을 두 consumer가 사용하도록 강제한다.
- **기존 cabinet 회귀**: 기존 필드 제거/rename 없이 normalize adapter로 승격하며 baseline fixture를 모든 gate에서 재실행한다.
- **뷰포트 성능**: stable feature ID, dirty subtree, memoized assembly를 먼저 설계하고 대형 fixture 예산을 둔다.
- **AI 전용 기능 발생**: AI에 공개할 operation은 대응하는 직접 UI affordance와 브라우저 검증이 있을 때만 활성화한다.
- **SketchUp 개념 누수**: Overlay, Tag, Group, Ruby callback 자체는 이식하지 않고 Pascal selection/registry/history/material 개념으로 번역한다.
- **INTM 결합 지연**: catalog/product adapter를 먼저 고정하고 원격 INTM 데이터는 로컬 기능이 검증된 뒤 연결한다.

## 구현 착수 순서

첫 구현 배치는 Gate 0과 Gate 1만 수행한다. 계획 모델은 `gpt-5.6-sol` high, 구현 작업 모델은 지침대로 `gpt-5.6-luna` max를 사용한다. 구현 모델을 현재 실행 환경에서 선택할 수 없으면 임의 대체하지 않고 가용성 제한을 기록한다.
