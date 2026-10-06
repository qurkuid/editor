# Real apartment browser QA — final v15 floor-import gate

- Resolved model: `gpt-5.6-luna`; reasoning effort: `max`
- Runtime: `http://localhost:3008`; visible CUA Chrome UI route `/apt` → apartment search → plan → `자동 모델링으로 시작` → new scene.
- Source/runtime freeze: zone UI initial-surface fix v15 was live before these fresh routes. No product source was edited by this QA agent. The existing 3002 user server was not touched.
- Graph validator: [`v15-graph-validation.json`](v15-graph-validation.json). Every captured graph has unique node IDs, valid level parent/child backlinks, reachable roots, and zero duplicate geometry signatures for wall/zone/slab/ceiling nodes.

## Fresh route matrix

`closed spaces` / `closed zones` are the Zones panel's wall-derived loop counts, captured before comparing stored slab/ceiling nodes. The stored slab and ceiling count matches `closed spaces` for every accepted route; guide-only routes intentionally have no walls or surfaces.

| case | selected real plan | scene | result | closed spaces / zones | stored slabs / ceilings | nodes | evidence |
|---|---|---|---|---:|---:|---:|---|
| p04 | `더원캐슬` / `3FO3YJBTN0PM` | `60206849dcfe` | accepted | 4 / 4 | 4 / 4 | 51 | `p04-2d-zones.png`, `p04-3d.png` |
| p50 | `청라롯데캐슬` / `3FO3YUXETBIG` | `371b6b7a66de` | accepted | 11 / 11 | 11 / 11 | 154 | `p50-2d-zones.png`, `p50-3d.png` |
| p47 | `오션브릿지` / `3FO3Y6TBLWT1` | `a138a608e9f1` | accepted | 12 / 11 | 12 / 12 | 123 | `p47-2d-zones.png`, `p47-3d.png` |
| p42 | `LH영천센트럴타운` / `3FO3YWCYEPV9` | `da7f33d63710` | accepted | 13 / 12 | 13 / 13 | 164 | `p42-2d-zones.png`, `p42-3d.png` |
| p35 | `송도더샵퍼스트파크(F14BL)` / `3FO3YCX91KCS` | `3a347e468e79` | accepted + repair history | 11 / 11 baseline | 11 / 11 baseline | 152 baseline | `p35-after-undo-2d-zones.png`, `p35-final-deliverable-2d-zones.png` |
| p12 | `e편한세상검단어반센트로` / `3FO3YVRRG2Q4` | `9fe140f9a963` | accepted | 8 / 8 | 8 / 8 | 116 | `p12-2d-zones.png`, `p12-3d.png` |
| p17 | `역북푸르지오` / `3FO40PYWOTXL` | `018a152ab3dd` | guide-only expected reject | 0 / 0 | 0 / 0 | 4 | `p17-2d-zones.png`, `p17-3d.png` |
| p34 | `방촌영남네오빌2차` / `3FO40JX41VTX` | `98eee518e083` | guide-only expected reject | 0 / 0 | 0 / 0 | 4 | `p34-2d-zones.png`, `p34-3d.png` |

## p35 repair history

The fresh p35 initial scene had 11 slabs and 11 ceilings. The endpoint repair was intentionally applied to `wall_38klwdnx3lv4bc14` at its 137 mm end; this is a real wall mutation and is reported as such.

| stage | slabs / ceilings | zones | walls | graph evidence |
|---|---:|---:|---:|---|
| baseline (restored by Undo) | 11 / 11 | 19 | 73 | `p35-scene-api-after-undo.json` |
| after one safe 137 mm endpoint connection | 12 / 12 | 21 | 73 | `p35-scene-api-after-repair.json` |
| one Undo | 11 / 11 | 19 | 73 | `p35-scene-api-after-undo.json` |
| one Redo | 12 / 12 | 21 | 73 | `p35-scene-api-after-redo.json` |
| hard reload after Redo | 12 / 12 | 21 | 73 | `p35-scene-api-after-reload.json` |

Redo and reload have the same graph hash and node-ID set. `Room 2` remains visible in the review names after repair, redo, reload, and the final deliverable view. No duplicate geometry was introduced.

## Separate generated-slab deletion check

Scene `eff467575ece` was isolated from p35. The UI selected `Room 1 Slab` and pressed the editor Delete control through CUA. The direct auto-generated slab deletion did **not** satisfy the requested persistence gate: the wall-derived auto-surface synchronizer immediately created a replacement with the same polygon (`Room 5 Slab`, new ID), leaving four slabs. Hard reload preserved the replacement. No wall edit occurred.

- Before: 4 slabs / 4 ceilings / 26 walls, `slab_g7agof97rd39dhvl` (`Room 1 Slab`).
- After Delete + auto-sync: 4 / 4 / 26; original ID gone, replacement `slab_61mu4wh5ccje02mq` (`Room 5 Slab`) has the identical polygon.
- After hard reload: replacement still present, 4 / 4 / 26.
- Evidence: `slab-delete-before-3d.png`, `slab-delete-after-autosync.png`, `slab-delete-after-autosync-reload.png`, `slab-delete-result.json`, `slab-delete-console-after-reload.json`.

This is recorded as a product behavior failure for the direct generated-slab deletion gate, without a code change from this QA agent.

## Runtime evidence scope

Fresh per-route console captures (`p04`, `p50`, `p47`, `p42`, `p35`, `p12`, `p17`, `p34`) contain zero console errors. The long-lived Chrome tab's deletion/reload log has two React unmount warnings caused by repeated multi-scene navigation; they are preserved in `slab-delete-console-after-reload.json` and are not presented as a fresh-tab clean run. Parent's independent fresh IAB desktop/mobile supplement is separate and already scoped.

## Focused generated-slab deletion rerun after source freeze

A fresh focused CUA run was performed after the auto-slab deletion fix, using the existing isolated scene `eff467575ece` (the earlier replacement state was preserved as the baseline). Selecting `Room 5 Slab` and pressing Delete produced a saved graph with 3 slabs / 4 ceilings and 26 walls; no surviving slab had the deleted polygon. One Undo restored the exact original graph hash and deleted slab ID, one Redo restored the exact 3-slab graph, and hard reload retained 3 slabs / 4 ceilings. Parent/child and duplicate-geometry checks passed for all five states.

- Fixed-run result: [`fixed-delete-result.json`](../../apartment-auto-slab-delete-fix-20261003/fixed-delete-result.json)
- Focused validation: [`focused-delete-validation.json`](../../apartment-auto-slab-delete-fix-20261003/focused-delete-validation.json)
- Fixed-run screenshots/AX/logs: `apartment-auto-slab-delete-fix-20261003/delete-before-3d.png`, `delete-after-3d.png`, `delete-after-undo-3d.png`, `delete-after-redo-3d.png`, `delete-after-reload-3d.png`, `delete-console-after-reload.json`.

The earlier failed deletion attempt remains preserved as a separate pre-fix record; the focused rerun is the authoritative post-fix result.
