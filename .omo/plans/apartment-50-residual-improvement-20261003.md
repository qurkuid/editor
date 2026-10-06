# Apartment 50 residual topology improvement — 2026-10-03

Sol/high reviewer `/root/zone_plan`: APPROVE TO IMPLEMENT. Implementation and runtime verification use installed `luna-max` (GPT-5.6 Luna/max). Existing dirty work and evidence remain intact.

## Scope and proven root

Fix the shared straight-wall detection graph in `packages/core/src/lib/space-detection.ts`, not raster extraction or stored walls. p12/p14/p22/p35 polygons self-intersect before floor generation. Existing endpoint-only planarization misses actual interior/interior crossings, excludes valid contacts within 80 mm of host endpoints, and inserts nearby endpoint coordinates directly into straight hosts, bending them. `buildSpace` copies these polygons directly.

Baseline: same immutable v15 documents, 44 imported / 6 rejected, 232/330 source room seeds, explicit outside false positive 1/6, 4 self-crossing cases/polygons/crossings. Affected counts/seeds: p12 8 spaces, 13/14; p14 5, 5/10; p22 7, 7/14; p35 11, 6/6. Keep baseline evidence under apartment-50-improvement; new evidence under `.omo/evidence/apartment-topology-refinement-20261003/`.

## Implementation contract

1. Add fail-first core regressions from frozen actual coordinates, embedded in test sources (no runtime evidence dependency). Reduced fixtures verify their actual affected faces/probes; full 50 replay verifies full-plan counts. Count proper crossings and non-adjacent self-touch. Prevent discarded-polygon success: affected interior probes remain covered, ids unique, boundary wall/face provenance retained.
2. Compute straight graph candidates once per detection. Add each real finite segment intersection to both split lists with one canonical point and small numerical epsilon. Source WallNodes, ids and hosted content never mutate.
3. For a unique safe endpoint-to-host-interior near contact within existing 80 mm tolerance, use host projection in both incident endpoint and host split list; never bend the host toward the original endpoint. Exclude only numerical/key-equivalent host endpoints, not the full 80 mm region. Ambiguous candidates fail closed. Do not join parallel walls, collinear gaps, endpoint-to-end gaps or door passages. Curved sampling/intersections remain unchanged.
4. Pair scan O(W²) once per detection, not per face. Reuse existing helpers before adding code. Preserve wallId, front/back and subedge provenance. No new dependency, operation, tool or renderer.
5. Negative controls: existing T two-room detection, exact X common vertex, T 57 mm from host endpoint, near contact 27–66 mm using projection, collinear door gap stays open, parallel walls stay separate, ambiguous host stays unsnapped, existing curves unchanged.
6. Synchronize canonical manual in `packages/mcp/src/modeling-agent-manual.ts` and manual exposure tests in ontology/resources: detection-only exact straight intersections and unique endpoint projection; no authored wall mutation or guessed closure.

## Paired gates

Use frozen v15 raw documents and existing evaluate/render helpers. Preserve old files and SHA. Target 4→0 self-crossing cases and no planned/persisted slab crossing. Imports/rejections stay 44/6; total spaces and 232/330 seeds do not decrease; affected full-plan counts and seeds meet their baselines. Wall/opening geometry stays equivalent after stable-ID normalization, outside false positive stays <=1/6, source-zone metadata loss 0. Explain changed Zone/Slab/Ceiling counts by detected faces. Capture before/after detection timing; target summed <=1.25x and no pathological timeout. If not met, remove redundant pair/split work rather than enlarge tolerance.

## Ordered verification

Fail-first evidence, focused core tests, manual exposure tests, core/MCP builds, changed-file Biome, relevant regression and app/editor types, 50-case paired source/floor/seed HTML report, fresh real browser, isolated production build, independent review. Browser: fresh `/apt` p12 and p14 or p35 in isolated QA runtime; 2D Zones select simple enclosed faces with matching Slab/Ceiling, 3D appearance, one import undo/redo and saved reload exact graph/state. Record console/network errors; any error preventing completion fails. Preserve existing scenes and user3002 runtime.

## Bounded fallback and residuals

If actual-intersection stage fixes p12/p22 but endpoint projection breaks negative controls or seed gates, land exact intersection only and report p14/p35 unresolved. Never filter malformed polygons merely to lower counts, enlarge tolerance, use source-room polygons as floors or broaden welding. p02 boundary loss remains separate. p19 scale annotation requires independent source endpoint review: reviewer found overall source endpoints approximately327..916 with10246/1177≈8.705 versusv15≈8.680; correct report annotation only after verification, not product scale. WebGPU/lifecycle warnings remain separate residuals.

## Sol/high review amendment: exact authored T contacts

First provisional replay p12 8→7 and p35 11→7 fails the count gates; relaxing the gates is REJECTED. A door anywhere on a host or incident wall cannot exclude its exact endpoint-on-host contact. Compute exact T candidates (numeric distance epsilon, strictly interior t) independently before approximate guards, regardless of door children; these do not move walls or close gaps. Apply opening/uniqueness guards only to approximate projection. Add two regressions preserving exact T with a door child on host and incident wall respectively. Preserve existing shared vertex connectivity when considering approximate projections; audit curve-connected endpoints before claiming curved behavior unchanged. Replay affected cases and source seeds before acceptance.

## Sol/high review amendment: shared authored vertices

After exact-T repair, reviewer replay reaches p12/p14/p22/p35 spaces10/7/10/14 and seeds14/14,10/10,10/14,6/6 with0crossings; retain original gates. HIGH: wall-specific projection disconnects actual p22 shared source vertex(-5.025519,-1.685412), moving one incident endpoint41.4mm while the other stays. Group endpoint candidates by authored coordinate cluster(pointKey/existing exact tolerance). Approximate projection applies to all straight incident endpoints at the cluster together only for one safe host/projection. Conflicting candidates or any curved incident endpoint reject approximate movement. Exact authored contacts remain original common coordinates. Add reduced shared-straight vertex and straight/curve shared-vertex regressions. Reviewer approval remains pending until these pass and frozen replay is rechecked.

## Sol/high review amendment: performance evidence

Reviewer `/root/zone_plan` approved this bounded amendment after inspecting `timing-recovery/sha-recovery-audit.json` and the current timing artifact. The exact historical source SHA `4dc5a167...` was unavailable after five evidence-only reconstructions and 36 Git commits. The original <=1.25x before/after ratio remains UNVERIFIED; no ratio claim is permitted. Use only current frozen-source absolute latency as completion evidence: 44 imported graphs with 21–84 walls, two warmups and 12 measured rounds per case (528 calls), errors and geometry drift zero, median 0.835ms, p95 1.965ms, maximum 3.309ms. Per-case median sum 38.725ms represents one representative pass; 470.093ms is the accumulated time for all 528 calls, not one batch latency. The harness has no interrupting timeout, so report observed maximum and errors rather than claiming timeout protection. Larger-than-84-wall scalability and historical relative latency remain unverified. This approval does not cover the separately discovered plain-guide UI scale mismatch.
