# Apartment automatic walls: concrete finish and fixed 100 mm — 2026-10-06

## Accepted scope

User clarification: this policy applies ONLY to automatic apartment modeling. Interior and exterior generated walls must use one solid concrete assembly physically 100 mm thick and the existing concrete finish material. Preserve existing manual/custom walls and their defaults, saved custom constructions, source document measurements and metadata. Do not retroactively rewrite every wall or change schema/global renderer defaults.

Planning was requested on Sol/high. This child cannot observe resolved model/effort metadata and does not claim verification of it. The parent coordinates the implementation relay and owns current-scene copies and actual exports. No product files were edited during this planning slice.

## Current source and fresh evidence

- `apps/editor/lib/apt-vector-scene.ts:472` / `buildVectorNodes` is the shared generator called by Apartment search, trace and debug routes.
- `:510–539`: raw `originalSourceSegs` and measured/clamped `Seg.th` support source-backed merge, opening host and relation checks. Keep their current semantics and input `doc` unchanged.
- `:1106`: actual WallNodes currently receive `thickness: seg.th` and `createDefaultWallFaceBands(seg.th)`.
- `:1243`: `connectWallJunctions` reads actual WallNode construction envelope. The intended final physical thickness must already be represented here, before junction splitting/miter decisions.
- `:1281` / `applyAptPlanImportFrame` currently multiplies thickness by guide frame scale and rebuilds faceBands from it. Simply setting 0.1 before this function would produce 0.2 for a 2x guide; simply overriding after junction connection would use the wrong envelope during junction decisions.
- `packages/core/src/index.ts:735` exports `DEFAULT_WALL_THICKNESS`; its definition at `systems/wall/wall-footprint.ts:11` is 0.1. Reuse it without changing it.
- `packages/core/src/material-library.ts:3897` defines `concrete-plate`, a wall-compatible smooth concrete finish. Canonical persisted reference: `library:concrete-plate`.
- `packages/viewer/src/systems/wall/wall-materials.ts:170–217`: interior/exterior refs override defaults; an absent band ref resolves through the corresponding side ref. No redundant band slot writes are needed. The generated one-band assembly remains disabled/count 1 as today.
- `packages/nodes/src/wall/construction-preview.tsx:119–140`: structural concrete layers intentionally use concrete structural color, while the finish view renders the wall envelope through its surface slots. Parent accepts concrete-plate finish view plus gray concrete structural view. Texture in DXF is outside scope.

Fresh command: `bun .omo/evidence/auto-wall-concrete-100mm-plan-20261006/probe.ts`.
Captured `current-policy.json` / `probe.log` show four generated walls currently have 0.2/0.1 thickness at default scale and 0.4/0.2 at scale 2; all slots are absent, input remains unchanged, and concrete-plate exists. This is a reproduced failing product expectation, not a post-fix claim.

## Minimal implementation contract: five primary files

1. `apps/editor/lib/apt-vector-scene.ts`
2. `apps/editor/lib/apt-vector-scene.test.ts`
3. `packages/mcp/src/modeling-agent-manual.ts`
4. `packages/mcp/src/ontology-manual.test.ts`
5. `apps/editor/lib/ai-provider.test.ts`

Only adjust an existing frame regression file if its old product expectation directly contradicts the new fixed-thickness requirement. Do not edit core global defaults, the wall schema, manual wall tools, node defaults, materials library, shared `connectWallJunctions`, or renderers.

### Correct thickness boundary

Within `buildVectorNodes`, compute source guide scale once from `(imageW * doc.mmPerPx) / 10000`, and compute the effective frame scale using the existing semantics: `frame.scale === undefined ? 1 : frame.scale / sourceGuideScale`.

When materializing each generated WallNode, including synthesized opening hosts, use `DEFAULT_WALL_THICKNESS / frameScale` as the source-frame physical thickness and use the same value in `createDefaultWallFaceBands`. Keep measured `Seg.th` and original source footprints untouched for earlier evidence/merge logic.

