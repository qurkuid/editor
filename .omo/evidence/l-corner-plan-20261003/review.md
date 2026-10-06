# L connector read-only planning review

No source files edited. Existing dirty work left intact. develop-pascal-editor skill, AGENTS, architecture pages and manual read. Attempt CLI failed because runtime target is missing; evidence falls back to .omo/evidence.

## Implementation contract
- Add explicit shape (existing direct default versus L) and bend-order controls; retain old direct branch. L route joins selected endpoints A/B using [B.x,A.y] or [A.x,B.y]. Require explicit target endpoint; body hit must prompt endpoint selection instead of guessing silently.
- L plan returns two created walls, no source/target/child updates. One applyNodeChanges({create, update}) under existing runAsSingleSceneHistoryStep; parent membership is already handled atomically.
- Preview uses SVG created-segment lines, never temporary useScene nodes. Retain cancel/tool/view/unmount/stale cleanup. Compare both creates and updates at apply.
- Keep plan deterministic: fixed new IDs must survive preview/revalidation, or generate actual IDs only after validated geometry comparison. applyNodeChanges overwrites colliding IDs without a guard, so validate new IDs are unique and absent.
- WallNode.parse must use explicit construction fields. Copy source height/thickness and selected finish/construction defaults only; clear children, metadata, finishRegions, parent identity and directional space classifications. Do not spread full source: metadata can duplicate import identity/boundary reviews and children can rehost existing openings. Explicitly decide source-style inheritance and vertical support behavior; mismatched elevations require rejection or a documented shared plane.
- Reject coincident endpoints and either zero-length L leg, nonfinite input, cross-level/same-wall target, stale snapshot, curves where exact validation is unavailable, and any collinear overlap of new segment with source/target/other wall. Aligned endpoints should tell user to use direct mode, never create a zero-length wall.
- Existing validateWallEndpointOverlaps only compares walls already in nodes and changed ids, so it is NOT a create validation API. Small local L-segment validation is preferable to fake degenerate wall snapshots. Existing segmentsIntersect/pointOnSegment can classify contacts; their true result includes legal endpoint contact and needs filtering. Reject incidental interior crossings/T contacts and overlap, allow the intended selected contacts and the new shared elbow. Check all same-level walls, not only source/target; other-level walls ignored.
- Existing buildWallSplitAtContacts performs topology mutation and would violate source/host preservation. Do not use it automatically. axis-guide-stretch private polylinesTouch demonstrates sampleWallCenterline for curved obstacles but sampling is approximate; do not silently treat a curve chord as its geometry.
- Existing roomBoundarySnapshot covers level walls and hosted children, suitable for stale geometry guard. A created-ID collision on another level is outside that snapshot and needs a separate collision check.
- Keep direct manual connect unaffected; no requirement that the new L closes an entire room. Require normal wall topology rendering and spaces to react after apply.

## Acceptance scenarios recommended (not executed)
1. Separated parallel endpoints with both X/Z offsets: both bend orders show distinct exact two-leg geometry; selecting direction writes zero nodes/history; apply adds exactly 2 walls and level children while original wall/hosted-child JSON matches; one undo restores full scene graph and redo restores exact IDs.
2. Existing direct connection regression suite stays passing; L can work without enclosing room.
3. Negative cases: coincident/aligned endpoints, invalid/cross-level/same target, collinear retracing, crossing third wall, stale source/child, colliding ID, and curved obstacle policy. Rejection writes zero nodes/history.
4. Browser visible L/direction control, real endpoint picking, both preview orientations, apply, 2D/3D resulting walls, cancel/Esc/tool-switch/unmount, unrelated scene edit stale guard, undo/redo, console and build evidence.

## Evidence matrix for this planning slice
| Claim | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Existing manual planner uses support-line endpoint updates only | sed -n '673,904p' packages/core/src/lib/room-boundary.ts | parallel rejection and updates-only return exist | room-boundary.txt |
| Preview/apply currently handles updates only | cat packages/editor/src/components/editor-2d/room-boundary-connect.tsx | compare plan.updates and apply update only | ui.txt |
| Existing overlap API is not create-aware | sed -n '638,681p' packages/core/src/lib/wall-operations.ts | walls derives solely from Object.values(nodes), changed id filter | overlap.txt |
| Atomic create supports parent bookkeeping | sed -n '869,955p' packages/core/src/store/actions/node-actions.ts | create loop and level children inside single set callback | apply.txt |
| General contact predicate includes endpoint contacts | cat packages/core/src/lib/polygon-relations.ts | pointOnSegment branch in segmentsIntersect | contact.txt |

No runtime feature pass or implementation completion is claimed.
