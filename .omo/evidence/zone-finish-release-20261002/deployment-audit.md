# Zone finish production deployment audit — 2026-10-02

## Verdict

**PASS for deployment activation and public build identity.** The scoped release commit, deployed runtime summary, and public response identify one release: commit `999b2771b3a0f1aa84f18d74fda82c77b29aad08`, release `/Volumes/DATABASE/floorplan-releases/20261002-999b2771`, runtime BUILD_ID `teZZYbe0c3JXeZCui2Wr5`, PM2 process `apt-subdomain` PID `48938` on port `3024`, and public `/apt` HTTP 200 containing that same BUILD_ID.

This supports the claim that the approved build is activated and publicly served. The remaining release gate is the public browser behavior run owned by Luna. Until that run completes, claim **deployed and publicly reachable**, not full public feature acceptance.

## Identity chain

| Layer | Result | Evidence |
|---|---|---|
| Scoped source | PASS | Local `HEAD` and `fork/deploy/floorplan` both resolve to full SHA `999b2771b3a0f1aa84f18d74fda82c77b29aad08`. `git show` contains 61 files, and its sorted path digest exactly matches `staged-manifest.txt`. |
| Clean validation | PASS | `projection-final-check.log` records 61 projected files and `DIFF_CHECK=PASS`. `validation-summary.md` records 248 focused tests across the listed suites, app typecheck, package builds, Biome, `git diff --check`, and production build success. `production-build-summary.log` records exit 0 and BUILD_ID `93aH90epuLLX219cfUzBX` for the isolated validation build. |
| Prepared release | PASS by deployment record | `deployment-status.md` records the versioned release path, SQLite online backup, exact commit, and new runtime BUILD_ID. The activation script requires a readable backup, copied environment, old executable, old/new BUILD_IDs, and unchanged PM2 cwd before switching. |
| Runtime | PASS, directly corroborated | The refreshed `server-runtime-after.txt` records source commit `999b2771b3a0f1aa84f18d74fda82c77b29aad08`, runtime BUILD_ID `teZZYbe0c3JXeZCui2Wr5`, PM2 `apt-subdomain` PID `48938` online from `/Volumes/DATABASE/floorplan-releases/20261002-999b2771/apps/editor`, port `3024`, and public HTTP 200. It also records the deployed QA fixture at version 1 with eight nodes. |
| Public response | PASS, directly corroborated | `public-before.html` contains old BUILD_ID `VvK6ZLvTWya3UrIT0uZ0c`; `public-apt.html` contains new BUILD_ID `teZZYbe0c3JXeZCui2Wr5`. The response body changed from SHA-256 `e223cd7b…` to `11b3727e…`, with nine chunk paths replaced. `deployment-status.md` records public `/apt` HTTP 200. |
| Dirty-work isolation | PASS | Commit `999b2771` has exactly the approved 61-file manifest. The source checkout still retains unrelated apartment-search/vector/guide modifications and untracked evidence/plans; none appears in the scoped commit. |

## Activation safety review

`activate-release.sh` implements the approved minimum safeguards:

- It accepts only a full 40-character commit and derives versioned backup/release paths (lines 4–9).
- It loads the saved `apt-subdomain` PM2 record and refuses activation if the live cwd changed after preparation (lines 10–17).
- It preserves the captured PM2 environment, overlays the recorded service variables, and requires port `3024` (lines 18–20).
- It reads both old and new BUILD_IDs and checks the database backup, copied environment, and old executable before deleting PM2 (lines 21–28).
- It retains explicit previous/new ecosystem configs with mode `0600` (lines 29–32).
- It defines rollback before the switch, restores the previous config on start or health failure, and requires rollback HTTP success (lines 34–45).
- It verifies the activated cwd, local HTTP 200, and only then persists PM2 state (lines 46–49).

The script does not prove the feature behavior; it correctly limits itself to safe activation, identity, and health.

## Evidence-quality note

The refreshed `server-runtime-after.txt` is a complete accessibility-tree export and directly proves the post-activation runtime identity and public HTTP result. Its SHA-256 is `47978a720ebb4849b59550cd6e56cc17d7dd489db9e80fe5505a32ccbce32cc4`.

`server-prepare-result.txt` and `server-activate-result.txt` still contain only four-line Remote Desktop messages saying the accessibility tree did not change. They are excluded as raw evidence for preparation and activation exit status. The retained `deployment-status.md`, safe activation script, direct post-activation runtime identity, and direct public BUILD_ID transition are sufficient for the deployment-state verdict; the two incomplete captures remain an audit-trail limitation. Future deployments should export terminal stdout/stderr directly so every step is independently replayable.

## Remaining gate

Only the in-progress public browser acceptance remains: load the deployed Zone-finish fixture, verify 2D/3D rendering, actual regional material/name/swatch, ordinary Paint plus one-step Undo, Zone apply plus one-step Undo, template list/apply persistence, and no new product exception in the captured console. Company sharing across two authorized real accounts remains an explicitly unavailable acceptance case and must not be claimed.

Known non-blocking limits remain unchanged: the standalone `packages/editor` TS6059 cross-package test-import baseline, unsupported curved partial regions, and partial-region assembly export outside this feature scope. The app typecheck and production build gates passed.