This gives `connectWallJunctions` a construction envelope equivalent to exactly 100 mm in final coordinates. Keep the existing coordinate transformation and opening-scale behavior. In the apartment-only `applyAptPlanImportFrame`, finalize node thickness to exactly `DEFAULT_WALL_THICKNESS` and rebuild the one-layer concrete assembly using the same exact value. This avoids floating drift and guide scaling changing the target thickness. Do not reorder the whole pipeline or introduce another normalization abstraction.

The output must satisfy:

- `wall.thickness === DEFAULT_WALL_THICKNESS`;
- one assembly layer, `kind: 'concrete'`, `thickness === DEFAULT_WALL_THICKNESS`, no cavity/stud/finish add-on;
- `getWallConstructionEnvelopeThickness(wall)` resolves 0.1 within its existing arithmetic precision;
- every split segment and door/window host satisfies the same contract at default, scaled, rotated and flipped frames;
- height remains absent unless another explicitly scoped operation sets it; no change to elevation correction behavior.

### Concrete finish

Set the two base surface slots on newly generated walls:

`slots: { interior: 'library:concrete-plate', exterior: 'library:concrete-plate' }`.

Preserve these slots through splitting and framing by retaining existing node spreads. Do not write legacy materialPreset/inline fields, dynamic scene materials, or additional band slots. Do not confuse structural material product/pricing metadata with visual surface refs.

### Data preservation

Do not add speculative sourceThickness metadata or rewrite source measurements. Input doc and existing opening metadata already retain their evidence; `Seg.th` and `originalSourceSegs` must continue carrying measured values through source-backed decisions. The new policy affects output physical wall construction only.

No automatic load migration and no writes to unrelated saved/manual walls. The existing Apartment import route may replace only the matching apt-vector-generated nodes according to its existing rerun contract. Do not broaden that replacement predicate.

### Manual wording

Replace the outdated statement that apartment generated physical wall thickness preserves plan-detected thickness. State that apartment automatic modeling creates 100 mm solid-concrete walls on both interior and exterior sides, including opening hosts, with concrete-plate base finishes independent of guide scale; source measurements remain source evidence and manual/custom existing walls are preserved. Keep the shared manual exposed by both MCP resource and internal AI prompt through existing imports/tests.

## Tests and captured acceptance

| Scenario | Invocation / interaction | Binary observable | Required artifact |
|---|---|---|---|
| Mixed detected 100/200+ mm interior/exterior source | `bun test apps/editor/lib/apt-vector-scene.test.ts` | every generated wall and assembly physical width=.1; both surface refs concrete-plate; input JSON exact unchanged | `vector-tests.log` |
| Default and non-default guide scales, rotation/flips | same focused suite | final width=.1 at scale .5, 1, 2 or equivalent nondefault guide frames; source-frame junction envelope scales reciprocally; transformed endpoints/openings retain expected positions | `frame-thickness-results.json` + test log |
| Door/window/synthesized hosts and T/X segmentation | existing vector regressions plus targeted assertions | every host/segment .1; source ids, widths, children/parent linkage preserved; no cut through hosted opening | `vector-tests.log` |
| Manual/custom preservation | existing rerun/import fixture with a 230 mm custom wall beside apt nodes | custom wall graph unchanged, matching regenerated apt walls .1 only | `preservation-test.log` |
| Shared manual exposure | `bun test packages/mcp/src/ontology-manual.test.ts apps/editor/lib/ai-provider.test.ts` | both exposed prompts include the scoped policy | `manual-tests.log` |
| Real automatic Apartment UI | parent-owned QA copy using actual 113C response (reported 78 source walls, 18 openings, 12 rooms) | use actual automatic-model button; visible interior and exterior inspector 100 mm; concrete finish visible; exported saved graph verifies all generated walls/hosts/assemblies and preserved custom nodes | source response, before/after graph, `2d.png`, `3d-finish.png`, `ui-result.json` |
| Undo/Redo + reload | same visible import action, Undo once, Redo once, save/reload | exact prior graph after Undo, exact generated graph after Redo and reload; no unintended extra nodes or reverted thickness/material | graph snapshots and equality report |
| Export geometry | parent-owned fresh UI DXF/GLB exports | final wall thickness policy represented in actual exported geometry; no regression in closure/openings; concrete finish requirement applies to finish view, not DXF textures | actual downloads + geometry report |

