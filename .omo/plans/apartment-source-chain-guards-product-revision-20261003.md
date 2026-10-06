# Apartment source-chain guards — final product revision 2026-10-03

## Approval and frozen evidence

- **Planning route:** `gpt-5.6-sol` / `high`.
- **Verdict:** **APPROVED TO IMPLEMENT** with `gpt-5.6-luna` / `max`, subject to this exact narrow contract. The paused WIP remains evidence only; replace its global protection rather than layering another guard on top.
- **Exact input:** `.omo/evidence/apartment-scale-fix-20261003/candidate15/3FO40C71IWG4.json`, SHA-256 `7f76c71f5989a256c9a0c599c92dfef69841e3922dd172e76c8cd14a68de9e1a`.
- **Lane A source:** SHA-256 `eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89`.
- **Pair-local control source:** SHA-256 `ca1dcad6affba6903ce5807a57413306205d293b556556f2698e6d043d05b02b`.
- **Paused live WIP:** `apps/editor/lib/apt-vector-scene.ts`, SHA-256 `75e44332e3a044cb53049abcff31f2e103d98e554411cbe5d0f5aa70beca8b26` at approval time.
- **Trace summary:** `.omo/evidence/apartment-source-chain-guards-20261003/causal-trace/causal-trace-summary.json`, SHA-256 `ecc7271ec9cd1d919e8efb13d44f52dab508d7be732c7c2144106ce2aacb157e`.

All three trace variants use the exact V15 input and have equal control, trace-disabled, and trace-enabled canonical output hashes within each variant. The pair-local control is correctly compared with its own uninstrumented source. The diagnostic code therefore did not alter returned geometry.

The accepted `containedDuplicateSpan` metric counts the shorter wall once only when the absolute centerline direction dot is at least `0.99`, both endpoints project inside the longer wall's closed longitudinal interval within `1e-6 m`, and both endpoint lateral distances are within the longer construction half-thickness plus `1e-6 m`. The nonparallel `w31` envelope case has direction dot `0.6356286682` / angle `50.53337278°`; it is a required negative control and never a canonical duplicate.

## Proven causal transitions

Lane A has three canonical duplicate spans totaling `1.2844009967 m`. The upper span is created by union event 131:

- proposed outer pair: `w2` and `w20`;
- facing endpoints: `w2.end = w24.start`, `w24.end = w20.start` within `1e-6 m`;
- retained bridge: `w24`, length `0.2458009967 m`, thickness `0.1243 m`;
- `w24` is not unionable with either outer member under the existing same-run predicate;
- before the union, `w24` is not contained by `w2` or `w20`;
- after the union, the `w2+w20` group contains `w24` with direction dot `0.9999240068` and endpoint lateral distances `0` and `0.0030302442 m`.

The pair-local exact-centerline guard removes the two window-side spans but intentionally leaves the upper `w24` span. The paused global WIP removes that span but creates a different canonical duplicate. Its first true transition is snap event 814, pass 1:

- `w20` spans `[-0.50249245,-3.67626164] → [-0.10849245,-3.64366164]`, length `0.3953463798 m`;
- immediately before event 814, `w9` starts at `[-0.10849245,-3.64366164]`, so the first `w20` projection is `-0.394 m` and containment is false;
- event 814 moves only `w9.start` by `0.394 m` toward the `w24` contact;
- immediately after, `w20` projects from `0` to `0.394 m` inside `w9`, direction dot is `0.99659443`, and containment is true.

The earlier pass-0 `0.1374 m` move only reaches the `w20` contact and does not create full containment. The defect is therefore two local operations: an outer-pair union across a retained nonabsorbable bridge, and later movement of a relation-owned group endpoint through that bridge. It is not evidence for globally freezing source segments or every endpoint at the same coordinate.

## Product implementation contract

**Owned product files:** `apps/editor/lib/apt-vector-scene.ts`, its existing focused test file, `packages/mcp/src/modeling-agent-manual.ts`, and the two existing manual exposure tests. No core, viewer, raster/vectorizer, schema, dependency, calibration, annotation, probe, or saved-scene migration change belongs in this pass.

