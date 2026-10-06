# 실제 아파트 도면 50개 개선 — Sol/high 승인 계약

계획 검토: `/root/zone_plan`, 설치된 code-reviewer, GPT-5.6 Sol/high. 구현은 설치된 luna-max, GPT-5.6 Luna/max. 기존 dirty changes 및 사용자 서버/장면은 보존한다.

## 고정 표본과 독립 근거

기존 3개 planId `3FO3YBET8M3M`, `3FO3Y8VP946W`, `3FO3YD1THDWY`를 제외한다. 이미 실행한 표본은 manifest.json의 50개를 고정한다: 50개 다른 단지, 기존 26개 캐시 전체 제외, 면적 5구간(<60,60–84,85–109,110–129,130+㎡)과 원본 인덱스 5분위 각각 2개, SHA-256 순으로 결정. 이는 권역 균형 표본이 아니므로 대표성 범위를 보고한다. 실패를 보고 표본을 바꾸지 않는다. 원본 URL, 해시, 수집 상태를 기록한다.

원본만 보는 독립 분석에서 50개 전체의 식별 가능한 방/원본 품질/구조 위험을 기록한다. 가능한 방 내부 seed·벽 span·통로 span·읽을 수 있는 인쇄 치수 및 끝점을 기록하고 불명확한 것은 unknown으로 분리한다. 원본 crop과 모델 overlay를 나란히 보존한다. raw vector count와 같은 알고리즘의 wallIoU는 진단용이며 사람이 표시한 원본 기준점 검사를 대체하지 않는다.

## Baseline과 개선

증거: `.omo/evidence/apartment-50-improvement-20261003/`. 현재 docVersion 13 vectorizer/source hashes, git 상태와 변경 전 코드를 보존한다. 원본 50개를 fresh vectorize하고 buildVectorNodes, detectSpacesForLevel, 존/바닥/천장 planner에 통과시킨다. 실패/timeout/reject도 결과 행으로 남긴다. 병렬 실행은 제한하며 제품 route의 90초 timeout을 평가한다.

도면마다 원본/벡터/import count, reject reason, unhosted/dropped openings/walls, detectedLoopCount, uniqueSpaceIdCount, editorStoreSpaceCount, 존 invalid/overlap/review, 바닥 누락/overlap, 인쇄 치수 일치성, 시간과 안정성 fingerprint를 기록한다. mmPerPx와 그 값으로 재계산한 결과의 일치는 외부 치수 검증으로 세지 않는다.

원본과 처음 달라지는 층을 결함 소유자로 지정한다: source/OCR scale → external vectorizer → apt-vector-scene importer → core topology → UI/persistence. 실제 공통 결함 한 원인씩 regression을 먼저 고정하고 Luna/max가 최소 수정한다. 외부 vectorizer는 원본 backup/hash/patch를 남기고 public repo에 private source를 복사하지 않는다. cache version은 extractor와 route를 함께 올린다. 넓은 snap, 가짜 wall, zone 개수 보정으로 실패를 숨기지 않는다.

## 즉시 승인된 공간 ID 근본수정

buildSpace가 full canonical polygon signature의 첫 12문자만 사용한다. 실제 해운대 9 loops→8 ids, 화명 7→5로 nextSpaces/Object.fromEntries에서 공간을 덮어쓴다. custom 짧은 hash 없이 full signature를 level prefix 뒤에 사용한다(파생/비영속 ID). 공통 leading coordinate의 다중 room, sync/undo/redo map 길이, 이전 실제3의 6/6·9/9·7/7을 회귀로 고정한다. 전체50에서 loop/unique IDs/store size를 paired 평가한다.

## 검증 기준

- 50/50은 분석 또는 명시적 실패 결과를 남긴다. reject/fallback은 자동모델 성공으로 집계하지 않는다.
- 공간 ID 손실, 비정상 geometry, hosted orphan/overflow, 새 false wall/exterior leak/floor overlap, 반복 import node 손실·semantic metadata 손실을 hard gate로 삼는다.
- 원본 wall positive probes recall 98%, semantic room seed 정확도 95%, closed-room floor 포함 100%, opening type 95%, readable 인쇄 치수 90%가 max(50mm,2%) 내를 목표로 평가한다. 미달 지표를 숨기지 않으며 evidence가 기존 acceptance 가정을 무효화하면 Sol에 재검토한다.
- 이전3 및 전체50 paired rerun에서 한 지표라도 악화되면 수정 재검토한다. 구조 파손/바닥 누락 → wall/opening → semantic/dimension 순으로 공통 원인을 수정한다.
- source annotation 없는 항목은 독립 검증 불가로 표시한다. case/probe weighted 분모, 완성도와 자체 일관성, visual와 machine metrics를 구분한다.