Verification order: failing focused regression, minimal fix, focused vector tests, existing `apt-import-frame.test.ts`, relevant shared wall topology tests when junction output changes, manual tests, changed-file Biome, editor typecheck, real browser, production build. Preserve existing strict source-evidence tests: change expected output thickness only when that assertion expresses the superseded policy, not to weaken source contact/merge/opening correctness.

No completion claim until the actual automatic Apartment UI path and saved graph agree with the policy. Existing corrected-scene import/export proof is not proof of this new generation policy.


## Approved amendment: unsupported automatic wall base fallback

The actual 100 mm Apartment UI generation exposed two unsupported walls. Fresh replay command `bun .omo/evidence/auto-wall-concrete-100mm-20261006/supports.ts > .omo/evidence/auto-wall-concrete-100mm-plan-20261006/supports-fresh.json` confirms 54 walls: 52 resolve 0.05 m and exactly `wall_sr35mt3zfcn6iscc` / `wall_kcd0m67vie52so5j` resolve 0 m with null elected slab. The saved `after.json` has 53 apt-vector walls and one manual wall; the unsupported walls retain source endpoints and have no explicit height, host or offset. Its same-level auto slabs and the retained non-auto slab all have elevation 0.05. Do not close the reported 2 mm source gap, extend walls, fabricate a slab, or rewrite source measurements. Parent's 54-closed DXF observation is separate from this independently reproduced support result.

### Small shared boundary

Extend the existing pure `computeWallSlabSupport` in `packages/core/src/systems/slab/slab-support.ts`, not a renderer/export-only correction. Real spatial support groups must be evaluated first and remain unchanged. Only when there are **zero actual qualifying overlap groups** may a conservative apartment automatic default-base fallback be considered. A capped-away actual support group is not missing support and must never enter this branch.

Match the query to exactly one wall in the supplied levelWalls using exact ordered start/end coordinates, effective `curveOffset ?? 0`, and effective `thickness ?? DEFAULT_WALL_THICKNESS`. Do not add a distance tolerance, reverse-endpoint heuristic, nearest-wall election, or choose the first duplicate. This makes the geometry-literal spatial-grid query and full-node export query converge on the same scene-wall identity. If zero or multiple matches exist, preserve current zero fallback. The unique wall must have `metadata.source === 'apt-vector'`, a parent level, no explicit height, no explicit supportSlabId (including ground), and no nonzero supportOffset. Existing core space detection already reads this source provenance; no editor/viewer dependency is introduced.

The fallback derives elevation from existing same-parent-level autoFromWalls slabs; require at least one valid auto slab, and unanimous finite elevation within the existing support elevation epsilon. Every same-level slab, including non-auto authored slabs, must agree with that elevation; a conflicting step disables fallback. Reject same-level recessed slabs or meaningful holes conservatively, and reject a fallback above a supplied maxElevation cap. Do not assign a synthesized electedSlabId. Return the inferred elevation consistently as `elevation`, `baseElevation`, and one full `[0,1]` base segment, with `electedSlabId: null`. Do not store it on the wall. This is an inferred default level floor, not a claim that a remote slab physically supports the wall.

`spatial-grid-manager.ts:1084` currently passes only `{start,end,curveOffset,thickness}`. Add optional query `supportOffset` to the existing WallOverlapInput shape and pass the manager's existing supportOffset argument into that literal. Check both query and matched-wall offset before allowing fallback. This retains current outer offset arithmetic while preventing a hypothetical nonzero-offset query from first acquiring the fallback and then double adding. No persisted schema field, new host sentinel, public operation, every-caller rewrite or generated-node offset is necessary. Existing callers with omitted offset retain their current default; direct full-wall callers already carry the field structurally.