Start from the Lane A behavior plus the pair-local exact-centerline guard. Remove the WIP-wide `sourceChainProtectedSegments` union bypass and coordinate-only `sourceChainProtectedEndpoints` snap/weld bypass. The final implementation must have no branch that skips every union involving a protected source segment and no branch that freezes every endpoint merely because its coordinate matches a stored point.

### 1. Build one precise retained-chain relation

While evaluating an already accepted same-run candidate pair `(A, C)`:

1. Use the candidate's actual longitudinal intervals to select the **facing** endpoint key on A and facing endpoint key on C. Never search arbitrary far-end combinations.
2. Find a surviving source segment B only when its two authored endpoints match those two facing endpoints within `1e-6 m`, orientation-normalized.
3. Require B to be **nonabsorbable**: the existing `isSameWallRun` predicate is false for both `(A, B)` and `(B, C)`. A normal same-thickness A→B→C fragmented run therefore keeps its existing merge behavior.
4. Record source segment identities and endpoint keys, not coordinates alone: `(A, A-facing-end, B, B-at-A-end, B-at-C-end, C, C-facing-end)`. Multiple matching bridges remain ambiguous; do not pick one by iteration order and do not join the opposite outer groups.

Reuse the endpoint-pair index. Do not add a per-candidate full wall scan or any O(W³) path.

### 2. Block only the relation's opposite outer-group union

At each union decision, resolve current disjoint-set roots. Skip the union only when its two roots contain the opposite A and C endpoint identities of the same retained-chain relation. This remains true if either side has legally absorbed unrelated fragments.

Every other union remains eligible under the existing predicate. In particular, a legal `w20+w9` union must not be disabled merely because `w20` participates in the `w2→w24→w20` relation. Unions within one side, normal same-thickness three-fragment runs, opening-host unions, and unrelated wall runs preserve existing behavior.

### 3. Protect only the relation-owned merged endpoint

Carry the relation's source member and endpoint identity through every disjoint-set alias and group formation to the corresponding merged segment endpoint. This is internal importer provenance only; do not add public node metadata or change emitted source metadata.

Normal group materialization projects all members onto the longest member's line. That projection must not erase the source-backed A↔B or B↔C contact. For a group that legally absorbs an unrelated continuation such as `w20+w9`, compare the projected group extent with the relation-owned authored contact before snap/weld. When that contact is still the extremal endpoint on that side, restore **only that one incident merged endpoint** to the exact authored bridge contact within `1e-6 m`; leave the opposite endpoint, unrelated groups, and ordinary group projection unchanged. Preserve the relation identity on the restored endpoint for later guards. This is not a coordinate-global anchor and not a general projection rewrite.

The p07 gate must prove this before snap: the group containing `w20+w9` remains eligible for the normal union, its bridge-facing group endpoint equals the authored `w24.end = w20.start`, and the `w24` line plus both A↔B/B↔C contacts remain exact. If a future group absorbs material on both sides so the authored contact is no longer a group extent, one straight merged segment cannot represent the relation safely; fail the implementation fixture and return to Sol/high rather than inventing a split, moving B, or freezing a coordinate globally.

Keep the pair-local rule: when one endpoint already touches the **currently evaluated other segment's** centerline within `1e-6 m`, that pair must not extend to the other's distant endpoint.

For snap and weld, reject a candidate only when all of these are true:

- the current merged endpoint is the endpoint identity owned by a retained-chain relation, or is already exactly joined to the relation's incident outer group;
- the proposed candidate belongs to that relation's bridge/opposite side;
- applying the move would leave the authored A↔B or B↔C contact, cross the retained B span, or change the exact canonical duplicate metric for a relation member from false to true.

The check uses group/source endpoint identity plus the proposed before/after geometry. It must not protect the other endpoint of the same wall, a different segment sharing the coordinate, or an unrelated T/corner candidate. `w20+w9` may merge normally; if they form one group, only the group's B-contact endpoint is protected against moving through B. The other endpoint and all unrelated unions/junctions remain available.

No fallback may drop B or another accepted source contributor, hide a wall from the output graph, discard a detected room, or suppress the duplicate metric. Preserve the authored bridge line and both relation contacts exactly. Established legal grouping may still represent unrelated continuations, but only with the source-backed held-end rule above. Repair normalization at its creating operation.

