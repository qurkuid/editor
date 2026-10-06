# 아파트 R4 운영 배포 계획

## 판정과 배포 단위

- 계획 역할: `gpt-5.6-sol / high`, read-only 배포 설계.
- 기준 Git 상태는 `HEAD = fork/deploy/floorplan = 8210a808adb0ed6e9ac79fde530914529eb44611`이다. 현재 운영도 이 커밋, build ID `X6qbOgOOG-Wj7_KCsVC_P`, PM2 `apt-subdomain`, 포트 `3024`이다.
- 이번 배포는 **18개 승인된 저장소 blob + 외부 vectorizer v15**를 하나의 결합된 릴리스로 취급한다. 앱 라우트만 먼저 활성화하지 않는다.
- Git 릴리스 검증 기준은 정확한 기준 커밋에서 만든 clean detached worktree에 manifest의 18개 blob만 복사한 projection이다. 검증 뒤 실제 branch commit은 원본 checkout에서 index/HEAD/hash sentinel을 다시 확인하고 동일 18개만 명시적으로 stage하여 만든다. 이 방식은 원본 branch가 push 뒤 stale 상태로 남는 문제를 피하면서 unrelated dirty 파일을 보존한다.
- 운영 장면 DB, 기존 저장 장면, 원본 도면, 50건 QA DB, 로컬 증거, vector cache를 릴리스에 이식하지 않는다.
- 기존 projection 증거는 배포 gate로 무효다. `apt-vector-scene.test.ts`의 p03 회귀가 private `.omo/evidence/.../vector.json`을 읽어 clean checkout에서 실패했고, 일부 build 명령은 잘못된 Bun cwd 형식으로 `Script not found`가 발생했다. 이는 제품 build 실패로 해석하지 않지만 올바른 명령으로 새 증거를 만들어야 한다.
- 두 source-level blocker는 해소됐다. p03 테스트의 승인 blob은 실제 원인 벽 `w13`, `w18`과 무관한 원거리 벽 `w0`만 포함한 `0ad44d97b69726de9f251e409c521b372cde08bc02e609c75c90bdc874f39696`이다. 기준 커밋의 옛 importer를 그대로 사용한 counterfactual은 같은 입력에서 가짜 peak를 재현했다. 외부 vectorizer도 원래 rollout patch를 docVersion 13 보존본에 재적용하여 50건 검증본 `c68552ec38c65326865ba20190019eb03c5fc08aa4af3a5c6b3acd8290377077`과 byte-identical하게 복구했다. 이 승인은 source 선택 승인이다. 승인 test blob을 원본 checkout과 새 clean projection에 다시 materialize하고 전체 tests/types/Biome/build를 재실행하기 전에는 commit 또는 활성화하지 않는다.

## 릴리스 범위

정확한 allowlist와 SHA-256은 `.omo/evidence/apartment-r4-deployment-20261003/scope-manifest.json`을 단일 기준으로 사용한다.

포함 범위는 다음과 같다.

1. vector API 문서 버전 15 전환.
2. 아파트 도면의 실물 축척 프레임, 자동 모델링, importer/topology, Slab/Ceiling/Zone 생성 및 회귀 테스트.
3. 닫힌 Space의 단일 Zone 소유권, 자동 surface 삭제·history, 검출 성능 cache.
4. viewer renderer 초기화 deadline 및 회복 경로.
5. 모델링 manual과 AI/MCP 노출 테스트.

다음은 제외한다.

- `packages/nodes/src/zone/quantities-panel.tsx`
- `packages/nodes/src/zone/quantities-panel.test.tsx`
- `.omo/**`, `.omx/**`, QA DB, 원본 도면, 벡터 cache, screenshot/report
- 이미 기준 커밋 `8210a808`에 포함된 L 연결·축 맞춤 파일의 재복사
- npm package release, GitHub Release, schema migration, 운영 장면 자동 재생성

`packages/core/src/lib/room-boundary.test.ts`와 manual/ontology/resource 파일은 현재 HEAD의 L 연결 내용을 이미 포함한 상태 위에 아파트 회귀가 더해진 **현재 manifest blob 전체**를 복사한다. 과거 아파트 snapshot을 적용해 L 변경을 되돌리지 않는다.

## 0. Portable p03 회귀 복구

`apps/editor/lib/apt-vector-scene.test.ts`의 `keeps the p03 source-outside fake peak out of imported endpoints`는 제품 동작은 맞지만 테스트 입력을 `.omo/evidence/apartment-50-improvement-20261003/...`에서 읽는다. 다음과 같이 test-only로 고친다.

