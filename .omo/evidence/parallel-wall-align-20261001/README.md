# Parallel wall alignment evidence helpers

These helpers are read-only verification artifacts. They do not create server records or mutate a scene.

## Browser graph replay check

Save the browser graph before the click, after the click, and after one Undo as `before.json`, `after.json`, and `undo.json` in this directory. The approved grounded case is copied from:

```text
.omo/evidence/expert-dimension-edit-20261001/current-before.json
```

Run:

```sh
bun .omo/evidence/parallel-wall-align-20261001/verify-parallel-wall-align.ts
```

The verifier calls `buildWallParallelAlignmentUpdates` for `wall_ev1580n36u0mzfek`, applies the existing reactive wall-side, auto-slab, auto-ceiling, and auto-zone plans, binds runtime-generated surface IDs by their stable descriptors, and compares every graph field with numeric tolerance `1e-10`. It requires the reference wall to remain byte-for-byte unchanged, checks the fixed-corner wall geometry, and requires the Undo graph to match `before.json` exactly. It prints one JSON result with `PASS` or `FAIL`, update and reactive counts, maximum numeric delta, and the first differences.

The same verifier accepts explicit paths when the browser capture uses another directory:

```sh
bun .omo/evidence/parallel-wall-align-20261001/verify-parallel-wall-align.ts \
  /path/to/before.json /path/to/after.json /path/to/undo.json
```

## Production read-only QA helper

`server-qa.ts` imports the built core from a release selected by a full 40-character
commit, reads scene `8552ea8b9254` through a read-only SQLite connection, and emits
only compact count/PASS or count/FAIL JSON. Capture keeps the graph in the private
deployment backup directory with mode `0600`; it never copies the production graph
into this evidence directory or writes the scene.

```sh
bun .omo/evidence/parallel-wall-align-20261001/server-qa.ts capture <40-char-commit>
bun .omo/evidence/parallel-wall-align-20261001/server-qa.ts apply <40-char-commit>
bun .omo/evidence/parallel-wall-align-20261001/server-qa.ts undo <40-char-commit>
```

`apply` reconstructs the wall batch and the existing side, zone, slab, and ceiling
reconciliation plans, then compares every graph field with numeric tolerance
`1e-10`; `undo` requires an exact graph match to the private capture.

## Browser negative fixture

`negative-fixture.json` is one valid Site → Building → Level scene graph with four spatially disconnected groups and stable selection ids, so it can be loaded by the normal scene API and rendered by the editor canvas. It covers perpendicular-only, ambiguous two-reference, protected interior T-junction, and hosted overflow on a linked wall. Generate it again with:

```sh
bun .omo/evidence/parallel-wall-align-20261001/make-negative-fixture.ts
```

Validate the fixture against the current pure builder without opening the browser:

```sh
bun .omo/evidence/parallel-wall-align-20261001/verify-negative-fixture.ts
```

The recorded verification expects stable errors `no-parallel-continuation`, `ambiguous-parallel-continuation`, `detached-wall-junction`, and `attachment-outside-wall`, with the fixture graph unchanged for every case. In UI QA, load the fixture, select each `selectedWallId` from its `cases` list, click the shared action, and assert the visible error plus unchanged graph and undo history.