Focused tests → relevant regressions → editor types → changed-file Biome → package builds where applicable → production build. 격리 browser에서 source 속성으로 고른 대표8개(중앙/최소/최대/컬러/불규칙/개구부다수/치수/위험)를 실제 /apt→auto model→2D Zones로 확인한다. Source guide/marker, 2D/3D, 실제 gap repair, hosted 보존, single undo/redo, autosave/reload, 재import 및 flip 한 사례, mobile panel과 console errors를 기록한다. 3002 환경 장애는 원인을 명시하고 사용자 서버를 재시작하지 않는다.

최종 한국어 standalone report.html은 50개별 source/candidate overlay, paired metrics, 실패 원인/개선 전후 수치, 실행 명령/로그/브라우저 근거 및 잔여 불확실성을 제공한다. 배포/commit/push는 요청 범위에 없다.

## Sol/high 추가 승인: 치수선 대응 보정

실제 p42 LH영천센트럴타운159A의 인쇄 19773mm 폭이 3.34m로 생성됐다. trace에서 같은 합쳐진 치수선에 작은 여러 숫자가 대응한 false cluster(2.15~2.37)가 올바른 독립 overall cluster(13.335~13.352)와 3표 동률로 잘못 선택됐다.

기존 matcher의 축/offset/길이/타당성 조건을 유지하고 숫자 중심의 line projection이 midpoint에서 길이의 10% 이내일 때만 vote한다. merged interval은 1표만 기여한다. 여러 숫자는 중심성이 가장 좋은 하나만 남기되 동률/근접 경쟁은 interval 전체를 버린다. 서로 다른 interval 최소2개·6% cluster 규칙을 유지한다. 새로운 tick detector와 importer snap 변경은 추가하지 않는다.

no-evidence는 기존 bbox fallback을 유지한다. centered evidence가 있으나 unique cluster가 성립하지 않거나 충돌하면 null로 명시적으로 거부한다. shared-line 3nums/edge-center/3unique-centered/no-evidence/conflict regression 및 p42 독립 인쇄치수 검사를 고정한다. 기존 v13 baseline을 보존하고 v14 candidate를 별도 생성한다. external extractor와 API DOC_VERSION을 함께14로 올린다. 전체50의 independent 치수/벽/개구부 비교가 악화되면 재검토한다. scale 교정 후 남는 zone/enclosure/wall 실패는 별도 유지한다.

## Sol/high 추가 승인: 짧은 벽 조각 과연장 방지

승인: `/root/zone_plan` 완료 보고. p03 더클래식동작24㎡ 원본의 수평 상부 창에 약0.18m 모서리 조각이 weldDanglingEnds의1m 한도로 약0.66m 연장되어 가짜 꼭짓점과 삼각형 바닥을 만들었다. 최초 변경은 weldDanglingEnds에 한정한다.

입장 시 각 선분 원본 start/end/length/direction을 고정한다. 두 pass를 합친 각 endpoint의 원본부터 target까지 이동은 min(1m, 원본 선분 길이) 이하로 제한한다. mutually dangling의 상대 reachability 역시 상대 원본 line interval과 길이로 검사한다. pass 중 커진 선분 길이를 예산으로 사용하지 않는다. 긴 벽의 정상1m 접합은 유지한다. 새 수평 벽/창을 만들어 원본 누락을 덮지 않는다.

짧은 조각 과연장, 긴 벽 정상 접합, 누적2pass, 상대 원본 길이 제한 및 실제 p03 false peak/floor 제거 회귀를 남긴다. 원본에 없는 폐합이 제거되어 closed-space 수가 줄면 정확도 개선으로 보고한다. snapJunctions는 같은 최초 원인이 별도 확인되기 전 수정하지 않는다.

## Sol/high 재검토: 근거 없는 축척 추측 제거와 잔여 실패

검토 완료: `/root/zone_plan`. frozen50 source+OCR 직접실행에서44건은 dimension-line evidence,6건은 모두800×800 wood-dense no-evidence였다. bbox fallback이 scale을 반환한 p13/p17/p36/p49는 독립치수에서4/4오답이다. 이전 no-evidence bbox fallback 유지 승인을 이 증거로 폐기한다.