1. 제품 importer 코드는 바꾸지 않는다.
2. p03의 실제 상단 창/짧은 bevel 원인을 재현하는 최소 `AptVectorDoc` wall 집합과 기존 잘못된 peak endpoint만 같은 테스트 파일에 상수로 넣는다. `imageSize`, `mmPerPx`, source wall endpoints와 thickness는 실제 p03 값에서 그대로 가져오며 임의 좌표를 만들지 않는다.
3. 기존 세 가지 의미를 유지한다.
   - marker `[363, 140]`은 authored source wall에서 30 source-px보다 멀다.
   - 과거 잘못된 imported endpoint는 marker에서 15 source-px보다 가깝다.
   - 현재 `buildVectorNodes` 결과의 모든 endpoint는 marker에서 30 source-px보다 멀다.
4. 기존 `readFileSync`/`resolve` import가 이 테스트에만 쓰이므로 제거한다.
5. test skip, 환경변수 분기, evidence path fallback, 원본 `.omo` symlink는 허용하지 않는다.
6. 승인 fixture는 `w13=[3008.1,1692.6]→[3135.8,1564.9]`, `w18=[3800.6,1566.1]→[3929,1694.5]`, 원거리 `w0=[3022.4,5729.6]→[8336.6,5729.6]`이다. 기준 커밋 `8210a808...`의 `apt-vector-scene.ts`를 그대로 복사한 counterfactual에서 세 assertion이 통과하여 옛 코드가 peak를 재현함을 확인했다. 다른 wall 집합으로 바꾸면 이 source 승인은 무효다.

이 수정은 `apt-vector-scene.test.ts` 한 파일의 hash만 바꾼다. 18-file path allowlist는 유지한다. 승인 hash는 `0ad44d97b69726de9f251e409c521b372cde08bc02e609c75c90bdc874f39696`이다. 임시 projection이 이후 이전 `281665...` fixture로 덮인 사실이 있으므로, 원본 checkout에 승인 blob을 적용하고 새 projection에서 hash를 다시 확인해야 한다. 과거 causal 로그만으로 clean projection 최종 gate를 대체하지 않는다.

## 1. Clean projection 생성

1. 원본 checkout의 index가 비어 있고 HEAD와 `fork/deploy/floorplan`이 모두 `8210a808...`인지 확인한다. 불일치하면 중단하고 새 원격 기준으로 계획을 다시 결합한다.
2. portable p03 수정 뒤 갱신된 최종 scope manifest를 사용해 각 allowlist 파일의 SHA-256을 확인한다. 한 파일이라도 다르면 복사·커밋을 중단한다.
3. 원본 checkout을 stash/reset/checkout하지 않는다.
4. 별도 경로에 detached worktree를 만든다.

   ```bash
   git worktree add --detach /tmp/editor-apartment-r4-release-20261003 8210a808adb0ed6e9ac79fde530914529eb44611
   ```

5. manifest의 18개 파일만 부모 디렉터리를 만든 뒤 byte copy한다. tracked 16개는 수정으로, renderer helper/test 2개는 새 파일로 나타나야 한다.
6. 복사 뒤 SHA-256을 다시 계산하여 manifest와 일치시킨다.
7. `git diff --name-only`와 `git status --short`의 경로 집합이 allowlist와 정확히 같아야 한다. quantities, `.omo`, `.omx`, DB, image가 하나라도 있으면 실패한다.
8. `git diff --check`가 통과해야 한다.

## 2. Clean projection 검증

다음 검증은 `pwd`가 clean worktree root이고 `.omo`가 존재하지 않는 상태에서 새로 실행한다. 원본 checkout에서 projection 경로의 test file만 지정해 실행하는 것은 clean 증거가 아니다.

