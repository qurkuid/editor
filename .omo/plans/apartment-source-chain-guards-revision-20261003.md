# Apartment Source-Chain Guards — Sol Revision 2026-10-03

## Decision

- **Route:** `gpt-5.6-sol`, reasoning `high`.
- **Verdict on paused WIP:** **REJECT as a product candidate.** Keep it frozen for comparison only.
- **Authorized next work:** read-only causal instrumentation against frozen source copies and the exact p07 V15 input. No product source, tests, manual, build, runtime, or browser mutation until that trace identifies the first operation that creates each final duplicate span.
- **Implementation owner after a revised product contract:** the confirmed `gpt-5.6-luna` / `max` lane. Lane C Viewer work is independent and must not be touched here.

This revision supplements `.omo/plans/apartment-source-chain-guards-20261003.md`; it does not overwrite the original approved evidence or relax its 50-case acceptance gates.

## Frozen facts

- Lane A source snapshot: `.omo/evidence/apartment-next-residual-20261003/lane-a-source/apps/editor/lib/apt-vector-scene.ts`, SHA-256 `eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89`.
- Paused WIP source: `apps/editor/lib/apt-vector-scene.ts`, SHA-256 `75e44332e3a044cb53049abcff31f2e103d98e554411cbe5d0f5aa70beca8b26`.
- Paused WIP test: `apps/editor/lib/apt-vector-scene.test.ts`, SHA-256 `8c0c80687f82ee9b2f0ffa37062506fdecdd4e32ae537d82226f4547f2bc59b4`.
- Exact p07 input for every future actual/replay claim: `.omo/evidence/apartment-scale-fix-20261003/candidate15/3FO40C71IWG4.json`, SHA-256 `7f76c71f5989a256c9a0c599c92dfef69841e3922dd172e76c8cd14a68de9e1a`.
- The older p07 `vector.json` has SHA-256 `45b524d0fce1af63da5cafc90b1366392b62858acc048aea19daa4bf28e3a9d7` and `docVersion: 13`. A canonical comparison confirms its geometry/data equals the V15 document after removing only `docVersion`; nevertheless it is not the acceptance input.
- The paused WIP passes 48 focused tests, but actual p07 still emits two contained duplicate spans totaling `0.5471133881973458 m`. Passing focused fixtures therefore does not prove the source-chain repair.

The source-backed p07 chains remain:

- upper: `w2 → w24 → w20`, where retained `w24` is 124.3 mm thick and the outer walls are 248.6 mm;
- right/window: `w21 → w26 → o5 → w27 → w13`, with `o5` preserved as a 3.275 m window host interval.

## Why the current global protection is rejected

The paused WIP precomputes `sourceChainProtectedSegments` and skips **every** same-run union involving either outer segment. `retainedSourceChainEndpoints()` searches all four endpoint combinations and accepts any exact source segment between them; it does not prove that the matched endpoints are the facing gap used by the current union, or that the retained middle segment cannot itself participate in the normal union. A normal same-thickness A→B→C fragmented wall can therefore disable unrelated outer unions.

The same WIP passes a coordinate-only `sourceChainProtectedEndpoints` list into both `snapJunctions` and `weldDanglingEnds`. Any segment endpoint later occupying that coordinate is frozen against every candidate, including an otherwise valid unrelated T or corner contact. Protection must follow a specific source segment/end and a specific retained-chain relation, not a global point.

These are broader bypasses around normal merge/snap/weld behavior. Because actual p07 still has two duplicates, they neither satisfy the requested result nor establish which operation is defective.

The two pair-local exact-contact checks may remain as a candidate for the later product patch: when evaluating one near-parallel pair, an endpoint already within `1e-6 m` of that other segment's centerline must not extend to the other's distant endpoint. Their two failing retained-chain fixtures show that this pair guard is insufficient by itself; they do not justify global segment or point freezing.

## Authorized read-only causal trace

Create all diagnostic code and output under:

`/Users/changseok/editor/.omo/evidence/apartment-source-chain-guards-20261003/causal-trace/`

Never import or overwrite the live product module. Start from immutable copies of both the Lane A source and paused WIP, record their source hashes, and add trace-only provenance fields to the copied `Seg` shape. The trace must not alter the returned geometry for a variant; verify a trace-disabled versus trace-enabled canonical output hash for each copy.

Run these variants on the exact V15 input:

1. Lane A frozen source;
2. Lane A plus only the two pair-local exact-centerline contact guards;
3. paused WIP global protection, for comparison only.

For every variant, persist one machine-readable JSON trace with source wall IDs and coordinates at these boundaries:

1. **transformed/filtered source segments** — source ID, original endpoints, transformed endpoints, thickness, and drop reason;
2. **same-run candidate decisions** — candidate source groups, the facing endpoint pair that determines longitudinal gap, alignment/lateral/gap/thickness values, direct bridge candidates, whether each bridge is itself unionable with either outer, and apply/skip reason;
3. **post-union groups** — full source member IDs for every disjoint-set group;
4. **opening-host unions** — opening source ID, flank/group IDs, coverage extensions, and the exact source members of the selected host, especially `o5`;
5. **merged segments before snap** — source member IDs, endpoints, thickness, and contained-duplicate metric;
6. **each snap pass** — segment/group ID, endpoint key, old point, proposed point, selected candidate group, branch (`corner`, `tee`, or `near-parallel`), distances, and apply/skip reason;
7. **each weld pass** — the same mutation record plus original movement budget and dangling/touch status;
8. **before and after `connectWallJunctions`** — wall/opening geometry and source membership where available;
9. **final duplicate attribution** — both final wall indices, span length, source contributor IDs, and the earliest prior boundary at which that pair first becomes a positive contained duplicate.

The trace is complete only when it attributes both paused-WIP pairs (`0.3953463797734842 m` and `0.1517670084238616 m`) to a named source group and one first mutating operation. Counts or final coordinates without first-stage attribution are insufficient.

## Product contract after causal proof

No implementation is authorized before the trace. If the trace confirms same-run bridging plus later endpoint movement as the shared cause, the replacement must use this local relation:

1. Evaluate one proposed same-run outer pair `(A, C)`.
2. Determine the **facing** A/C endpoints that produce the accepted longitudinal gap. Do not search unrelated far-end combinations.
3. Recognize a retained bridge `B` only when one surviving source segment matches those two facing endpoints within `1e-6 m` and `B` cannot be absorbed into the normal union with either A or C under the existing `isSameWallRun` predicate. Thus a normal same-thickness A→B→C fragment chain keeps its ordinary union behavior.
4. Record the relation by segment/group identity and endpoint key: `(A:end, B:start, B:end, C:start)`, orientation-normalized. Coordinates alone are not ownership.
5. Skip only the proposed A/C union represented by that relation. A and C remain eligible for every unrelated valid union.
6. In snap/weld, reject only a mutation of an incident relation endpoint that would move it away from its authored A↔B or B↔C contact, or extend A/C through B's retained span. Unrelated T/corner candidates, the other endpoints of A/B/C, and other segments sharing the coordinate remain eligible.
7. When multiple bridge candidates connect the same facing endpoints, do not select one by iteration order and do not union A/C. Preserve source evidence and let only already-existing, independently proven duplicate normalization decide whether exactly coincident bridge detections collapse.

If the trace identifies a different first operation, return to Sol/high with that event record instead of adapting this relation spec to fit an unsupported hypothesis.

## Required fail-first regressions for the eventual patch

Before product editing resumes, add fixtures that fail on the Lane A frozen source and distinguish the local relation from the rejected global freeze:

1. p07-like thick A → retained thin/slightly angled B → thick C: preserve all three authored lines and produce zero contained duplicate span;
2. normal same-thickness A → B → C: merge normally into the same wall run; protection must not trigger;
3. a source segment joining non-facing far endpoints of an otherwise mergeable pair: normal facing union remains enabled;
4. a retained-chain coordinate also carrying a valid unrelated T/corner wall: preserve the chain contact while the unrelated junction still connects;
5. competing retained bridges: do not union the outer pair or choose a bridge by order, preserve existing source-dedup behavior, and emit no contained duplicate;
6. exact near-parallel centerline contact: do not stretch to the distant endpoint in snap or weld;
7. actual window chain with `o5`: preserve window type, width `3.275 m`, source metadata, host parent/child integrity, and transformed interval endpoints within `1e-6 m`;
8. ordinary L/T/X junctions, parallel corridors, door passages, opening hosts, and unrelated fragmented walls remain unchanged.

Assertions must cover emitted coordinates, source-line preservation, group membership, opening host semantics, space/floor result, and `containedDuplicateSpan`. A test that only checks wall count or zero duplicates can pass by dropping source geometry and is not acceptable.

## Acceptance after the revised implementation

Use the exact V15 p07 input and the frozen 50-document/330-probe Lane A baseline:

- p07 contained duplicate pair count and summed span are exactly zero;
- p07 recovers all four targeted probes and the total reaches at least `302/330`;
- no accepted case loses a floor probe, gains a contained duplicate, gains stored Slab/Ceiling positive overlap, or changes preserved raw wall/opening/semantic-zone geometry unexpectedly;
- the normal same-thickness three-fragment negative control still merges;
- focused tests, types, Biome, manual exposure, production build, owned-browser p07 import, one-step Undo/Redo, save/reload, opening placement, and 2D/3D visual checks pass;
- any final manual sentence describes the narrow local relation actually shipped, not the rejected global segment/coordinate freeze.

Until the causal trace satisfies its stop condition, leave the paused WIP untouched and report Lane B as **diagnostic only / product fix not approved**.
