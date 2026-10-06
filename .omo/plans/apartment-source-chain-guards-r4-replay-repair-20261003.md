# Apartment source-chain guards — R4 replay repair addendum

Resolved lane: gpt-5.6-sol / high. This addendum preserves the approved R3 source-chain, opening-host, held-contact, atomicity, raw-input, and final-held-guard contracts. It permits no product fallback, detector/core/raster change, metric deletion, tolerance widening, case/ID special case, or inferred closure wall.

## 1. Proven p30 failure

Exact V15 plan `3FO3TOWE773J` imported under Lane A but R3 returns null. The final held-contact check rejects DSU group `[58,57]`. Before that check, `extendToCrossingWalls` commits source-segment mutations at `apt-vector-scene.ts:1644`. For source opening `o2` (`src:'pair'`, door), it moves source segment 57 end from `[-0.33084621975315165,-4.366930813168767]` to `[-0.36820853507132867,-3.7722800683152546]`, about 0.596 m. This makes relation-0 contact `[-0.33084621975315165,-4.234630813168766]` interior while relation-1 still owns `[-0.3213462197531517,-4.518130813168766]`. R3's unchanged final held check correctly detects the unsafe geometry. The defect is the earlier non-atomic source mutation.

## 2. Minimal product repair

Refactor synthesized-host crossing extension into plan → validate → commit:

1. `extendToCrossingWalls` must compute synthesized endpoints and every proposed existing-source-segment endpoint extension without mutating `segs`.
2. Group proposed extensions by current DSU root. For each affected root, call the existing `heldContactsForMembers` once with all prospective extremum points for that root. Preserve the existing movement budgets, nearest-crossing choice, opening-source requirements, relation identities, and reason-aware union rules.
3. Commit the synthesized wall, all source extensions, and its placement only after every affected root is representable. Commit them atomically; one unsafe end commits nothing.
4. If validation fails, keep every authored/current source segment byte-for-byte unchanged, do not create the synthesized host or placement, and allow `buildVectorNodes` to continue. The opening must appear in existing `unhostedOpeningIds`; it may not silently disappear or be reclassified as deduped. The final `heldContactsForMembers` check remains unchanged and must pass.
5. Do not try a farther crossing, create a floating/source-free host, move a held contact, suppress the diagnostic, or return the whole document as null. Existing safe synthesized hosts must remain identical.

For p30, `o2` was already in Lane A's `dedupedOpeningIds` and a later source opening represented the kept physical opening. R4 must explicitly reconcile all 29 source openings: each ID appears exactly once in kept, deduped, or unhosted accounting. Preserve the Lane A kept physical opening count/positions/widths unless the exact counterfactual proves `o2` was the sole support; any lost kept physical opening is a blocker.

## 3. Fail-first tests

Add focused adapter tests that fail on R3:

- Two retained relations plus a synthesized pair-door host whose second crossing would extend an existing source group past another held contact: build returns non-null, no affected source endpoint changes, no synthesized wall is emitted, the opening is unhosted, and the final held guard is not bypassed.
- Two-end atomicity: the first proposed crossing extension is safe and the second unsafe; assert neither source extension nor synth/placement is committed.
- Existing safe two-crossing synthesized host: exact wall/opening geometry and diagnostics remain unchanged.
- Existing safe opening-host precedence and all R3 retained-chain/source-order fixtures remain unchanged.
- Exact p30 V15 replay: imports; source wall/opening/semantic-zone inputs remain immutable; every opening is accounted; no new canonical contained pair; exact Slab/Ceiling positive overlap remains zero; floor-probe hits are no lower than Lane A for p30; build is idempotent. If conservative unhosting loses a kept physical opening or a floor seed, stop and return to Sol review—do not restore the unsafe extension.

Update the canonical modeling manual and ontology/resource exposure tests in the same change: a synthesized apartment opening host is committed only when all inferred crossing extensions preserve retained source contacts; otherwise the plan imports and exposes that opening as unhosted for review.

## 4. Canonical duplicate metric interpretation

Do not alter `containedDuplicateSpan`, its dot/tolerance rules, or any raw counts. The R3 report must continue to show raw other-case count `19` versus Lane A `17` and raw lengths.

The raw +2 count is not two newly introduced physical overlaps:

- p39 `3FO3TSOR9DA9`: baseline overlap and R3 overlap are both exactly `0.16562654424040213 m`. R3 removes a `0.002873455759597743 m` non-overlapping tail, so the existing overlap changes from partial to contained. Source groups are short `[48,24]`, long `[36,7]`.
- p29 `3FO3YPCW00SU`: baseline centerline overlap is `0.22213225693226102 m`; R3 is `0.22205615449262248 m` (not increased). Exact-T planarization splits source wall group `[15]`; the already present shallow wall group `[49,33]` remains. The child segment becomes contained, but its union equals the original parent coverage.
- p04 `3FO3YJBTN0PM`: an existing pair grows from `0.2624 m` to `0.2764 m`. Short source wall `[13]` is extended 14 mm to the source-contact x-coordinate of `w22`; the unchanged covering group is `[24,9,23,16,22]`. The added span lies wholly inside that pre-existing wall's construction envelope. Record this raw `+0.014 m` delta; it is allowed only after a frozen source-contact trace confirms the endpoint identity and proves no new emitted wall, no increase in occupied wall-footprint union, and no floor/surface loss.

Thus final acceptance keeps two simultaneous gates:

1. Raw canonical metric: publish all per-case pair/count/length deltas unchanged; p07 must be expected `0`, not the stale baseline expectation `3`.
2. Causal physical regression gate: fail any new source-wall pair, increased centerline overlap, or new occupied wall footprint unless it matches one of the generic source-backed categories below:
   - segmentation-only: child union equals the baseline parent and pair overlap does not increase;
   - containment-boundary-only: the same source pair and same overlap length existed before;
   - existing-pair contact closure: the pair existed before, the endpoint lands on a frozen source contact, the added span stays entirely inside the same pre-existing covering construction footprint, and occupied wall-footprint union does not increase.

No case/plan ID checks enter product code. Produce a frozen attribution JSON with source indices, before/after endpoints, overlap lengths, category, and footprint/coverage proof for every nonzero delta. Any unattributed delta or new physical overlap is a blocker.

## 5. Completion gates

Re-run the same immutable 50 inputs after the repair. Require: 44 imported / 6 calibration rejects / 0 errors; no per-case floor-hit loss; exact stored Slab/Ceiling overlap zero; p07 canonical duplicates zero; p30 imported and fully accounted; no unattributed duplicate delta; original wall/opening/semantic-zone inputs unchanged; same-version idempotence; paired performance final/Lane-A p95 ≤1.25 under the approved protocol; detector fixed threshold unchanged; focused tests, editor/MCP types, Biome, build; owned browser Undo/Redo/save/reload, closed-zone diagnostics, rendered 3D and console. Bind the final source/input hashes after all concurrent files freeze.
