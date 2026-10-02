# Zone 마감 및 조합 템플릿 실행 계획

## 결정 상태

- 기획 lane: `gpt-5.6-sol`, reasoning `high`.
- 사용자 최종 UX: Zone을 선택하면 기존 **오른쪽 선택 인스펙터**에 `전체 벽면`, `천장`, `바닥` 실제 자재 행과 Zone/집 템플릿 제어가 보인다. 행 클릭은 기존 자재 카탈로그를 담은 modal을 열고, 자재 선택 한 번으로 해당 부위를 즉시 적용한다.
- 이전의 Painting 탭 안 `Zone 마감` 방 목록, 개별 wall-face 행, target arm 흐름은 폐기한다. Painting 탭과 기존 paint tool은 개별 벽면/포인트 페인팅 용도로 그대로 유지한다.
- Zone 템플릿 저장 완료 조건은 최초 요구대로 **모든 inward wall slot + 바닥**이다. 천장은 선택 항목이며, 명시적으로 칠해진 경우에만 snapshot에 포함한다. 천장 미지정은 저장을 막지 않는다.
- 실제 scene read-only snapshot(`/tmp/zone-finish-current-scene.json`)은 `wall=51`, `zone=12`, `slab=0`, `ceiling=0`, level height `2.5m`다. 바닥과 천장 행은 target이 없다는 이유로 비활성화하지 않고 안전한 Zone footprint node를 선택 시 생성한다. 운영 scene 자체는 수정하지 않는다.
- 비범위: 새 자재 라이브러리, 단계형 wizard, 클라우드 템플릿 공유, Zone 경계에 맞춘 자동 Wall split, face-subsegment material, 공유 slab/ceiling의 암묵적 분할, 이름 기반 방 자동 매핑.

## 현재 코드 경계와 최소 진입점

1. Zone 선택 SSOT는 `useViewer.selection.zoneId`다. 2D 방 이름과 3D Zone label의 기존 selection routing을 유지한다.
2. 선택 Zone의 오른쪽 패널은 `packages/editor/src/components/ui/panels/panel-manager.tsx`가 `ParametricInspector nodeId={selectedZoneId}`로 렌더한다. Zone의 현재 본문은 `packages/nodes/src/zone/parametrics.ts`의 `trailingSection`인 `packages/nodes/src/zone/quantities-panel.tsx`다.
3. 앱 전용 마감 UI는 node registry나 `packages/nodes`가 아니라 기존 `EditorProps.inspectorFooter`에 주입한다. `PanelWrapper`는 footer를 우측 패널의 스크롤 본문 아래에 고정한다. `apps/editor/app/editor/page.tsx`와 `apps/editor/components/scene-loader.tsx` 두 `<Editor>` root에 같은 `<ZoneFinishInspectorFooter />`를 전달한다. 이 컴포넌트는 선택이 room Zone이 아니면 `null`을 반환한다.
4. `ZoneNode.wallFinish/floorFinish/ceilingFinish`는 공사 문서용 문자열이다. 기존 Room documentation 필드는 유지하되 실제 material 적용·완료·템플릿의 근거로 사용하지 않는다. footer 제목은 혼동이 없도록 `실제 마감 자재`로 한다.
5. 실제 마감 SSOT는 Wall의 inward side slots, Slab의 `slots.surface`, Ceiling의 `slots.surface`, scene materials다. ceiling 렌더러도 `slots.surface`를 legacy inline material보다 먼저 해석한다 (`packages/nodes/src/ceiling/renderer.tsx`).
6. 기존 카탈로그는 `apps/editor/components/paint-catalog.tsx`의 `MergedMaterialCatalog`, `FavoriteMaterialsGrid`와 `packages/editor/src/components/ui/controls/scene-material-list.tsx`를 재사용한다. Modal chrome은 기존 `Dialog` primitive를 사용하며 필요한 export는 `packages/editor/src/index.tsx` 한 곳에서만 추가한다.
7. 모든 apply는 전체 preflight 뒤 `runAsSingleSceneHistoryStep()` 한 번으로 material 등록, node 생성, slot patch를 함께 commit한다. 실패 시 scene mutation과 history 추가는 0건이다.

