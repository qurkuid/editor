# 벽 소속 구역 정보 이동 — 검증 결과

- 커밋: `d5a762ca202f7a39e6902e4feca07541d7db77a5`, fork `deploy/floorplan` 푸시 완료.
- 변경: RelatedZonePanel의 구역 카드를 기본 버튼으로 연결. 기존 phase/layer/zone 선택 사용. 모바일 구역 선택 해석과 열린 정보 시트 유지.
- 이번 커밋 파일: `related-zone-panel.tsx`, `panel-manager.tsx`, `related-zone-panel.test.tsx`. 다른 작업 보존.
- 검증: 관련 테스트 27개 통과, 앱 타입 검사 통과. UI 경로가 Biome 기본 설정에서 제외되어 동일 규칙의 임시 설정으로 검사; 오류 없음, 정보 수준 알림 2개. git diff --check 통과.
- 서버 독립 릴리스: nodes/mcp 빌드, 앱 타입 검사, 운영 빌드 모두 통과. 기존 middleware 폐기 예정 경고 있음.
- 런타임: PM2 apt-subdomain online, PID 61485, `/Volumes/DATABASE/floorplan-releases/20261002-d5a762ca/apps/editor`.
- BUILD_ID: `mu5klzdGCKy5Qxdq1JI05`. 공개 /apt HTTP 200 응답의 BUILD_ID와 일치.
- 로컬: `expert-room-qa` 벽 카드에서 QA Living Room 정보 이동, Enter 키 이동, 모바일 열린 벽 정보에서 구역 정보로 이동 확인. 콘솔 오류 없음.
- 운영: https://apt.intm.kr/scene/cb044b5dc9de 에서 5번째 Wall의 거실/안방 소속 카드 각각 선택. 실 이름 입력값 각각 거실/안방으로 확인. 안방 Enter 키 확인. 모바일 운영 벽 속성 시트에서 거실 클릭 후 실 정보가 열린 상태 유지; 실제 CSS viewport 354×767. 콘솔 오류 없음.
- 기존 운영 탭은 거실 정보 화면 유지, 테스트용 새 탭은 닫고 viewport override 해제.
- DB 온라인 백업 및 이전 PM2 구성 보존, 초기 응답 실패 시 자동 롤백 구성 유지. 장면 편집/마이그레이션 없이 선택 UI만 조작.
- CI 워크플로는 main 전용이므로 deploy/floorplan 푸시는 CI 대상 아님. 서버 릴리스의 타입 검사와 빌드로 검증.

