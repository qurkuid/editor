# Code review — estimate submission history

**Verdict: APPROVE (source + history browser gate)**

Reviewed all five changed files in worktree `/Users/changseok/.codex/worktrees/estimate-submit-deploy/editor` at `f705593d`. Role profile reconfirmed as `gpt-5.6-sol` / `high` (`~/.codex/agents/code-reviewer.toml:4-5`).

## Resolved finding

### [RESOLVED MEDIUM] The persisted-history read path is bounded

**File:** `apps/editor/lib/scene-project-link.ts:152-160`

`readSceneEstimateSubmissions` now slices valid persisted records to `MAX_SCENE_ESTIMATE_SUBMISSIONS`, and a direct 12-record metadata fixture asserts a ten-record result. The append path remains capped as well.

## Resolved browser finding

### [RESOLVED LOW] Project switching and persisted filtering are browser-verified

**File:** `apps/editor/lib/scene-project-link.test.ts:149-190`

The focused unit test remains narrower than the full interaction, but `history-qa-result.json` now supplies the missing runtime proof. A real scene save issued successful PUT responses, reload restored the saved partial-result row with `성공 1 · 실패 1 · 전체 2` and its canonical `https://intm.kr/newportal/estimates/fixture-history-partial/edit` link, and the mixed-project A → B → A scenario showed zero A rows while B was selected while preserving one persisted B row. A corrupt stored URL rendered the unavailable message with zero anchors.

## Verified behavior

- `StatsTab` captures the submitted project and attempted payload before awaiting, then rebuilds the metadata patch from a fresh `useScene.getState()` snapshot.
- `ok: true` partial and all-item-failure results are persisted; pre-document failures are not.
- Visible history is filtered by the currently selected project, and the immediate result is hidden on project change.
- Persisted URLs are never assigned directly to history anchors. The anchor is canonicalized from the server-provided `intmBaseUrl`, and stored/canonical mismatches fail closed. This supports production `apt.intm.kr` → `intm.kr` split origins.
- Metadata append preserves the existing project link and unrelated metadata, and de-duplicates `(projectId, estimateId)`.

## Validation

- Fresh re-run of `bun test apps/editor/lib/scene-project-link.test.ts apps/editor/lib/estimate-submit.test.ts`: **33 pass, 0 fail, 65 assertions**.
- Biome on the five changed files: **clean**.
- Parent-provided clean editor typecheck: **no errors**. A dedicated LSP diagnostics tool was unavailable in this lane; the fresh typecheck is the type-safety evidence.
- Browser/save-reopen evidence in `history-qa-result.json`: successful scene PUTs and reload, correct persisted counts/link, mixed-project filtering across A → B → A, corrupt URL with zero anchors, zero console/page errors, and zero external mutations. Observed external traffic was limited to editor asset GETs.