## 최종 UX 계약

### 오른쪽 Zone 인스펙터

`ZoneFinishInspectorFooter`는 3개 compact row를 항상 같은 순서로 보여 준다.

1. **전체 벽면**
   - 상태: `미지정 N면`, 단일 material swatch/name, 또는 `혼합 N종`.
   - 클릭 → `전체 벽면 자재 선택` modal → 자재 카드 선택 즉시 모든 안전한 inward face의 base + 활성 band slot에 동일 material 적용 → modal 닫기.
   - 개별 wall-face 행과 face highlight는 두지 않는다. 특정 벽/밴드는 기존 paint tool로 칠한다. 이후 우측 행은 `혼합 N종`으로 갱신한다.
2. **천장**
   - 상태: explicit slot이면 swatch/name, exact ceiling이 default/legacy fallback뿐이면 `미지정`, node가 없고 생성 가능하면 `미지정 · 선택 시 생성`, 겹침/모호성이면 `천장 정리 필요`.
   - 클릭 → 같은 material modal → 안전한 exact Ceiling을 resolve하거나 생성하고 `slots.surface` 적용 → modal 닫기.
3. **바닥**
   - 상태: explicit slot이면 swatch/name, exact slab이 default면 `미지정`, node가 없고 생성 가능하면 `미지정 · 선택 시 생성`, 겹침/모호성이면 `바닥 정리 필요`.
   - 클릭 → 같은 material modal → 안전한 exact/finish Slab을 resolve 또는 생성하고 `slots.surface` 적용 → modal 닫기.

행 클릭만으로 기존 brush를 적용하거나 scene을 바꾸지 않는다. Modal에서 자재를 선택한 순간의 `{scene token, zoneId, kind, target fingerprint}`를 캡처한다. RawPainter/import 준비가 끝났을 때 Zone/scene/geometry가 바뀌었으면 `대상이 변경되어 적용하지 않았습니다`로 닫지 않고 오류를 보여 주며 mutation하지 않는다. 같은 자재를 다시 선택해도 callback은 매번 실행한다. 취소/Escape는 mutation 0건이며 focus가 원래 행으로 돌아간다.

Modal은 `MergedMaterialCatalog`의 기존 `자재/즐겨찾기/내 자재` source를 그대로 보여 준다. 별도 라이브러리나 복제 grid를 만들지 않는다. 선택 성공 후 `거실 · 전체 벽면/천장/바닥에 적용했습니다`와 Undo affordance를 표시한다.

### 템플릿 UI

- 3개 material row 아래에 `Zone 템플릿 저장`과 `템플릿 적용`을 둔다. 기존 persisted Zone/home template store와 mapping dialog를 이 우측 흐름에 연결한다.
- 저장 진행률은 `벽 x/y · 바닥 x/y`가 기본이다. 모든 inward wall base/active band slot과 하나의 안전한 floor slot이 explicit ref일 때 저장 가능하다. 천장은 별도 `천장 포함` badge로만 표시하며 미지정이어도 저장 가능하다.
- explicit ceiling slot이 있으면 Zone template에 ceiling target fingerprint와 portable material snapshot을 포함한다. default soft-white, legacy fallback만 있는 ceiling, ceiling node 없음은 `ceiling` field를 생략한다.
- ceiling을 포함하지 않은 template 적용은 대상 Zone의 기존 ceiling을 건드리지 않는다. 포함한 template은 ceiling resolve/create까지 포함해 벽·바닥·천장을 한 transaction으로 적용하며, ceiling preflight 실패 시 어느 부위도 바꾸지 않는다.
- exact Zone template은 클릭 즉시 적용한다. topology가 다른 mixed-wall template은 별도 mapping dialog에서만 source face→target face를 명시적으로 연결하거나 한 material로 통일한다. normal inspector에는 개별 face 행을 노출하지 않는다.
- 집 템플릿은 완성 Zone template snapshot을 값으로 포함한다. 이름 중복으로 방을 자동 연결하지 않고 stable scene/Zone identity가 검증되지 않으면 one-to-one Zone mapping dialog를 연다.