Actual future slab support always wins the original election, so a newly overlapping 0.05 slab produces 0.05, never 0.10. A real 0.20 support produces 0.20. Removing that support restores the eligible unanimous fallback only if the remaining scene satisfies all guards. Explicit authored height/host/offset and manual/custom walls retain existing behavior. Auto floor creation passes only non-auto slabs to this resolver, so it must not acquire this auto-slab fallback and restart the earlier ratchet.

### Exact implementation ownership

Luna owns the minimal resolver, optional query field and manager forwarding, focused tests in `packages/core/src/systems/slab/slab-support.test.ts` and `packages/core/src/hooks/spatial-grid/wall-slab-overlap.test.ts` (or the existing support-host fixture where setup is already available), and a short scoped manual amendment plus existing shared-manual assertions. Parent owns review/integration and real automatic UI/export verification. Existing source files modified by the concrete100 change remain owned by its executor; preserve all concurrent changes. No saved-scene edits are part of this amendment.

### Required regression scenarios

1. An unsupported apt-vector wall, geometrically identical query literal and full-node query, same-level uniform auto slabs: both return elevation/base/profile 0.05 and null host. Include exact current two-wall source coordinates in an evidence replay.
2. Add an actual overlapping 0.05 slab, then a 0.20 slab: original election and actual slab id win, no 0.10 double-add. Remove it and verify eligible fallback resumes.
3. Zero or duplicate exact wall matches, manual wall, no auto slab, mixed auto elevations, different-level candidates, same-level authored step, recessed slab, holes, explicit height, explicit host/ground, stored nonzero offset, query nonzero offset, cap below candidate: fallback disabled. A cap above candidate permits it.
4. Existing support, partial support/base profiles, authored slab support, ground and pointer-cap tests stay unchanged. Run `bun test packages/core/src/systems/slab/slab-support.test.ts packages/core/src/hooks/spatial-grid/wall-slab-overlap.test.ts packages/core/src/hooks/spatial-grid/support-host.test.ts packages/core/src/hooks/spatial-grid/pointer-support-cap.test.ts packages/core/src/lib/space-detection.test.ts` and capture the full output. Use the actual existing space-detection test location if its suite has split.
5. Parent real UI reload/regenerate/save/export on isolated QA: the identical source gap and endpoints remain; all 53 generated automatic walls keep 100 mm concrete; manual wall graph remains intact; all 54 actual DXF blocks are closed with bottom50/top2500. Save graph/2D/3D/export reports separately. Inference changes must not persist new supportOffset/host/height fields. Repeat the already-required Undo/Redo and reload generation contract.

### Source guard test review amendment

Removing output thickness filters is necessary because all output walls are now 0.1. The focused changed test around line2484 still checks the complete sorted length multiset (0.2502, 0.75015, 1.5, 3), count4, and zero duplicate span; this is stronger than replacing it with count alone. Its retained bridge endpoints should also be checked to make identity explicit.

The changed tests around line2598 (valid retained relation), 2670 (both-side absorption), 2787 (tolerance), 2905 (competing bridges), 2966 (controls), and 3015 (non-facing) use counts/lengths that cannot by themselves prove which source span survived. Preserve the existing fixtures and add small endpoint/source-span checks for the specifically named retained or merged runs; do not restore obsolete thickness partitions. In particular, line2670's generic length >1.99 can be satisfied by the 3 m absorber and no longer proves the unrelated 2 m continuation: select the horizontal run at transformed y=-4 with x from2 to4, or its equivalent unordered endpoints. Retained bridge fixtures should assert the transformed source bridge endpoints, and non-facing fixture should distinguish the two 4 m runs by their positions. No fixture redefinition, tolerance broadening, or source guard algorithm change is authorized. Counts4/5 may legitimately include the unrelated far wall and narrower-envelope splits; the executor must retain positional evidence rather than justify those counts solely with a passing run.

Required artifacts in parent attempt: `support-tests.log`, `support-fallback-cases.json`, `source-guard-tests.log`, fresh graph support replay, UI saved before/after/undo/redo snapshots, actual DXF archive and closure/extents report. This planning amendment does not claim implementation or passing product tests.
