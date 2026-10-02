# INTM 견적 제출 결과·링크 개선 계약

## 실행 프로필과 범위

- 기획 lane: `gpt-5.6-sol`, reasoning `high`.
  - 근거: `/Users/changseok/.codex/agents/code-reviewer.toml`의 `model = "gpt-5.6-sol"`, `model_reasoning_effort = "high"`.
- 목표: 독립 견적 제출 직후 사용자가 성공·부분 실패·전체 항목 실패를 정확히 알고, 방금 생성된 INTM 견적 편집기로 이동할 수 있게 한다.
- 범위 밖: 제출 이력 저장, 재시도/재개 시스템, 원자적 롤백, INTM API 전환, 고객 공개 링크, 기존 Zone/재질/도면 작업.
- 기존 계약 유지: 견적 문서 생성 뒤 항목이 일부 또는 전부 실패해도 문서는 존재하므로 `ok: true`; 문서 생성 자체가 실패할 때만 `ok: false`.

## 확인된 현재 계약

- `apps/editor/lib/estimate-submit.ts`는 이미 성공 추가 수 `itemCount`와 실패 수 `failedItems`를 센다.
- `apps/editor/components/stats-tab.tsx`는 성공 응답 타입에서 `failedItems`를 누락해 실패 정보를 버리고 문자열 한 개만 렌더링한다.
- INTM의 현재 편집 화면은 `/newportal/estimates/[id]/edit`이며, 동일한 `estimates`/`estimate_items` 테이블을 읽는다. Pascal의 기존 `/api/estimates` 생성과 `/api/estimates/{id}/items` 추가 결과를 이 편집기가 조회할 수 있다.

## 구현 계약

1. `apps/editor/lib/estimate-submit.ts`
   - 성공형에 필수 `estimateUrl: string`을 추가한다.
   - 문서 ID를 받은 직후 서버의 `intmBaseUrl()`과 URL 인코딩한 ID로 `${base}/newportal/estimates/${id}/edit`를 만든다. 브라우저가 호스트를 추측하거나 하드코딩하지 않는다.
   - 반환 수는 의미를 바꾸지 않는다: `itemCount`는 추가 성공 수, `failedItems`는 추가 실패 수, 전체 시도 수는 두 값의 합이다.
   - 항목 추가 루프, 순차 처리, `ok` 판정은 바꾸지 않는다.

2. `apps/editor/components/stats-tab.tsx`
   - `submitResult`를 문자열 대신 `SubmitResult | null`로 보관하고 API 성공형을 `failedItems`와 `estimateUrl`까지 소비한다.
   - 결과 영역은 다음 세 경우를 구분한다.
     - 완전 성공: `failedItems === 0`; 성공한 `itemCount` 표시.
     - 부분 실패: `itemCount > 0 && failedItems > 0`; 성공/전체/실패 수를 모두 표시하고 INTM에서 확인·완성하도록 안내.
     - 전체 항목 실패: `itemCount === 0 && failedItems > 0`; 빈 견적 문서는 생성됐지만 항목 추가는 전부 실패했다고 명시.
   - 세 `ok: true` 경우 모두 동일한 “INTM에서 견적서 열기” 링크를 표시한다. 새 탭 링크는 `target="_blank"`와 `rel="noopener noreferrer"`를 사용한다.
   - `ok: false`와 예외는 기존처럼 오류만 표시하며 링크를 만들지 않는다. 새 제출 시작 시 이전 결과를 지운다.
   - 결과 컨테이너에는 `aria-live="polite"`를 적용하고, 성공과 경고/오류의 색을 구분하되 기존 카드 레이아웃을 유지한다.

3. `packages/editor/src/i18n/dictionary/furniture.ts`
   - 기존 완전 성공 문구는 유지하거나 명확한 success 키로 이동한다.
   - 부분 실패, 전체 항목 실패, 편집기 열기 문구를 한국어/영어로 추가한다.
   - 각 문구의 토큰은 `{added}`, `{failed}`, `{total}`처럼 의미가 드러나게 통일한다.

## 수용 기준

