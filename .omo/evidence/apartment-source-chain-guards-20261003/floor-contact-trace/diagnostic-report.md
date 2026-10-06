# R3 p07/p09 floor contact regression diagnosis

## Finding

The p07 and p09 R3 losses come from DSU group iteration order at merged-segment materialization. R3 emits `groupMembers` in retained-root insertion order; the counterfactual sorts groups by minimum source index and each group's members ascending. That one change restores p07 from 8/9 to 9/9 probes and 6 to 7 slabs, and p09 from 3/7 to 6/7 probes and 3 to 4 slabs.

The weld exact-contact deletion alone leaves p07 at 8/9 and p09 at 3/7. It is part of the approved R4 repair for other same-50 cases, but it is not the causal repair for these two plans. `relationMoveRejected` and the snap exact-contact guard stay unchanged.

## Frozen reproduction

| Variant | p07 probes | p07 spaces/slabs | p09 probes | p09 spaces/slabs |
| --- | ---: | ---: | ---: | ---: |
| Lane A | 5/9 | 5/5 | 6/7 | 4/4 |
| Pair-local only | 6/9 | 6/6 | 6/7 | 4/4 |
| Retained only | 7/9 | 5/5 | 3/7 | 3/3 |
| R3 | 8/9 | 6/6 | 3/7 | 3/3 |
| R3 + source order only | 9/9 | 7/7 | 6/7 | 4/4 |
| R3 + weld deletion only | 8/9 | 6/6 | 3/7 | 3/3 |
| R3 + source order + weld deletion | 9/9 | 7/7 | 6/7 | 4/4 |

The source-order-only counterfactual restores p07's earlier room-02/03/04 gains, room-09, and the newly lost balcony room-05. It restores p09 room-01/03/04; room-02 remains the pre-existing miss.

## Operation trace

- p07 keeps the same source-backed retained relation `w2.end -> w24.start`, `w24.end -> w20.start` and the same rejected normal union `(2,20)` before and after sorting. Its final physical wall multiset is identical, while its emitted sequence changes. Frozen space detection returns seven spaces/slabs and room-05 after ordering.
- p09 emits zero retained-chain events and zero pair-local already-contact rejections in both runs. In R3, `[w30,w11]` appears after `w7`; its endpoint first moves from y=0.2681838602 to 0.3007623048, then a second pass moves it to 0.3154838602 against `w7`. With source ordering, `[w11,w30]` appears earlier and remains at 0.3007623048. That restores room-01/03/04.
- Instrumented runs match their uninstrumented counterparts for wall sequence/coordinates/thickness, space and slab rings, probe outcomes, and counts for both p07 and p09.

## Duplicate-span guardrail

The frozen canonical duplicate helper reports p07 Lane A at 3 pairs / 1.2844009967 m, R3 at 0 / 0 m, source-order-only at 0 / 0 m, and combined R4 at 0 / 0 m. Sorting preserves the R3 duplicate correction.

## Evidence identities

- Frozen R3 source: `d66fb5f94c65a61632fedac01477d086cae331e0204650b900f0d7910d8cad2f`
- Source-order-only source: `00e2466fdc6877aad0f4b16ab3e2c47f43afa8d47a7088ac29c18c31de7a6681`
- Combined order+weld source: `e66ffb32ab6bd8bde5c9b5209d466523f6046e881faa30cbe139e4c9e69f2e79`
- Runner: `fa199607b4cb399b909b5e4bae03326dfe3bd84eb37d2236159210f6b6c3e63c`
- Raw p07: `7f76c71f5989a256c9a0c599c92dfef69841e3922dd172e76c8cd14a68de9e1a`
- Raw p09: `86f51b5c91ac5327d4f66a84eb4bf064bbde2417fdf6b7af2757718f240d2b06`
- Source probes: `e6bdc01afc8bc2d9065d1bf600bf2c445e995a4b62ba2e30cba59d109c2e83cb`
- Frozen duplicate helper: `18fd6af9fcb3a7ae0a9ff0bac0a0869000593a06a3007b0e616b0b8ed7f4d5c3`

Machine-readable per-seed results, complete trace events, raw endpoints, diffs, and dependency hashes are in `diagnostic-report.json` and the referenced `outputs/` files.
