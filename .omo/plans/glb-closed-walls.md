# Closed standard GLB wall meshes

## TL;DR
> Summary: Repair nonconforming triangle edges on cloned wall meshes before GLB serialization. Preserve the actual wall surface, openings, material assignments, UVs, children and transforms; semantic extras remain supplementary.
> For whom: Pascal users exporting walls for solid-aware downstream editing, particularly SketchUp.
> Deliverables: 
> - A narrowly scoped wall topology repair with regression fixtures.
> - Standard GLB serialization/round-trip proof independent of extras.
> - Browser export and current-scene artifact evidence.
> Effort: Medium
> Risk: Medium - floating-point edge matching, material seams and importer topology interpretation.

## Scope
### Affected user and ideal state
**Affected user:** Today a Pascal user exports the existing rendered CSG triangle soup; in SketchUp they encounter split or apparently open wall surfaces. Afterward, standard GLB wall triangles form a conforming, consistently wound shell while retaining modeled details. SketchUp editability still requires proof in the actual importer: GLB stores triangles, not native six-polygon CAD solids.

| Row | Statement | Reason |
|-----|-----------|--------|
| IS-1 | Every valid exported wall shell has two opposite incident triangles per position-welded edge, finite nondegenerate triangles and preserved volume. | Solid-aware importers need conforming topology, not merely coincident surfaces. |
| GAP-1 | Current CSG wall triangles include T-junctions; group compaction does not split edges. | Apparent holes or disconnected faces survive standard GLB import. |
| IS-2 | Openings, miter corners, stepped bases, existing face materials/UVs, transforms and hosted objects remain identical within declared numeric tolerance. | Editable geometry must remain the user's designed wall. |
| GAP-2 | There is no topology repair with attribute and scene immutability coverage. | A geometry-only patch can damage textures, openings or hierarchy. |
| IS-3 | The downloaded standard GLB is checked independently of Pascal extras and the visible export workflow succeeds. | A semantic face contract alone cannot prove the delivered mesh works. |
| GAP-3 | Existing wall export tests mainly check group compaction and extras, not serialized triangle closure. | Passing tests can coexist with defective delivered geometry. |

### Must have
- Preserve the eight preexisting modified/untracked source files reported by `git status`; capture a before-diff and never reset or broad-stage them.
- Fix T-junctions in the export clone, using original wall triangles as the source of truth.
- Treat wall material primitives collectively for topology checks: a single material primitive is not expected to be a closed solid.
- Preserve holes, concave boundaries, original face planes, negative/nonuniform transforms, material slots, UV/UV2 attributes, door/window children and animation tracks.
- Verify the current scene and a small deterministic fixture; report actual importer results separately from GLB structural validation.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No bounding boxes, opening removal, wall union across IDs, lossy decimation, new dependency or CAD kernel rewrite.
- No claim that `pascalNativeWall.compatible` proves the ordinary mesh is closed.
- No forced closure of a genuinely missing face by guessing a cap. Detect and report the affected wall ID; preserve the source and seek a new targeted diagnosis.
- No mutation/disposal of live shared geometry; no export option or new UX for a repair that should be automatic.
- No commits/pushes that include unrelated recovered changes; commit instructions below describe logical hunks only, subject to parent scope authorization.

### Discovery and chosen repair
- `packages/editor/src/lib/glb-export.ts:193-237` clones then sanitizes groups/materials and stamps contracts; it never repairs mesh topology. `:421-435` compacts groups only.
- `packages/viewer/src/systems/wall/wall-system.tsx:1008-1018` starts with an extrusion; `:1141-1166` subtracts CSG cutouts and returns triangles without conforming-edge cleanup.
- Read-only fixture measured with position identity at 1e-6 metres: plain 4×2.5×0.1 wall = 12 triangles / 0 unmatched edges; centered 1×1 window at `[2,1.3,0]` = 68 triangles / 82 unmatched edges; base segments `[0,.5,0]`, `[.5,1,.05]` with slab=.2 and base=0 = 35 triangles / 33 unmatched edges. Splitting edge incidence at existing collinear vertices reduces both problematic fixtures to **zero** unmatched or inconsistent edges, with zero degenerate triangles. This proves T-junctions for these fixtures; parent artifact audit must confirm the user's scene.
- Alternative A (chosen): split only affected triangles on the export clone; preserves all actual rendered geometry and attributes. Alternative B: triangulate the semantic contract; rejected for this repair because its compatibility gates omit curved walls, shaped openings, terrain, trims and face bands (`sketchup-wall-contract.ts:734-744`). Alternative C: modify all runtime CSG output; deferred because export-only failure has a smaller shared export boundary and runtime performance must not regress.
- The dependency explicitly warns that CSG results may not remain two-manifold: https://github.com/gkjohnson/three-bvh-csg#readme. Three's existing polygon triangulation helper accepts outer contours and holes, but independent polygon triangulation alone does not guarantee matching edge subdivisions: https://threejs.org/docs/pages/ShapeUtils.html.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + existing Bun test runner. Extend focused tests; no new framework.
- QA policy: every task has agent-executed scenarios.
- Evidence: `<attemptDir>/task-<N>-<slug>.<ext>` — under ulw-loop, `<attemptDir>` is the `currentAttemptDir` from `omo-agent-toolkit ulw-loop status --json`; outside ulw-loop use `.omo/evidence/`.
- Numeric policy: topology comparison starts at 1e-6 metres in local coordinates; do not round every vertex to a grid. Require identical bounds within 1e-6 metres and volume difference <= max(1e-7 m³, original absolute volume × 1e-5). Check serialized Float32 output, not just double-precision intermediate arrays. If the current artifact needs another tolerance, record measured coordinates/error and adjust once with a regression; never increase tolerance merely to hide failures.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

