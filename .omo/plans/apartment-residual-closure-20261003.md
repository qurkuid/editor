# Apartment residual closure — approved Sol/high contract

Approved by `/root/zone_plan` (gpt-5.6-sol/high), 2026-10-03. Parent saved the read-only reviewer's contract. Exact current source/input freeze: `.omo/evidence/apartment-residual-closure-20261003/baseline-parent/baseline-manifest.json` (168 files: 24 source, 50 raw V15, 44 imported, 50 evaluation). Core before SHA `0b92675436829c6fbde644544309a125485433c8c94669b12d92825f63bcbe11`; importer before SHA `6092586698577501b55cf656696bdc78e02e6aae77644a75708a419dc61b8b46`.

## Evidence and scope

Removing the approximate-T door guard did not change p03/p07/p09 spaces (1/3/3). Lowering importer minimum wall length to 80 mm also did not improve spaces. Reject both hypotheses.

Approve two independent core fixes: unique physically touching nonparallel endpoint corners, and preservation of real shared surface bends. p07 copied-wall reproduction changes 3 spaces to 5 by joining two physical corners. p42 raw spaces have zero overlap but 80 mm surface simplification creates 7 positive pairs / 0.1901438 m²; p48 creates 1 / 0.05399547 m². p38 has a raw nested containment of 1.88049992 m², explicitly unresolved in this change.

Allowed product files: `packages/core/src/lib/space-detection.ts`, its focused/history tests if needed, `packages/mcp/src/modeling-agent-manual.ts`, `ontology-manual.test.ts`, and `resources/resources.test.ts`. No importer, UI, schema, source vector, or dependency changes. Preserve unrelated dirty work.

## Physical corner contract

Collect endpoint-to-end line intersection candidates within the existing straight-wall pair scan; avoid a new unconditional quadratic scan. Both walls must be nonparallel straight segments. Intersection must be at the nearest endpoint direction of each segment. Each endpoint displacement must be at most `min(0.08 m, authored wall length)`. Authored endpoint separation must be within the two construction-envelope half-thicknesses, proving physical band contact. Every incident straight segment at an authored endpoint cluster must agree on the same canonical point. Curved incidents, competing candidates, conflicting points, and inferred interior passages fail closed.

Apply only to `projectedEndpointByKey`; stored walls, hosted openings, metadata, and scale stay unchanged. Existing approximate endpoint-to-interior door guards remain. Physical door-hosted end corners may join; collinear/parallel door gaps and separated passages remain open.

### Sol amendment: source-line-preserving compact components

The C evidence variant averaging multiple intersection points is REJECTED. It creates a point off source centerlines and can join competing walls. p07 is a genuine compact three-wall corner, with three distinct pair intersections and endpoint diameter 17.62 mm. Replace the earlier single-canonical-point requirement for this case with a complete pairwise candidate component. Every incident endpoint must participate, every pair must be nonparallel, and component diameter must not exceed 80 mm or any incident wall half-thickness. Reject same-wall two-endpoint components, curved/collinear incidents, and incomplete competing components. Each endpoint's candidate intersections must lie on its single authored outward ray. Extend only the derived segment to the farthest exact intersection; retain nearer intersections as split points. Preserve original source line direction; never average, rotate, or invent a new coordinate. Sol copied-wall proof: V→D, H→V, D→H restores p07 3→5 spaces without self-crossing. Require D artifact variant p07≥5 and p09≥4 plus negative fixtures before product adoption.

Diameter is necessary but insufficient for physical contact. Every candidate pair must additionally pass the existing `polygonsOverlap` utility on its authored unmitered straight-wall construction footprints, precomputed once per straight wall using `getWallPlanFootprint` with empty junction maps. Use `getWallThickness`/`getWallConstructionEnvelopeThickness` consistently, including canonical face-band overrides. No new polygon implementation/dependency. Fail-first nearly parallel separated endcaps: `(0,-2)→(0,0)` and `(.0007,.04)→(.0357,2.04)` with thickness 0.2 m, enclosed by supporting bottom/right/top walls. The loop must remain open (zero Spaces); a 40 mm endpoint-distance check alone incorrectly closes it. Also prove p07 physical footprints touch and canonical face-band thickness overrides stale authored thickness in a negative fixture.

### Sol amendment: closure diagnostics must agree