```bash
bun install --frozen-lockfile
bun test \
  apps/editor/lib/apt-import-frame.test.ts \
  apps/editor/lib/apt-vector-scene.test.ts \
  apps/editor/lib/ai-contract.test.ts \
  packages/core/src/lib/room-boundary.test.ts \
  packages/core/src/lib/room-boundary-l.test.ts \
  packages/core/src/lib/room-boundary-manual.test.ts \
  packages/core/src/lib/space-detection.test.ts \
  packages/core/src/lib/space-detection-history.test.ts \
  packages/core/src/lib/wall-operations.test.ts \
  packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts \
  packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts \
  packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts \
  packages/editor/src/components/tools/wall/wall-drafting.test.ts \
  packages/nodes/src/wall/endpoint-edit-plan.test.ts \
  packages/nodes/src/wall/floorplan-affordances.test.ts \
  packages/mcp/src/ontology-manual.test.ts \
  packages/mcp/src/resources/resources.test.ts \
  packages/viewer/src/lib/renderer-init.test.ts
(cd packages/core && bun run build)
(cd packages/viewer && bun run build)
(cd packages/nodes && bun run build)
(cd packages/mcp && bun run build)
(cd apps/editor && bun run check-types)
bunx biome check <manifest의 18개 경로>
(cd apps/editor && bun run build)
```

필수 판정:

- 모든 명령 exit 0. `apt-vector-scene.test.ts`는 `.omo`가 없는 clean root에서 통과해야 한다.
- app build의 source hash가 manifest와 동일하고 build 중 source drift가 없어야 한다.
- 기존 R4 성능 benchmark를 고르기식으로 다시 실행하지 않는다. `space-detection.ts=e899d97d...`가 승인된 benchmark source와 같음을 증명하는 것으로 고정한다.
- 50건 raw/vector 재생성은 release projection 검증에 반복하지 않는다. 이미 승인된 동일 blob인지 hash로 결합하고, 외부 vectorizer는 아래 별도 gate로 검증한다.

## 3. 외부 vectorizer v15 동결

운영 현재값:

- `VECTORIZER_DIR=/Volumes/DATABASE/floorplan-vectorizer`
- `VECTORIZER_PYTHON=/usr/local/bin/python3`
- 현재 운영 `vectorize.py=6307ad0760300e995ece6aabfc570d8cf4a0fa135438ebaadf552bb99d836f94`, `docVersion=13`

신규 릴리스는 아래 A 경로로 확정한다.

- 배포 `vectorize.py=c68552ec38c65326865ba20190019eb03c5fc08aa4af3a5c6b3acd8290377077`
- `build_doc(... docVersion=15)`
- focused calibration test 통과
- `python3 -m py_compile` 통과
- 로컬 최종 `9e9920db...`와의 차이는 증거상 docstring뿐임을 기록한다.

### A. exact c685 복구

1. 원래 c685 batch 직후 docstring을 고쳐 9e가 된 rollout의 실제 tool-call transcript와 completion record를 찾는다.
2. transcript에서 정확한 docstring-only 변경의 이전/이후 bytes, 파일 hash, cwd를 추출한다. 기억이나 수동 추측으로 문구를 복원하지 않는다.
3. 현재 `9e9920...` evidence copy에 그 docstring 변경만 역적용한다.
4. 결과가 정확히 `c68552ec...`이면 c685를 recovered frozen source로 승인한다.
5. `diff c685 9e`가 오직 해당 docstring이고 Python AST가 동일한지 확인한다.
6. focused scale tests와 `python3 -m py_compile`을 실행한다.

이 경로는 완료됐다. 승인 입력은 보존된 docVersion 13 `6307ad0760300e995ece6aabfc570d8cf4a0fa135438ebaadf552bb99d836f94`, 원래 rollout ordinal 3652에서 추출한 patch `4f39a2bdffa9c2076cfbac8cfa89a48bcfaf7c7e862ced84c99a0f5409b834cf`, 결과 `c68552ec...`다. 결과가 50건 V15 artifact에 기록된 SHA와 정확히 같고 focused calibration 8건과 `py_compile`이 통과했다. 따라서 B 경로와 50건 재실행은 사용하지 않는다.

### B. conditional 9e 재승인

A가 불가능할 때만 `9e9920db...`를 배포 후보로 검토한다. 다음을 모두 만족해야 하며 하나라도 빠지면 활성화하지 않는다.

1. `6307ad... + focused patch = 9e9920...` 재구성 hash가 이미 입증되어 있어야 한다.
2. original rollout 기록이 c685→9e 변경이 실행 코드가 아닌 `estimate_scale` docstring 한 곳뿐이었다는 사실을 source line과 hash로 입증해야 한다. 단순 provenance 문장만으로는 부족하다.
3. frozen 50 raw inputs와 같은 OCR 입력/cache 조건에서 9e를 실행한다. timing은 측정하거나 비교하지 않는다.
4. 각 case의 결과를 frozen c685 output과 canonical JSON으로 paired 비교한다. source basename처럼 사전에 명시한 비동작 필드 외에는 `docVersion`, unit, `mmPerPx`, walls, openings, rooms, metrics, accepted/rejected 결과가 모두 같아야 한다. 50/50 exact semantic parity와 case별 hash를 남긴다.
5. 기존 focused scale regression, annotation controls, `python3 -m py_compile`이 통과해야 한다.
6. Sol이 paired artifact와 source proof를 재검토해 `acceptedDeploySha256=9e9920...`를 명시적으로 기록해야 한다.

