# R4 Addendum — deterministic merged-wall order and relation-scoped weld protection

## Authority and blocker
R3 source freeze `product-final/source-freeze-r3.json` SHA `0a98dacaee08067585247edb3ca573f4a09d6587f1a1cc292727f8bc4ca876d8` is not releasable: `product-final/r3/replay-final/r3-floor-loss-triage-reviewed.json` SHA `7b892f1973377a8042293c04b051ae03d00233963665be1d1ea6c43a2f52c274` proves the same immutable probes/source frame lose five hits across the common 43 imported plans, plus p30 rejects separately. This addendum supplements, and does not replace, the p30 atomic plan in `apartment-source-chain-guards-r4-replay-repair-20261003.md`.

## Root cause and smallest implementation
In `apps/editor/lib/apt-vector-scene.ts`, preserve the retained-chain DSU/relation bookkeeping, but materialize final merged groups with the same deterministic source order as Lane A: sort every group’s member indices ascending and process groups by their minimum member/source index. The DSU representative and Set insertion order must not select the longest-member tie, merged-wall order, or later snap/weld candidate order.

Keep the exact-centerline-contact guard in `snapJunctions`; removing it reintroduces p07 contained duplicates. Remove only the global non-crossing branch skip in `weldDanglingEnds` (`distToSegment(p, originalOther) <= SOURCE_ENDPOINT_EPS_M`). Retained authored contacts remain protected by the existing held-endpoint/relation identity and `relationMoveRejected` check for the actual candidate. Do not change weld budgets, lateral/angle/thickness tolerances, source walls/openings, opening-host precedence, core topology, or raster/vector inputs. Do not add case IDs or alternate fallback paths.

## Fail-first tests
1. Add a public `buildVectorNodes` fixture whose union retains a non-earliest DSU root and whose equal/competing merged members expose iteration order. Assert explicit merged wall geometry equals Lane-A source-index semantics and remains stable across repeated builds. This must fail with R3 root/Set order.
2. Add a non-retained exact-contact fixture that needs the existing weld candidate after snap. Assert the room remains closed. This must fail with the global weld skip and pass without changing tolerances.
3. Keep all R3 retained-chain, opening-host, atomic blocked-key, ambiguous relation, and authored-line fixtures passing. Add/retain a p07-shaped assertion that relation-owned endpoints do not move and contained duplicate span remains zero.
4. Bind actual immutable V15 p07 probes: all 9/9 must hit, including the R3-lost balcony `p07_...-room-05`, while recovered 02/03/04/09 remain hits; p07 contained duplicate count/length stays `0/0`, openings remain 10, and existing source/opening provenance stays exact.
5. Bind actual p08, p09, p29, p33, p37 per-seed results to no loss from Lane A; p22 gain may remain. Use the same frozen probes, raw documents, image sizes, and world transform. p30 must import and retain its prior 6/6 under the separate atomic repair.

## Full gates
Fresh R4 replay must have 44 imported / the same six strict calibration rejects; no accepted per-seed floor-hit loss against Lane A; stored Slab/Ceiling exact positive overlap zero; no new self-intersection/exterior floor; raw walls/openings/semantic Zones unchanged; and every canonical geometry delta outside the p07/p30 or another proven generic retained-chain instance must have source-backed attribution. Historical Lane-A canonical mismatch remains an observational field. Final paired benchmark binds `after` to the successful fresh R4 canonical hashes; same-version idempotence remains independently true. Re-run duplicate metrics with dot>=.99 and preserve every raw pair/classification.

## Frozen causal evidence
- `floor-contact-trace/outputs/lane-a/summary.json` SHA `fc6232db3e34ee3d8f35ee05ca7a84e50888d5292ec19129f14c942c7d21efea`
- `floor-contact-trace/outputs/pair-local-only/summary.json` SHA `d3c622dc1d88ec05f6bcc82d892f18eb8201f3e1b290199739de8b5a094061b4`
- `floor-contact-trace/outputs/r3/summary.json` SHA `ca09bc1357bf19e541fb7c553dede7da0445e007bb92eabf1c3978979d858aec`
- Temporary exact counterfactual source `/tmp/apt-vector-r4-order-noweld.ts` SHA `e66ffb32ab6bd8bde5c9b5209d466523f6046e881faa30cbe139e4c9e69f2e79`
- Runner `/tmp/run-r4-order-noweld.ts` SHA `6b8eb39d39ee5207e911376dc86cad62660172938cc2d46f969d6a77bdd70268`
- Summary `/tmp/r4-order-noweld/outputs/order-noweld/summary.json` SHA `5d2a1b4425b4e67e3808b683950d063638306a0ab16cb9efb71eb5a05ab3cade`
- p07 output SHA `f22bc0ef4fc367a5a80e42cd41945deeff380c3da8743e6a5ba2cd9942848a71`: walls34/openings10/spaces7/slabs7, probes9/9, independently recomputed contained duplicate `0/0`
- p09 output SHA `f021dabd2c139301eaf624d9fc1e71564f8c214aae121ddcbcacf715bfa9b5a2`: walls26/openings7/spaces4/slabs4, probes6/7 (Lane-A parity)

## Stop condition
Do not accept a p30-only patch, a net-hit waiver, or a removal of both exact-contact guards. Source implementation may start after the temporary counterfactual bytes are frozen. Final approval still requires fresh source review, 50-case replay, paired performance, build/types/Biome/manual gates, and the owned UI history/save/reload/2D/3D checks.
