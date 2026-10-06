# 수동 공간 경계 보정 구현 계획 — 2026-10-03

## 계약과 소유권

계획/검수는 gpt-6-astra high, 구현은 gpt-6-luna max. 이전 스킬의 gpt-5.6 라우팅보다 사용자의 최신 지시가 우선한다. 리더가 실제 모델/effort를 확인한 한 명의 구현자에게 아래 파일 전체를 맡긴다. 병렬 소스 변경은 하지 않는다. 기존 dirty 및 untracked 파일은 사용자 작업이며 통째 덮어쓰기/되돌리기/스테이징 금지. 배포, push, 사용자 장면 변경, 사용자 3002 서버 재시작은 범위 밖이다.

목표: 2D 노란 경계 표시에서 대상 벽 또는 끝점을 명시해 미리보기 후 연결하고, 기존 끝점 드래그로 스냅 보정하거나, 실제 개방 상태를 유지하며 해당 점검을 의도적 개방으로 완료한다. 새 방이 생기지 않거나 간격이 350mm를 넘더라도 명시적 수동 수정을 허용한다. 기하/문·창·부착물 안전 검증은 유지한다. 기존 유일한 자동 연결은 유지한다. 한 번 Undo, Esc 취소, 저장/재로드, readOnly/오래된 계획 거절은 필수이다.

## 직접 확인한 현재 구조

- `packages/core/src/lib/room-boundary.ts`: 자동 후보는 0.35m 한도와 새 공간 증가 검증에 묶인다. `candidateForWall`은 무한 직선 교차점을 구하나 한 후보는 한 source endpoint만 움직인다. `diagnoseEndpoint`가 벽 ID별 후보를 세어 같은 교차점도 모호해진다. 자동 bundle은 최대 4개 후보로 닫힘을 입증한다.
- `buildRoomBoundaryRepairUpdates`는 복사 snapshot에 `buildWallEndpointUpdates`를 순차 적용하고 ID별 patch를 합치는 재사용 가능한 구현 패턴이다. 자동 함수의 조건을 통째로 풀지 않는다.
- `packages/core/src/lib/wall-operations.ts:601`: `buildWallEndpointUpdates`는 연결된 끝점, hosted child frame rebase, span, reverse/collapse, 곡선, 기존 T접합 단절을 검증한다. 직접 UI에서는 readOnly와 최신 snapshot을 별도로 확인해야 한다.
- `packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.tsx`: marker는 클릭 시 structure/zones/select/site로 이동해 벽만 선택한다. 끝점/issue 정보는 선택으로 전달되지 않는다. pointerdown/up은 stopPropagation만 한다.
- `packages/nodes/src/wall/floorplan.ts:273`: 선택한 벽의 두 endpoint handle은 Zones에서도 생성된다. `renderers/floorplan-registry-layer.tsx`의 `startAffordanceDrag`가 `def.floorplanAffordances['move-endpoint']`를 실행하고 scope/포인터/취소/Undo를 담당한다. `floorplan-panel.tsx:11777`의 marker는 registry overlay보다 뒤에 그려져 같은 위치의 핸들을 가린다. legacy Zones geometry gate만 고치면 해결된다고 가정하지 않는다.
- `packages/nodes/src/wall/floorplan-affordances.ts`와 `move-endpoint-tool.tsx`: 스냅/방향 고정/live override가 이미 있지만 commit은 endpoint 직접 쓰기이며 hosted-child 검증 함수가 아니다. 이 경로를 노출하려면 안전 preflight를 보강하고 해당 3D 동작도 동일하게 맞춘다.
- Registry dispatcher는 ephemeral commit session도 pointerup/cancel 시 snapshot을 되쓴다. 외부 변경 뒤 stale 거절을 해도 이 되쓰기가 외부 작업을 되돌릴 수 있으므로 해당 경로의 복원 조건도 검증해야 한다.
- scope는 `reshaping`, `reshape:'endpoint'`, `driver:'floorplan'`를 이미 지원한다. 새 `useEditor` boolean이나 별도 병렬 도구 매니저를 만들지 않는다.

