# Manual boundary repair — implementation evidence

Status: implementation and local validation complete; parent owns final real-browser and production-build gates. No commit, push, deployment, or production-model write was performed by this implementation lane. QA scene writes belong to the parent lane.

## Changed behavior

- Core explicit target planning extends source and, when needed, target straight wall to their supporting-line corner. It uses complete scene endpoint validation, preserves IDs/metadata, and is independent of automatic room-count / 350 mm eligibility.
- Core endpoint validation rejects newly introduced/increased collinear wall overlaps while retaining existing unrelated overlap. The same helper owns manual connection, 2D endpoint preview/commit, and 3D endpoint preview/commit.
- Hosted child center rebasing uses the original world frame; final item footprint span uses the final wall direction. Both source/target and cascaded walls are validated.
- The zone boundary panel and yellow markers expose target connection, endpoint move, and geometry-specific Keep open/reset. Keep open stores only merged metadata and expires when relevant wall geometry changes.
- Manual connection targets and preview are mounted once under the floorplan registry render context; drag callback delegates to the existing registry owner. Preview uses live overrides; apply is a single atomic update and Undo step.
- Marker drag saves pointer-down coordinates, starts after 4px, lets the threshold move reach the window dispatcher, and lets pointerup commit. Tap pointerup remains contained. Existing focus-visible SVG ring is preserved.
- Ephemeral dispatcher sessions neither pause scene history nor restore old graph snapshots on cancel/rejection, preserving external edits. 3D endpoint gesture likewise uses ephemeral child/wall previews and shared validation.
- Endpoint split preflight captures changes before any write, restores created wall children lists, rejects opening-crossing splits for endpoint edits, then applies source/split/child changes together.
- Canonical modeling manual covers explicit manual repair, Keep open, 2D/3D safety, cancellation, Undo and direct-UI-only capability. MCP resource and internal AI prompt tests assert that contract.

## Verification records

All paths below are relative to this directory. Evidence logs are captured command output; test names identify the exact scenario and binary observable.

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Manual corner/open L, 1m gap without room increase, explicit competing target, collinear gap, wrong endpoint, parallel/curve/different level/reversal/T rejection, metadata merge/reset/expiry, overlap and linked-item regression | `bun test packages/core/src/lib/room-boundary-manual.test.ts` | 10 pass, 0 fail; rejected plans return no updates and source graph remains exact | `manual-expanded.log` |
| Marker pointer routing; 2D hosted ephemeral preview, final span reject, single-step exact Undo, stale 0.1mm external edit preservation, readOnly flip; pure 2D/3D split preflight/migration/opening rejection | `bun test packages/nodes/src/wall/endpoint-edit-plan.test.ts packages/nodes/src/wall/floorplan-affordances.test.ts packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts packages/editor/src/components/tools/wall/wall-drafting.test.ts` | 63 pass, 0 fail at safety-fix checkpoint; later overlap regression included in full suite | `drag-safety-fixed.log` |
| Complete relevant topology/history/UI/manual/AI regression | full command in `regression-command.txt` | 253 pass, 0 fail, 14 files | `regression-final.log` |
| Core package compile after final shared guard | `bun run --cwd packages/core build` | exit 0 | `core-build-final.log` |
| Node package compile after final shared guard | `bun run --cwd packages/nodes build` | exit 0 | `nodes-build-final.log` |
| MCP canonical guide package compile | `bun run --cwd packages/mcp build` | exit 0 | `mcp-build-final.log` |
| Editor typecheck | `bun run --cwd apps/editor check-types` | exit 0, route generation successful | `types-final.log`, `types-hit-fix.log` |
| Changed-file static check | `bunx biome check --write` on 22 implementation/test files | no errors, no warnings; final expanded test formatting also clean | `biome-final.log`, `biome-tests.log` |
| Worktree whitespace diff | `git diff --check` | exit 0, no whitespace findings | `diff-check.log` |

Initial failures were retained as investigative records (`core-red.log`, `affordance-first.log`, `focused-first.log`, `drag-safety.log`). They are not final evidence. Initial combined manual/AI failures were caused by stale MCP dist; MCP rebuild and the complete rerun passed. Zustand localStorage-unavailable messages are test-runtime warnings; there are no final failed tests.

## Browser-driven hit-routing follow-up

Parent observed draft-cursor decoration hiding the yellow marker in build mode and the later SVG target wall stealing a closer centerline click. Corrected narrowly: draft cursor group and anchor circle now have `pointerEvents=none`; candidate clicks resolve nearest real segment across all targets in scene coordinates. Exact-distance ties return all candidate walls for explicit UI choice with human labels, endpoints, and coordinates. Hover uses the same geometric resolver. Removed the unreachable snapshot-restore condition from the commit-hook branch.

Invocation: `bun test packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts packages/editor/src/components/editor-2d/floorplan-zone-closure-layer.test.ts packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts`; observable: 26 pass / 0 fail, including reversed DOM order, exact endpoint, equidistant explicit-choice set, out-of-range and zero-length rejection. Artifact: `hit-fix-tests.log`. `bun run --cwd apps/editor check-types` exited 0 (`types-hit-fix.log`); `biome-hit-fix.log` and `biome-hit-labels.log` contain the clean changed-file checks. Full 14-file regression rerun after these edits passed 253 tests (`regression-final.log`).

## Ownership and preservation

Core: `room-boundary.ts`, new `room-boundary-manual.test.ts`, `wall-operations.ts`, exports.
Editor: existing marker + closure panel; new `room-boundary-connect.tsx` and `room-boundary-interaction.ts`; narrow registry mount/drag lifecycle; old panel tail marker mount removal; interaction scope intent; pure wall split capture + export; focused marker/registry tests.
Nodes: shared new `endpoint-edit-plan.ts` and test; 2D endpoint affordance and tests; sibling 3D endpoint tool.
Manual: canonical manual plus ontology/resource/internal AI assertions. Other concurrent source-chain manual paragraphs remain intact.

Dirty baseline and previous focus-ring changes were preserved. Parent baseline is `../before/` and `../initial-status.txt`; this lane also captured `discovery-status.txt`. No dependencies added. No recursive delegation. Missing OMX runtime was captured in `attempt-status.txt`; parent directed no further retry.

## Remaining gates / limits

- Parent must provide actual stable-browser apply/Undo/Redo/reload, direct marker drag/release, intentional-open, readOnly and cancel evidence. This report does not claim those from static source or shared tests.
- Shared planner tests establish 2D/3D validation parity, not a real 3D gesture. Parent owns final runtime coverage and any disclosed gap.
- Full production app build belongs to parent.
- Curved manual connections, invalid hosted spans, broken T contacts, reversal, and increased wall overlap are deliberately rejected. Automatic eligibility remains unchanged.