## Domain 계약

### 벽

- 검출 Space를 compact `space.id` Record로 축약하지 않고 같은 level의 detected-space 배열을 polygon + wall signature로 구분한다. 실제 snapshot의 collision에도 auto room 9개 모두 boundaryFaces를 얻어야 한다.
- Auto Zone은 exact polygon + `boundaryWallIds`가 일치하는 Space의 `boundaryFaces`만 사용한다. front/back은 기존 `wallRoleForRoomFace` 규칙으로 inward slot role에 변환하고 반대 room side는 patch하지 않는다.
- whole Space가 없는 manual Zone은 Wall 전체 centerline/polyline이 Zone edge 전체와 일치하는 full-face fallback만 허용한다. partial overlap, 한 `wallId:face`의 다중 Zone claim, ambiguous side가 하나라도 있으면 Zone 전체 벽 apply/template capture를 `manual-zone-subsegment-unsupported`로 거부한다.
- 실제 snapshot의 manual `현관`, `거실`, `안방`은 partial/shared face 때문에 whole-wall apply가 blocked다. 바닥과 안전한 천장 직접 적용, 기존 single-surface paint는 유지한다. 12-Zone 집 전체 저장은 세 방 때문에 준비되지 않은 상태를 명시한다.
- `전체 벽면` 적용은 각 inward face의 base와 현재 활성 `lower/middle/upper/top Interior|Exterior` slot을 같은 ref로 쓴다. band 높이/기하는 유지하고 반대 side slot은 보존한다.
- Template capture는 개별 face/active slot material을 계속 저장한다. 따라서 기존 paint tool로 만든 mixed/accented 조합도 같은 Zone fingerprint에서 정확 복원된다.

### 바닥

1. 같은 level에서 Zone footprint와 tolerance 내 exact Slab 하나가 있으면 사용한다. 여러 exact 후보는 unique `metadata.zoneFinish.zoneId` marker가 있는 하나만 허용하며 나머지 중복/모호성은 block한다.
2. exact가 없고 Zone을 완전히 포함하는 큰 Slab 하나가 있으면 base를 보존하고 Zone footprint의 20mm finish Slab을 위에 만든다. 기존 shared Slab slot은 바꾸지 않는다.
3. level에 Slab이 없거나 기존 Slab과 완전히 분리돼 있으면 Zone polygon으로 finish Slab을 만든다.
4. partial overlap, 여러 containing Slab, invalid polygon/hole은 임의 분할하지 않고 block한다.

생성 Slab은 `metadata.zoneFinish={version:1,zoneId}`, `autoFromWalls:false`이며 생성+material+slot patch가 Undo 한 번이다.

### 천장

`CeilingNode`는 `polygon`, `holes`, optional `height`, `autoFromWalls`, `slots.surface`를 가진다. `height`를 생략하면 `resolveCeilingHeight()`가 level top/covering slab underside bound를 따르므로 현재 scene의 임의 2.52m 상수를 복제하지 않는다.

1. 같은 level에서 Zone polygon과 tolerance 내 exact Ceiling이 정확히 하나면 사용한다. `slots.surface`만 patch하고 holes/features/height/construction은 보존한다.
2. exact 후보가 여러 개면 unique valid Zone marker가 있어도 겹친 렌더 surface가 남으므로 기본적으로 `ambiguous-ceiling`으로 block한다. 중복 삭제/채택은 이 기능이 자동 결정하지 않는다.
3. exact Ceiling이 없고 Zone polygon과 면적 overlap이 있는 Ceiling이 하나라도 있으면 block한다. containing/shared Ceiling 전체 slot을 바꾸거나 같은 평면에 overlay를 만들어 z-fighting을 유발하지 않는다.
4. exact도 overlap도 없고 Zone polygon이 valid하면 자재 선택 commit 안에서 `CeilingNode.parse({ name, polygon, holes: [], autoFromWalls: false, slots: {surface: ref}, metadata: {zoneFinish:{version:1,zoneId}} })`로 생성해 Zone의 level에 붙인다. explicit `height`는 쓰지 않는다.
5. 이후 재적용은 marker뿐 아니라 parent level + exact polygon을 함께 검증해 중복 생성을 막는다. Zone geometry가 바뀌어 기존 marked Ceiling이 overlap/비exact가 되면 자동 reshape하지 않고 block한다.

