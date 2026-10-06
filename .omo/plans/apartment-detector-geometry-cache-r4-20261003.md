# Apartment detector geometry-cache R4

## Status and authority

- Review lane: `gpt-5.6-sol`, reasoning `high`.
- This is the approved, bounded implementation contract for the remaining detector performance gate. It does not approve a product source freeze or a final release.
- Product ownership: Luna implements. This plan changes no product source itself.
- Scope is limited to `packages/core/src/lib/space-detection.ts` and its focused tests. No importer, room-boundary UI, renderer, schema, dependency, or manual change belongs in this lane.

## Frozen evidence

| Evidence | SHA-256 |
| --- | --- |
| Current reviewed `packages/core/src/lib/space-detection.ts` | `4cabb219ca8487664a9c9e0cf06264d02c733556e6d970b5cfeab70fc08a378c` |
| Detector stress result | `16064156555fdea4c779d73c1add8e3769dd964f4e0cbde6f9f3b6ce35cffc29` |
| Detector stress runner | `84ad3eed3b8159a604b1b2e0409a0da349a84a225a755af5dc7cc58c9cb4ca8a` |
| Performance input manifest | `e63a0272578f42fb6ac221cb56fa331023a34fb70e31057285bd7a1c12053149` |

The frozen run contains 44 actual normalized wall graphs plus disjoint synthetic graphs with 100, 500, and 1000 walls. It used two warmups and twelve timed calls per case, for 564 timed calls. Input cloning and importer verification were outside the timed region. It reported zero detector errors and zero geometry-idempotence failures, but `p95=2.963708ms`, above the unchanged `2.819375ms` gate. Real-only `p95=1.902708ms` is observational and must not replace the required 47-case gate. A rerun may not be selected merely because it is faster.

## Root cause and implementation contract

`extractRooms` currently stores only the wall, start, and end in `straightWalls`. The O(N²) scans repeatedly recompute invariant segment vectors, squared lengths, lengths, and unit directions:

- `endpointCornerForPair` recomputes two lengths and directions for every nonparallel pair.
- The exact endpoint-to-host pass runs approximately `2N × N` projections.
- The approximate endpoint-candidate pass runs another `2N × N` projections and also recomputes host length and unit direction for every endpoint-host pair.
- `effectiveStraightWalls` is allocated even when no endpoint was projected and the second intersection pass is skipped.

The measured synthetic medians increase from about `1.012ms` at 100 walls to `19.614ms` at 500 and `53.903ms` at 1000, so removing invariant work inside those scans is the smallest source-backed first correction.

Implement exactly these changes:

1. When constructing each nondegenerate straight-wall record, calculate and retain immutable `dx`, `dy`, `lengthSquared`, `length = Math.hypot(dx, dy)`, and `unitDirection` once. Preserve the wall order, source coordinates, wall IDs, and existing nondegenerate predicate.
2. Reuse the retained values in the exact intersection pair scan, `endpointCornerForPair`, exact endpoint-to-host scan, and approximate endpoint-candidate scan.
3. A cached projection helper may accept a point and cached straight-wall record, but it must preserve the current `segmentProjection` arithmetic and return contract: the `1e-12` degenerate branch, unclamped `t`, `[0,1]` clamp used only for the projected point, and `Math.hypot` distance remain unchanged. Do not replace the cached `Math.hypot(dx,dy)` length with `Math.sqrt(lengthSquared)` because exact geometry parity is required.
4. Build `effectiveStraightWalls` only inside the existing `projectedEndpointByKey.size > 0` branch. When the map is empty, neither the derived array nor the second exact-intersection scan runs. When nonempty, retain the current mapping and scan order.
5. Preserve every predicate and observable ordering: `1e-12`, `1e-9`, `1e-7`, `1e-6`, and `WALL_JUNCTION_TOLERANCE`; pair iteration order; candidate insertion and sorting order; DSU behavior; footprint contact; door handling; split-point order; polygon construction; IDs; and source coordinates.

Do not add a spatial index, bounding-box pruning, new tolerance, alternate topology path, fallback, dependency, or graph-algorithm change in this pass.

## Required validation

Run the focused detector regressions and repository-required core type/build/Biome checks. Preserve exact canonical output for all 44 actual normalized graphs and synthetic 100/500/1000 graphs, using the existing eight-decimal canonical polygon representation and space counts. The four intentional importer-verification differences in the frozen benchmark (`3FO3TOWE773J`, `3FO3Y6TBLWT1`, `3FO3YCX91KCS`, `3FO40C71IWG4`) remain observationally identical; this optimization must not create another difference.

The established product gates remain unchanged:

- p07, p30, p35, and p47 hard geometry results stay exact.
- Floor probes remain at least `302/330`, with zero previously passing seed loss.
- Closed-space Zone ownership remains `376/376`, exactly one enclosed owner per closed space.
- Stored Slab/Ceiling exact positive-area overlap remains zero.
- The p07 contained-duplicate result remains `0 / 0m`; the other 43 imported cases remain exactly `17 / 4.553583479452558m`.

After source freeze and parity checks, run the same bound benchmark once with the same input manifest, runtime protocol, and machine conditions:

- 44 actual plus synthetic 100/500/1000 cases;
- two warmups and twelve timed calls per case;
- 564 timed calls total;
- clone and importer verification outside timing;
- zero errors and zero canonical geometry mismatches;
- detector `p95 <= 2.819375ms`.

If this first frozen post-change run fails the fixed p95 gate, stop. Preserve the failing evidence and return to Sol with a profile of the same frozen source and inputs. Do not stack speculative optimizations or weaken the gate.

## Read-only scope conclusions

- The frozen R4 room-boundary source is `c003cfc5baf22a848524ac614b68a804426f5640f0db0abbade0047d6c0601de`. The separately moving concurrent source observed during this review was `a167f6d7992a8d5770352e33594245657a00681d9f9cb1ca846b7d1cead109e0`. Its auto diagnosis, auto quick-repair planning, and default direct-manual algorithm were unchanged; the direct success result only gained empty `creates` and `measurements`, while L-corner behavior is opt-in. The concurrent L workflow is excluded from this R4 task. Final reporting must identify the immutable R4 snapshot and the current unowned concurrent work separately and must not describe the moving current tree as fully reviewed.
- p35 and p47 attribution is sufficient through exact output-hash binding. The attribution report is based on an older R4 importer snapshot, but its p35 output SHA `205d61bd5b7642ec0f6130b6f289cdc6e8fbdd751a8f0d28fa8079f857e0e353` and p47 output SHA `91023766a684f53721225b67e92bec072776b5412ee5fdfbe9f842cbba5faa2c` exactly match the final replay outputs. Report this as an exact output-hash bridge, not as a fresh final-source attribution run.
- Contained-duplicate evidence passes: p07 changed from three pairs / `1.284401m` to zero; all other 43 imported cases remained exactly seventeen pairs / `4.553583479452558m`.

## Disposable quick-repair UI fixture setup

The prior visible-UI construction attempt is valid failure evidence and remains preserved. It produced five walls and no safe repair; it must not be overwritten or presented as a successful replay. For the missing current quick-repair UI proof, test-data setup may seed the exact immutable historical **pre-repair** graph into a new disposable private database. This is fixture setup, not proof of the repair action.

Approved source fixture:

- `.omo/evidence/apartment-zone-closure-20261002/browser-fixture.json`
- SHA-256 `e6f9b7db9c11f71dde2f1903a7d4c420117cf565872bdb24754852a6a8a365bd`
- eight nodes: one Site, one Building, one Level, four Walls, and one Door;
- root `site_zone_qa`, empty `collections` and `materials`;
- Level owns exactly the four walls; `wall_zone_qa_south` owns `door_zone_qa`; the Door's `parentId` and `wallId` both equal `wall_zone_qa_south`;
- the only intended closure gap is south-wall end `[1.8,-1.5]` to east-wall start `[2,-1.5]`, exactly `0.2m`;
- no Zone, Slab, Ceiling, precomputed repair, or repaired endpoint exists in the seed.

Setup contract:

1. Create a new disposable private SQLite database and a unique QA runtime/build binding. The user or production database and every previously captured QA scene remain untouched.
2. With the runtime stopped, load the fixture through the repository's current SQLite scene-store path so current parsing, serialization, scene metadata, revision initialization, size, and node count are produced by the storage implementation. Do not hand-write only the `scenes` row and do not seed a repaired graph or historical after-state.
3. Validate the fixture through current schemas before saving. Fail setup if the eight IDs, root, parent/children relations, Door host relations, four wall endpoints, source metadata, or empty collections/materials differ. Record the source fixture SHA, disposable DB SHA/path, created scene ID/version, serialized graph hash, and build/runtime binding.
4. Start the owned runtime, open that scene through the normal editor route, and capture the loaded graph before any action. This loaded graph is the exact Undo baseline; schema-default materialization, if any, must be explicit in setup evidence and cannot alter the listed geometry or ownership invariants.
5. All behavior under test then occurs through visible CUA only: open 2D boundary diagnostics, invoke the safe quick-repair action once, Undo once, Redo once, save, hard reload, and inspect 2D/3D. Do not use API, SQL, devtools, or direct scene-store writes for the repair, Undo, Redo, or reload state.

Acceptance:

- Before action: four walls, one hosted Door, zero Zone/Slab/Ceiling, one eligible 200mm issue, and visible open-boundary diagnostics.
- Repair: the south endpoint moves to `[2,-1.5]`; all four wall IDs remain; the Door ID, `parentId`, `wallId`, width, and world placement remain unchanged; exactly one enclosed generated Zone, one Slab, and one Ceiling are created with the four expected boundary walls.
- One visible Undo equals the captured loaded baseline graph. One visible Redo equals the captured repaired graph, including generated IDs. Save plus hard reload equals the same repaired graph.
- 2D shows a closed space/zone and no stale opening marker at the repaired corner. 3D is evidence only when an actual rendered result is visible. Console errors are zero; warnings are recorded rather than cleared or suppressed.
- The historical `after-repair.json` may be used only as an oracle for expected geometry. It must never be inserted into the disposable database.

This fixture replay is separate from the detector cache source gate. It may close the current R4 quick-repair UI evidence gap, but it cannot substitute for actual p07/p30 apartment evidence or for the detector performance run.
