# Apartment next residual evidence — prepared replay

상태: **source-freeze 대기**. 이 단계에서는 candidate replay, 새 raster 추출, 새 paired render, 기존 evidence 덮어쓰기를 실행하지 않았다.

## 고정한 비교 기준

- 실행 경로: `gpt-5.6-luna / max`
- 동일 raw V15 입력: 50 plans
- 기존 `residual-closure-eba42adc` candidate imported/evaluation과 metrics를 before 기준으로 사용: 50건, 44 imported, 6 rejected, 0 errors
- 기존 eba42adc candidate의 동일 330개 source probe 기준: room-seed hit 298/330
- 기존 exact polygon audit: stored slab/ceiling positive overlap 0쌍
- imported output: stored slabs 374, ceilings 374; slab/ceiling plan match 44/44
- authored wall/opening/source semantic Zone 보존: 44/44; per-case floor-probe loss 0
- manual recovery/UI는 대상 6건의 별도 검증 레인이다. 현재 준비 단계에서 실제 검증 완료 건수는 기록하지 않으며, 자동 50/50으로 합산하지 않는다.

기존 paired render는 새로 찍지 않고 해시가 고정된 historical render를 재사용할 때만 연결한다.

## 새 harness와 manifest

- baseline manifest: [`baseline-manifest.json`](baseline-manifest.json)
- prepared replay manifest: [`replay/replay-manifest.json`](replay/replay-manifest.json)
- harness copy manifest: [`replay-harness/harness-copy-manifest.json`](replay-harness/harness-copy-manifest.json)
- adapted evaluator: [`replay-harness/evaluate_candidate.ts`](replay-harness/evaluate_candidate.ts)
- adapted input guard: [`replay-harness/verify_replay_inputs.py`](replay-harness/verify_replay_inputs.py)
- baseline contract: [`verification/baseline-contract.json`](verification/baseline-contract.json)
- preparation guard: [`verification/input-guard-prepared.json`](verification/input-guard-prepared.json)

Before 경로는 `.omo/evidence/apartment-residual-closure-20261003/replay/candidate-imported-residual-closure-eba42adc`, `candidate-evaluation-residual-closure-eba42adc`, `candidate-residual-closure-eba42adc-metrics.json`으로 고정했다. 이전 `0b926754` imported/evaluation 경로를 비교 기준으로 사용하지 않는다.

`replay-harness/upstream/`에는 이전 residual-closure harness 원본 사본을 보존하고, 실행용 사본은 새 evidence root만 쓰도록 경로를 적응했다. 준비 guard는 24 frozen source snapshots와 50 raw documents를 확인했고, eba42adc before 비교 기준·manual guide injection 금지·old V15-floor baseline 금지를 확인한다.

## 실행 게이트

parent가 전달하는 명시적 source-freeze와 SHA가 오기 전까지 candidate 실행은 차단한다. 현재 Lane A 작업으로 working-tree의 일부 소스가 baseline manifest와 다르므로, candidate는 frozen snapshots와 parent source-freeze를 함께 검증한 뒤에만 실행할 수 있다. 모든 candidate 산출물은 이 새 root 아래에만 기록한다.
