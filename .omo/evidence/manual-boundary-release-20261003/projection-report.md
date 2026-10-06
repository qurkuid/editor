# Manual boundary release projection

Status: isolated projection and requested local validation complete. Parent owns real-browser QA, staging, commit, push, CI and deployment. Nothing was staged, committed, pushed, or deployed by this lane. No production scene was mutated.

Worktree: `/Users/changseok/.codex/worktrees/manual-boundary-release/editor`.
Base: `5942f036bea763776b9a58431ba98ed985cd69ca`.
Source: `/Users/changseok/editor`, read-only except the explicitly assigned release evidence directory.
Resolved execution profile: `gpt-6-astra / high`, verified from child rollout `turn_context` (`resolved-profile.json`). The requested Luna/max route did not resolve. Parent disclosed the constraint and authorized this profile only for release projection of existing verified function code.

## Scope and preservation

`changed-files.txt` enumerates 31 product/test files; `projection-manifest.json` records each SHA-256. `release-projection.patch` contains tracked changes and all new files. `scope-audit.md` was read before validation.

- Copied the existing manual connection core, endpoint validation, marker/connection UI, panel mounts, interaction scope, registry dispatcher, wall split planner/export, both endpoint tools and their scoped tests.
- Included `AutoZoneSyncPlan.create`, creation context/name helper, closure lifecycle planner and live apt-vector zone creation. This is required by the panel and by manual closure producing a room zone.
- Preserved HEAD derived graph extraction, space IDs, slab trigger logic and slab simplification exactly. `projection-check.json` contains direct byte-comparison results for those regions. Apartment source-chain, import/guide, and viewer changes are absent.
- Projected only the boundary/manual paragraph in the canonical guide and matching ontology/resource/AI assertions. Its initial claim is qualified to panel reconciliation and live apt-vector edits, without claiming new initial-import behavior.
- Omitted only the unrelated `room-boundary.test.ts` test named `clears recovered endpoint markers from a derived three-wall corner`; it requires excluded derived planarization. The original source test remains untouched.
- Space tests retain HEAD tests and the seven closure lifecycle cases. History keeps HEAD history plus live apt-vector closure and obsolete generated-room replacement. For the replacement history test only, translated the fixture and obsolete polygon +1000 m on X, retaining every replacement, Undo, Redo and rehydration assertion. This avoids testing the deliberately excluded same-prefix space-ID feature while proving replacement history.
- Concurrent source drift was detected after snapshot: `floorplan-affordances.test.ts` gained `a single linked outer endpoint squares an L corner in the preview and commit`. This later axis-snap test was not imported. All other whole-copy candidates remained byte-identical to the source when checked; the manifest describes this intentional snapshot difference.

## Fresh validation evidence

All artifact paths below are relative to this report directory. Commands ran in the isolated worktree. Logs are freshly captured outputs, not inherited success reports.

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Frozen dependencies | `bun install --frozen-lockfile` | exit 0; 1378 packages installed; lockfile unchanged | `install.log` |
| Core endpoint and closure API compile | `bun run --cwd packages/core build` | exit 0 | `core-build.log` |
| 2D/3D node compile | `bun run --cwd packages/nodes build` | exit 0 | `nodes-build.log` |
| Canonical manual/resources compile | `bun run --cwd packages/mcp build` | exit 0 | `mcp-build.log` |
| Manual corner, target, overlap and hosted-child rejection; automatic repair; closure/provenance/duplicate coverage; exact history restoration; 2D preview/commit; split preflight; marker hit routing; shared manual resource and AI assertions | exact 14-file `bun test` command in `regression-command.txt` | **224 pass, 0 fail, 1057 assertions, 14 files** | `regression-first.log`, `regression-command.txt` |
| Editor types | `PATH=/Users/changseok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH bun run --cwd apps/editor check-types` | exit 0; route types generated | `types.log` |
| Repository-configured changed-file static check | `bun --bun node_modules/@biomejs/biome/bin/biome check <31 paths from changed-files.txt>` | exit 0; 28 files checked, no fixes | `biome-final.log` |
| Whitespace | `git diff --check` | exit 0 | `diff-check.log` |
| Exact patch representation | `git apply --reverse --check release-projection.patch` | exit 0; nonmutating check | `patch-check.log` |
| Production app build | `PATH=/Users/changseok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH bun run --cwd apps/editor build` | exit 0; compiled successfully; 13/13 static pages; route table produced | `production-build.log` |
| Excluded implementation remains at base | compare HEAD/projected named function ranges and precision/import sentinels | all exclusion checks true | `projection-check.json` |

Default system Node is x64 whereas frozen Bun dependencies are arm64. Initial `bunx biome` failed to load the x64 binary (`biome-format.log`); the arm64 Bun invocation passed. Package builds use architecture-independent tsc. Editor types/build use the bundled arm64 Node. No dependencies or lockfile were changed to recover this environment issue.

Repository Biome configuration excludes `**/components/ui`; its standard check therefore checks 28 of the 31 passed paths, excluding the three sidebar panel files. These files are covered by editor types and production build; this report does not claim Biome linted them. An attempted CLI override was unsupported (`biome-all-files.log`) and did not modify files. Two projected test files received formatting only before final tests/static checks.

Production build warning: Next middleware convention is deprecated in favor of proxy. The app build skips its own type validation by existing configuration; the separate editor typecheck above passed.

## Remaining parent gates

Real-browser apply/Undo/Redo/reload, marker drag/release, intentional-open, cancellation/read-only coverage and live 3D gesture evidence remain parent-owned. This lane claims no browser/deployment success. Parent was notified that the production build is ready for local production-mode QA on port 3018.
