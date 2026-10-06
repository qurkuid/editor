# 아파트 공간 존 및 경계 연결

Sol/high 계획 검토 결과를 구현 계약으로 채택한다. Luna/max 고정 역할로 구현하고 부모가 브라우저를 검증한다.

## 현재 사실

- `planAutoZonesForLevel`은 기존 존 갱신만 수행한다.
- `buildVectorNodes`는 감지된 공간을 OCR 존과 조정하지만 누락 공간의 존을 만들지 않는다.
- 문/창은 연속 벽의 hosted opening이며 공선 간격은 의도된 개방 통로일 수 있다.
- 기존 사용자 수정은 toolbar, registry layer, viewer-chrome 사전에 있다. 보존한다.

## 구현 계약

1. AutoZoneSyncPlan을 create/update로 확장한다. 명시적 apartment import와 apt-vector 벽/존이 있는 레벨의 live wall edit에만 누락 존 생성을 활성화한다. 기존 존/semantic subdivisions의 합집합이 공간을 소유하면 중복 전체 존을 만들지 않는다.
2. 신규 존은 정확한 감지 polygon, boundaryWallIds, autoFromWalls, room role, enclosed, finish-faces, apt-vector provenance를 가진다. 미매칭 원본 존은 polygon/이름/색/마감을 보존하며 open/review 표시를 한다. 재연결 시 enclosed와 review 해제를 적용한다.
3. 순수 경계 진단은 존이 전혀 없는 레벨에서도 열린 벽 끝을 표시한다. 같은 공간 탐지 좌표 및 T 접합 정책을 사용한다. 직선 벽의 짧은 비평행 T/L 단절만 연결 후보로 삼는다. 공선/큰 간격/곡선/경쟁 목표는 수동 확인이다.
4. 가상 적용으로 닫힌 공간 생성/복구를 입증하고 기존 공유 endpoint 검증으로 방향/hosted opening/접합 안전성을 확인한 후보만 빠른 연결에 포함한다. 새 벽은 만들지 않는다. stale/readOnly는 mutation 전에 거부한다.
5. 2D overlay에 색상 점/점선/길이를 표시하고 ZonePanel의 공간 경계 점검에서 선택/위치 확인/연결을 제공한다. 존 미생성 사례에서도 발견할 수 있어야 한다. 기존 building/frame 변환을 재사용한다.
6. 하나의 원자적 사용자 동작으로 벽 수정과 존 생성/갱신이 함께 적용되며 undo/redo 한 번으로 정확히 복원한다.
7. canonical modeling manual과 MCP/internal AI prompt 노출 테스트를 갱신한다. 새 AI mutation operation은 요청하지 않았으므로 추가하지 않는다.

## 검증

- import: OCR 누락 공간 자동 존, semantic subdivisions 보존/전체 중복 방지, 재실행 중복 방지, open 원본 상태 보존.
- geometry: T/L 연결, 닫힌/hosted opening false positive 없음, 공선/곡선/큰 간격/경쟁 목표 manual-only, invalid/stale/readOnly 무변경.
- transaction: 열린 레벨 연결 후 존 생성, undo 정확한 이전 graph, redo 정확한 이후 graph.
- focused tests -> editor typecheck -> changed-file Biome -> 관련 regression -> 실제 2D UI -> production build.
- 브라우저: 200mm L-gap synthetic apartment scene에서 marker/연결/zone/undo/redo/persistence, 390px UI, 콘솔.

## 종료 조건

모든 인수 조건의 증거를 수집하고 검증 통과 후 완료를 보고한다. 테스트 장면은 사용자 장면과 분리하고 테스트 중 수정한 사용자 파일을 되돌리지 않는다.