Ceiling 생성/등록/slot patch도 하나의 history step이다. Template에 ceiling이 포함됐는데 target ceiling이 위 정책으로 resolve/create되지 않으면 전체 Zone/home apply가 원자적으로 실패한다.

## Portable template schema

`apps/editor/lib/finish-template-store.ts`의 versioned Zustand `persist` store는 `material-favorites-store.ts`와 같은 validated merge/partialize 패턴을 쓴다. 아직 배포 전인 v1 schema에 optional ceiling을 추가한다.

```ts
type PortableMaterialSnapshot = {
  label: string
  preferredRef?: `library:${string}`
  material: MaterialSchema
}

type ZoneFinishTemplateSnapshot = {
  version: 1
  id: string
  name: string
  createdAt: string
  source: { sceneId?: string; zoneId: string; fingerprint: ZoneSurfaceFingerprint }
  walls: Array<{
    sourceFace: InwardWallFingerprint
    slots: Array<{ role: string; material: PortableMaterialSnapshot }>
  }>
  floor: { target: FloorFingerprint; material: PortableMaterialSnapshot }
  ceiling?: { target: CeilingFingerprint; material: PortableMaterialSnapshot }
}

type HomeFinishTemplate = {
  version: 1
  id: string
  name: string
  createdAt: string
  sourceSceneId?: string
  zones: Array<{ sourceZoneId: string; sourceZoneName: string; template: ZoneFinishTemplateSnapshot }>
}
```

- library ref는 frozen fallback을 함께 저장한다. RawPainter/host/scene material은 texture URL, repeat, physicalSize, provider externalId/revision을 포함한 전체 `MaterialSchema` snapshot을 저장한다.
- scene material id는 다른 scene에서 stable하다고 가정하지 않는다. 동일 snapshot은 dedupe하고 없으면 scene material을 하나 등록한다.
- home template은 live Zone template id가 아니라 immutable embedded snapshots를 저장한다.

## 공개 interface 수정

개별 row target을 제거하고 ceiling을 추가한다.

```ts
export type ZoneFinishTargetKind = 'walls' | 'ceiling' | 'floor'

export type CapturedZoneFinishTarget = {
  zoneId: ZoneNode['id']
  levelId: string
  kind: ZoneFinishTargetKind
  fingerprint: string
}

export type ZoneFinishInspection = {
  targets: {
    walls: CapturedZoneFinishTarget
    ceiling: CapturedZoneFinishTarget
    floor: CapturedZoneFinishTarget
  }
  walls: { status: 'ready' | 'blocked'; materialCount: number; missing: SurfaceSlotRef[]; conflictIds: string[] }
  ceiling:
    | { status: 'existing'; ceilingId: CeilingNode['id']; explicit: boolean }
    | { status: 'creatable' }
    | { status: 'blocked'; reason: string; conflictIds: string[] }
  floor:
    | { status: 'existing'; slabId: SlabNode['id']; explicit: boolean }
    | { status: 'creatable' }
    | { status: 'blocked'; reason: string; conflictIds: string[] }
  completion: { wallsExplicit: number; wallsTotal: number; floorExplicit: boolean; ceilingIncluded: boolean }
}

inspectZoneFinish(zoneId, scene): ZoneFinishInspection
planZoneFinishMaterialApply(capturedTarget, selection, currentScene): Plan | ZoneFinishError
commitZoneFinishApply(plan): Result
captureZoneFinishTemplate(...): ZoneFinishTemplateSnapshot | ZoneFinishError
applyZoneFinishTemplate(...): ZoneFinishApplyResult
applyHomeFinishTemplate(...): ZoneFinishApplyResult
```