estimate_scale은 dimension_scale이 증명한 scale만 반환하고, bbox pair/single-axis로 축척을 추측하지 않는다. line evidence가 없거나 불충분하면 null로 guide/manual-scale 흐름에 남기며 자동모델 성공에서 제외한다. 새로운 dimension detector나 수동값 주입은 추가하지 않는다. extractor/API docVersion15를 함께 올리고 source/patch/hash/manual/exposure tests를 동기화한다. p13/p17/p36/p49→null, p34/p44 null유지,44line-evidence scale불변 및 이전실제3 회귀를 검증한다. v13 baseline과 중간v14를 보존하고 최종v15전체50을 별도재실행한다.

추가 자동 폐합/바닥 일반수정은 승인하지 않는다. p02 source rooms5/spaces0/dangling9 등 입력구조누락이 선행하며 core face enumeration이 공통최초원인이라는 증거가 없다. semantic room polygon을 바닥으로 사용하거나 snap/weld를 넓히면 이미 확인된 false diagonal/외부바닥을 늘린다. source-supported single gap은 quick repair, 다중/모호한 경계는 open/review+wall편집, missing/false structural walls는 extractor 잔여결함으로 보고한다.

95%room/100%floor 목표는 현재 미달이다. seed243/354 포함률은 진단치이며 한 merged slab이 여러seed를 덮을 수 있어 방별정확도나 폐합증명이 아니다. 정확한 방별성공은 원본room당 source-supported closed face1개, 인접room분리, outside-floor없음을 함께 만족해야 한다. 현재 per-room faceannotation부족은 unknown, 독립시각결함은 hard residual로 유지한다. 완성claim은 추가50분석/공통근본수정/검증에 한정하며 모든공간폐합완료라고 하지 않는다.

## Sol/high 추가 승인: 경계 정리 후 분리된 공간의 존 복구

계획 검토 `/root/zone_plan` 완료, 실행 모델은 기존 Luna/max를 유지한다. 실제 p35 안전137mm 연결에서 spaces11→12, enclosedZones11→10, generated Room2가 open/review로 바뀌었으나 그 구polygon이 coveredPolygons에 남아 새2closedface의 존생성을 막았다. 부모pure replay에서 기존0creates, 해당open generatedcoverage제외 시2creates를 재현했다.

createContext의 coveredPolygons 구성에서 각zone의 유효post-update enclosureStatus/metadata/polygon을 사용하고, metadata.generatedFrom===detected-space && enclosureStatus===open일 때만 생성억제coverage에서 제외한다. 기존zone은 existingZones/names/update/scene/undo에서 보존하며 name/polygon/content를 삭제하거나 변환하지 않는다. semantic/manual openzones와 matched/enclosed generatedzones의 coverage는 유지한다. 생성한polygon은 계속coveredPolygons에 추가해 중복을 막는다. split 재할당 추상화는 추가하지 않는다.

pure split2faces/metadata보존/semanticunion·matchedgenerated·manualnegative, live1transactionundo/redo/repeatsync/reload, frozenp35actual12faces각1enclosedZone 회귀를 검증한다. obsoleteRoom2open/review는 남고 replacement2존이 추가되므로 rawtotal이 아닌 currentface별coverage cardinality를 성공기준으로 한다. canonicalmanual/exposuretests를 같은변경에 갱신한다.

재가져오기 판정도 정정한다. AptTrace는 매시작새version이름scene1개를 생성하는 기존계약이며 StrictMode startedRef는 같은visit의중복생성만막는다. v13→14장면수1→2는 예상된새scene1개다. 테스트는1visit→1graphcreate와 새graph내중복geometry없음만검증하고 globalreuse/scene삭제를 도입하지 않는다. React unmount/WebGPU오류는 별도runtime검증항목이다.

## Sol/high 추가 승인: 최초 가져오기 바닥 저장 누락

검토 `/root/zone_plan` 완료. 실제 최종 v15 자동모델 6개 초기 저장 장면 모두 slab/ceiling 0/0이며, p35는 벽137mm 연결 후에만12/12가 생성됐다. AptTrace가 벽·개구부·존만 bootstrap graph에 넣고 공유 VectorSceneNodes가 바닥을 반환하지 않는 통합 누락이다. hydration baseline은 사용자 삭제 바닥의 부활을 막는 의도된 보호이므로 변경하지 않는다. 이 수정은 앞의 입력구조 추측/자동 폐합 확대 금지와 충돌하지 않는다.

