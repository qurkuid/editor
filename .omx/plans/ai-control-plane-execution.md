# Pascal AI Control Plane 실행·검증 명세

작성일: 2026-08-02

## 우선순위

INTM 연동은 모델링·AI 기반 구현 뒤로 미룬다. 현재 최우선은 사용자가 편집기 안에서 AI와 대화하고, AI가 화면 캡처가 아닌 Pascal 장면 형식 자체를 이해해 세부 모델링을 수행하며, 같은 기능을 CLI에서 호출·진단할 수 있게 만드는 것이다.

## 제품 계약

1. AI 입력의 SSOT는 `SceneGraph`, 노드 JSON Schema, 재질 슬롯, 좌표계, 선택/작업 문맥이다. 픽셀과 스크린 좌표를 모델 의미의 근거로 사용하지 않는다.
2. 앱 대화창과 외부 CLI는 동일한 create/update/delete 패치 의미와 MCP semantic tool을 사용한다.
3. 모델 응답은 신뢰하지 않는다. API 경계에서 Zod로 파싱하고, 현재 장면을 대상으로 dry-run한 뒤에만 실행한다.
4. AI가 만든 여러 변경은 하나의 history transaction이며 Undo 한 번으로 복원된다.
5. 실행 전 변경 수와 종류를 보여주고 사용자가 적용한다. 실패 시 부분 적용하지 않는다.
6. 디버깅은 구조화 데이터로 제공한다. 활성 장면, 노드 수, validation, history 깊이, 저장소 상태, 최근 operation을 앱과 CLI에서 추적한다.
7. API 키는 서버에서만 읽고 장면과 함께 브라우저로 노출하지 않는다.

## 경계

- `packages/core`: 장면 스키마, history, 순수 모델링 불변식만 소유한다. AI/provider/chat 개념을 알지 않는다.
- `packages/mcp`: 외부 AI/CLI용 semantic tools, scene resources, debug resources를 소유한다.
- `packages/editor`: 호스트가 주입할 수 있는 편집 UI 경계만 소유한다.
- `apps/editor`: AI provider 설정, 대화 세션, 현재 장면 context 조립, 적용 전 검토 UI를 소유한다.

## 단계와 검증 게이트

### Gate AI-1 — 구조화 실행 코어

- `SceneGraph` 기반 context 생성
- MCP `apply_patch`와 같은 create/update/delete 계약
- 전체 패치 사전 검증
- 단일 Undo transaction

통과 기준:

- 2개 이상의 생성/수정이 Undo 1회로 모두 복원된다.
- 잘못된 ID, 부모, 노드 스키마가 있으면 변경 0건이다.
- context에 screenshot/pixel 의존 필드가 없다.

### Gate AI-2 — 대화창과 모델 연결

- Editor V2 sidebar AI panel
- 로그인된 Codex CLI OAuth 세션을 재사용하는 서버 어댑터
- 전체 `AnyNode` JSON Schema와 현재 scene context 전달
- 구조화 응답 재검증, 변경 미리보기, 명시적 적용
- 키 미설정/timeout/invalid response 상태 표시

통과 기준:

- API 키가 없으면 장면을 바꾸지 않고 설정 오류를 표시한다.
- 유효한 provider fixture가 반환한 patch가 UI에 적용 대기로 나타난다.
- 적용 후 장면 node count가 바뀌고 Undo로 복원된다.

### Gate AI-3 — CLI와 내부 디버깅

- stdio/HTTP MCP transport 유지
- `pascal://scene/current`와 node/tool schemas로 형식 이해
- `pascal://debug/state`로 scene/history/validation/store/recent operation 조회
- 저장 장면은 SQLite scene event를 통해 브라우저와 CLI 변경을 공유

통과 기준:

- MCP in-memory, stdio, HTTP transport에서 리소스 목록과 debug state를 읽는다.
- debug state가 현재 node count와 history count를 정확히 반환한다.
- 저장 장면에서 CLI mutation kind/version/node count를 최근 이력으로 추적한다.

### Gate AI-4 — 세부 모델링 도구 확장

순서:

1. 벽/방/문/창/슬래브/천장/지붕
2. 이동/회전/스케일/배열/복제
3. Body edge/face, Push/Pull, Offset, boolean
4. 가구 검색·배치·교체
5. 재질 슬롯, texture placement, RawPainter
6. Annotation 생성·연결·수정

각 도구는 semantic MCP tool을 우선 사용하고, 범용 patch는 도구가 없는 세부 필드 편집에만 사용한다.

통과 기준:

- 각 도구별 schema fixture, invalid fixture, single-undo, save/reopen, 2D/3D 결과 검증을 통과한다.
- AI가 실행 뒤 `validate_scene`과 해당 도메인 검증 도구를 호출한다.

## 반복 검증 루프

```text
사용자 요청
  → 구조화 scene/context 읽기
  → 모델이 plan 생성
  → Zod/schema 검증
  → 현재 장면 dry-run
  → 변경 미리보기
  → 단일 transaction 적용
  → validate + domain check
  → 실패 시 Undo + trace
  → 성공 시 save/checkpoint + 결과 요약
```

다음 게이트로 넘어가는 조건은 unit/type/lint/build뿐 아니라 실제 편집기에서 장면 변경과 Undo가 확인되는 것이다.
