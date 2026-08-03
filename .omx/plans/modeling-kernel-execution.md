# Pascal Direct Modeling Kernel 실행 명세

작성일: 2026-08-02

상위 문서: [SketchUp급 실행·검증 마스터 플랜](./sketchup-grade-execution-verification.md)

## 1. 목표

모델링을 파라메트릭 건축 요소의 보조 기능이 아니라 Pascal의 첫 번째 제품 축으로 만든다. 사용자는 벽·슬라브·가구 같은 의미 요소와 자유 형상을 한 장면에서 만들고, edge/face를 직접 편집하고, 정확한 수치로 가공하고, 저장·undo·재질·Annotation 연결을 잃지 않아야 한다.

완료 상태는 다음과 같다.

- 선과 닫힌 profile로 face를 만들고 분할·병합한다.
- 임의 face를 Push/Pull해 돌출하거나 관통 절삭한다.
- face Offset과 path 기반 Follow Path를 정확한 수치로 실행한다.
- vertex/edge/face/body를 선택해 Move/Rotate/Scale한다.
- Group/Component 경계 안에서 격리 편집한다.
- Union/Subtract/Trim/Intersect/Split 결과가 manifold인지 즉시 진단한다.
- topology 변경 뒤에도 가능한 material placement와 semantic Annotation anchor가 같은 면을 추적한다.
- 잘못된 연산은 원본을 훼손하지 않고 실패 원인과 문제 위치를 표시한다.

공식 비교 기준:

- [SketchUp drawing and modeling tools](https://help.sketchup.com/en/sketchup/drawing-lines-shapes-and-3d-objects)
- [SketchUp Push/Pull](https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d)
- [SketchUp Move](https://help.sketchup.com/en/sketchup/moving-entities-around)
- [SketchUp Solid Tools](https://help.sketchup.com/en/sketchup/modeling-complex-3d-shapes-solid-tools)

## 2. 현재 기반과 핵심 공백

이미 있는 기반:

- wall/slab/ceiling/roof/item 등 파라메트릭 node와 geometry generator
- 2D/3D placement·move·reshape interaction, inference와 exact-length HUD
- `useLiveTransforms`, `useLiveNodeOverrides`, 단일 history transaction 계약
- opening, chimney, roof 등에 사용하는 `three-bvh-csg` 기반 내부 CSG
- BVH raycast, node registry, surface slot, scene save/load와 migration

핵심 공백:

- 사용자가 편집할 수 있는 영속 edge/face/topology SSOT가 없다.
- 현재 CSG는 renderer geometry를 만드는 내부 수단이지 범용 사용자 모델링 문서가 아니다.
- face ID가 없으므로 자유 형상 면에 재질·Annotation을 안정적으로 연결할 수 없다.
- topology 변경 전후의 feature 대응표가 없어 연산 뒤 연결 정보 보존 규칙을 정의할 수 없다.
- mesh triangle을 직접 편집하면 n-gon, 구멍, 곡선 의미와 undo 안정성을 잃는다.

## 3. 도메인 모델

### 3.1 영속 SSOT와 파생 데이터

`packages/core`에 renderer 독립 `BodyNode`와 topology schema를 둔다.

```text
BodyNode
  bodyId
  shells[]
  vertices{id, position}
  halfEdges{id, vertexId, twinId, nextId, loopId, curveId?}
  loops{id, faceId, kind: outer|inner}
  faces{id, outerLoopId, innerLoopIds[], surface}
  curves{id, kind: line|circularArc, parameters}
  bodyDefaults
```

원칙:

- topology와 analytic curve가 영속 SSOT다.
- triangle mesh, BVH, edge overlay, normal buffer는 revision-keyed 파생 cache다.
- ID는 배열 index가 아니라 영속 stable ID다.
- 좌표는 문서 내부 meter를 유지하고 표시·입력만 document unit을 사용한다.
- 공차는 `GeometryTolerance` 한 곳에서 관리한다. 도구별 임의 epsilon을 금지한다.
- `packages/core`는 Three.js나 Editor state를 import하지 않는다.

### 3.2 연산 계약

모든 topology 연산은 같은 결과 형식을 사용한다.

```text
ModelingOperation(input body revision, operands, constraint)
  -> success: BodyPatch + TopologyRemap + Diagnostics + Bounds
  -> failure: Diagnostics + ProblemFeatures, 원본 변경 없음
```

`TopologyRemap`은 유지·생성·분할·병합·삭제된 vertex/edge/face ID 관계를 기록한다. 다음 소비자가 이 표를 사용한다.

- face material placement
- semantic Annotation anchor
- 현재 sub-entity selection
- component definition instance override
- finish quantity dirty region
- undo/redo와 operation replay 진단

연산 preview는 임시 body revision을 사용하며 확정 시 scene에 한 번만 commit한다. Escape, focus loss, tool change는 preview revision을 폐기한다.

### 3.3 파라메트릭 요소와 자유 형상 경계

- wall/slab/roof 같은 기존 node를 자동으로 자유 형상과 왕복 변환하지 않는다.
- 사용자가 `자유 형상으로 변환`을 명시적으로 실행한다.
- 변환 전 파라메트릭 handle, host 관계, 수량·Annotation 영향의 loss preview를 보여준다.
- 변환 결과는 원본 node ID를 대체하지 않고 새 `BodyNode`와 source lineage를 만든다.
- 취소 또는 undo로 원래 파라메트릭 node를 완전히 복원한다.

## 4. 구현 에픽

### MK-0 — Kernel contract와 fixture harness

- `BodyNode`, stable topology ID, revision, diagnostic schema 확정
- topology invariant checker와 semantic hash 작성
- cube, prism, concave n-gon, hole, disjoint shell, invalid self-intersection fixture
- operation golden result에 bounds, area, volume, Euler characteristic, feature count 저장
- mesh tessellation과 render cache는 아직 사용자 기능으로 노출하지 않는다.

통과 기준:

- 저장 → 재열기에서 semantic hash가 동일하다.
- twin/next/loop/face/shell 참조 오류 0건이다.
- invalid fixture는 예상 diagnostic code와 feature ID를 반환한다.

### MK-1 — Sub-entity selection과 편집 context

- vertex/edge/face/body hit proxy와 hover highlight
- click, additive selection, window/crossing select
- connected, coplanar, boundary loop 선택
- double-click face+boundary, triple-click connected body
- Group/Component context 밖 geometry는 fade/lock한다.
- 2D에서 적용 가능한 edge/profile 선택은 3D와 같은 selection ID를 사용한다.

통과 기준:

- triangle tessellation이 달라도 같은 logical face ID가 선택된다.
- 10만 edge 모델에서 hover/select p95 50 ms 이하이다.
- context 전환·Esc·undo 뒤 stale sub-selection이 남지 않는다.

### MK-2 — Sketch profile과 face formation

- Line, Rectangle, Circle, Arc, Freehand
- endpoint/midpoint/intersection/on-edge/on-face inference
- coplanar closed loop의 face 생성, hole 인식, crossing edge 분할
- short edge, duplicate edge, non-planar closure 진단
- 길이, 반경, 각도, 좌표 입력을 `DraftConstraintSession`으로 통일

통과 기준:

- 동일 입력 sequence가 2D/3D에서 같은 topology hash를 만든다.
- 닫힘·교차·hole 20개 fixture에서 face/loop 수가 golden과 일치한다.
- 1 mm 최소 지원 detail에서 무단 weld 또는 gap이 없다.

### MK-3 — Push/Pull과 절삭

- face normal 방향 preview, inference와 축/거리 잠금
- 숫자 입력, 다른 face까지 extrude, 관통 cut
- inner loop를 포함한 profile extrusion
- 생성 side face와 이동 face의 deterministic ID/remap 규칙
- invalid zero-thickness와 self-intersection rollback

통과 기준:

- 양·음 방향 돌출, 관통/비관통 cut, hole profile 15개가 volume/face golden을 만족한다.
- 1,200 mm 입력 결과 오차가 0.01 mm 이하이다.
- 원래 face 재질과 UV anchor가 이동 face를 따라가고 새 면은 명시된 inheritance 규칙을 따른다.

### MK-4 — Offset과 Follow Path

- face/loop inward·outward offset
- 모서리 join, concave corner, hole collapse 진단
- 선택 path를 따라 profile sweep
- corner frame, closed path seam, twist/degenerate 구간 처리
- 몰딩·걸레받이·덕트·손잡이 제작 fixture

통과 기준:

- offset self-intersection은 자동 repair 또는 실패 위치를 명확히 반환한다.
- closed sweep seam에 열린 edge가 없다.
- path 편집 뒤 연산 재실행 또는 명시적 bake 상태가 구분된다.

### MK-5 — Direct transform과 배열

- vertex/edge/face/body Move/Rotate/Scale
- absolute `[x,y,z]`, relative `<x,y,z>`, 길이·각도 입력
- 축 잠금, inference target, copy, linear/radial array
- coplanar merge, auto-fold, reversed face 처리

통과 기준:

- preview와 commit topology가 동일하다.
- 배열 undo가 한 transaction이고 instance/geometry 복제 규칙이 일치한다.
- 변형이 만든 invalid body를 commit하지 않는다.

### MK-6 — Solid operations와 Inspector

- Outer Shell, Union, Subtract, Trim, Intersect, Split
- operation preview와 operand 보존 선택
- open edge, reversed face, internal face, non-manifold edge, zero-area face 탐지
- 문제 feature zoom/select와 제한된 자동 repair
- 현재 viewer CSG를 바로 영속 SSOT로 승격하지 않고 kernel adapter 뒤에서 교체 가능하게 둔다.

통과 기준:

- 30개 boolean corpus가 volume, shell count, manifold 상태 golden을 만족한다.
- 실패 결과는 operand를 변경하지 않는다.
- repair는 수정한 feature와 topology diff를 기록하며 undo 가능하다.

### MK-7 — 파라메트릭 변환과 실무 제작 흐름

- wall/slab/roof/stair/item의 자유 형상 변환 지원 범위 표
- source lineage, 변환 시 material/slot/Annotation mapping
- 방 shell, 붙박이장, 아치 개구부, 몰딩, 계단 디테일, 가구 joinery 기준 작업
- 변환 이후 INTM finish schedule과 drawing section에서 body를 동일하게 소비

통과 기준:

- 기준 작업 10개를 모델 생성부터 재질·치수·도면까지 중단 없이 완료한다.
- loss preview에 없던 의미 데이터 손실 0건이다.
- 저장·재열기·undo/redo·GLB export에서 topology와 연결 정보가 보존된다.

## 5. 재질·Annotation 보존 규칙

모델링과 재질을 별도 후속 작업으로 취급하지 않는다.

- 유지 face: material placement와 anchor를 그대로 유지한다.
- 이동/변형 face: 동일 face ID와 local UV frame을 유지한다.
- 분할 face: 자식 face가 부모 assignment를 상속하고 UV origin을 공유한다.
- 병합 face: assignment가 같을 때만 자동 병합한다. 다르면 사용자 선택 또는 face 경계를 유지한다.
- 새 side/cut face: operation별 명시된 inheritance rule을 사용하고 preview legend로 표시한다.
- 삭제 face: 연결 Annotation은 dangling이 되며 자동 삭제하지 않는다.
- 재연결이 불확실하면 자동 추측하지 않고 confidence와 후보를 표시한다.

## 6. 검증 매트릭스

최소 48개 모델링 시나리오를 유지한다.

| 범주 | 개수 | 핵심 증거 |
|---|---:|---|
| topology·save/load | 8 | invariant, semantic hash, migration |
| selection·context | 6 | logical face hit, nesting, cancel |
| sketch·face | 8 | profile/loop/intersection golden |
| Push/Pull | 8 | volume, face remap, exact input |
| Offset·Follow Path | 6 | corner/seam/self-intersection |
| transform·array | 5 | preview=commit, single undo |
| solids·repair | 5 | manifold, rollback, diagnostics |
| parametric conversion | 2 | loss preview, lineage round-trip |

각 시나리오는 다음을 함께 비교한다.

- semantic topology hash
- bounds, area, signed volume, shell 수, Euler characteristic
- stable feature ID와 `TopologyRemap`
- material/Annotation linkage
- undo/redo와 save/load 결과
- screenshot/recording과 작업 시간
- peak heap, operation time, cancel 후 memory 회수

## 7. 성능 예산

- 10만 edge hover/select p95 50 ms 이하
- 1만 face 단순 Push/Pull preview p95 50 ms 이하
- 중형 boolean은 UI thread를 막지 않고 progress/cancel을 제공한다.
- topology patch는 전체 body deep copy를 history에 반복 저장하지 않는다.
- 동일 component definition은 topology와 render mesh를 instance 간 공유한다.
- BVH/mesh cache는 body revision 변경 범위만 무효화한다.

예산을 넘으면 기능 범위를 줄이지 말고 profiler evidence로 병목을 분리한다. kernel correctness를 근사 mesh 편집으로 우회하지 않는다.

## 8. 출시 차단 조건

- topology invariant 실패를 자동 repair로 숨긴다.
- triangle index를 영속 face ID로 사용한다.
- 조작 preview 중 scene store를 pointer frame마다 기록한다.
- material 또는 Annotation 연결이 topology 연산 뒤 조용히 사라진다.
- 실패 연산이 operand를 일부 변경한다.
- 2D/3D 중 적용 가능한 한쪽만 같은 조작을 제공한다.
- 파라메트릭 변환의 의미 손실을 사용자에게 알리지 않는다.

## 9. 첫 구현 세로 기능

첫 모델링 구현은 `닫힌 직사각형 → face → 1,200 mm Push/Pull → 면 선택 → 재질 적용 → 저장/재열기 → undo/redo`다.

이 한 흐름에서 먼저 완성할 것:

1. 최소 `BodyNode`와 topology invariant
2. logical face selection
3. exact Push/Pull operation과 rollback
4. face stable ID와 `TopologyRemap`
5. face material placement 보존
6. semantic snapshot, browser recording, performance 결과

이 세로 기능이 Gate 0~7을 통과하기 전 Offset, Follow Path, Solid UI를 병렬로 확장하지 않는다.