This bounded fix deliberately uses three dependent atomic tasks: artificial parallel source ownership would cause conflicts in the same export module. Parent artifact audit/browser preparation can run independently.

Wave 1 (no dependencies):
- Task 1: Attribute-preserving conforming wall triangles and focused regression.

Wave 2 (after Wave 1):
- Task 2: Export integration and actual GLB round-trip regression; depends [1].

Wave 3 (after Wave 2):
- Task 3: Current-scene browser export, structural audit and importer proof; depends [2].

Critical path: Task 1 -> Task 2 -> Task 3

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1 | none | 2 | Parent read-only artifact audit |
| 2 | 1 | 3 | Parent browser preparation |
| 3 | 2 | F1-F4 | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Subdivide existing wall triangle edges without changing the surface

  What to do: Add one narrowly named internal helper in `packages/editor/src/lib/glb-export.ts` (extract to a sibling only if readability requires). Read indexed/nonindexed triangles with effective draw ranges and material groups. Identify existing vertices lying strictly inside another triangle edge using a measured local-coordinate tolerance. For a triangle that needs subdivision, order all split points along its three boundary edges and triangulate the resulting boundary without removing its collinear vertices. A center fan is a simple conforming option: its center is strictly inside the original nondegenerate triangle; retain orientation and interpolate all vertex attributes barycentrically. Leave unaffected triangles untouched. Rebuild contiguous groups preserving the original triangle's material slot, and keep UV seams/hard normals as duplicated attributes at identical positions. Do not weld away attribute seams. Recheck boundary incidence after Float32 conversion. Add tests to the existing export test file, using generated wall geometry as the fixture rather than a synthetic open plane alone.

  Must NOT do: Recompute smooth normals across face seams; discard attributes; move all vertices onto a rounding grid; change the live renderer or semantic contract; infer missing surfaces.
  Closes: GAP-1, GAP-2

  Parallelization: Can parallel: NO | Wave 1 | Blocks: [2] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern: `packages/editor/src/lib/glb-export.ts:375-435` - detached geometry replacement and group compaction.
  - API/Type: `packages/viewer/src/systems/wall/wall-system.tsx:930-941` - `generateExtrudedWall` fixture arguments.
  - Test: `packages/editor/src/lib/glb-export.test.ts:50-96` - triangle/material and world-position inspection helpers; extend rather than introduce a framework.
  - Test: `packages/viewer/src/systems/wall/wall-opening-cutout.test.ts:10-82` - opening fixture and empty-cutout assertions.
  - External: `https://github.com/gkjohnson/three-bvh-csg#readme` - known output-manifold limitation.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test packages/editor/src/lib/glb-export.test.ts` passes new test names containing `conforming wall`; before the fix, the window/stepped fixture test fails for unmatched edges.
  - [ ] Plain wall remains 12 triangles; repaired window and stepped fixtures have zero unmatched/overused edges, balanced direction, finite nondegenerate triangles and preserved volume.
  - [ ] Triangle subdivision preserves per-original-face material, linearly interpolated UV/UV2, normals and original bounds; source attribute/index/group arrays are unchanged.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: conforming wall cutouts
    Tool: bash
    Steps: bun test packages/editor/src/lib/glb-export.test.ts --test-name-pattern 'conforming wall'
    Expected: Plain, window, door-to-floor, two openings, miter-cap crossing and stepped-base fixtures pass position-welded triangle incidence and shape/attribute assertions.
    Evidence: <attemptDir>/task-1-conforming-wall.txt

  Scenario: preserve genuinely open source
    Tool: bash
    Steps: bun test packages/editor/src/lib/glb-export.test.ts --test-name-pattern 'open wall is not capped'
    Expected: Deliberately delete one fixture face; test confirms repair never invents it and topology validation identifies remaining open edges.
    Evidence: <attemptDir>/task-1-conforming-wall-error.txt
  ```

  Commit: YES | Message: `fix(export): conform wall triangle boundaries` | Files: [`packages/editor/src/lib/glb-export.ts`, `packages/editor/src/lib/glb-export.test.ts`] - stage only task hunks.

