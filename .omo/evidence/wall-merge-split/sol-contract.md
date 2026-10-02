# Wall merge/split implementation contract

Planning lane: gpt-5.6-sol, high, explicitly selected native agent.
Implementation lane: luna-max, gpt-5.6-luna max, agent-confirmed.

- Preserve all pre-existing dirty edits (baseline /tmp/wall-task-before.patch).
- Automatic apartment conversion: endpoint/interior T junction retains the continuous main wall. Interior/interior X crossing retains current splitting for rendering correctness. Preserve host openings.
- Core pure operations: merge contiguous collinear straight sibling walls only with compatible dimensions, construction, materials, and support. Reject incompatible or disconnected geometry atomically. Account for reversed direction and hosted world transforms; preserve parent/children/collections.
- Split at a finite user-entered distance from wall start, strictly inside the wall; reject opening/hosted item span crossings. Preserve first wall id and child placements.
- Shared contextual panel exposes multi-selection merge and single-selection unit-aware split in both views. One undoable mutation each. Avoid delete action neighbor auto-merge heuristics.
- AI mergeWalls/splitWall use the same core operations and atomic plan execution. Update canonical modeling manual, internal prompt and MCP guide assertions.
- Validate focused regression tests, node build if touched, editor types, changed-file Biome, real browser direct and AI flows, undo, console, production build. Report actual unsupported/runtime gaps.