`c68552...`를 정확히 복구하면 A를 사용하고 50건을 재실행할 필요는 없다. A가 실패했다고 B의 parity gate를 줄이거나 샘플 수를 축소하지 않는다.

서버에서는 mutable 기존 디렉터리를 덮지 않고 다음과 같은 버전 디렉터리를 만든다.

```text
/Volumes/DATABASE/floorplan-vectorizer-releases/20261003-<accepted-sha8>-v15/
  vectorize.py
  ocr_vision.swift
  .build/ocr_vision
  .build/ocr-cache/   # 실행 중 생성, 릴리스 입력에는 포함하지 않음
```

- `vectorize.py`는 A의 `c68552...` 또는 B에서 Sol 재승인된 `9e9920...` 중 하나만 복사한다. 실제 선택 SHA를 release manifest와 PM2 env에 결합한다.
- `ocr_vision.swift`는 현재 운영의 원본 SHA를 먼저 기록하고 같은 파일을 복사한다.
- `.build/ocr_vision`은 새 버전 디렉터리에서 `swiftc -O`로 빌드하고 SHA를 기록한다. 운영의 OCR cache는 복사하지 않는다.
- Python/OpenCV 등은 현재 운영과 같은 `/usr/local/bin/python3` 환경을 사용하고 import smoke를 실행한다.
- 새 PM2 ecosystem만 `VECTORIZER_DIR`을 versioned v15 디렉터리로 바꾼다. rollback ecosystem은 기존 `/Volumes/DATABASE/floorplan-vectorizer`를 유지한다.

## 4. 커밋·push

portable test hash 갱신, 외부 vectorizer A 또는 B gate, clean projection 검증이 통과한 뒤 원본 checkout에서 다음 sentinel을 다시 확인한다.

- `HEAD`와 `fork/deploy/floorplan`이 아직 `8210a808...`이다.
- index가 비어 있다.
- 원본 checkout의 18개 파일 SHA가 manifest와 일치한다.
- clean projection의 18개 파일 SHA와 원본 checkout의 18개 파일 SHA가 일치한다.

그 뒤 `git add -- <manifest의 18개 정확한 경로>`만 실행한다. `git add -A`, broad stage, stash, reset은 사용하지 않는다. staged path 집합이 manifest와 정확히 같고, `git show :<path>`의 SHA-256이 manifest와 같은지 확인한 뒤 일반 `git commit`으로 한 커밋을 만든다. commit 직전에 unrelated staged path나 HEAD/hash drift가 생기면 `git restore --staged -- <18개 경로>`만 실행하고 중단한다. 원본 working tree의 quantities와 evidence는 건드리지 않는다.

```text
feat: improve apartment import and closed-zone modeling
```

커밋 전후에 다음을 기록한다.

- parent `8210a808...`
- commit SHA
- 18개 tree blob SHA-256
- diff path 집합과 scope manifest equality
- tests/types/Biome/build 로그 SHA

원격이 여전히 `8210a808...`일 때만 CAS push한다.

```bash
git push fork <new-commit>:refs/heads/deploy/floorplan \
  --force-with-lease=refs/heads/deploy/floorplan:8210a808adb0ed6e9ac79fde530914529eb44611
```

원격이 움직였으면 force하지 않고 중단한다. 새 원격 HEAD에서 clean projection과 검증을 다시 수행한다.

`ci.yml`과 `mcp-ci.yml`은 이 branch push를 대상으로 한다. exact commit run이 생성되면 둘 다 success여야 활성화한다. GitHub Actions가 실제로 enqueue되지 않으면 `CI_NOT_ENQUEUED`로 남기고 CI 통과라고 쓰지 않는다. 이 경우 서버의 동일 커밋 전체 install/test/type/build gate를 필수 대체 증거로 사용한다. 뒤늦게 같은 commit의 CI가 시작해 실패하면 즉시 rollback 대상으로 본다.

