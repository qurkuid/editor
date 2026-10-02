# Zone opening takeoff final gate

- Resolved profile: `gpt-5.6-luna`, reasoning `max`
- Worktree: `/Users/changseok/.codex/worktrees/zone-finish-takeoff/editor`
- Owned source scope: 11 files; no source outside that scope changed
- Diff SHA256: `238a62ea6251e393d55069de88c4f1b8be50d95b844e166da6134a56ed20a915`
- Focused/regression: `focused-regression-final.log` — 150 pass, 0 fail, 548 assertions
- Typecheck: `check-types-final.log` — `bun run --cwd apps/editor check-types`, EXIT:0
- Viewer build: `viewer-build-final.log` — `bun run --cwd packages/viewer build`, EXIT:0
- App build: `app-build-final.log` — `bun run --cwd apps/editor build`, EXIT:0
- Biome: `biome-final.log` — 11 files, no fixes, EXIT:0
- Diff whitespace: `git diff --check` clean
- Browser: `browser-cua-final.md` records visible CUA synthetic wall/Stats proof and the bounded door-preview limitation. Isolated port 3312 was stopped; no production/user runtime was touched.
