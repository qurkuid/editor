# Core 좁은 회귀 재검수

판정: **요청된 두 결함 수정과 기존 overlap 허용 회귀 통과.** 제품 소스 수정 없음. UI 및 전체 기능 완료 판정은 포함하지 않는다.

| 시나리오 | 직접 실행 | 관측값 | fresh artifact |
|---|---|---|---|
| 제3벽과 새 collinear overlap | `bun .omo/evidence/manual-boundary-repair-20261003/core-review-probes.ts` | `new_collinear_overlap`: ok=false, reason=overlap, updates=[], 원본 불변 | `core-review-recheck-probes.log`, `core-review-recheck-probes.json` |
| 회전한 linked host의 item footprint 밖 | `bun .omo/evidence/manual-boundary-repair-20261003/core-review-item-probe.ts` | ok=false, reason=attachment-outside-wall, updates=[] | `core-review-recheck-item.log`, `core-review-recheck-item.json` |
| 무관한 벽 두 개의 기존 overlap | `bun .omo/evidence/manual-boundary-repair-20261003/core-review-overlap-recheck.ts` | source end 1→3 승인, 기존 far overlap 불변, pass=true | `core-review-overlap-recheck.log`, `core-review-overlap-recheck.json` |
| 변경하는 source 내부의 기존 overlap 그대로 | 위 호출 | source end 1→3 승인, `[.2,0]→[.8,0]` 기존 겹침 증가 없음, pass=true | 위 artifact의 `changed_wall_unchanged_existing_overlap` |
| 변경하는 source의 기존 overlap 증가 | 위 호출 | source end 1→1.8 요청, 다른 벽 `[.5,0]→[2,0]`; 기존 .5m→1.3m 증가를 reason=overlap, updates=[] 거절, pass=true | 위 artifact의 `changed_wall_increased_existing_overlap` |
| 관련 core regression | `bun test packages/core/src/lib/room-boundary-manual.test.ts packages/core/src/lib/room-boundary.test.ts packages/core/src/lib/wall-operations.test.ts` | 39 pass, 0 fail, 133 assertions | `core-review-recheck-tests.log` |

위 artifact는 모두 `/Users/changseok/editor/.omo/evidence/manual-boundary-repair-20261003/` 아래 있다. 현재 검수 source SHA256은 `core-review-recheck-source.sha256`에 기록했다.

직접 source 확인: `room-boundary.ts:780-785`는 update에 포함된 wall만 시작점으로 최종 pair별 overlap을 원래 pair overlap과 비교한다. 기존보다 1e-6m 초과 증가할 때만 거절하므로, global 기존 overlap을 이유로 unrelated manual fix를 막는 방식이 아니다. 이 범위가 요청된 narrow guard에 적합하다. `wall-operations.ts:429`는 rebase center와 최종 after 방향의 item half-span을 조합해 최종 host 구간을 검사한다.

재실행 시 기존 probe 스크립트가 원래 `.json` 출력 위치를 덮어썼다. 이 재검수의 fresh 결과는 별도 `core-review-recheck-*.json`에 복사했고, 첫 검수의 실패 관측은 원래 `core-review-probes.log` 및 `core-review-item-probe.log`에 남아 있다. 보고서를 읽을 때 JSON은 fresh 결과, 최초 log는 이전 결함 결과로 구분한다.