## 5. ggbg20 prepare와 격리 canary

기존 `manual-l-connection` prepare 방식을 복사하되, 릴리스 이름·로그·vectorizer를 R4 전용으로 만든다.

1. SSH는 `-oControlMaster=no -oControlPath=none`을 사용한다.
2. 서버에서 fork의 `deploy/floorplan`을 fetch하고 FETCH_HEAD가 정확한 신규 commit인지 확인한다.
3. `/Volumes/DATABASE/floorplan-releases/20261003-<short>`에 detached worktree를 만든다.
4. `/Volumes/DATABASE/floorplan-deploy-backups/20261003-<short>`에 다음을 저장한다.
   - `pm2 jlist`
   - 현재 PM2 cwd, build ID, PID, env 중 비밀값을 제거한 summary
   - SQLite online backup. 이는 비상 증거이며 코드 rollback 때 자동 restore하지 않는다.
   - 현재 vectorizer dir/source SHA
   - 현재 vector-cache 파일명/docVersion/mtime inventory. 원본 도면이나 cache body는 release artifact로 복사하지 않는다.
5. `.env.local`은 기존 운영본을 release dir에 권한 600으로 복사하되 evidence에 내용을 남기지 않는다.
6. 서버에서 clean projection과 같은 tests/types/Biome/package builds/app build를 실행한다.
7. app build ID와 18개 source hash가 release manifest와 같음을 확인한다.

운영 전환 전에 별도 비공개 포트에서 canary를 실행한다.

- 운영 scene DB를 사용하지 않는다. 신규 disposable DB path를 사용한다.
- `APT_DATA_DIR`은 운영 원본을 옮기지 않는다. immutable index/data만 read-only로 연결하고 자체 writable `vector-cache`를 가진 임시 디렉터리를 만든다.
- `VECTORIZER_DIR`은 신규 versioned v15 디렉터리를 사용한다.
- 알려진 accepted plan 하나를 새로 vectorize하여 HTTP 200, `code=OK`, `data.docVersion=15`, `unit=mm`, finite positive `mmPerPx`, non-empty `walls`를 확인한다.
- `/apt`를 실제 브라우저에서 열고 검색·도면 조회까지만 확인한다. 자동 모델링이나 운영 scene 저장은 수행하지 않는다.
- renderer readiness는 `/apt`로 주장하지 않는다. 같은 격리 canary의 disposable scene으로 `/editor`를 열어 3D canvas ready/fallback 상태와 console error 0을 확인한다. 이 scene은 격리 DB에만 존재한다.
- health OK와 위 두 browser gate를 확인하고 canary를 종료한다.

## 6. PM2 활성화

활성화 직전 CAS 조건:

- `apt-subdomain`이 online이고 포트 3024를 사용한다.
- 현재 cwd/commit/build ID가 prepare 때 기록한 값과 같다. 현재 알려진 값은 `8210a808...` / `X6qbOgOOG-Wj7_KCsVC_P`; 달라졌다면 중단한다.
- 신규 app release, build ID, source hash, vectorizer release SHA가 모두 고정되어 있다.
- 운영 DB 파일은 변경하지 않았다.

새 ecosystem은 기존 운영 env를 보존하면서 다음 두 값만 의도적으로 결합한다.

- `cwd=/Volumes/DATABASE/floorplan-releases/20261003-<new>/apps/editor`
- `VECTORIZER_DIR=/Volumes/DATABASE/floorplan-vectorizer-releases/20261003-<accepted-sha8>-v15`

`PORT=3024`, `VECTORIZER_PYTHON=/usr/local/bin/python3`, `APT_DATA_DIR=/Volumes/DATABASE/apt-data`, DB path와 나머지 env는 기존 값을 유지한다. 앱과 vectorizer env를 같은 PM2 restart에서 전환한다. 중간에 DOC_VERSION15 앱이 v13 vectorizer를 사용하거나 반대 조합이 노출되면 실패다.

전환 후 즉시 다음을 확인한다.

1. PM2 online, restart 폭증 없음, cwd/build ID/env가 신규 값.
2. loopback health 200.
3. public health 200.
4. 서버 로그에 module/load/vectorizer 오류 없음.

## 7. public vector API와 브라우저 검증

공개 API 생성 검증은 accepted control 한 건으로 제한한다. 우선 래미안장전89B `3FO4KH7SYCOC / 3FO3YBET8M3M`을 사용한다.

