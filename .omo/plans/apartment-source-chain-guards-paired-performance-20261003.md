# Paired importer performance acceptance

Sol/high approved this clarification before candidate execution. Parent saved the supplied protocol on 2026-10-03.

Use a single paired run with frozen Lane A importer `eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89` and the final frozen importer. Both use the same frozen-core bridge, shared transitive dependency hashes and load paths, process, environment and 44 accepted V15 inputs.

Finish both variants' two warmup rounds before measurement. Run 12 measured rounds per case for each variant. Alternate A→B / B→A ordering by case and round to balance ordering/JIT effects. Cloning and canonical geometry/idempotence comparisons are outside the timed region. Record the bridge and shared dependency closure in the run manifest.

The denominator is Lane A p95 measured in that paired run. The historical 9.530709 ms and 12.468375 ms runs remain evidence history and cannot be selected as the final denominator. Required: final/LaneA <= 1.25, round errors zero for both, expected geometry/idempotence parity PASS. Different dependency closures make the ratio UNVERIFIED. A shared current dependency closure is acceptable for this relative comparison, while full historical Lane A closure remains unverified.

The separate detector gate stays unchanged: historical baseline p95 2.2555 ms; upper bound 2.819375 ms; fixed normalized graphs, two warmups and 12 rounds, 44 real plus three synthetic cases, 564 measured calls, zero errors/parity failures.
