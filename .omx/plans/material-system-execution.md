# Pascal Material·Finish System 실행 명세

작성일: 2026-08-02

상위 문서: [SketchUp급 실행·검증 마스터 플랜](./sketchup-grade-execution-verification.md)

연결 문서: [INTM·Annotation·마감재 연동 계획](./intm-editor-integration.md)

## 1. 목표

재질을 단순한 색·텍스처 선택이 아니라 다음 세 계약이 끝까지 연결되는 제품 축으로 만든다.

1. **Appearance asset**: 화면과 export에서 재현되는 PBR 외형
2. **Surface placement**: 각 표면에서의 실제 크기, 방향, 원점, 투영 방식
3. **Finish assignment**: INTM 제품 ID, 적용 위치, 수량, 견적·발주 계보

사용자는 하나의 Paint 작업공간에서 Pascal library, Scene, Local, INTM/RawPainter 재질을 검색·샘플링·적용하고, 실제 규격과 무늬 방향을 조정하고, 위치별 마감표와 수량을 생성해야 한다. 온라인 공급원이 끊겨도 이미 사용한 재질은 깨지지 않아야 한다.

공식 비교 기준:

- [SketchUp materials, textures, and environments](https://help.sketchup.com/en/sketchup/adding-colors-and-textures-materials)
- [Applying Materials](https://help.sketchup.com/en/sketchup/applying-materials)
- [Positioning Textures](https://help.sketchup.com/en/sketchup/positioning-textures)
- [Creating Materials](https://help.sketchup.com/en/creating-materials)
- [Managing Materials](https://help.sketchup.com/en/managing-and-organizing-materials)
- [Generate Textures](https://help.sketchup.com/en/sketchup/ai-materials)

## 2. 현재 기반과 핵심 공백

이미 있는 기반:

- `MaterialMapsSchema`: albedo, normal, roughness, metalness, AO, alpha, emissive 등
- `MaterialMapPropertiesSchema`: repeat, rotation, wrap, normal/ao/displacement 값
- procedural geometry의 `1 UV unit = 1 m` 계약
- GLB `slot_*` paintable part와 authored material 보존
- scene material, surface slot, single/object/matching/room scope, eyedropper, undo
- RawPainter 카탈로그·다운로드·cache와 INTM 통합 자재 계획

핵심 공백:

- `SceneMaterial`은 현재 `id`, `name`, `material`만 저장해 provenance, version, 실제 규격, offline snapshot을 표현하지 못한다.
- material asset 속성과 표면별 placement가 분리되지 않아 같은 타일을 면마다 다른 방향·원점으로 배치하기 어렵다.
- Pascal library의 repeat는 재질 전체 속성이며 per-face UV transform 계약이 없다.
- 렌더링 재질과 INTM 마감재 assignment가 같은 객체로 섞일 위험이 있다.
- topology 연산 뒤 face material과 UV anchor를 이어주는 remap 규칙이 없다.
- color space, map convention, texture memory/LOD, export round-trip 기준이 명문화되지 않았다.

## 3. 정규화된 재질 모델

### 3.1 Appearance asset

`MaterialAsset`은 재사용 가능한 외형과 자산 계보를 소유한다.

```text
MaterialAsset
  id, revision, name, category
  source { provider, externalId, version, retrievedAt }
  physicalSize { widthM, heightM }?
  channels { baseColor, normal, roughness, metalness, ao, opacity, emissive, displacement }
  factors { color, roughness, metalness, opacity, normalScale, ... }
  rendering { alphaMode, doubleSided, normalConvention }
  preview, license, checksum
  frozenFallback
```

원칙:

- Pascal/Scene/Local/INTM 공급원은 같은 canonical asset DTO로 정규화한다.
- 외부 URL만 영속 참조하지 않는다. checksum과 최소 offline fallback을 함께 저장한다.
- albedo/emissive는 sRGB, roughness/metalness/normal/AO는 linear data로 처리한다.
- normal map convention과 channel packing을 import 시 명시적으로 정규화한다.
- asset revision 변경은 기존 프로젝트를 조용히 바꾸지 않는다. 사용자가 update 또는 pin을 선택한다.

### 3.2 Surface placement

`MaterialPlacement`는 `(nodeId, stableSurfaceId 또는 slotId)`에 연결한다.

```text
MaterialPlacement
  materialAssetId
  surfaceRef
  mapping: uv|planar|projected|box|cylindrical
  physicalScale
  origin
  rotation
  mirror
  pins[]?
  inheritedFrom?
```

원칙:

- 같은 `MaterialAsset`을 여러 면에서 서로 다른 방향·원점으로 사용할 수 있다.
- 실제 규격 600 × 1200 mm는 asset metadata이고, 표면 transform은 비파괴 placement다.
- procedural surface와 GLB slot의 기본 계약은 1 UV unit = 1 m를 유지한다.
- free-pin/4-corner 왜곡은 placement에 저장하며 원본 texture를 변형하지 않는다.
- topology 변경은 `TopologyRemap`으로 placement를 유지·분할·dangling 처리한다.

### 3.3 Finish assignment

`FinishAssignment`는 비즈니스 의미를 소유하며 renderer가 직접 소비하지 않는다.

```text
FinishAssignment
  id, projectId, materialAssetId
  intmMaterialId?, rawPainterProductId?
  target { nodeId, surfaceId|slotId, locationId, roomId? }
  basis { grossArea, openingDeduction, netArea, length, count }
  wasteRate, quantity, unit
  status, substitution, estimateItemId?, provenance
```

원칙:

- 외형은 같지만 제품이 다른 자재를 하나로 합치지 않는다.
- 제품이 unavailable이어도 model appearance와 기존 assignment snapshot은 유지한다.
- 수량은 geometry에서 계산하고 가격·발주 상태는 INTM에서 가져온다.
- 견적 변경은 preview/change-set/승인을 거쳐야 하며 Paint 클릭이 즉시 견적을 수정하지 않는다.

## 4. Provider와 asset pipeline

공통 `MaterialProvider` 계약:

```text
search(query, category, surface, cursor)
getProduct(externalId)
resolveAsset(externalId, requestedQuality)
getRevision(externalId)
```

provider 종류:

- Pascal built-in library
- Scene/In Model materials
- Local file import
- INTM/RawPainter online catalog

규칙:

- provider는 검색·메타데이터·asset 상태만 반환한다.
- active material, scope, eyedropper, eraser, commit, undo는 기존 Paint state만 소유한다.
- 원본 RawPainter와 clone fallback은 같은 DTO와 cache key를 사용한다.
- preview → viewport → export 품질 단계가 같은 material ID를 유지한다.
- 같은 checksum asset은 중복 저장·다운로드하지 않는다.
- timeout, retry, cancel, 404, license 제한 상태를 패널에서 명확히 표시한다.

## 5. 구현 에픽

### MT-0 — Schema 정규화와 migration

- `MaterialSchema`, `MaterialPresetPayload`, `SceneMaterial`의 중복 책임 목록화
- `MaterialAsset`, `MaterialPlacement`, `FinishAssignment` schema 확정
- legacy inline material와 `library:*` ref migration
- asset revision, checksum, frozen fallback, provenance 추가
- 기존 scene fixture 두 version 이상 round-trip

통과 기준:

- 기존 프로젝트 외형과 surface slot 결과가 바뀌지 않는다.
- save/load 뒤 asset ID, placement, finish linkage가 동일하다.
- INTM 없이 문서를 열어도 cached/frozen appearance가 표시된다.

### MT-1 — 통합 Material workspace

- 한 패널에서 Library, In Model, Local, INTM/RawPainter 탭과 통합 검색
- category, surface suitability, brand, code, size filter
- swatch/grid/list, detail, download progress, retry/cancel
- recent/favorite/project collections
- In Model 사용 위치, replace all, duplicate, rename, purge unused
- preselect 후 paint, paint 후 select, Alt eyedropper의 일관된 흐름

통과 기준:

- provider를 바꿔도 Paint mode와 scope가 유지된다.
- 10,000개 catalog 결과가 virtualized되고 검색 입력 p95 100 ms 이하이다.
- purge가 사용 중 asset 또는 frozen fallback을 삭제하지 않는다.

### MT-2 — PBR rendering correctness

- baseColor, normal, roughness, metalness, AO, opacity, emissive 우선 지원
- displacement는 실제 geometry 변형과 shader 표현 범위를 분리해 표시
- color space, normal convention, alpha mode, double-sided 규칙
- texture channel missing/default 규칙
- environment reflection과 rendered/solid 모드 일관성
- GLB import/export material mapping

통과 기준:

- 고정 HDR environment 아래 material sphere golden image가 허용 차이 안이다.
- roughness/metalness/normal channel swap fixture를 자동 탐지한다.
- export → import에서 지원 channel과 factor 손실 0건이다.

### MT-3 — 실제 규격과 texture positioning

- 실물 width/height 기반 repeat 계산
- move, scale, rotate, mirror, reset
- fixed pin과 free pin/4-corner 왜곡
- planar/projected/box/cylindrical mapping
- 인접 coplanar face 정렬, 곡면 seam preview
- 조정 중 하부 HUD에 규격·각도·offset 실시간 표시

통과 기준:

- 600 × 1200 mm fixture가 12 m 벽에 정확히 20 × 10 module로 배치된다.
- world scale 오차 1% 이하, 회전 오차 0.1° 이하이다.
- face 분할 뒤 pattern origin이 뛰지 않고 다시 병합해도 연속성을 유지한다.

### MT-4 — Paint scope와 topology 연동

- single/object/matching/room scope를 stable surface ID에 적용
- eyedropper가 asset과 placement를 구분해 샘플링
- 같은 asset만 교체, 같은 finish product만 교체 옵션 분리
- Push/Pull, split, merge, boolean의 `TopologyRemap` 소비
- front/back, inside/outside, slot inheritance 규칙

통과 기준:

- 범위 적용과 FinishAssignment fan-out이 한 undo transaction이다.
- topology 변경 뒤 유지/분할 face의 pattern과 제품 linkage가 보존된다.
- ambiguous merge는 조용히 한 재질을 선택하지 않는다.

### MT-5 — INTM finish schedule과 수량

- surface/room/location별 `FinishAssignment`
- gross area, opening deduction, net area, length/count basis
- 자재 규격, waste, pack rounding, substitute/unavailable 상태
- 현장 마감표, 견적 change-set, 발주 linkage
- 모델 highlight ↔ INTM row 양방향 선택

통과 기준:

- 기준 방의 벽·바닥·천장 net quantity가 geometry golden과 일치한다.
- 현장 마감표에서 material/location/source node를 역추적한다.
- 승인 전 estimate mutation 0건, retry duplicate 0건이다.

### MT-6 — Asset resilience와 scale

- preview/viewport/export texture LOD와 memory budget
- checksum dedupe, indexed cache, eviction, offline pin
- 404/corrupt/timeout/partial download 복구
- asset license와 export 허용 상태
- 100/1,000 material scene benchmark

통과 기준:

- Large scene에서 texture memory ceiling을 넘지 않고 가까운 표면부터 선명해진다.
- offline 재열기에서 사용 중 재질 누락 0건이다.
- 취소·실패 다운로드가 partial cache와 object URL을 남기지 않는다.

### MT-7 — 생성형/보정 재질

- 이미지에서 PBR channel 생성은 optional provider로 둔다.
- 생성 channel은 `generated`, model/version, source image checksum을 기록한다.
- seamless 보정, crop, physical size calibration preview
- 원본과 생성본을 나란히 비교하고 언제든 되돌린다.

통과 기준:

- 생성 여부를 숨기지 않고 동일 입력의 provenance가 재현된다.
- 생성 실패가 원본 appearance 또는 assignment를 변경하지 않는다.
- 자동 생성 재질도 일반 `MaterialAsset` 검증과 export 규칙을 통과한다.

## 6. 모델링 연산과 재질 상속 규칙

| topology 변화 | appearance 처리 | finish 처리 |
|---|---|---|
| face 이동/변형 | asset·placement local frame 유지 | assignment 유지, quantity dirty |
| face 분할 | 자식이 asset·pattern origin 상속 | assignment 분할, 합산 값 보존 |
| 같은 재질 face 병합 | UV 연속 시 placement 병합 | assignment 합산 |
| 다른 재질 face 병합 | 경계 유지 또는 사용자 선택 | 자동 합치지 않음 |
| Push/Pull 이동 face | 원 face placement 유지 | 원 assignment 유지 |
| 새 side/cut face | operation inheritance preview | 미지정 또는 명시된 source 제품 |
| face 삭제 | placement dangling 기록 후 정리 가능 | assignment dangling/relink |

이 표는 모델링 kernel fixture와 재질 fixture에서 동일한 expected result를 공유한다.

## 7. 검증 매트릭스

최소 24개 재질 시나리오를 유지한다.

| 범주 | 개수 | 핵심 증거 |
|---|---:|---|
| schema·provider·offline | 4 | migration, provenance, fallback |
| PBR channel·color space | 4 | sphere golden, channel validation |
| 실제 규격·positioning | 5 | repeat, pins, projection, seam |
| paint scope·eyedropper | 4 | fan-out, single undo, reset |
| topology 보존 | 3 | split/merge/PushPull remap |
| INTM 수량·견적 | 2 | net basis, approval/idempotency |
| performance·cache | 2 | LOD, memory, offline recovery |

필수 fixture:

- 600 × 1200 mm 타일, 100 × 900 mm 마루, 방향성 무늬목
- sRGB baseColor와 linear roughness/normal 기준 texture
- alpha cutout 유리/패브릭과 emissive sign
- planar wall, concave floor, cylinder, curved sweep, GLB item slot
- RawPainter 정상·clone fallback·404·corrupt checksum 응답

## 8. 출시 차단 조건

- texture가 보기에는 맞지만 실제 규격 metadata가 없다.
- per-face placement를 material asset 복제로 표현한다.
- provider마다 별도 Paint state나 undo를 만든다.
- 외부 URL 만으로 프로젝트 재질을 저장한다.
- topology 변경 뒤 재질·제품 linkage가 조용히 사라진다.
- PBR map의 color space 또는 normal convention을 추측한다.
- Paint 클릭이 사용자 승인 없이 견적·발주 데이터를 변경한다.
- unavailable 제품 때문에 이미 저장된 모델 appearance가 사라진다.

## 9. 첫 구현 세로 기능

첫 재질 구현은 `INTM/RawPainter 600 × 1200 mm 자재 선택 → 1,200 mm Push/Pull body face에 적용 → 방향/원점 조정 → face 분할 → 저장/오프라인 재열기 → 마감 수량 확인`이다.

먼저 완성할 것:

1. canonical `MaterialAsset`과 legacy migration
2. face별 `MaterialPlacement`
3. physical size와 rotate/offset HUD
4. Paint provider adapter와 frozen fallback
5. topology remap에 따른 placement 보존
6. 최소 `FinishAssignment`와 net area evidence

이 세로 기능이 Gate 0~7을 통과하기 전 생성형 재질, 대규모 catalog UX, 고급 projection을 확장하지 않는다.