- [ ] 2. Integrate before serialization and prove standard GLB topology

  What to do: Invoke the repair for registered wall root meshes in `prepareSceneForExport`, using the original-to-clone map before identity stamping. Do not recursively repair hosted door/window/item meshes or decorative trim merely because they are descendants. Ensure group sanitation cannot hide a real malformed wall group. Retain clone transforms and children; use local geometry coordinates. Keep current contract extras but remove them in one test before serialization to establish independence. Serialize via installed GLTFExporter in a Bun test with only the minimum FileReader shim if required; load with installed GLTFLoader or decode the actual accessors with a small test-local reader. Aggregate all material primitives for each wall ID and assert topology. Include nested level transforms, nonuniform scale and reflection; inspect world-space winding together with glTF transform behavior rather than rewriting all world coordinates. Add explicit no-op regression for unsupported semantic-contract types: curved wall and shaped opening actual geometry must remain present and faithful. Capture unresolved genuine holes in the parent audit instead of silently declaring repair complete.

  Must NOT do: Replace actual meshes from `pascalNativeWall.faces`; double-apply matrixWorld; clear parent/child transforms; claim each material primitive is independently solid.
  Closes: GAP-2, GAP-3

  Parallelization: Can parallel: NO | Wave 2 | Blocks: [3] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern: `packages/editor/src/lib/glb-export.ts:123-165` - serialization lifecycle and level restoration.
  - Pattern: `packages/editor/src/lib/glb-export.ts:193-260` - clone identity map and repair ordering.
  - API/Type: `packages/nodes/src/wall/renderer.tsx:130-163` - wall is the root Mesh, with separate collision and hosted children.
  - Test: `packages/editor/src/lib/glb-export.test.ts:178-309` - group/transform invariants.
  - Test: `packages/editor/src/lib/glb-export.test.ts:445-524` - existing extras checks must remain supplementary.
  - External: `https://threejs.org/docs/pages/GLTFExporter.html` - installed exporter API contract; check installed source for exact version behavior.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test packages/editor/src/lib/glb-export.test.ts packages/editor/src/lib/sketchup-wall-contract.test.ts` passes, including tests named `serialized GLB wall` and `transformed GLB wall`.
  - [ ] Actual serialized accessor triangles remain closed with `pascalNativeWall` removed; material/texture linkage, children, node identities and animations survive.
  - [ ] `bun run --cwd apps/editor check-types` and `bunx biome check packages/editor/src/lib/glb-export.ts packages/editor/src/lib/glb-export.test.ts` pass or independently documented preexisting failures are unchanged.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: extras-free serialized shell
    Tool: bash
    Steps: bun test packages/editor/src/lib/glb-export.test.ts --test-name-pattern 'serialized GLB wall'
    Expected: Binary GLB accessors across wall primitives have 0 boundary/nonmanifold edges, preserved positive local shell volume and preserved openings without semantic extras.
    Evidence: <attemptDir>/task-2-glb-roundtrip.txt

  Scenario: transformed GLB wall
    Tool: bash
    Steps: bun test packages/editor/src/lib/glb-export.test.ts --test-name-pattern 'transformed GLB wall'
    Expected: Nested translation/rotation, nonuniform and negative scale preserve world bounds and orientation contract; hosted door animation and source matrices are unchanged.
    Evidence: <attemptDir>/task-2-glb-roundtrip-error.txt
  ```

  Commit: YES | Message: `test(export): verify closed walls in serialized GLB` | Files: [`packages/editor/src/lib/glb-export.ts`, `packages/editor/src/lib/glb-export.test.ts`] - stage only task hunks.

