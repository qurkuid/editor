# 전체 변경 검토 — 2026-10-06

## 결론

`git add -A`는 현재 안전하지 않다. 검토 스냅샷(2026-10-06 11:17 KST, `HEAD=0a7624f24eed9194857563967da57afa96339342`)에는 추적 파일 수정 1개와 미추적 항목 13,835개가 있었다. 미추적 항목의 apparent size는 약 2.30 GiB이며, `.omo/evidence`가 13,801개를 차지한다. 로컬 `.omo/evidence` 전체는 이미 ignore된 파일까지 포함해 17,090개, 약 3.0 GiB다.

초기 보수적 후보는 제품 코드/테스트, 계획 문서, Markdown/SHA256 증거만 포함한 93개였다. 이후 부모 요청에 따라 직접 작성한 증거 스크립트·HTML 보고서·패치·텍스트 검증도 검사해 포함했고, PNG/GLB와 복제 소스는 로컬에 남겼다. 최종 reviewed staged-ready 목록은 아래와 같다.

## 최종 staged-ready 목록

- [`staged-ready.nul`](./staged-ready.nul): NUL 구분, 267개, 2,404,668 bytes
- [`staged-ready.txt`](./staged-ready.txt): 사람이 읽는 동일 목록
- 구성: `.gitignore` 1개, 제품 소스/테스트 4개, 계획 33개, 검토된 evidence 229개
- evidence 형식: Python 74, Markdown 37(전체 목록 기준 Markdown은 계획 포함 70), text 42, TypeScript 36, SHA256 16, HTML 10, shell 10, patch 4, TSX 2, diff 1, reviewed JSON 예외 1

`export-face-integrity-plan-20261006/replay.json`은 전역 JSON ignore에 걸리지만, 키가 `scenario`, `walls`, `results`, `allClosed`, `allRawBroken` 및 기하 카운터/ID로만 구성되고 URL·경로·이메일·비밀정보 패턴이 없음을 확인해 force-add 예외로 목록에 넣었다.

로컬 보존 제외 목록은 [`excluded-local-preserved.nul`](./excluded-local-preserved.nul)에 NUL 구분으로 15,866개를 기록했다. 현재 `.gitignore`로 숨겨진 파일과 아래 추가 수동 제외 102개의 합집합이며, reviewed JSON 예외는 제외 목록에서 뺐다. [`excluded-supplemental.txt`](./excluded-supplemental.txt)는 추가 수동 제외 경로와 사유를 사람이 읽는 형식으로 담는다.

## 변경 범주

| 범주 | 개수 | apparent bytes | 판단 |
|---|---:|---:|---|
| 추적 수정 | 1 | — | 커밋 후보 |
| 미추적 전체 | 13,835 | 2,470,960,632 | 일괄 스테이징 금지 |
| `.omo/evidence` 미추적 | 13,801 | 2,470,719,793 | 선별 필요 |
| `.omo/plans` 미추적 | 33 | 236,922 | 커밋 후보 |
| 제품 테스트 미추적 | 1 | 3,917 | 커밋 후보 |
| 이미 ignore된 `.omo/evidence` | 2,290 | 547,816,488 | 로컬 보존 |

주요 중복/위험 범주는 서로 겹친다.

| 위험 범주 | 개수 | bytes | 이유 |
|---|---:|---:|---|
| SQLite DB/journal | 58 | 948,973,104 | 장면·고객 데이터, 로컬 상태, 백업 포함 |
| `backups/` | 22 | 554,500,096 | DB 백업 |
| JPG/JPEG | 7,412 | 1,024,715,361 | 대량 원본/오버레이/스크린샷 캐시 |
| JSON/NDJSON | 3,516 | 390,422,959 | API 응답, 장면 그래프, 전체 평면 데이터 가능 |
| 로그/PID/PYC | 567 | 2,081,086 | 런타임/빌드 출력 |
| `product-final/` | 1,634 | 187,705,856 | 복제 작업공간과 소스 사본 |
| `replay/` | 3,069 | 393,359,733 | 반복 생성 결과 |
| `baseline*`/`candidate*`/`paired*` | 8,382 | 1,074,846,915 | 반복 비교 산출물 |
| `apt-data/`/`qa-data/` | 59 | 41,070,284 | 외부/고객 평면 데이터 및 절대경로 링크 |
| 심볼릭 링크 | 64 | 링크 자체 3,585 | 4개는 저장소 밖 절대경로, 60개는 중복 상대 링크 |

개별 파일은 100 MiB를 넘지 않지만 10 MiB 초과 파일이 34개이며, 가장 큰 파일들은 18–38 MiB SQLite DB/백업이다. GitHub 단일 파일 제한만 피한다고 안전한 커밋이 되는 상태가 아니다.

## 권장 스테이징 범위

기본 후보:

