# DSU rejection atomicity clarification

Sol/high reviewed the r2 union bookkeeping before final freeze. This clarification supplements the safety addendum, preserves its product behavior gates, and does not change source geometry acceptance.

After a successful union, rebuild blocked opposite-root pairs from all affected active relations (moving and retained), excluding superseded relations. Rebuilding only moving-root relations loses retained-root protections and is a HIGH blocker. Regression must cover two relations sharing a retained root, an unrelated member absorbed into it, rejection of the remaining opposite union, and source-order permutations.

Rejected unions must be semantically atomic: equivalence-class membership/root identity, relation sets, blocked pairs, superseded relation IDs, group members and subsequent canonical output stay equivalent. Existing path compression may change internal parent pointers without changing these semantics. Byte-for-byte parent array parity is not required. Superseded relation IDs must be rolled back on rejection. Prove semantic equivalence through rejection followed by subsequent unions and order permutations.

Parent saved this Sol/high clarification before source freeze and replay on 2026-10-03.
