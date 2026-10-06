# 존 버튼 검증

- 우측 상단 적층 버튼 바로 왼쪽에 `존` 텍스트 버튼 추가.
- 기존 structureLayer를 사용해 켜기/끄기. 진입 전 진행 중인 도구를 취소하고 요소/존 선택을 정리함.
- 2D 존 클릭도 selection.zoneId 경로를 사용하도록 보완. 일반 요소 선택, Build/Delete, 도장 모드의 기존 동작 보존.
- 별도의 존 상태, 렌더러, 패널, 의존성 추가 없음.

## 변경 파일

- apps/editor/components/viewer-toolbar.tsx
- apps/editor/components/viewer-toolbar.test.ts
- packages/editor/src/i18n/dictionary/viewer-chrome.ts
- packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx
- packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts

## 검증

- 관련 6개 파일: 65 tests pass / 0 fail / 127 assertions.
- apps/editor check-types 통과.
- 변경 5개 파일 Biome 통과, git diff --check 통과.
- PASCAL_NEXT_DIST_DIR=.next-zone-button-qa 프로덕션 빌드 통과. 사용자 dev server 유지.
- localhost:3002/scene/expert-room-qa: 3D와 2D에서 존 진입, 라벨 선택, 실 정보·마감재·수량 패널 표시 확인.
- 390×844: 존 버튼 표시·터치·종료와 기존 속성 편집 시트 접근 확인. 뷰포트 원복.
- QA 모델의 graphHash e2bd354dc26269bd783a3566dc21ad8071e7f9d4e9221c927ee6eab8ffeea776, nodeCount 9 유지. 자동 저장으로 버전은 증가했지만 모델 데이터는 동일.
- Sol 리뷰 승인. 좁은 2D 선택 보완은 native luna-max (gpt-5.6-luna/max)에서 구현.

## 한계와 경고

- 검증된 소스 5개 파일을 5942f036으로 커밋해 fork/deploy/floorplan에 푸시 완료. 원격 브랜치 SHA 일치 확인. 운영 배포는 별도 검증하지 않음.
- dev HMR 노드 재등록/scene readiness 경고 관찰. 모바일 레이아웃 전환 과정에서 기존 WebGPU destroyed 로그 발생; 원복 및 새로고침 후 최종 버튼 동작에서 새 error 없음.
- 기존 모바일 툴바의 다른 긴 텍스트는 좁은 화면에서 줄바꿈/잘림. 요청한 존 버튼과 바로 오른쪽 적층 버튼은 접근 가능.
- QA fixture의 기존 천장고 누락은 NaN으로 표시됨. 이번 변경에서 모델 데이터를 수정하지 않음.
- 빌드의 기존 middleware deprecation 경고 유지.

![적층 왼쪽 존 버튼](zone-button.jpg)