## Fail-first regression contract

Use the canonical `containedDuplicateSpan` predicate above in test helpers; do not use general wall-footprint intersection as the duplicate gate. Add eight behavior fixtures that fail on the relevant pre-fix behavior:

1. p07-like thick A → thin/slightly angled nonabsorbable B → thick C: the A/C opposite-root union is rejected, all three authored lines remain, and canonical duplicate count/length are zero.
2. Normal same-thickness A → B → C: the usual merge still occurs; no relation protection triggers.
3. A source segment joining non-facing far endpoints: it does not qualify as B and the real facing union remains enabled.
4. A relation contact shared with a valid unrelated T/corner: the chain contact stays authored and the unrelated junction still connects.
5. Competing retained bridges: no iteration-order selection, no opposite outer-root union, all source evidence preserved, zero canonical duplicate.
6. Exact near-parallel centerline contact: snap and weld do not extend that pair to a distant endpoint; an offset parallel corridor and real door passage remain open.
7. A legal unrelated continuation on a relation outer member, modeled after `w20+w9`: it remains eligible to union; after longest-member projection its B-contact group endpoint is restored to the exact authored contact before snap, retains the relation endpoint identity, and cannot later move through B. Assert the pre-snap endpoint and bridge-contact coordinates, not only the final duplicate count.
8. Actual opening chain `w21→w26→o5→w27→w13`: `o5` remains a window of width `3.275 m`, with identical source metadata, parent/child host integrity, and world interval parity metric `0` after `1e-6 m` normalization.

Each fixture asserts source-line coordinates, group membership, emitted walls/openings, spaces/floors where applicable, and the canonical metric. Wall count alone and “zero duplicate” obtained by dropping geometry are invalid tests. Keep ordinary L/T/X, curved/competing junction, parallel corridor, fragmented-run, opening-host, and manual-surface suppression regressions enabled.

## Acceptance gates

1. **Focused/static:** focused importer and manual exposure tests; editor types; changed-file Biome; relevant core/MCP regressions; production build. Update the canonical modeling manual with one narrow sentence describing retained nonabsorbable source-chain preservation and expose the same text through both existing manual surfaces.
2. **Exact p07 V15:** canonical contained duplicate count `0`, summed length `0`; all four targeted p07 probes recovered; total floor hits at least `302/330`; `o5` world parity metric `0`; no authored wall/opening/semantic-zone loss.
3. **Same 50:** preserve `44 imported / 6 strict scale rejects`; per-case floor-hit loss `0`; no new canonical contained duplicate; no stored Slab/Ceiling exact positive overlap; no geometry change outside the intended p07 relation normalization, and all raw wall/opening/semantic-zone documents plus calibration inputs unchanged. Keep the five semantic review-only probes in the denominator.
4. **Performance:** relation discovery reuses indexed endpoint pairs, and the existing same-protocol importer/detector performance gate remains within `1.25×` p95 with no timeout or error.
5. **Owned browser:** fresh owned production runtime and disposable scene; visible actual p07 import/reimport; correct 2D walls, five or more recovered closed spaces/floors as supported by the exact replay, and real rendered 3D geometry using the already accepted Viewer recovery; one-step Undo returns the exact prior graph, Redo restores exact IDs/geometry, save/reload preserves them, and console errors are zero. Do not mutate the user's saved scene or user-managed 3002/3008 runtimes.
6. **Evidence binding:** freeze final product/test/manual hashes, V15/50 input hashes, before/after p07 outputs, exact metric pairs, probe results, surface-overlap audit, build ID, graph equality, and browser screenshots/logs under the Lane B evidence root. Re-run source/input guards after the final browser step.

## Stop and return conditions

Return to Sol/high before continuing if the local relation cannot reach p07 duplicate `0` and all four probes without a per-case loss, if a normal union/junction needs global endpoint protection, or if a new candidate requires inferred walls, broader snap distance, source/raster changes, or gate relaxation. Do not reinterpret nonparallel `w31`, semantic aggregate-floor probes, or legitimate junction footprint contact as duplicate-wall failures.

Implementation is complete only after every acceptance gate is bound to the final hashes. Until then, retain the current causal trace and paused WIP as immutable evidence.
