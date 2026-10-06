## R4 p30 source-backed opening cluster repair

### Root finding
`o2`(pair 699.45mm), `o21`(frame 691.158mm), `o22`(parallel frame), `o28`(ray 1286.7mm)은 p30 현관 한 개구부의 중복 검출이다. 원본 1242×828 crop에서 jamb 사이 연속 밝은 통로는 x536..604 = 약1.30±0.04m이며 `o28`과 일치한다. `o2/o21`은 그 안 왼쪽 약0.70m 문짝/프레임 선이고 별도 jamb/pier가 없다. 증거 MD SHA `79e06a889e0b7f3857b249dae99ff92e0620de4690c7d6bbe9e3bd2407ce5722`, JSON SHA `2714b1455e38ba76aec8c258d43b6d08163fb29173f8f4e968e99c903be88871`. 따라서 LaneA의 26개 두-door 상태를 복원하지 말고 physical cluster 1개를 유지한다. 현재 R4의 25개 수 자체는 문제 아님; 좁은 `o21`을 남기고 전체 span `o28`을 버린 것이 문제다.

### Minimal generic implementation contract
1. **Placement 이전 cluster 판정**: 원본(아직 union/snap/weld/extension 전) wall segments에서만 판단한다. 같은 door type이고 span들이 중첩되며, 정확히 한 ray 후보가 다음을 모두 만족할 때만 `dualJambSupportedFullSpan`으로 고른다: finite `a/b/barrierA/barrierB`; barrier 양끝이 서로 다른 원본 wall envelope에 각 1개씩 지지됨; 두 support가 span 양쪽에 있음; ray `a..b`가 경쟁 frame/pair span을 포함함; 통로 내부를 가르는 제3 wall/pier envelope가 없음; support pair와 winner가 유일함. 하나라도 모호하면 기존 tighter-span 경로를 그대로 쓴다. 단순 `src==='ray'`, barrier 필드 존재, 큰 폭만으로 우선하면 안 된다.
2. **Loser는 topology를 바꾸기 전에 제거**: `o2/o21/o22` 같은 loser를 placement/DSU union/`extendToCrossingWalls` 전에 suppress한다. 그 ID는 `dedupedOpeningIds` 또는 동등한 provenance 진단에 모두 남긴다. winner node는 `sourceOpeningId:o28`, `sourceWidthMm:1286.7`, `sourceOpeningSource:'ray'`를 유지한다. 이렇게 해야 버릴 `o21`이 w19/w45를 먼저 union해 host geometry를 오염시키지 않는다.
3. **별도 source-backed host materialization**: winner는 left/right source groups를 union하지 않고, 선택된 두 jamb support의 centerline contact/projection 사이에 opening-host 1개를 만든다. thickness는 검증된 barrier/wall thickness를 사용한다. raw `a/b`를 host axis에 투영한 interval이 clamp 없이 정확히 host 내부에 들어가야 한다(각 endpoint world 오차 ≤1e-6 또는 기존 numerical epsilon). 들어가지 않으면 fail closed + diagnostic; 67mm 위치 이동을 숨기는 clamp는 금지한다.
4. **기존 retained-contact 안전장치 불변**: 새 host 때문에 `crossingExtensionRepresentable`, held-contact preflight/final guard, relation block key를 완화/삭제하지 않는다. source wall endpoint를 늘려 맞추지 않는다. host endpoint normalization은 선택된 두 jamb envelope/contact 내부와 기존 snap budget에서만 허용하며 unrelated segment/held endpoint 이동이 필요하면 전체 cluster branch를 원자적으로 거부한다.
5. **왜 wall 수가 57/58과 달라도 되는가**: 현재 58-wall 출력은 loser `o21`이 두 source group을 먼저 union한 결과다. 올바른 branch는 두 source groups를 서로 합치지 않고 source-backed opening host를 별도로 둔다. 따라서 derived wall node 수 변화는 허용하되, 원본 source wall contributor 좌표/ID와 cluster 밖 geometry는 strict parity, 추가 footprint는 두 jamb가 지지한 host envelope 안으로 제한한다.

### Fail-first tests
- p30 exact fixture: kept physical entrance는 1개, winner `o28`; `o2/o21/o22` 모두 provenance-accounted loser; width 1.2867m 및 modeled world interval raw `a/b` exact; p30 probes 6/6; repeat canonical stable.
- one-sided support, 양끝 same wall/group, detached/overshooting ray, intermediate pier, competing two full-span rays, non-containing/different-axis 후보는 winner override 금지.
- held retained-chain endpoint가 필요한 fixture는 branch 전체 reject, source graph byte/canonical parity, no partial DSU/endpoint mutation.
- 기존 tighter-span duplicate fixture는 그대로 통과하며 non-authoritative ray가 승격되지 않음.
- full replay: 44 accepted/6 calibration rejects, 각 기존 seed hit loss 0, total ≥298/330, slab/ceiling exact overlap 0, raw50/annotation/source hash unchanged. p07/p09 개선 attribution은 **order-only**로 기록; weld refinement을 p07/p09 원인으로 쓰지 않는다. p08/p29/p33/p37 weld 필요성은 별도 isolated evidence로만 주장.
- 실제 p30 2D overlay에서 jamb-to-jamb 한 개구부가 보이고 0.69m 두 번째 문이 없음; undo/redo/save/reload graph equality, 3D render/console gate.

### Review stop
현재 `b6a43e...` WIP은 HIGH blocker 유지. 위 branch가 구현·동결되고 exact p30 interval/provenance/negative fixtures + same50를 통과하기 전 final freeze 승인 금지. 단순 width-desc sort 반례는 25 openings/11 spaces/probes6/6이나 `o28`이 raw 위치에서 67mm clamp돼 불충분; 단순 대각 o21 합성 host 복원도 동일 opening을 2개로 만들어 REJECT.
