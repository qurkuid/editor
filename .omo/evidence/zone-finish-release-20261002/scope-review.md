# Zone finish release scope review — 2026-10-02

**Verdict:** APPROVED for a scoped projection from `2215e094fefdf96f3f74d7cbd7afbb2d11ed4c0f`. The working tree contains 66 modified tracked files plus unrelated untracked artifacts. The release must contain exactly the 44 full-file tracked changes, three filtered shared-file changes, and 14 new source/test files below. Apartment search/vector/orientation, guide rendering/calibration, plans, logs, screenshots, fixtures, and evidence helpers stay in the source worktree and out of the release commit.

The current branch and `fork/deploy/floorplan` both resolve to `2215e094`. That baseline already contains the previously released parallel-wall alignment implementation. Do not replay the old `.omo/evidence/parallel-wall-align-20261001/baseline` delta onto the release: that baseline predates the alignment commit and would mix a prior feature with this projection. Reuse only its projection shape: create a clean checkout at the exact baseline, copy files whose entire `HEAD..working-tree` diff is in scope, and apply explicitly filtered hunks for shared files.

## Full tracked-file manifest

Each file below has only Zone finish, finish-template, wall renderer/material, Canvas dependency, or isolated-runtime support changes relative to `2215e094`; copy the current file into the clean projection.

```text
apps/editor/.gitignore
apps/editor/app/editor/page.tsx
apps/editor/components/paint-catalog.tsx
apps/editor/components/painting-tab.test.tsx
apps/editor/components/painting-tab.tsx
apps/editor/components/scene-loader.tsx
apps/editor/lib/material-import.ts
apps/editor/lib/scene-api-security.ts
apps/editor/lib/scene-store-server.ts
apps/editor/next.config.ts
apps/editor/package.json
apps/ifc-converter/package.json
bun.lock
packages/core/src/lib/wall-operations.test.ts
packages/core/src/lib/wall-operations.ts
packages/core/src/schema/nodes/wall.test.ts
packages/core/src/schema/nodes/wall.ts
packages/core/src/store/actions/node-actions.ts
packages/core/src/store/use-scene-dirty-tracking.test.ts
packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx
packages/editor/src/components/systems/zone/zone-label-editor-system.tsx
packages/editor/src/components/systems/zone/zone-system.tsx
packages/editor/src/components/ui/controls/scene-material-list.tsx
packages/editor/src/hooks/use-keyboard.ts
packages/editor/src/index.tsx
packages/editor/src/lib/paint-scope.test.ts
packages/editor/src/lib/paint-scope.ts
packages/mcp/src/storage/index.ts
packages/mcp/src/storage/sqlite-scene-store.test.ts
packages/mcp/src/storage/sqlite-scene-store.ts
packages/mcp/src/storage/types.ts
packages/nodes/src/wall/construction-geometry.test.ts
packages/nodes/src/wall/construction-geometry.ts
packages/nodes/src/wall/construction-preview.test.tsx
packages/nodes/src/wall/construction-preview.tsx
packages/nodes/src/wall/paint.test.ts
packages/nodes/src/wall/paint.ts
packages/nodes/src/wall/renderer.tsx
packages/viewer/src/index.ts
packages/viewer/src/lib/materials.test.ts
packages/viewer/src/lib/materials.ts
packages/viewer/src/systems/wall/wall-material-override.test.ts
packages/viewer/src/systems/wall/wall-materials.ts
packages/viewer/src/systems/wall/wall-system.tsx
```

The dependency triplet is indivisible: `apps/editor/package.json`, `apps/ifc-converter/package.json`, and `bun.lock` must move together so both applications resolve `@react-three/fiber` 9.8.1. The app-local `/.next*/` ignore and `PASCAL_NEXT_DIST_DIR` setting are also part of the approved Canvas/runtime repair and remain in scope.

## New source and test files

Add exactly these previously untracked files:

```text
apps/editor/app/api/finish-templates/[id]/route.ts
apps/editor/app/api/finish-templates/route.test.ts
apps/editor/app/api/finish-templates/route.ts
apps/editor/components/zone-finish-panel.test.tsx
apps/editor/components/zone-finish-panel.tsx
apps/editor/lib/finish-template-schema.test.ts
apps/editor/lib/finish-template-schema.ts
apps/editor/lib/finish-template-server.test.ts
apps/editor/lib/finish-template-server.ts
apps/editor/lib/finish-template-store.test.ts
apps/editor/lib/finish-template-store.ts
packages/editor/src/hooks/use-keyboard.test.tsx
packages/editor/src/lib/zone-finish.test.ts
packages/editor/src/lib/zone-finish.ts
```

`apps/editor/app/api/finish-templates/route.test.ts` is required release coverage, not an evidence artifact. Its five route-level regressions exercise local idempotent create/list with public-field filtering, version-CAS rename/delete, the 2 MiB expanded-body cap, strict rejection of unknown Zone payload fields, and the verified company-less principal's private-only authorization. It directly validates the approved API contract and must travel with both route modules.