- [ ] 3. Verify the real export and downstream wall editing

  What to do: Use the parent-owned live browser at `http://localhost:3002` without restarting it or replacing the user's scene. Capture current scene node counts, wall IDs, current view and source state. Invoke the existing visible `Export 3D Model (GLB)` command and retain the downloaded file. Audit actual accessor triangles per wall across material primitives; report boundary counts before/after, bounds, volume, openings and materials. Run the same audit on the parent's recovered scene export. Inspect the exported result from front/back/top/bottom in the existing viewer/import surface. Where the parent has a functioning SketchUp importer, import into a fresh temporary model and verify face editing and solid status through native automation; do not use a semantic-only reconstruction as the sole standard-GLB test. If SketchUp is inaccessible, record exactly that verification gap, never claim SketchUp editing is verified. Any actual remaining open wall becomes a concrete failing fixture and returns to Task 1; missing caps are a new diagnosed change, not guessed geometry.

  Must NOT do: Overwrite the user's scene, active SketchUp model or recovered files; hide failures behind screenshot-only approval; publish or push.
  Closes: GAP-3

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [F1, F2, F3, F4] | Blocked by: [2]

  References (executor has NO interview context - be exhaustive):
  - Pattern: `packages/editor/src/components/editor/export-manager.tsx:39-61` - visible command downloads `model_YYYY-MM-DD.glb`.
  - API/Type: `packages/editor/src/components/ui/command-palette/editor-commands.tsx:386-395` - command ID `editor.export.glb`, label `Export 3D Model (GLB)`.
  - Test: `packages/editor/src/lib/glb-export.test.ts` - Task 2 actual-accessor audit logic.
  - External: `https://threejs.org/docs/pages/GLTFExporter.html` - standard GLB serialization boundary.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test packages/editor/src/lib/glb-export.test.ts packages/editor/src/lib/sketchup-wall-contract.test.ts packages/viewer/src/systems/wall/wall-opening-cutout.test.ts packages/viewer/src/systems/wall/wall-support-extension.test.ts` passes.
  - [ ] `bun run --cwd apps/editor build` passes; record warnings separately.
  - [ ] Downloaded current-scene GLB retains each expected wall ID and passes per-wall conforming topology/volume checks; screenshot and console evidence reference its exact file/hash.
  - [ ] Native SketchUp verification either proves solid status and a reversible face edit or is explicitly left unverified; full SketchUp-specific completion cannot be claimed while it is unverified.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: visible GLB export
    Tool: computer-use
    Steps: In the parent-owned tab at http://localhost:3002 press Meta+K; enter 'Export 3D Model (GLB)'; select the matching command; collect the new model_YYYY-MM-DD.glb. Reuse Task 2's accessor audit on that exact artifact. Capture model views and console.
    Expected: Download completes, no new export error, all actual wall shells pass with openings/materials intact, source scene/view unchanged after export.
    Evidence: <attemptDir>/task-3-live-export.json and <attemptDir>/task-3-live-export.png

  Scenario: export failure restores scene state
    Tool: bash
    Steps: bun test packages/editor/src/lib/glb-export.test.ts --test-name-pattern 'export failure restores'
    Expected: A test-injected serialization rejection leaves original geometry/groups/matrices unchanged, restores level state and emits the after-capture event; no fabricated success artifact.
    Evidence: <attemptDir>/task-3-live-export-error.txt
  ```

  Commit: NO | Message: `test(export): record real wall export verification` | Files: [evidence only; include any added failure-lifecycle test in Task 2's logical commit]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - every task done, every acceptance criterion met
- [ ] F2. Code quality review - diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA - every QA scenario executed with evidence captured
- [ ] F4. Ideal-state fidelity - delivered behavior checked against every IS row 1:1; a shortfall becomes new task rows, never a note; nothing Must-NOT-Have introduced

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/glb-closed-walls.md`.
- Parent owns authorization and hunk isolation; do not include any of the unrelated recovered work merely because it shares a path.

## Success criteria
| IS | Delivering task(s) | Proving QA scenario | Evidence |
|----|--------------------|---------------------|----------|
| IS-1 | 1, 2 | conforming wall cutouts; extras-free serialized shell | <attemptDir>/task-1-conforming-wall.txt; <attemptDir>/task-2-glb-roundtrip.txt |
| IS-2 | 1, 2 | conforming wall cutouts; transformed GLB wall | <attemptDir>/task-1-conforming-wall.txt; <attemptDir>/task-2-glb-roundtrip-error.txt |
| IS-3 | 2, 3 | extras-free serialized shell; visible GLB export | <attemptDir>/task-2-glb-roundtrip.txt; <attemptDir>/task-3-live-export.json |
- Every IS row above has a delivering task and a proving scenario; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
