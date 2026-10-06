# Apartment 50 browser QA evidence

Resolved runtime role: `gpt-5.6-luna` / `max`.

This folder contains the source-blind eight-case selection, GET-only scene snapshots, the p04 reimport comparison, p35 safe-repair replay/reload proof, AX summaries, console result, and screenshot index. Browser controls were executed with `cua_repl` on the isolated `localhost:3008` server. No source files were edited by this QA agent and the user-managed `3002` server was not restarted.

The report is deliberately honest about failed gates:

- p34 reached a guide-only shell and has no wall/zone/opening geometry.
- p35 safe repair succeeded and replay/reload persisted exactly, while the resulting `Room 2` remained review/open; no all-zones-closed claim is made.
- p04 reimport created a v14 scene while leaving v13, so the duplicate/reimport guard failed.
- console error zero failed due observed React unmount and WebGPU validation errors.
- mobile viewport was not run.

The final deliverable tab is `http://localhost:3008/scene/fb39095d4635`, 2D + Zones, marked via CUA.

## Candidate version boundary

The browser scenes in this folder were created from the then-current v14 candidate cache. The later Sol/high scale policy requires final docVersion15 to reject no-evidence bbox guesses; therefore p17 v14 is retained as diagnostic UI evidence and classified as `REJECT_MANUAL_SCALE` for the final batch. p34 is `REJECT_GUIDE_ONLY`.
## v15 browser supplement

The final v15 eight-case visible QA matrix is in `v15-ui-results.json`. It uses the actual 3008 runtime DB and apt-data paths recorded there. Six line-evidence candidates produced automatic modeled scenes; p17 and p34 were recorded as guide-only expected rejects. The final deliverable is `http://localhost:3008/scene/d91d9557b8a3` (p35 v15, repaired and reloaded, 2D + Zones).

The p35 v15 137mm safe candidate was clicked after the zone core freeze: 11/11 spaces/zones became 12/12, Undo restored 11/11, Redo restored 12/12, and a Redo-state hard reload preserved the repaired 156-node graph. `Room 2` remains under review, so all-zones-closed is not claimed. The v15 Chrome console capture retains whole-tab lifecycle errors and warnings; a fresh IAB error-zero claim is supplied only by the parent’s separate fresh-tab evidence. Mobile viewport QA was unavailable because `cua_repl` exposed only the Chrome extension browser.