Planner는 mutation하지 않는다. commit 직전에 scene token, target fingerprint, material validity를 재검증한다. Apply plan은 필요한 scene material 생성, optional Slab/Ceiling 생성, 모든 node patch를 미리 확정한다.

## 구현 파일과 소유 경계

### Domain lane

- `packages/editor/src/lib/zone-finish.ts`, `.test.ts`: collision-safe walls, floor resolver/create, **ceiling resolver/create**, capture/apply/preflight/atomic plan.
- `packages/editor/src/lib/paint-scope.ts`, `.test.ts`: 기존 inward face/active slot helper만 재사용·export.
- `apps/editor/lib/finish-template-store.ts`, `.test.ts`: optional ceiling schema와 persisted Zone/home template.
- `packages/editor/src/index.tsx`: Zone finish domain exports와 앱 modal이 쓰는 기존 Dialog primitive exports. 다른 core schema/index 추가는 하지 않는다.
- `packages/mcp/src/modeling-agent-manual.ts`, ontology test: whole-wall/floor/ceiling 안전 생성과 atomic template apply 계약 갱신.

### UI lane

- `apps/editor/components/zone-finish-panel.tsx`는 좌측 panel 구현을 버리고 `ZoneFinishInspectorFooter` + material/template/mapping dialogs로 축소한다. 필요하면 파일명은 후속 rename하되 중복 컴포넌트를 만들지 않는다.
- `apps/editor/components/painting-tab.tsx`: Zone room list, armed target, Zone/template orchestration을 제거하고 기존 paint UX로 복원한다. 기존 surface paint는 그대로 작동해야 한다.
- `apps/editor/components/paint-catalog.tsx`, `packages/editor/src/components/ui/controls/scene-material-list.tsx`: optional `onSelectMaterial(selection)` sink는 modal 재사용을 위해 유지한다. sink가 없으면 기존 brush 선택 behavior를 유지한다.
- `apps/editor/app/editor/page.tsx`, `apps/editor/components/scene-loader.tsx`: 두 Editor root에 동일한 `inspectorFooter={<ZoneFinishInspectorFooter />}`를 주입한다.
- Zone label/system 변경은 우측 선택 진입에 실제 필요한 최소 selection 유지분만 보존한다. Painting 탭에 Zone label을 강제로 노출하는 이전 요구는 폐기한다.

공유 barrel인 `packages/editor/src/index.tsx`는 Domain lane만 수정한다. UI lane이 필요한 Dialog export를 Domain lane에 요청해 충돌을 피한다.

## 필수 acceptance

### Domain

- 공유 Wall 양쪽 Zone에서 `전체 벽면` 적용은 선택 방 inward base/active band slots만 바꾸고 반대 side와 band geometry를 보존한다.
- compact Space id 충돌 fixture와 실제 snapshot copy에서 auto room 9/9가 wall faces를 얻는다.
- manual partial/shared face는 `manual-zone-subsegment-unsupported`, mutation/history 0건이다. 현관/거실/안방 whole-wall 행은 `벽 분할 필요`를 표시한다.
- 0-Slab Zone 바닥 선택은 exact Zone Slab + material을 한 commit으로 만들며 Undo/Redo 각 한 번이다. containing base, duplicate marker, partial overlap guard를 검증한다.
- 0-Ceiling Zone 천장 선택은 exact Zone Ceiling을 `height` 없이 만들고 explicit `slots.surface`를 쓴다. Undo 한 번으로 material registration과 Ceiling이 함께 사라진다.
- exact Ceiling은 surface slot만 변경하고 holes/features/height를 보존한다. containing/shared, partial-overlap, multiple-exact, invalid polygon은 mutation/history 0건으로 실패한다.
- Zone 저장은 walls+floor explicit이면 ceiling 없이 성공한다. explicit ceiling이 있으면 snapshot에 포함되고 default ceiling은 포함하지 않는다.
- ceiling 없는 template apply는 target ceiling을 보존한다. ceiling 포함 template의 ceiling preflight가 실패하면 walls/floor도 바뀌지 않는다.
- mixed wall 조합은 same fingerprint에서 face/slot별로 복원된다. 다른 topology에는 explicit mapping 또는 uniform fallback 없이는 mutation하지 않는다.
- house apply는 모든 Zone/material/wall/floor/optional ceiling을 preflight한 후 history `+1`; 한 항목 오류 시 `+0`이다.
- 새로고침 후 textured wall/floor/ceiling material과 생성 node가 SceneGraph autosave에서 복원되고 Zone/home templates가 browser profile에서 복원된다.

