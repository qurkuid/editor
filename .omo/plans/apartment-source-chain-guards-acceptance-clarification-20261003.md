# Apartment source-chain guards — acceptance clarification 2026-10-03

Planning route: `gpt-5.6-sol` / `high`. This note supplements, and does not overwrite, the frozen product contract `.omo/plans/apartment-source-chain-guards-product-revision-20261003.md` SHA-256 `bc6ff65cd770433e0a2dac511b283eb48547bf820576bca7fa0491e6156d757a`.

## Geometry parity means relation-scoped generic behavior

The gate “no geometry change outside the intended p07 relation normalization” does **not** authorize a p07 ID special case and does not require every other accepted plan to remain byte-identical when it contains the same proven topology.

The product rule applies generically to every exact retained source-chain instance that satisfies the frozen contract: actual facing endpoints, a surviving bridge matching both contacts within `1e-6 m`, bridge nonabsorbable by `isSameWallRun` on both sides, relation identity carried through group aliases, and the source-backed held endpoint remaining a group extent. A different plan may therefore change at that relation only.

Every changed case must report the source wall identities, facing endpoint keys, nonabsorbable-bridge proof, before/after union or endpoint operation, authored-contact parity, and canonical duplicate metric. It must also preserve all raw inputs and source contributors, opening/semantic-zone meaning, per-case floor hits, and exact stored Slab/Ceiling non-overlap. No new duplicate is allowed. Changes that cannot be attributed to this exact relation are failures.

After stable generated-ID normalization:

- geometry belonging to a proven relation may differ only by the approved opposite-root union rejection, incident held-end restoration, and relation-owned snap/weld rejection;
- all unrelated wall geometry is strict parity;
- opening world geometry and metadata are strict parity; p07 `o5` keeps world parity metric `0` and its existing semantics;
- semantic zones, calibration, images, annotations, and raw V15 documents are strict parity.

The same-50 report must list every case with a relation-scoped change rather than presenting only an aggregate. A new relation instance is acceptable only when every source-backed condition and negative-control gate passes; it is not permission to widen proximity, angle, thickness, or merge tolerances.

## Performance evidence has two separate gates

The authoritative existing detector baseline is:

- `.omo/evidence/apartment-residual-closure-20261003/performance/baseline-v15-current-0b926754-stress-100-500-1000-final-detector-benchmark.json`
- SHA-256 `c28f110c4cc612b44939f4cb13f6465a4379990544225dae3ca8a78f9b5f03ce`
- `realDetectorP95Ms = 2.2555`
- fixed `1.25×` gate `2.819375 ms`
- protocol: 2 warmups, 12 measured rounds per case, `detectSpacesForLevel` on fixed normalized wall graphs, importer verification outside timing, 44 real plus 3 synthetic cases, 564 calls.

The prior accepted candidate result is `2.729875 ms` from `after-residual-closure-eba42adc-detector-benchmark.json` SHA-256 `d61d9a2984fb761846483bb9380954549f89037b196f643bf86d6a289f9f5af6`, which passes the fixed detector gate. It is a prior candidate measurement, not the Lane B importer baseline.

Lane A importer source SHA-256 `eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89` has no authoritative end-to-end importer p95 measurement in the inspected evidence. Therefore:

1. Re-run the existing detector protocol on the final product and require `realDetectorP95Ms <= 2.819375`, zero round errors, zero geometry/idempotence failures. Do not describe this as importer timing.
2. Measure importer performance separately by running the **same new protocol twice**: once from the frozen Lane A `eb96…` source and once from the final source, on the same frozen V15 inputs and accepted-case set, with identical warmups/rounds, cloning, normalization, and timing boundaries. Set the importer gate only after measuring Lane A: `final importer p95 <= 1.25 × measured Lane A importer p95`, with zero errors and identical non-timing input/output audit rules.
3. Do not use `2.2555`, `2.729875`, the paused WIP, or an unrelated current checkout measurement as the Lane A importer baseline. If the paired Lane A/final importer measurement is unavailable, mark the importer ratio **UNVERIFIED** and do not claim the Lane B performance gate complete.

No threshold may be weakened because the relation is generic. If the indexed relation implementation misses the paired importer gate, optimize the relation lookup/alias bookkeeping without changing its geometric predicates.