## Shared-file hunk rules

These three files must start from the clean `2215e094` version and receive only the named Zone hunks. Do not copy the whole working-tree file.

1. `packages/core/src/schema/index.ts`
   - Include `WallFinishRegion` in the wall type exports.
   - Include `mergeWallFinishRegions`, `normalizeWallFinishRegion`, `normalizeWallFinishRegions`, `remapWallFinishRegionsForMerge`, `splitWallFinishRegions`, and `validateWallFinishRegions` in the wall value exports.
   - Include `WallFinishRegionSchema` and `WallSurfaceSideSchema`.
   - The clean projection's Biome `organizeImports` gate requires the current sorted positions of `ComponentNode` and `SavedView`. Include those two ordering-only moves as a mechanical static-gate exception. They change no export name, source module, or runtime behavior. No other symbol addition/removal is authorized by this exception.
2. `packages/mcp/src/modeling-agent-manual.ts`
   - Include only the five contiguous Zone finish entries currently at lines 111–115: face protection, floor resolution, ceiling resolution, manual-Zone partial-span behavior, and Zone/home template semantics.
   - Exclude the apartment horizontal/vertical image-flip entry near line 25. The parallel-wall alignment entry is already present in `2215e094` and must remain once.
3. `packages/mcp/src/ontology-manual.test.ts`
   - Include only the `documents Zone finish face protection and atomic floor/template apply` test currently at lines 192–212.
   - Exclude the `documents shared apartment import orientation` test near lines 94–99. Preserve the baseline parallel-wall test once.

## Explicit exclusions

Exclude these 19 tracked-file diffs in full; they belong to apartment search/vector/orientation or guide perspective work:

```text
apps/editor/app/apt/trace/page.tsx
apps/editor/components/apt-search-panel.tsx
apps/editor/components/apt-search.module.css
apps/editor/components/apt-search.tsx
apps/editor/components/apt-trace.tsx
apps/editor/lib/apt-vector-scene.test.ts
apps/editor/lib/apt-vector-scene.ts
packages/core/src/index.ts
packages/core/src/lib/guide-perspective.test.ts
packages/core/src/lib/guide-perspective.ts
packages/core/src/schema/nodes/guide.test.ts
packages/core/src/schema/nodes/guide.ts
packages/editor/src/components/editor/floorplan-panel.tsx
packages/editor/src/components/ui/panels/use-guide-perspective-calibration.ts
packages/nodes/src/guide/definition.test.ts
packages/nodes/src/guide/definition.ts
packages/nodes/src/guide/geometry.test.ts
packages/nodes/src/guide/geometry.ts
packages/nodes/src/guide/renderer.tsx
```

`packages/core/src/index.ts` is wholly excluded: its only working-tree diff is the unrelated `canonicalizeGuidePerspectiveCorners` export. Zone code uses the schema subpath and the approved editor exports instead.

Also exclude every other untracked item, including `.debug-journal.md`, `.omx/**`, `.omo/**` other than this local review artifact, `outputs/**`, and `apps/editor/lib/apt-import-frame{,.test}.ts`. None belongs in the product release commit.

## Required dependency order

1. Apply the core Wall schema/index hunk, wall split/merge preservation, merge guard, and tests.
2. Apply viewer wall tessellation/material groups/world UV, asynchronous scene/preset texture repair, and tests.
3. Apply nodes wall rendering, construction presentation/export sentinel, regional Paint behavior, and tests.
4. Apply editor domain helpers, paint scope, Zone selection, idle-Paint Undo, exports, and tests.
5. Apply MCP SQLite template records/methods and the server-safe `@pascal-app/core/schema` consumer boundary.
6. Apply app API, principal/security limits, local/server stores, material picker handoff, Zone footer, and both editor entrypoints.
7. Apply the R3F package/lock triplet and Next isolated-output support.

This ordering is for projection and conflict diagnosis. The resulting commit remains one atomic Zone-finish release; do not split out a server commit that leaves the app routes without storage methods, or a renderer commit that introduces `finishRegions` before the core schema exists.

## Projection and verification contract