buildVectorNodes에서 최종 import frame을 적용한 벽으로 detectSpacesForLevel을 실행하고, 증명된 roomPolygons만 기존 planAutoSlabsForLevel(...,[]), planAutoCeilingsForLevel(...,[])에 전달해 create 노드를 반환한다. doc.rooms/semantic polygon으로 바닥을 만들지 않는다. Slab elevation0.05, height 없는 level-following Ceiling, autoFromWalls 및 일반 metadata를 유지한다. apt-trace의 levelchildren/node map과 apt-search-panel의 기존 단일 applyNodeChanges transaction 양쪽에 삽입한다. 기존 derived-surface cleanup/history를 보존하고 hydration 강제 sync를 추가하지 않는다.

closed1/open+sourcepolygon0, frameflip/rotation/scale signature, IDs unique, reimport/manual surface preservation/one undo/redo 회귀를 검증한다. actual fresh6 scenes는 초기 바닥/천장이 각 독립 closed loop 수와 같아야 한다. p35 초기11/11→repair12/12→undo11/11→redo/reload12/12, generated slab 하나 삭제 후 wall edit 없이 save/reload 시 삭제 유지가 브라우저 게이트다. 기존50raw vector를 재사용해 importer 재평가하고 canonical manual을 갱신한다. 공간이 원본에 맞는지와 바닥 저장 여부를 분리해 보고하며, 알려진 바닥 footprint 누락·병합과 모바일 WebGPU 오류는 계속 잔여 실패로 기록한다.

기존 장면 경로의 추가 HIGH 검토를 반영한다. 빈 기존 surface 목록으로 만든 결과를 apt-search에 그대로 삽입하면 같은 footprint의 수동/유지 자동 바닥을 중복시킨다. buildVectorNodes의 선택적 세 번째 context는 existingSlabs/existingCeilings를 받아 기존 planner 억제를 재사용한다. AptTrace는 기본 빈 context이며, apt-search는 build 전에 기존 finder로 staleSurfaceIds를 계산하고 같은 레벨에서 그 삭제 예정 ID를 제외한 모든 유지 수동/자동 surface를 전달한다. 같은 stale ID 목록을 transaction delete에 재사용한다. 삭제 예정 surface를 context에 넣어 새 생성까지 막는 오류를 방지한다. exact/containing/복수 수동 union/far manual/retained auto/stale replacement 부정 회귀를 추가하며 새 geometry matcher는 만들지 않는다.

## Sol/high 추가 승인: 자동 바닥 삭제 후 재생성 방지

검토 `/root/zone_plan` APPROVE. 실제 격리 eff467575ece 장면에서 Slab 삭제 직후 동일 polygon이 새 ID로 복원되어 위 삭제 유지 게이트가 실패했다. levelStructureSnapshots가 자체 레벨의 모든 Slab ID/elevation을 slabKey에 넣어 파생 자동 바닥 삭제도 runSpaceDetection 입력 변경으로 처리한다. 자체 레벨 수직 배치 계산은 이미 수동 Slab만 사용한다.

자체 slabKey에는 autoFromWalls !== true인 수동 Slab의 ID/elevation만 포함한다. coveringUndersidesByLevel에는 자동을 포함한 모든 비매립 Slab을 그대로 유지해 상부 바닥 생성/삭제/elevation/thickness 변경이 아래층 Ceiling clamp를 갱신하게 한다. snapshot 설명을 수정하고 polygon 제외와 hydration baseline은 유지한다. tombstone, 삭제 특례, caller guard, 새 flag는 추가하지 않는다.

자동 Slab 삭제/elevation 편집은 자체 레벨 재계산을 유발하지 않아 보존되며 이후 벽/topology/support 변경은 정상적으로 파생면을 재조정할 수 있다. 삭제 한 Undo/Redo와 저장/reload, 자동 elevation 편집 후 벽 변경 재조정, 수동 support 변화, 상부 자동 바닥 변화의 아래층 clamp 및 매립 제외 회귀를 검증한다. canonical manual과 exposure를 동기화한다. importer/벡터 형상이 같으므로 50개 재추출은 반복하지 않고 lifecycle/browser 및 최종 source gate만 재검증한다.
