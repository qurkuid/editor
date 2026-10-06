# Lane B source-chain guard 준비 증거

이 디렉터리는 Lane B 후보 실행 전의 **읽기 전용 준비 산출물**이다. Lane A에서 동결된 자동 가져오기 결과와 같은 V15 원본 50건, 330개 probe, annotation/image freeze를 해시로 묶었다. 이 작업에서는 제품 소스, 빌드, UI, 서버, raster 재추출을 실행하지 않았고 후보 실행도 하지 않았다.

## 기준선

- Lane A source freeze: `55c24008cf3697d2732b92179d1e1053ec3e90521a1697a60601a2392a12667d`
- 입력: raw V15 50건, imported 44건, rejected 6건, floor probe 298/330
- `containedDuplicateSpan`: 짧은 물리 벽 S의 두 끝점이 긴 벽 L의 닫힌 종방향 구간 안에 각각 `1e-6 m` 이내로 투영되고, L 중심선까지 거리가 L 시공 반두께+`1e-6 m` 이내일 때 S 길이를 한 번만 센다. 기존 helper 계약과 같이 방향 내적 절댓값 `>= 0.99`를 적용해 일반 L/T/X 접점과 단순 polygon/raster overlap을 세지 않는다.
- 전체 44개 baseline: 20쌍, 합계 `5.8379844762 m`; pair가 있는 도면 13개
- p07 (`3FO40C71IWG4`): 3쌍, `1.2844009967 m` → 승인 기준 3쌍/`1.284401 m` 이내
- p07을 제외한 43개: 17쌍, `4.5535834795 m`, 12개 도면. 이는 baseline 관측값이며 후보 후 개선을 주장하는 수치가 아니다.
- 순수 metric synthetic control: offset/adjacent/crossing/T-junction은 0쌍, 완전히 포함된 평행 short wall만 1쌍으로 확인했다.

## o5 확인

동결된 p07에서 source opening `o5`는 `window`, 폭 `3.275 m`이다. raw 변환 interval은 `[0.6413, 3.9163] m`, imported host interval도 같고 최대 차이는 `4.4e-16 m`이다. source ID/type/폭 metadata, host의 parent-child 관계가 모두 확인되었다. 상세 결과는 [`o5-source-window-check.json`](./o5-source-window-check.json)에 있다.

## 재현 및 가드

- [`contained_duplicate_span.py`](./contained_duplicate_span.py): 동결 imported walls만 읽는 metric harness
- [`prepare_lane_b_inputs.py`](./prepare_lane_b_inputs.py): raw/import/evaluation/probe/image 입력 해시 매니페스트 생성
- [`verify_preparation.py`](./verify_preparation.py): source gate, 50/44/6, 298/330, 파일 해시, p07 기준, 후보 실행 금지 확인
- [`preparation-manifest-lane-b.json`](./preparation-manifest-lane-b.json): 최종 준비 계약과 산출물 해시
- [`preparation-verification-final-2.json`](./preparation-verification-final-2.json): 최종 검증 `PASS`
- [`baseline-contained-duplicate-span.json`](./baseline-contained-duplicate-span.json): 44개 per-plan pair 상세

Lane B source freeze가 별도로 승인되기 전에는 이 기준선에 대해 candidate replay를 실행하지 않는다. 후보 후 비교에서 요구되는 제한은 p07 pair 0/길이 0, 나머지 43개 pair 증가 없음과 per-case floor probe loss 0이며, 이 디렉터리의 baseline 결과만으로 그 후조건을 주장하지 않는다.
