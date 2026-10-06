# Core 수동 경계 보정 검수

판정: **수정 필요 — 재현된 결함 2개.** UI/nodes 전체 완료 검수가 아닌 core 첫 pass 검수다. 제품 소스는 변경하지 않았다.

## P1 — 연결벽에 부착된 item의 최종 footprint가 벽 밖인데 수동 보정 승인

- 위치: `packages/core/src/lib/wall-operations.ts:405` 및 `:426`. `buildWallEndpointUpdates`의 `rebaseHostedChildren=true` 경로는 `getAttachmentSpan(child, before)`의 half-span을 최종 wall 검증에도 사용한다. 연결 endpoint cascade가 부착물의 host를 회전시키면 최종 벽 방향에 대한 폭/깊이 투영이 달라지지만 검증 폭이 갱신되지 않는다.
- 정확한 fixture: a=`[0,0]→[1.8,0]`; b=`[2,.2]→[2,2]`; c=`[2,.2]→[3,.2]`. c의 item은 localX=.35, width=.6, depth=2, rotationY=0, attachTo=wall. a:end에서 b를 수동 연결한다.
- 관측: `ok=true`; a/b 교차점 `[2,0]`; c:start도 `[2,0]`로 이동한다. 변경 뒤 host length=1.019803902718557, 현재 helper와 동일한 방향 투영 식으로 구한 item footprint min=-0.10786387432600114m. 즉 host 시작을 107.86mm 넘어가는데 거절되지 않는다.
- 영향: 사용자가 두벽 코너를 보정하면서 연결된 다른 벽의 부착물 안전성을 위반할 수 있다. 원본 및 item width/rotation이 유효한 fixture이다.
- 최소 수정 방향: center의 old-world→new-local rebase는 before 프레임을 사용하되, 최종 footprint half-span은 after 프레임과 최종 child transform으로 계산해 모든 affected host를 검사한다. 실패 시 빈 updates로 원자 거절한다. 일반 endpoint drag에서 같은 helper를 사용하면 회귀 검증에도 포함한다.
- 재현 호출: `bun .omo/evidence/manual-boundary-repair-20261003/core-review-item-probe.ts`
- 증거: `/Users/changseok/editor/.omo/evidence/manual-boundary-repair-20261003/core-review-item-probe.json`, `core-review-item-probe.log`, `core-review-item-probe.ts`.

## P2 — 수동 연장이 다른 직선 벽과 새 겹침을 만들어도 승인

- 위치: `packages/core/src/lib/room-boundary.ts:758-773` (순차 patch 이후 바로 성공). collinear branch `:740-742`는 선택한 target과의 overlap만 검사하고 최종 변경벽과 다른 level 벽의 overlap은 검사하지 않는다. 호출하는 endpoint validator도 기존 T접합 단절만 검사한다.
- 정확한 fixture: source `[0,0]→[1,0]`; target `[3,-1]→[3,1]`; 제3벽 `[1.5,0]→[2.5,0]`. source:end에서 target wall을 선택한다.
- 관측: `ok=true`, source end=`[3,0]`, 제3벽 불변. 결과는 두 벽의 중심선이 1m 겹친다. source는 선택 전 실제 dangling endpoint이고 입력은 직선/같은 level/유효 길이이다.
- 영향: 자동 미완성 경계를 수동 수정할 때 중복 wall geometry 및 중복 물량을 만들 수 있으며 기하 안전 요구를 충족하지 못한다.
- 최소 수정 방향: 최종 working snapshot에서 변경된 모든 wall과 같은 level 직선 wall 사이에 새 양의 길이 collinear overlap이 생겼는지 비교해 거절한다. 기존 접점/T연결은 허용하고 이미 존재한 unrelated overlap 때문에 무관한 보정을 모두 막지 않는다.
- 재현 호출: `bun .omo/evidence/manual-boundary-repair-20261003/core-review-probes.ts`
- 증거: `/Users/changseok/editor/.omo/evidence/manual-boundary-repair-20261003/core-review-probes.json`의 `new_collinear_overlap`, 동명 `.log`와 `.ts`.

## 직접 검증한 통과 범위

`bun test packages/core/src/lib/room-boundary-manual.test.ts packages/core/src/lib/room-boundary.test.ts packages/core/src/lib/wall-operations.test.ts` → **37 pass / 0 fail / 130 assertions**. artifact: `/Users/changseok/editor/.omo/evidence/manual-boundary-repair-20261003/core-review-tests.log`.

추가 `core-review-probes.ts` 결과: 기존 T 접합 단절은 `detached-wall-junction`으로 updates=[] 거절; 유효 collinear endpoint 연결 성공; 선택 target 중복과 분리 parallel 거절; hosted start 연장 door localX .8→1.0 rebase; preview snapshot 이후 child width 변경은 stale 거절; 의도적 개방 기록은 JSON roundtrip 유지하고 0.1mm source geometry 변경 시 만료. 모든 probe에서 입력 graph JSON 불변을 확인했다. 기존 manual test의 제목 `rejects ... detached existing T junctions`에는 실제 T fixture가 없으므로 해당 보장은 별도 probe로 검증했다.

Snapshot helper는 level의 모든 wall 및 parentId/wallId로 연결된 child 전체를 직렬화하므로 정상 관계의 source/target 0.1mm 및 child 변경을 감지한다. 테스트의 door rebase는 통과하나 위 linked rotated item 결함 때문에 **all affected child safety 통과로 간주할 수 없다**. exact Undo, readOnly, visible preview, save/reload browser, scope cleanup는 UI 구현 후 별도 검수가 필요하다.