실행 근거: `.omo/evidence/manual-boundary-plan-20261003/discover.ts`를 `bun`으로 직접 실행했다. `discovery.json`/`discovery.log`에 원본 복사 장면의 auto=false/ambiguous와 기존 검증 함수의 두 벽 업데이트를 기록했다. 대상은 `wall_ggf99ydyqrsc817f:end`, `wall_m5sb1yvia8zx4239:end`; 교차점 `[8.14421627274387,-3.8852224848374206]`; 연장량 `0.16036658354114586m`, `0.0535m`. 같은 교차점 후보에 `wall_syjw2ob0uot6yx11`도 있다. 후보의 좌표가 같더라도 영향을 받는 벽/patch가 다른 선택을 무조건 합치지 않는다.

## 구현 순서

### 1. 기존 테스트로 계약을 고정하고 수동 core 계획 추가

`room-boundary.test.ts`에 아래 양성/음성 fixture부터 추가한다. `room-boundary.ts`에 명시적 source endpoint + target wall/endpoint + source/target snapshot을 받는 순수 수동 계획 함수와 의도적 개방 메타데이터 helper를 추가하고 `core/src/index.ts`에서 export한다. 자동 builder의 350mm/새방 조건은 유지한다.

수동 연결 규칙:

1. 같은 level의 유한한 직선 벽을 요구한다. source의 반대 끝점은 고정한다. 벽 body 선택은 source 진행선과 target 중심선의 교차점을 계산한다. target segment 내부라면 source만 이동하는 T 연결이다. target segment 밖이면 가까운 target 끝점을 같은 교차점으로 연장하여 두 벽 방향을 보존한다. source/target endpoint 명시 선택도 같은 검증을 거친다. 임의 diagonal 점프를 corner extension으로 위장하지 않는다. collinear의 명시 endpoint 연결은 진행방향을 보존하고 overlap/reverse/collapse를 만들지 않을 때 허용한다. 분리 평행선/곡선은 구체적인 거절 이유를 표시한다.
2. 350mm와 새 공간 증가, 자동 후보의 `safe`, display gap 1.5m는 수동 허가 조건이 아니다. 사용자가 누른 같은 level 벽은 진단 후보 목록 밖이어도 평가한다.
3. 각 endpoint proposal을 복사 snapshot에서 기존 `buildWallEndpointUpdates`로 검증하고 순차 적용한다. ID별 patch를 합치고 마지막 topology/attachment 유효성을 다시 확인한다. geometry만 바꾼 자동 후보를 곧바로 적용하지 않는다. source의 기존 hosted window/door/item ID, width, metadata, 유효 footprint를 보존한다.
4. 순차 검증의 중간 상태가 정상적인 양벽 연장을 거절하면 검증을 건너뛰지 않는다. 먼저 최소 실패 fixture와 이유를 리더에게 보고한다. 필요 시 `wall-operations.ts` 내부의 동일 검증을 최종 다중-wall proposal에 적용하는 좁은 함수로 추출한다.
5. 중복 후보는 실제 같은 교차점/같은 endpoint edit 결과별로 그룹화하고 대상 wall ID는 보존한다. 같은 점에서 서로 다른 target endpoint를 움직이는 안은 그룹 안의 별도 명시 선택으로 둔다. 중복 정리는 수동 UI/추천 선택에 한정한다. 자동의 후보 판정과 유일성/안전 조건을 넓히지 않는다. 서로 다른 교차점이 50mm 내에 있는 진짜 모호성은 자동 거절한다.
6. commit 직전에 source/target/연결벽/hosted children의 시작 snapshot과 현재 상태가 일치하는지 검증한다. issue ID의 3자리 반올림만 stale 토큰으로 쓰지 않는다. 변경/삭제/level 이동은 거절하며 최신 미리보기를 다시 요구한다.

의도적 개방:

- owner wall `metadata` 안의 endpoint별 작은 레코드에 intent와 검토한 wall geometry/level signature를 저장한다. source metadata와 다른 endpoint 기록은 병합 보존한다. schema는 기존 JSON metadata를 사용한다.
- 물리 `danglingEndpoints`와 공간 검출은 그대로 둔다. 진단 issue에 reviewed-open 상태를 파생시켜 미점검과 구분하고 marker/panel을 `개방 유지 · 확인 완료`로 표시한다. `enclosureStatus`, `autoFromWalls`, zone polygon, `boundaryNeedsReview`를 거짓으로 닫힘 처리하지 않는다. 확인 완료와 실제 열린 벽 개수는 별개이다.
- 같은 wall geometry/level이 바뀌면 기록이 만료되어 다시 미점검이다. 저장/Undo/Redo는 일반 scene metadata 경로를 따른다. 되돌리기 버튼으로 해당 endpoint 기록만 제거할 수 있게 한다.