1. `packages/nodes/src/zone/quantities-panel.tsx`
2. `packages/nodes/src/zone/quantities-panel.test.tsx`
3. `.omo/plans/`의 미추적 Markdown 33개
4. 고위험 경로를 제외한 `.omo/evidence/**/*.md`와 `.omo/evidence/**/*.sha256` 58개

4번에서 다음 두 문서는 전화번호처럼 보이는 문자열이 각각 1개씩 검출됐다. 문맥을 숫자 마스킹 상태로 검사한 결과 벽 좌표/길이의 소수점 연속값이 정규식에 걸린 오탐이라 최종 목록에는 포함했다.

- `.omo/evidence/apartment-source-chain-guards-20261003/r4-nonexpected-wall-attribution/report.md`
- `.omo/evidence/manual-boundary-repair-20261003/core-review.md`

PNG 201개는 선택적 후보다. 최종 QA를 직접 증명하는 소수만 열어 보고 추가하고, 원본 도면·중간 비교·중복 화면은 로컬에 남긴다.

## 비밀정보/개인정보 스캔

제품 코드/테스트, 계획 Markdown, 위의 Markdown/SHA256 증거 후보를 파일 내용 값 없이 검사했다.

- AWS/GitHub/OpenAI 형식 키, 개인키 헤더, JWT 형식의 고신뢰 비밀정보: 0개 파일
- `authorization`, `bearer`, `api_key`, `access_token`, `refresh_token`, `client_secret`, `password`, `cookie`, `session_id` 대입형 패턴: 0개 파일
- 이메일/한국 휴대전화 형태: 8개 파일. 2개 문서와 1개 Python은 기하 좌표/길이 오탐, 5개 release shell은 `user@host` 형태의 SSH 원격 주소로 확인됐다. 실제 이메일/휴대전화 값은 없었다.

이 검사는 패턴 기반이며 이미지와 SQLite 내부 내용은 보증하지 않는다. 그래서 PNG는 육안 검토, DB/백업은 전부 제외한다.

## `.gitignore` 제안

[`recommended-ignore-patterns.txt`](./recommended-ignore-patterns.txt)의 패턴을 현재 `.gitignore` 끝에 추가하는 것을 권장한다. 기존 ignore는 `build-workspace/`, `*.pickle`, `*.tar.gz`만 일부 막고 있어 DB, 대량 JPG, JSON 장면/API 출력, 절대경로 데이터 링크가 계속 미추적으로 노출된다.

패턴은 파일을 삭제하지 않고 Git 후보에서만 숨긴다. 이미 추적 중인 과거 `.omo/evidence` 파일에는 영향을 주지 않는다.

제안 패턴은 부모 작업에서 `.gitignore`에 반영됐다. 그 뒤 남은 후보에서도 raw public-console/server 캡처, 재구성 vectorizer, 실험용 복제 소스, raw HTML/HTTP/AX/URL 출력, 과거 dirty diff를 추가로 제외해 최종 267개 whitelist를 만들었다. 이 추가 제외는 `.gitignore` 변경 없이 manifest 수준에서만 적용했다.

## 차단점과 주의사항

- 검토 도중 다른 작업자가 `.omo/plans/export-face-integrity-20261006.md`를 추가해 계획 문서가 32개에서 33개로 늘었다. 스테이징 직전에 상태와 개수를 다시 산출해야 한다.
- `git add -A` 또는 `.omo/evidence` 전체 추가는 DB/백업과 4개 절대경로 심볼릭 링크를 포함할 수 있다.
- `.omo/evidence`의 1,306개 TypeScript 파일 대부분은 `product-final/` 등 복제 작업공간에서 왔다. 제품 소스 변경으로 취급하면 안 된다.
- 보고서 폴더 자체는 검토 산출물이며 기본 제품 커밋 후보 집계에서 제외했다.

## 최종 게이트

`.gitignore` 반영 후 스테이징 목록을 다시 만들고, 다음 조건을 모두 확인해야 한다.

- staged DB/journal/log/JPG/절대경로 symlink가 0개, JSON은 검토된 `replay.json` 한 개
- 제품 변경은 `glb-export.ts`, `glb-wall-topology.test.ts`, `quantities-panel.tsx`와 해당 테스트 4개로 일치
- 계획/증거 문서는 예상 개수와 일치
- `git diff --cached --check -- .gitignore packages` 통과. 과거 증거 패치의 빈 문맥 행과 텍스트 캡처에는 원본 공백이 있으므로 전체 evidence 대상 검사는 통과하지 않았다. 증거의 원형은 보존했다.
- staged 파일만 대상으로 비밀정보 패턴 재검사 통과

## 최종 인덱스 재검증

부모가 기본 267개 whitelist에 검토 문서와 실제 DXF 검증 기록을 추가했다. 마지막 목록은 `final-stage-manifest.txt`에 기록한다. staged 내용으로 고신뢰 개인키/서비스키/JWT를 재검사한 결과 모두 0개였고, DB·이미지·로그·심볼릭 링크 제외 및 JSON 예외 한 개 조건도 통과했다. 제품 소스/테스트는 위의 4개다.
