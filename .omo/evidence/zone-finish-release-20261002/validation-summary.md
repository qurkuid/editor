# Zone finish release projection validation

- Resolved model / reasoning: `gpt-5.6-luna / max`
- Clean projection base: `2215e094fefdf96f3f74d7cbd7afbb2d11ed4c0f`
- Projection: 61 files (`47` tracked modifications + `14` new files)
- Exact patch: `feature-scope.patch`
- Patch bytes: `576165`
- Patch SHA-256: `af2a201ff66d1db9715b3c7dace60a51a2864e73e65052b6ad128dac5be0e8c0`

## Focused tests

- Core wall/schema/dirty tracking: `47 pass`, `174 expect`
- Viewer/nodes wall/material/paint/construction: `28 pass`, `567 expect` (rerun after package builds)
- Editor Zone finish/paint scope/keyboard/panel: `81 pass`, `269 expect`
- Finish template schema/server/store/API: `27 pass`, `111 expect`
- MCP SQLite/manual: `52 pass`, `235 expect`
- Construction geometry: `3 pass`, `7286 expect`
- Painting tab: `2 pass`, `14 expect`
- Scene API security: `8 pass`, `11 expect`

The initial viewer/nodes attempt failed only because workspace package dist aliases were not built; core/viewer/nodes/mcp builds were then completed and the same focused viewer/nodes suite passed. The standalone `packages/editor` tsconfig retains the known TS6059 cross-package test-import baseline failure recorded in `editor-build.log`.

## Static/build checks

- Core, viewer, nodes, MCP package builds: passed.
- App typecheck: `bun run --bun --cwd apps/editor check-types` passed. The plain Node invocation hit the host x64/installed arm64 native TypeScript optional-package mismatch; no dependency or source change was made.
- Biome: `56` projected TS/TSX files passed with assist disabled solely to preserve the approved shared `packages/core/src/schema/index.ts` export ordering. `packages/core/src/store/actions/node-actions.ts` received only the two mechanical formatter expansions authorized by scope review.
- Production build: exit `0`; custom dist `apps/editor/.next-zone-finish-validation-3`; `BUILD_ID=93aH90epuLLX219cfUzBX`; route manifests present.
- `git diff --check`: passed.

## Sanitized QA fixture

`qa-scene.json` contains one site, building, level, four CCW straight walls enclosing a 4m x 4m footprint, and the manual room Zone `배포 검수실`. It has no slab or ceiling. Core schema/graph validation passed with zero errors, warnings, or schema issues. Domain space detection found one space with four front/inward boundary faces. Zone finish inspection found all four wall faces, all active wall roles explicit, and creatable floor and ceiling targets.

No commit, push, or deployment was performed from the isolated projection checkout.
