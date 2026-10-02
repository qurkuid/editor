# Automatic-model replacement undo repair

Sol/high review contract approved by `missing_wall_review` on 2026-09-30.

Observed on the real editor: automatic generation replaced the original 65-node graph with the corrected 73-node graph. One undo restored a 23-node intermediate graph. `runAsSingleSceneHistoryStep` coalesces after execution, after Zundo's 50-entry limit has already discarded the original state.

Modify only `packages/core/src/store/history-control.ts` and its existing commit tests. Capture a clone of the pre-run history and subscribe before executing. Clone the first actual history addition immediately; Zundo mutates existing history arrays with `shift()` at the limit. On successful completion, retain that first-write history clone; for semantic no-ops restore the pre-run clone. Preserve future clearing, pauses, nested commit transactions, exceptions, and generic types. Remove posthoc overlap detection. Always unsubscribe.

Acceptance: 70 writes undo to the exact baseline and redo to final; an already full 50-entry history stays bounded and retains earlier undo steps; a cap-overflow no-op preserves prior history; nested wrappers remain one commit and one undo step; new writes clear redo. Run focused tests, core types/static/build, then editor types.

Root owns the browser and scene artifacts. After all source/build changes finish, take a fresh graph snapshot, regenerate through the visible 231DH button, undo once and compare the entire graph, redo and compare the repaired graph, then leave the repaired result visible. Preserve the original 65-node snapshot and the failed undo as evidence. No commit or deployment is requested.
