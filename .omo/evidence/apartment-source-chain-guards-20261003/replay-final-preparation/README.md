# Lane B 소스 체인 검증 준비

이 디렉터리는 `apartment-source-chain-guards-product-revision-20261003` 계약에 대한 증거 전용 준비물입니다. Lane A의 동결된 `eba42adc` core와 `eb96fcb` importer를 기준으로 같은 V15 원본 50개, 승인된 44개, 거부 6개를 고정했습니다. 원본 래스터 재추출과 수동 가이드 주입은 하지 않았습니다.

## 현재 기준선

- 입력: V15 50개, import 성공 44개, reject 6개, 오류 0개
- 바닥 probe: 298/330 (`.omo/evidence/apartment-next-residual-20261003/replay/candidate-lane-a-final-metrics.json`)
- 저장된 Slab/Ceiling: 각각 374개
- 정확한 polygon audit: raw/Slab/Ceiling 모두 양의 면적 겹침 0개; raster shared-edge 진단값과 분리
- contained duplicate span: 전체 20쌍, 5.837984476195861m; p07은 3쌍, 1.2844009967433032m
- O5 source window: 3.275m, world interval/host-child integrity PASS

정확 audit는 [`exact-surface-audit-lane-a-final.json`](exact-surface-audit-lane-a-final.json), 중복 span은 [`contained-duplicate-span-lane-a-final.json`](contained-duplicate-span-lane-a-final.json), O5는 [`o5-source-window-lane-a-final.json`](o5-source-window-lane-a-final.json)에 있습니다. 일반 벽끼리의 접점이나 정상 T/L/X junction을 중복 벽으로 세지 않는 정의를 사용합니다.

## Importer 성능 기준선

[`lane-a-eb96-importer-baseline-frozen-core-importer-benchmark.json`](performance/lane-a-eb96-importer-baseline-frozen-core-importer-benchmark.json)은 Lane A의 immutable `eba42adc` core, `eb96fcb` importer, `apt-import-frame` source copy를 사용해 44개 승인 도면을 2회 warm-up 후 12회 측정한 결과입니다. `buildVectorNodes(cloned raw V15 document)`만 시간을 재고, clone과 canonical geometry 비교는 측정 밖에서 수행했습니다.

- 528 timed calls, 44/44 canonical parity, geometry idempotence PASS, round error 0
- importer median 4.557416ms, p95 12.468375ms, max 55.009292ms
- 이 evidence 기준선의 후보 허용 상한: `12.468375 × 1.25 = 15.585469ms`
- 이전 9.530709ms/9.528625ms 측정은 live current core dependency를 사용한 선행 실행이라 `SUPERSEDED_PRE_FROZEN_CORE_REWRITE`로 보존하며, 이 Lane A gate에 사용하지 않습니다.
- 24-file Lane A freeze 중 현재 workspace와 다른 파일 12개를 [`source-delta-lane-a-live-snapshot.json`](source-delta-lane-a-live-snapshot.json)에 기록했습니다. benchmark는 live 파일을 복구하지 않았고, core의 transitive dependency 전체를 Lane A snapshot으로 닫았다고 주장하지 않습니다.
- frozen `space-detection.ts`의 직접 상대 import 13개는 [`source-contact-attribution-lane-a.json`](source-contact-attribution-lane-a.json)에 귀속 기록했습니다(현재 workspace에서 13개 해석, 24-file snapshot에 포함된 직접 dependency 0개). 24-file snapshot 바깥의 transitive dependency는 현재 workspace에서 해석될 수 있으므로, 이 artifact는 완전한 transitive closure라고 주장하지 않습니다.
- 최종 후보 timing과 ratio는 아직 실행하지 않았으므로 PASS로 해석하지 않음

Detector 전용 과거 수치(2.2555ms/2.729875ms)는 importer 기준선으로 사용하지 않습니다. 비교 계약은 같은 2+12 protocol과 frozen Lane A p95를 사용하며, 후보 실행은 명시적인 B source freeze와 `--execute-candidate`가 없으면 [`run_candidate_guarded.ts`](run_candidate_guarded.ts)가 거부합니다.

## 재현 경로

- 준비 계약: [`preparation-manifest-lane-b-final-frozen-core-baseline-measured.json`](preparation-manifest-lane-b-final-frozen-core-baseline-measured.json)
- 원본 입력 계약: [`performance-input-manifest-lane-a.json`](performance-input-manifest-lane-a.json)
- 준비 검증: [`preparation-verification-frozen-core-baseline.json`](preparation-verification-frozen-core-baseline.json)
- importer benchmark: [`benchmark_importer_sourcecopy.ts`](benchmark_importer_sourcecopy.ts)
- paired protocol preparation: [`prepare_paired_importer_benchmark.ts`](prepare_paired_importer_benchmark.ts) · [`performance/paired-importer-protocol-preparation.json`](performance/paired-importer-protocol-preparation.json)
- live source drift capture: [`capture_source_delta.py`](capture_source_delta.py)
- direct core dependency attribution: [`capture_core_dependency_attribution.py`](capture_core_dependency_attribution.py) · [`source-contact-attribution-lane-a.json`](source-contact-attribution-lane-a.json)
- candidate guard: [`verify_final_preparation.py`](verify_final_preparation.py), [`run_candidate_guarded.ts`](run_candidate_guarded.ts)

현재 상태는 동결 core source copy 기준선이 측정된 `READY_LANE_A_FROZEN_CORE_BASELINE_MEASURED_WAITING_FOR_B_SOURCE_FREEZE`입니다. [`verify_frozen_core_baseline.py`](verify_frozen_core_baseline.py)의 검증 결과는 PASS이며 candidate 실행은 차단되어 있습니다. 이 준비 단계에서는 product source, tests, build, runtime, browser, source image 및 기존 evidence를 변경하지 않았습니다. 최종 후보가 승인된 source freeze를 받은 뒤에만 새 evidence 하위 경로에서 paired replay와 final importer timing을 수행합니다.