### 2. marker와 기존 registry drag를 연결

`FloorplanZoneClosureLayer`를 `FloorplanRegistryLayer`의 overlay 끝에 한 번 렌더하고 좁은 `onEndpointDrag` callback을 받아 기존 `startAffordanceDrag`를 호출하게 한다. `floorplan-panel.tsx`의 마지막 중복 marker instance를 제거한다. 이 합성으로 geometry/pointer 변환/history 소유권을 복제하지 않는다. 화면 배율/회전 및 prior focus-ring 수정은 유지한다.

- marker 클릭/Enter: 해당 endpoint로 수동 연결 scope를 열고 sidebar 해당 issue를 선택한다. `대상 벽 또는 끝점을 선택하세요`를 표시한다. 범용 선택은 잠시 억제한다.
- marker press-drag 또는 panel `끝점 이동`: 같은 `move-endpoint` session을 사용한다. tap과 drag의 구별은 기존 포인터 이동 임계 패턴을 재사용하고 click fallthrough를 막는다. 열려 있던 연결 세션은 먼저 정리한다.
- target 선택: 같은 marker layer 내에서 plan-space pointer와 실제 동일 level wall geometry를 사용하여 클릭한 벽/끝점을 특정한다. 마우스 hover로 예상 target를 강조하고 클릭으로 고정한다. 실제 target ID를 core planner에 전달하며 nearest auto candidate를 몰래 선택하지 않는다.
- preview: `useLiveNodeOverrides`에 검증된 전체 affected wall/child patch를 표시한다. committed nodes/history는 그대로여야 한다. source/target와 두 개 연장량, `연결 적용`/`취소`를 표시한다. 두 벽 짧은 코너는 두 연장 선 모두 보인다.
- commit: readOnly, level, dependency snapshot을 재검증하고 fresh core plan과 preview 결과를 비교한다. 일치하는 patch만 `runAsSingleSceneHistoryStep` + 단일 apply로 적용한다. 불일치하면 preview를 지우고 이유를 표시한다.
- scope는 기존 endpoint reshape의 좁은 optional intent `boundary-connect`로 구분한다. active 여부/source endpoint는 scope 하나가 소유하고 target/preview는 그 owner의 로컬 draft이다. 3D 도구는 floorplan driver에 중복 mount되지 않아야 한다. 새 store/도구 union은 추가하지 않는다.
- Esc, tool/level/view 전환, unmount, 삭제, readOnly 전환은 자기 preview와 scope만 지운다. scene snapshot을 무조건 덮어쓰지 않는다.

### 3. endpoint drag 안전 검증과 2D/3D parity

기존 snapping 파이프라인을 유지하며 양쪽 endpoint commit 직전에 동일 core endpoint 검증을 수행한다. hosted-child patch도 같은 preview/commit 결과에 포함한다. `Alt` detach와 연결벽 cascade, 내부 host split의 기존 정상 동작은 회귀 fixture로 고정한다. attach=false 동작을 linked-wall 자동 전파 함수로 덮어쓰지 않는다. 필요 시 기존 builder의 내부 validation을 명시적 final-wall patch 목록에도 적용하도록 작은 추출을 사용한다.

`resolveEndpointWallSplit`는 scene을 변이할 수 있으므로 검증 전 호출하지 않는다. split 포함 변경은 계획 전체를 먼저 검증하고 성공 시 한 transaction에 적용한다. split을 순수 계획으로 만들기 위해 큰 구조 변경이 필요하면 구체 blocker를 리더에게 전달한다. 실패가 발견됐는데 source만 옮기거나 host opening을 잘라서는 안 된다.

