# R4 atomic DSU trace preparation

This directory contains the evidence-only scaffold and the fresh R4
internal-key counterfactual. The scaffold remained dormant until the parent
opened the explicit final R4 execution gate.

Current state:

- the historical `preparation-manifest-r4.json` records the closed prep state
- the final run is recorded in `execution-manifest-r4.json`
- `candidateExecutionAllowed=true` only through the explicit final gate
- `candidateRunExecuted=true` for the bounded two-order atomic trace
- the R3 `atomic-trace-final` tree is preserved unchanged
- product source, tests, build, runtime, browser, raster/vectorizer, and
  public debug APIs are outside this preparation

`ATOMIC_TRACE_R4_FINAL_GATE` and `PASCAL_R4_FINAL_GATE` select the parent gate;
the adapter accepts combined `productSourceEntries`, `sourceSnapshots`,
`sourceFiles`, `entries`, `ownedProductFiles`, and `sourceFileSha256` records,
plus nested hash-bound references. It copied only the frozen importer into
`copies/source-final.ts`, injected trace-only observations into an evidence
copy, and applied the one-line old-key counterfactual: delete affected
moving+retained blocked keys and re-add only moving relation IDs. The runner
bound the frozen source hash, R4 snapshot hash, both retained fixtures,
reason/key traces, semantic partition/map state, and disabled-instrumentation
control parity.

The R4 source changes (synthesized-host plan/validate/commit, deterministic
materialization ordering, and relation-scoped weld protection) are exercised
only after that gate. The DSU relation-key and held-contact contract remains
the R3 contract from the approved atomic-trace plan.
