# Scoped manual boundary release audit

Audit target: /Users/changseok/editor, HEAD 5942f036bea763776b9a58431ba98ed985cd69ca. Read-only source audit. Parent reports production base 69d63180; that production identity was not independently verified here. Existing implementation report is a discovery aid, not new passing evidence.

## Decision

Release the current manual wall repair implementation and its pre-existing closure UI/core dependencies. Parent explicitly selected live apt-vector zone creation as part of the closure dependency so a manual wall closure creates the room zone. Exclude apartment import/source-chain, derived graph planarization, space-id, slab-lifecycle/precision, and viewer initialization changes. No source, index, commit, or worktree edits were made by this audit.

## Exact projection

All paths relative to repo. Whole current file/diff is appropriate for these files:

- packages/core/src/index.ts: entire +23-line diff. Room-boundary exports plus buildWallEndpointUpdates/WallEndpointUpdate are required.
- packages/core/src/lib/wall-operations.ts: entire current 128-add/9-delete diff. The pre-task rebase/export changes are dependencies, not unrelated scope. Keep rename to buildWallEndpointPatches, public endpoint API, final-direction child spans, linked detach behavior, and overlap guard. Keeping only before-to-current deltas will not compile against HEAD.
- packages/core/src/lib/room-boundary.ts; room-boundary-manual.test.ts: full new files.
- packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.tsx and its test; room-boundary-connect.tsx; room-boundary-interaction.ts and its test: full new files.
- packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx and its test: complete tracked diffs. Keep single marker mount within registry context, drag callback and ephemeral-session history/cancel changes together.
- packages/editor/src/components/editor/floorplan-panel.tsx: current HEAD diff only (draft cursor wrapper pointerEvents=none and anchor pointerEvents=none). Do not restore the old tail marker mount from before/: markers moved to registry.
- packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx: entire three-hunk diff: import and ZoneClosurePanel in both empty/nonempty zone branches.
- packages/editor/src/components/ui/sidebar/panels/zone-panel/index.tsx: both import/mount hunks.
- packages/editor/src/components/ui/sidebar/panels/zone-panel/zone-closure-panel.tsx: full new file. It requires createMissingZones and returned create arrays in space-detection.
- packages/editor/src/components/tools/wall/wall-drafting.ts: complete diff, including pure planEndpointWallSplit and atomic application. packages/editor/src/index.tsx: export that planner. packages/editor/src/lib/interaction/scope.ts: boundary intent union.
- packages/nodes/src/wall/endpoint-edit-plan.ts and test: full new files. floorplan-affordances.ts and test, move-endpoint-tool.tsx: full diffs. The new nodes planner imports planEndpointWallSplit from editor, so build/export order matters.
- apps/editor/lib/ai-provider.test.ts: all three added manual assertions.

### space-detection.ts partial projection (HEAD-coordinate hunk anchors)

Include:

1. AutoZoneSyncPlan.create and AutoZoneCreationContext additions near HEAD 86. Split this mixed hunk: do NOT change AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE or WALL_JUNCTION_TOLERANCE commentary.
2. nextAutoZoneName addition near HEAD 830.
3. planAutoZonesForLevel changes near HEAD 973 through 1097: createMissingZones option; create array; claimedSpaces; ambiguous imported-zone review update; unmatched-zone open/review metadata; matching-zone enclosureStatus=enclosed; covered-polygons duplicate protection; creation of provenance-tagged ZoneNode; return {create, update}. The changed compact-id comment near HEAD 989 may be retained as neutral wording, but do not include buildSpace id behavior.
4. runSpaceDetection additions near HEAD 1642 and 1662: apt-vector metadata/context discovery, createMissingZones context, sceneStore.createNodes mapping. These are selected by parent to ensure wall closure produces zones in the same scene transaction.

Exclude:

- All new getWallPlanFootprint, polygonsOverlap, getWallConstructionEnvelopeThickness imports near HEAD 29: used only by excluded derived planarization.
- Entire cross2D/straightLineIntersection/splitStraightWallAtPoints and extractRooms planarization changes near HEAD 484 and 540. Preserve HEAD splitter/extractRooms exactly.
- AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE change 0.08 -> 1e-6.
- Slab trigger comment and autoFromWalls slab-elevation filtering near HEAD 871/899.
- buildSpace signature.slice(0,12) -> full signature near HEAD 940.

### Manual and manual-contract tests

packages/mcp/src/modeling-agent-manual.ts: retain HEAD except the single added paragraph beginning “Every confirmed closed wall loop on an apartment level receives one `Zone`”. This paragraph contains both the selected zone-closure lifecycle and manual yellow-handle contract. Exclude all other apartment dimension, source-chain, surface persistence, derived planarization and guide-scale paragraphs/expansions.