- Build the projection in a clean checkout rooted at exact commit `2215e094fefdf96f3f74d7cbd7afbb2d11ed4c0f`.
- Copy the 44 full tracked files and 14 new files. Apply the three shared-file rules manually or with a filtered patch; never stage by broad pathspec from the dirty source checkout.
- Require `git diff --name-only 2215e094` to equal the 61-file manifest in this document. Require `git status --short` to contain no `.omo`, `.omx`, `outputs`, apt, or guide files.
- Require `git diff --check` and inspect the three shared-file diffs directly before dependency installation.
- Two mechanical formatting changes are explicitly allowed without changing the 61-file manifest: Biome's export ordering in `packages/core/src/schema/index.ts` described above, and formatter-only wrapping of `expanded.set(...)` plus the returned `.map(...)` object at current projection lines 543–561 in `packages/core/src/store/actions/node-actions.ts`. The latter must preserve the same condition, casts, keys, values, and control flow byte-for-byte apart from whitespace/newlines. No broad formatter change outside these exact files/constructs is approved.
- Run the approved focused core/editor/nodes/viewer/MCP tests from the Zone plan, then package builds, `apps/editor check-types`, Biome for all projected source/test files, and a production editor build with a fresh app-local output directory.
- The known standalone `packages/editor` TS6059 cross-package test-import issue is not a release regression; `apps/editor check-types` and the package builds are the required type/build gates.
- Deployment/runtime proof may reuse the completed browser acceptance as behavioral evidence only after the projected commit passes the clean checks. Do not infer correctness from the dirty-tree build if the projected diff differs.

## Stop conditions

Stop projection before commit if any manifest file is missing, any excluded apt/guide/evidence file appears, a shared file contains an excluded semantic hunk, the two static-gate exceptions change symbols or behavior, R3F resolves below 9.8.1, an API route imports the client-bearing `@pascal-app/core` barrel instead of `@pascal-app/core/schema`, or the focused tests/type/build gates fail. Resolve the scoped projection itself; do not modify or clean the original dirty worktree.

## Deployment-path advisory after clean commit `999b2771`

**Decision:** retain the existing versioned `/Volumes/DATABASE/floorplan-releases` and `/Volumes/DATABASE/floorplan-deploy-backups` workflow. Do not switch this deployment to a home-directory release. The configured Node `24.15` runtime and `/usr/local/bin/python3` have both successfully read the existing external `.env.local` and release `BUILD_ID`, and the same configured runtime has already spawned a successful `git -C` read of the external checkout. The failures from `/bin/mkdir` and `/usr/bin/python3` are executable-context/TCC failures, not evidence that the established deployment runtime lost volume access. No permission grant or service restart is required to test preparation.

Run the existing `prepare-release.sh` through that exact configured Node runtime's `execFileSync`, preserving its already-working execution context. Preparation is read/build/backup only and must complete before `activate-release.sh` is allowed to touch PM2. Approval is conditional on all of the following:

1. The fetched `deploy/floorplan` commit equals full SHA `999b2771b3a0f1aa84f18d74fda82c77b29aad08`, the detached release directory is versioned with that SHA, and the projected 61-file commit is the only source being built.
2. The exact external `.env.local` is copied into the release with mode `0600`; do not reconstruct it from a guessed subset of variables while the authoritative file is readable. This preserves `NEXT_PUBLIC_*` build configuration and the runtime's INTM, apartment-data, vectorizer, API, and provider settings without printing secret values.
3. `pm2-before.json`, the SQLite online backup of `~/.pascal/data/pascal.db`, install/build logs, and the new `apps/editor/.next/BUILD_ID` are present in the versioned external backup/release directories before activation. The SQLite default remains the existing home database because `PASCAL_DB_PATH`, `PASCAL_DATA_DIR`, and `XDG_DATA_HOME` are absent in the recorded service environment.
4. Immediately before PM2 deletion, the same configured Node context must still read the old release script/BUILD_ID, the new release script/BUILD_ID, both generated ecosystem configs, and the copied environment file; the current `apt-subdomain` cwd must still equal the cwd captured in `pm2-before.json`, and local port `3024` must still answer. This extends the existing concurrency guard with a same-context rollback-readability preflight.
5. Activation must preserve the full captured `pm2_env.env`, overlay the existing top-level `PORT`, `NODE_ENV`, `INTM_BASE_URL`, `APT_DATA_DIR`, `VECTORIZER_DIR`, and `VECTORIZER_PYTHON` values exactly as the approved script does, require port `3024`, and retain the previous cwd/script in `ecosystem-previous.config.cjs`. Do not synthesize a smaller runtime environment.
6. After switch, require PM2 `online`, cwd equal to the new release's `apps/editor`, local HTTP 200, expected source commit and new BUILD_ID, then run the already-approved public/runtime smoke. Any activation error before these checks invokes the generated previous config and verifies the old cwd/BUILD_ID plus HTTP 200 before reporting rollback complete.

The home fallback at `~/.pascal/floorplan-releases` is **not approved when all external-volume access is blocked**. Although the SQLite database and browser `asset://` payloads live under the existing home database/browser IndexedDB paths, production also depends on the PM2-carried `APT_DATA_DIR` and vectorizer paths and rollback depends on restarting the old external release. A home release is safe only if a later same-context preflight proves those external runtime data paths and the previous release remain readable/restartable, and if the exact environment is preserved. Since the established Node context now passes those reads, using the existing external release path is the smaller and safer branch.