- 3/3 성공 응답은 “3개 추가” 성공 상태와 설정된 INTM 편집 링크를 보인다.
- 2/3 성공 응답은 “2개 성공, 1개 실패” 경고 상태와 같은 편집 링크를 보인다.
- 0/3 성공 응답은 문서 생성 사실과 “3개 모두 추가 실패”를 함께 보이며 편집 링크를 보인다.
- 문서 생성 실패/네트워크 예외는 편집 링크 없이 오류를 보인다.
- 링크의 origin은 실행 서버의 `INTM_BASE_URL`과 일치하고 경로는 `/newportal/estimates/{encodeURIComponent(estimateId)}/edit`이다.
- 기존 제출 비활성 조건, 프로젝트 연결 저장, 확정 항목 필터링에는 회귀가 없다.
- 제출 이력, 자동 재시도, 고객용 공개 URL은 추가되지 않는다.

## 테스트와 검증

1. `apps/editor/lib/estimate-submit.test.ts`
   - 완전 성공: `itemCount: 3`, `failedItems: 0`, 정확한 `estimateUrl`.
   - 부분 실패: 성공/실패 수와 URL을 함께 검증.
   - 전체 항목 실패: `ok: true`, `itemCount: 0`, `failedItems: N`, URL을 검증.
   - 설정된 base URL의 후행 슬래시가 제거되고 ID가 경로 인코딩되는 케이스를 포함한다.
   - 기존 문서 생성 실패, ID 누락, 세션/설정 누락 테스트는 유지한다.

2. 정적 검증
   - `bun test apps/editor/lib/estimate-submit.test.ts`
   - `bun run --cwd apps/editor check-types`
   - `bunx biome check apps/editor/lib/estimate-submit.ts apps/editor/lib/estimate-submit.test.ts apps/editor/components/stats-tab.tsx packages/editor/src/i18n/dictionary/furniture.ts`

3. 브라우저 안전 검증
   - 현재 3002 서버와 `.next`를 건드리지 않는 별도 작업 복사본/워크트리와 별도 포트(예: 3102)를 사용한다. 빌드도 그 격리된 복사본에서 실행한다.
   - 편집기가 hydration을 마치고 `Ground Floor`/로드 완료 화면이 보인 뒤 일반 클릭으로 통계 탭을 연다. hydration 전 강제 클릭이나 그 직후 스크린샷은 통계 탭 진입 증거로 인정하지 않는다.
   - 브라우저 네트워크를 가로채 `/api/intm/materials`, `/api/intm/projects`, `/api/intm/estimates`에 고정 fixture를 반환한다. 실제 INTM/API 외부 mutation(`POST`/`PATCH`/`PUT`/`DELETE`)은 0건이어야 한다.
   - 제출 응답을 차례로 `{ok:true,itemCount:3,failedItems:0}`, `{ok:true,itemCount:2,failedItems:1}`, `{ok:true,itemCount:0,failedItems:3}`로 바꿔 세 문구와 링크 href를 확인한다.
   - `ok:false`와 fetch reject도 확인해 링크가 사라지고 오류만 노출되는지 검증한다.
   - 콘솔 오류와 page error가 0건임을 캡처한다. `iconify`/`unisvg`, `editor.pascal.app` 텍스처 같은 확인된 편집기 정적 자산 `GET`은 허용 목록으로 분류하거나 fixture로 mock할 수 있으며, 외부 요청 0건 자체를 성공 조건으로 삼지 않는다.
   - 네트워크 증거에는 허용된 정적 자산 `GET`, mock된 로컬 API, 차단 대상 외부 mutation을 구분해 기록한다.
   - 마지막으로 격리 복사본에서 `bun run --cwd apps/editor build`를 실행한다.

## 파일 소유권과 상향 보고

- 구현 대상: `apps/editor/lib/estimate-submit.ts`, 그 테스트, `apps/editor/components/stats-tab.tsx`, `packages/editor/src/i18n/dictionary/furniture.ts`.
- `apps/editor/app/api/intm/estimates/route.ts`는 결과를 그대로 직렬화하므로 코드 변경이 필요하지 않다.
- INTM 저장소 수정이나 공개 고객 링크 요구가 생기면 현재 범위를 넘으므로 상위 기획 lane으로 돌린다. 현재 확인된 편집 라우트와 데이터 테이블 계약만으로는 경계 변경이 필요 없다.