packages/mcp/src/ontology-manual.test.ts: add only new assertions in existing “documents validated length edits and boundary review”: Every confirmed closed wall loop; generatedFrom: detected-space; split closed replacement/open-review preservation; smallest multi-gap bundle; direct UI no AI/MCP; stale/read-only; explicit target; Keep open; both-view drag. All other added tests are excluded work.

packages/mcp/src/resources/resources.test.ts: include only new assertions for Every confirmed closed wall loop; generatedFrom; smallest multi-gap bundle; direct UI no AI/MCP; stale/read-only; explicit target; Keep open; both-view drag. Do NOT copy entire addition, which mixes source-chain, scale and derived-planarization assertions.

### Test projection dependencies

- room-boundary-manual.test.ts: all ten tests are actual manual contract and required. No derived-planarization requirement found in their scenarios.
- room-boundary.test.ts: include current file EXCEPT “clears recovered endpoint markers from a derived three-wall corner” (current lines 87–138). That fixture explicitly expects derived three-wall projection and is unrelated previously dirty topology work. Preserve that test in the shared checkout; omit only from isolated scoped release. Its expected spaces=1 is not evidence of manual repair and must not force the ~500-line topology feature into release.
- space-detection.test.ts: start HEAD and include procedural-zone hunks near HEAD 783 (ambiguous imported subdivision review assertion update) and HEAD 814 (seven tests: empty labels create provenance zone; demoted generated room replacement; enclosed generated coverage; manual open coverage; semantic-subdivision duplicate prevention; unmatched zone open/restored enclosed; live apt-vector wall closure creation). These support selected planner/live closure lifecycle.
- Exclude all newly added residual topology fixtures/helper geometry, residual topology describe, same-prefix space ID scenario, auto slab ownership/above-level scenario, p42 shallow-bend scenario, and extra imports only required by those excluded fixtures. Existing HEAD tests remain.
- space-detection-history.test.ts: start HEAD; add only “apt-vector wall closure creates a room zone in the same undo step” and “one history step replaces an obsolete generated room with two closed rooms” (current lines 112–287). Exclude samePrefixRoomHistoryFixture, live same-prefix loops test, auto slab delete/reload test, and their BuildingNode/CeilingNode/SlabNode import expansion.
- Existing wall-operations.test.ts and wall-drafting.test.ts are unchanged against HEAD and remain required regression inputs, not files to stage.

## Hard exclusions

All dirty apps/editor apartment route/search/trace/import-frame/vector-scene files and corresponding tests. All packages/viewer modifications and renderer-init new files. Unrelated .omo/evidence and .omo/plans artifacts. Do not stage shared dirty workspace wholesale.

## Dependency/validation risks

This audit establishes source dependencies and scope; it does NOT certify isolated compilation or runtime. Parent owns projected-core/node/MCP builds, editor types, changed-file lint and real browser checks. Existing 253-pass log is from full dirty tree and cannot prove the narrowed release. Build MCP before AI/manual resource tests because package exports can resolve dist. Build core/editor-facing exports before nodes because endpoint-edit-plan imports the new public API. Derived-planarization-dependent tests must be omitted only from isolated projection, never deleted from shared checkout. Any projected test failure must be diagnosed rather than solved by blindly copying unrelated space-detection changes.

Production is behind local HEAD per parent. A release based on 5942f036 can include already-committed changes since 69d63180; the parent must review that commit range separately from this dirty-change projection before deployment.

## Direct inspection evidence

| Scenario | Invocation | Binary observable directly inspected | Artifact |
|---|---|---|---|
| Identify projection base | git rev-parse HEAD | 5942f036bea763776b9a58431ba98ed985cd69ca | this report |
| Identify exported endpoint dependency | git diff --numstat -- packages/core/src/lib/wall-operations.ts packages/core/src/index.ts; git diff -- those files | 128 additions/9 deletions wall operations; 23 additions index; public endpoint API and types referenced by room-boundary/nodes | this report, exact projection above |
| Separate space changes | git diff -- packages/core/src/lib/space-detection.ts | hunk anchors 29,86,484,540,830,871,899,940,973,989,1032,1059,1076,1090,1097,1642,1662 inspected | this report, include/exclude inventory above |
| Establish UI compile dependency | cat packages/editor/src/components/ui/sidebar/panels/zone-panel/zone-closure-panel.tsx; git show HEAD:packages/core/src/lib/space-detection.ts | UI passes createMissingZones and reads create; HEAD option and return type lack both | this report |
| Separate unrelated test | sed -n 75,142p packages/core/src/lib/room-boundary.test.ts | derived three-wall fixture expects spaces length 1 without calling manual mutation | this report |
| Attempt evidence location | omo-agent-toolkit ulw-loop status --json | exit 1: runtime target missing at /Users/changseok/.codex/plugins/cache/sisyphuslabs/omo/5.1.0/dist/cli/index.js | this report; fallback .omo/evidence used |

No existing report/log passing claim was adopted. No compile/test/browser/deploy success is claimed by this audit.