Registry ephemeral session의 stale/cancel은 본 session의 live override만 제거한다. `session.commit`이 존재하는 순수 ephemeral 경로는 원본 snapshot을 무조건 되쓰지 않는다. legacy scene-writing session의 기존 복원은 보존하고, 외부 변경 유지 테스트를 추가한다. readOnly는 session 시작과 commit 두 곳 모두 검사한다.

### 4. panel과 canonical manual

`zone-closure-panel.tsx`: 모든 미점검 issue에 대상 연결, 끝점 이동, 개방 유지 액션을 제공한다. 자동 안전 후보에만 기존 빠른 연결을 추가로 유지한다. readOnly는 모든 변경 액션을 비활성화한다. 같은 교차점 그룹은 하나의 위치로 표시하되 여러 영향 결과가 있으면 대상 벽을 명시적으로 선택하게 한다. panel action과 marker는 같은 scope/core planner를 공유한다.

`modeling-agent-manual.ts`의 기존 direct boundary 항목을 교체한다: 자동 보수 조건, 수동 명시 연결의 새방/거리 독립성, 양끝 코너 연장, 의도적 개방의 비물리성, 안전/취소/Undo를 설명한다. 새 AI/MCP mutation API는 추가하지 않는다. `ontology-manual.test.ts`, `resources/resources.test.ts`에서 manual과 `buildAiModelingPrompt`/`pascal://agent-guide` 반영을 검증한다.

## 파일 소유권

한 구현자: `core/src/lib/room-boundary{,.test}.ts`, `core/src/lib/wall-operations{,.test}.ts`(검증 재사용에 필요한 범위), `core/src/index.ts`; `editor/src/components/editor-2d/floorplan-zone-closure-layer{,.test}.tsx`(기존 test 확장자는 .ts), `editor-2d/renderers/floorplan-registry-layer{,.test}.tsx`(기존 test는 .ts), `editor/floorplan-panel.tsx`, `ui/sidebar/panels/zone-panel/zone-closure-panel.tsx`; `editor/src/lib/interaction/scope.ts`와 관련 scope 테스트; `nodes/src/wall/floorplan-affordances{,.test}.ts`, `move-endpoint-tool.tsx` 및 그 검증 테스트; 위 manual/tests. helper 추출은 이 소유 파일 근처에서 기존 도구의 중복 제거에 한정한다. unrelated import/vector/viewer/zone-sync 파일 변경은 금지하며 필요하면 리더에게 이유를 보고한다.

## 필수 fixture와 바이너리 관측값

| 시나리오 | fixture/동작 | 통과 관측값 |
|---|---|---|
| 실제 코너 | baseline의 두 wall/end 선택 | 두 끝점이 정확한 교차점; 반대 끝점/방향/기존 window 불변; 단일 Undo graph exact |
| 열린 L | `[0,0]→[1.8,0]`, `[2,.2]→[2,2]` | 두벽 `[2,0]` 연결 성공, before/after room count=0 허용 |
| 큰 간격 | source `[0,0]→[1,0]`, target `[2,0]→[2,2]` | 수동 1m 성공, 자동은 large 거절 |
| 같은 점 중복 | target `[2,0]→[2,2]`, `[2,2]→[2,4]` | 같은 교차점의 동일 edit는 한 선택; 다른 target extension 결과는 보존 |
| 진짜 모호성 | target x=2와 x=2.03 두 벽 | 자동 거절, 명시 선택 x=2.03만 반영 |
| target 내부 | T형 target center 클릭 | 기존 host와 openings 보존; core 경계 연결은 host를 불필요하게 split하지 않음 |
| hosted 시작점 | start 연장되는 벽에 door/window/item | world center/width/metadata 유지, localX rebase 및 wallT 유효 |
| 음성 | collapse/reverse/곡선/다른 level/삭제/nonfinite/T단절/host span 밖 | ok=false, updates=[], graph/history 불변 |
| stale | preview 후 source 0.1mm, target 또는 child 변경 | commit 거절, 외부 변경 유지, override/scope 정리 |
| readOnly | 시작 전 및 preview 후 전환 | preview/commit 금지; graph/history 불변 |
| 개방 유지 | 열린 L의 source review | wall geometry 및 space count 불변; reviewed 표시; Undo/reload/geometry 만료 정확 |
| cancel | 양벽 preview 후 Esc/level/view/tool 전환 | graph/history exact, 모든 자기 override 제거 |
| drag parity | 2D marker 드래그와 3D 기존 handle | snapping/Shift/Alt 정상; openings 안전; 각 single Undo |
| focus 회귀 | zoom/rotation 상태 marker keyboard focus | 픽셀 크기 ring 유지, 거대한 사각 outline 없음 |