### UI/통합

- 2D 방 이름 또는 3D Zone label로 room 선택 → 기존 오른쪽 Zone inspector 하단에 `전체 벽면/천장/바닥` 3행과 template controls가 보인다. 다른 node/선택 없음에는 보이지 않는다.
- 각 행 클릭은 focus-trapped material Dialog를 열며 scene을 바꾸지 않는다. builtin, RawPainter, scene textured material 선택은 해당 행 하나만 적용하고 dialog를 닫는다.
- inspector에는 개별 wall-face 행이 없다. 기존 paint tool로 한 벽만 칠한 뒤 전체 벽면 행이 `혼합 N종`으로 갱신되고 template capture가 그 조합을 보존한다.
- 실제 0-ceiling snapshot copy에서 천장 행은 `미지정 · 선택 시 생성`이고 선택 뒤 swatch/name으로 갱신된다. 천장을 칠하지 않아도 walls+floor 완료 시 Zone 저장 버튼이 활성화된다.
- modal을 연 뒤 Zone을 바꾸거나 RawPainter 응답 전에 geometry를 바꾸면 새 Zone에 적용되지 않는다.
- exact Zone/home template 적용은 success toast와 단일 Undo를 제공한다. mismatch는 mapping dialog만 열고 scene mutation은 0건이다.
- 320px inspector에서 3행은 잘리지 않고 keyboard Enter/Space로 modal을 열며, Escape/cancel 뒤 원래 행으로 focus가 복귀한다.

### 실행 검증

1. `bun test packages/editor/src/lib/zone-finish.test.ts packages/editor/src/lib/paint-scope.test.ts apps/editor/lib/finish-template-store.test.ts`
2. `bun test apps/editor/components/painting-tab.test.tsx apps/editor/components/paint-catalog.test.tsx apps/editor/components/zone-finish-panel.test.tsx`
3. `bun test packages/mcp/src/ontology-manual.test.ts`
4. `bun run --cwd apps/editor check-types`
5. `bunx biome check <changed-files>`
6. `bun run --cwd apps/editor build`
7. `localhost:3002` 운영 scene은 GET/read-only로만 비교하고 copy/fixture에서 실제 브라우저 QA한다. 우측 Zone inspector, 3행 modal, builtin/RawPainter/scene material, wall/floor/ceiling 2D·3D 결과, mixed-wall summary, template reload, single Undo, console error 0건을 기록한다.

## 완료 조건

선택 Zone의 기존 오른쪽 inspector에서 전체 벽면·천장·바닥을 modal 자재 선택 한 번으로 적용할 수 있고, 기존 paint tool의 개별 surface 흐름이 회귀하지 않아야 한다. Walls+floor completion, optional painted ceiling capture, collision-safe wall side, safe Slab/Ceiling creation, template persistence/mapping, 실패 0 mutation, 성공 single Undo가 위 테스트와 browser evidence로 확인되면 완료다. Manual partial-wall 3개까지 whole-wall 지원하는 일은 Wall split 또는 subsegment material이 별도 구현될 때까지 명시적으로 남는다.