Static review proves authored-only `isConnected` can leave the recovered p07 corner flagged open. Reproduce actual D issue wall IDs first. If reproduced, allow `packages/core/src/lib/room-boundary.ts` and its test as a mandatory companion fix. Reuse one `detectSpacesForLevel` result and its confirmed `boundaryFaces`: shared graph nodes require two distinct wall IDs at the same point key. An authored straight endpoint may be connected only to a shared node on its own line/outward ray, within 80 mm, with start parameter <=0 or end parameter >=1. Do not duplicate the D corner algorithm or mistake a nearby interior split for endpoint connection. Recovered p07 corner markers disappear; real collinear, parallel, curved, ambiguous, and unsupported gaps retain issues. Surface preservation remains independently approved.

Fail-first reduced p07 fixture: vertical end `(-0.6216924549, 0.5557383634)`, door-hosted horizontal start `(-0.6072924549, 0.5557383634)`, diagonal start `(-0.6216924549, 0.5455786796)`; thicknesses 0.2347/0.2347/0.1588 m. Require actual 3→5 spaces and byte-equivalent input walls. Negative tests: parallel/collinear gap, beyond 80 mm or physical band, beyond wall length, curved incident, competing candidate points, separated door-hosted passage.

## Surface boundary contract

Change shared automatic Slab/Ceiling simplification tolerance from 0.08 m to 1e-6 m. Reuse the existing utility. No trimming, union, holes, or containment filtering.

Fail-first actual p42 shallow shared-bend fixture must retain Space polygon geometry in both Slab and Ceiling and introduce no positive overlap. Existing simplified automatic surfaces update with stable IDs, without create/delete churn. Manual containing/exact surfaces continue suppressing automatic generation. Preserve p38 containment as a separately reported residual.

## Validation and stop condition

Test each independent variant, then combine only if both pass. Replay the same 50 immutable V15 documents and same 330 source probes. Require 44 accepted / 6 rejected, zero errors/self-intersections/duplicate IDs, floor coverage at least 290/330 with no per-case hit losses, p07 at least 5 spaces and 5/9 probes. Preserve authored wall/opening geometry and source metadata/scale. Surface-only counts stay unchanged; combined automatic Slab/Ceiling counts track confirmed Spaces exactly in isolated imports. Existing semantic Zone adoption may suppress a new Zone when the existing one matches.

p42 and p48 planner-introduced positive overlaps must become zero; all 44 planned polygons must introduce no positive overlap beyond raw Space overlap. Raster boundary pixels are not the exact overlap success metric. Record raw containment separately. Existing auto surface IDs and manual surfaces remain stable. Save/reload must preserve resulting node IDs/counts.

Benchmark exact before/after sources on identical frozen inputs: two warmups and 12 measured rounds, per-case median, p95, max, total. Detection/planning p95 must be at most 1.25× before, with no timeout. Report measured stress bounds separately.

Run focused tests, relevant regression, package build, editor types, changed-file Biome/static checks, and isolated production build. Fresh real browser gate: owned QA runtime, p07 default-guide import; visible Zones/2D boundary diagnostics, actual 2D/3D surfaces, one import Undo/Redo, save/reload graph/scale, fresh console. Also inspect p42/p48 shared surface boundary. Never restart user runtime 3002.

If corner variant misses p07 target or loses another source probe, reject it without widening tolerance. If surface variant churns IDs/manual surfaces, reject it independently. Complete this iteration only after evidence is collected; report remaining source gaps and nested containment explicitly, without claiming all spaces closed.


### Sol amendment: performance and meaningful regressions

The fc48930d geometry replay passes but its warmed real-case p95 is 3.901708 ms, exceeding the original 2.819375 ms gate. The same-protocol baseline repeat is 2.3235 ms (candidate ratio 1.679). Preserve these failed artifacts. Apply the identical 80 mm/wall-length displacement predicates before physical polygon lookup, and compute authored unmitered footprints lazily through a per-detection memoized getter using the same canonical footprint utility and empty junction maps. Cache segment length/direction only if necessary after measuring. Do not weaken any complete-component, incident, curved, competing, footprint-contact, envelope, source-line or passage predicate. Require the original performance gate on the same frozen inputs.

Tests must model an actual p42/p48 opposing shared bent chain and measure exact positive polygon intersection for both Slab and Ceiling, failing against the frozen 80 mm simplifier. Preserve auto IDs without create/delete churn; exact manual suppression must assert the emitted polygon is the other room. The incomplete-component fixture must contain every other side of a closable loop and fail when only the completeness predicate is disabled. Capture both stdout and stderr, plus exit status, for test evidence.

The all44 fc48930d exact audit shows the previous p38 containment is naturally removed by separating the outer aggregate around the retained inner room. This is a verified geometry result, not containment filtering; report it accurately instead of retaining the earlier anticipated residual. Floor coverage is 298/330 with no per-case loss. A new product SHA requires fresh replay, frozen-source performance, core build, and browser binding to that source.