## 검증 호출과 증거

구현 시작 시 `omo-agent-toolkit ulw-loop status --json`을 재확인한다. 계획 시점 CLI는 missing runtime 오류여서 `.omo/evidence/manual-boundary-plan-20261003/`를 사용했다. active attempt가 없으면 구현 증거는 `.omo/evidence/manual-boundary-repair-20261003/`에 저장한다. 이하 E는 그 절대 경로이다. 각 명령의 stdout/stderr와 exit code를 별도 파일에 저장하고 모든 artifact가 nonempty인지 확인한다.

1. `bun test packages/core/src/lib/room-boundary.test.ts packages/core/src/lib/wall-operations.test.ts packages/nodes/src/wall/floorplan-affordances.test.ts packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts packages/editor/src/store/use-interaction-scope.test.ts` → `E/focused-tests.log`; 새 실패 test를 먼저 기록하고 구현 후 전체 재실행.
2. `bun run --cwd packages/nodes build` → `E/nodes-build.log`.
3. `bun run --cwd apps/editor check-types` → `E/types.log`.
4. `bunx biome check <실제로 바꾼 소스/테스트 파일 목록>` → `E/biome.log`.
5. `bun test packages/core/src/lib/space-detection.test.ts packages/core/src/lib/space-detection-history.test.ts packages/mcp/src/ontology-manual.test.ts packages/mcp/src/resources/resources.test.ts` + 변경한 split/endpoint 회귀 → `E/regression.log`.
6. `bun run --cwd apps/editor build` → `E/editor-build.log`; 경고와 실패 분리.
7. isolated runtime 3014와 copied QA database의 현 상태/소유권 확인 후 같은 source build를 실행한다. 3002는 손대지 않는다. 리더가 이미 같은 owned QA DB에 생성한 `qa-manual-boundary-20261003` 장면과 새 `browser-baseline.json`/`before.png`를 확인해 사용한다. 과거 QA report는 증거로 재사용하지 않는다.
8. 실브라우저에서 fixture scene `qa-manual-boundary-20261003`의 2D→Zones→실제 노란 표시→target wall 선택→양벽 preview→연결 적용→Undo→Redo→저장/재로드를 실행한다. 실제 URL 형태는 현재 router를 확인한다. `E/browser-actions.json`, `E/before-graph.json`, `E/preview-state.json`, `E/after-graph.json`, `E/undo-graph.json`, `E/reloaded-graph.json`, `E/corner-preview.png`, `E/corner-committed.png`에 동작과 graph exact equality/좌표/overlay count를 기록한다. 콘솔과 pageerror는 `E/console.json`에 저장한다.
9. 같은 UI로 no-room, >350mm, ambiguous target, marker drag, 개방 유지/만료/reload, Esc, readOnly, stale 시나리오를 실행하고 시나리오별 JSON+화면을 저장한다. fixture 주입/외부 stale 변경은 테스트 setup으로만 허용; 주된 mutation은 UI 클릭/drag로 수행한다. 3D endpoint drag도 별도 UI 증거를 남긴다.
10. `E/acceptance.json`에 각 위 criterion의 exact scenario, invocation/action sequence, binary observable, artifact absolute path를 기록한다. 로그 통과만으로 UI를 완료 처리하지 않는다.

## 중단/완료 기준

리더가 승인한 범위에서 모든 criterion의 fresh nonempty evidence가 있고 검수자가 실제 artifact를 읽어 확인했을 때만 완료. 모델 불가, 정상 geometry가 기존 core 검증에 거절, host split atomic preflight가 대규모 재설계를 요구, 사용자 서버/장면 침범 필요, 다른 작성자의 동일 파일 충돌은 구체 자료와 함께 리더에 보고한다. 구현자는 의도/geometry 안전 조건을 임의로 완화하거나 API/배포 범위를 늘리지 않는다.
