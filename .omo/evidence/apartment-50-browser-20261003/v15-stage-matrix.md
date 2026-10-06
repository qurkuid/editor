# Actual apartment v15 browser QA stage matrix

Resolved role: `gpt-5.6-luna` / `max` (`/Users/changseok/.codex/agents/luna-max.toml`). Runtime: `http://localhost:3008`, DB and apt data under `.omo/evidence/apartment-zone-real-20261003/`. Browser controls used `cua_repl` only; user managed `3002` was not restarted.

| Case | Plan | Route result | 2D/3D | Zones panel | Initial visible state | Scene |
|---|---|---|---|---|---:|---|
| p04 | 더원캐슬 19A | auto model | pass/pass | pass | 4 spaces / 4 zones / 4 endpoint entries | `6e3f56f6d17f` |
| p50 | 청라롯데캐슬 177 | auto model | pass/pass | pass | 11 / 11 / 15 | `d3bc8e710f1d` |
| p34 | 방촌영남네오빌2차 114 | guide-only expected reject | guide shell/guide shell | no zones | 0 / 0 / 0; 4 graph nodes | `ef92a53d4330` |
| p47 | 오션브릿지 166 | auto model | pass/pass | pass | 12 / 11 / 3 | `4c2b71fc512f` |
| p42 | LH영천센트럴타운 159A | auto model | pass/pass | pass | 13 / 12 / 11 | `80ced2494974` |
| p35 | 송도더샵퍼스트파크(F14BL) 129B | auto model | pass/pass | pass | 11 / 11 / 10; 137mm candidate | `d91d9557b8a3` |
| p12 | e편한세상검단어반센트로 82P1 | auto model | pass/pass | pass | 8 / 8 / 4 | `a57f96b80bf9` |
| p17 | 역북푸르지오 80A | guide-only expected reject | guide shell/guide shell | no zones | 0 / 0 / 0; 4 graph nodes | `5d085542dc3b` |

The p35 v15 visible `연결` action on `wall_me17sgdibnxrn7qk end` (137mm) changed 11/11 to 12/12. Meta+Z restored the 130-node, 19-zone baseline; Meta+Shift+Z restored the 156-node, 21-zone repair graph. Hard reload after Redo preserved 12/12 and graph hash `48f29ac0229dccbee2c427d5a834aa2435f21ff7d95b905aef1a6054dd6c547e`; Room 2 remains under review/open. All 73 p35 wall IDs remained unchanged.

The final deliverable tab is `http://localhost:3008/scene/d91d9557b8a3`, 2D + Zones, marked with CUA. Parent separately captured fresh IAB desktop evidence for this same repaired scene at `http://localhost:3008/scene/d91d9557b8a3`; this CUA session exposed only Chrome extension browser id 1, so mobile viewport QA is recorded as unavailable. Raw whole-tab Chrome logs are in `v15-chrome-console-after-repair.json` (60 entries: 25 errors, 35 warnings); they include prior lifecycle/WebGPU entries and are not a fresh-tab zero claim.

## Artifact clarification (v15)

- The six accepted initial auto-model API graphs were checked before any edit: p04, p50, p47, p42, p35, and p12 each have `slab=0` and `ceiling=0` (exact node counts and type counts are in [`v15-artifact-clarification.json`](./v15-artifact-clarification.json)). Initial route-created floor/ceiling creation was therefore not persisted.
- p35 starts at 130 nodes with 0 slabs/0 ceilings; the visible 137 mm endpoint repair results in the repaired reload graph at 156 nodes with 12 slabs and 12 ceilings. Those repair-state additions are separate from batch `computed-plan.create` floor coverage.
- Parent IAB responsive scope: mobile expanded Zones panel passes at 390x844 with 12 spaces/12 enclosed zones; mobile locate remains `FAIL_UNVERIFIED` because the viewer went blank after panel collapse and WebGPU reported a destroyed device. The fresh desktop IAB proof had zero errors before responsive testing; recovery reload restored 12/12 with no geometry mutation.
- Source endpoint mutation is intentional and reportable: `wall_me17sgdibnxrn7qk` end, 137 mm via visible UI. Wall IDs/count stayed 73→73; do not claim zero source geometry mutation.