1. 전환 직전 해당 `vector-cache/<planId>.json`의 존재·SHA·docVersion을 기록한다.
2. public endpoint에 `?refresh=1`을 한 번 호출한다.
3. HTTP 200, `Cache-Control: no-store`, `code=OK`, `data.docVersion=15`, `unit=mm`, finite positive `mmPerPx`, non-empty walls를 검증한다.
4. query 없는 동일 GET을 호출해 docVersion15 cache가 public route와 호환되는지 확인한다.
5. raw vector body는 Git이나 공개 evidence에 저장하지 않고, plan ID·status·docVersion·unit·walls count·mmPerPx·body SHA만 기록한다.

이 호출은 파생 vector cache 한 파일만 갱신한다. `POST /api/scenes`, 자동 모델링, 기존 scene 수정·저장·재생성은 하지 않는다.

public browser에서는 `/apt`의 검색과 도면 조회, health, console error만 확인한다. 이 공개 smoke로 renderer readiness를 주장하지 않는다. `/scene/[id]`는 load 뒤 autosave PUT과 thumbnail POST가 발생할 수 있으므로 기존 운영 장면을 읽기 검증 목적으로도 열지 않는다. p07/p30/synthetic의 모델링·Undo/Redo/Reload와 renderer 증거는 동일 source hash에 결합된 격리 QA/canary 증거를 사용한다.

## 8. rollback

다음 중 하나면 rollback한다.

- PM2/health/public HTTP 실패
- vector API가 docVersion15가 아니거나 JSON/scale/walls validation 실패
- source/build/vectorizer SHA drift
- 새 console error, 반복 restart, vectorizer 5xx
- 같은 commit의 CI 실패

rollback 순서:

1. 신규 앱을 중지한다.
2. 활성화 시점 이후 생성·갱신된 `docVersion=15` vector cache 파일 목록을 기록하고 삭제한다. 이는 파생 cache만 대상으로 하며 원본 도면이나 scene DB를 건드리지 않는다. 기존 doc13 앱이 v15 cache를 그대로 읽지 않게 하기 위한 필수 조치다.
3. 이전 cwd와 기존 `VECTORIZER_DIR=/Volumes/DATABASE/floorplan-vectorizer`가 들어 있는 rollback ecosystem으로 `apt-subdomain`을 시작한다.
4. PM2 online, 이전 build ID, loopback/public health, vector API 재생성을 확인하고 `pm2 save`한다.
5. SQLite backup을 자동 restore하지 않는다. 배포는 scene DB를 쓰지 않으므로 DB restore는 사용자 편집을 잃을 수 있다. 별도 데이터 사고가 입증된 경우에만 별도 승인 경로로 사용한다.

성공 시에도 이전 app/vectorizer release와 rollback ecosystem을 보존한다.

## 9. 완료 조건과 증거

완료는 다음이 모두 참일 때만 선언한다.

- clean projection의 18개 파일만 커밋됨.
- fork `deploy/floorplan`이 정확한 신규 commit을 가리킴.
- 외부 vectorizer는 versioned directory의 승인 SHA(A의 `c68552...` 또는 B에서 50/50 parity로 재승인된 `9e9920...`)이고 PM2가 그 경로를 사용함.
- 서버 install/tests/types/Biome/build와 source binding 통과.
- PM2 3024 신규 build online, public health 통과.
- public vector API가 실제 생성한 docVersion15 문서 통과.
- public `/apt` read-only browser smoke와 console error 0 통과.
- 운영 scene DB와 저장 장면을 수정하지 않음.
- rollback app/vectorizer/cache 절차가 실행 가능한 상태로 남아 있음.

권장 증거 디렉터리:

```text
.omo/evidence/apartment-r4-deployment-20261003/
  scope-manifest.json
  projection-validation.json
  projection-tests.log
  projection-types.log
  projection-biome.log
  projection-build.log
  commit-push.json
  vectorizer/reconstruction-manifest.json
  vectorizer/server-release-manifest.json
  prepare-release.sh
  activate-release.sh
  rollback-release.sh
  server-preflight.json
  pm2-before.json
  runtime-before.json
  build-source-binding.json
  runtime-after.json
  public-vector-v15.json
  public-http.json
  browser-smoke.json
  rollback-readiness.json
  final-deploy-manifest.json
```

이 evidence와 스크립트는 커밋하지 않는다. 비밀 env, DB, raw 도면, vector 본문도 evidence에 넣지 않는다.
