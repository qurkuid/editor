# 노란 핸들 수동 보완 검증

2D 기능 구현 및 실제 브라우저 검증 완료. 로컬 변경이며 커밋·푸시·배포하지 않았습니다. 원본 대신 격리된 QA 복사 장면에서 조작했습니다.

- 노란 핸들 클릭 → 대상 벽/끝점 선택 → 양쪽 연장 미리보기 → 연결 적용. 실제 문제 코너는 160.3666mm와 53.5mm 연장해 공통 교차점으로 연결.
- 클릭 대상은 SVG 겹침 순서와 무관하게 실제 가장 가까운 선분을 선택. 정확한 동거리 후보는 좌표와 함께 명시 선택.
- 노란 핸들 직접 드래그와 놓기로 적용. 한 번의 Undo는 전체 장면을 정확히 복원.
- 1m 간격의 열린 L자도 닫힌 방 증가 없이 수동 연결 가능. 자동 연결의 보수적인 기준은 유지.
- 개방 유지는 형상 변경 없이 메타데이터만 저장. 새로고침 후 유지, 다시 점검으로 해제.
- 미리보기는 저장 데이터 불변; Esc 및 뷰 전환 시 취소.

## 실제 브라우저 증거

`acceptance.json`의 11개 조건은 모두 true. `stable-final-undo.json`은 `stable-before.json`과 정확히 같고, `stable-final-redo.json` 및 `stable-reloaded.json`은 `stable-applied.json`과 정확히 같습니다. `stable-drag-undo.json`도 원본과 정확히 같습니다. `open-l-*` 파일은 1m/가까운 타겟/개방 표시/뷰 취소 검증입니다.

처음 HMR이 진행되던 탭에서는 이전 벽 그리기 도구의 history pause 때문에 Undo 증거가 유효하지 않았습니다. 이후 stable source의 새 복사 장면에서 실제 키보드 Undo/Redo를 다시 수행하고 exact graph 비교를 통과했습니다. 초기 `final-*` 또는 `undo-graph.json`을 최신 Undo 증거로 사용하지 않습니다.

## 검증

- 253 tests / 14 files / 0 failures: `implementation/regression-final.log`
- core/nodes/MCP builds, editor typecheck, changed-file Biome, diff whitespace 통과: `implementation/implementation-report.md`
- 전체 프로덕션 빌드 exit 0: `production-build.log`. middleware convention deprecation 경고만 있었으며 타입은 별도 check-types로 검증했습니다.
- 독립 읽기 검수: `final-code-review.md` 마지막 stable-source 후속 검수.

## 한계

3D의 같은 endpoint planning/validation/atomic Undo 경로는 순수·세션 테스트를 통과했지만, 실제 3D 드래그는 뷰어 초기화 오류로 검증하지 못했습니다. final QA에서 `[viewer] renderer initialization failed`(08:15:01.205Z), supplemental QA에서는 초기화 실패와 React root unmount 오류(08:14:14.958Z)가 기록됐습니다. 2D 연결·드래그 검수 중에는 해당 입력 오류가 없었습니다. 별도 기존 viewer 변경은 수정하지 않았습니다.

곡선 연결, 벽 반전/축퇴, 부착물 유효 범위 이탈, 기존 T 접점 분리, 새로 증가하는 벽 겹침은 변경 전에 거절합니다. 관련 없는 기존 겹침은 수동 수정을 막지 않습니다.
