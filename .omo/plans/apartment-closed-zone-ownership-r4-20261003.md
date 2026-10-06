# R4 closed apartment Space ownership repair

Sol/high verdict: APPROVE FOR LUNA IMPLEMENTATION. Parent accepts this bounded contract.

## Evidence and cause

Read-only Lane A audit `.omo/evidence/apartment-source-chain-guards-20261003/product-final/r4/replay-preparation/baseline-closed-zone-coverage.json`, SHA256 `9d3dac9c28b6d29df269f4f1ad35733252d20ba9905fca61e6a1ee51f3ca6c5a`, found 374 closed Spaces and 346 enclosed Zones; 28 Spaces lack a physical owner in 25 plans. Existing `simplifyClosedPolygon(...,1e-6)` cyclic/reverse comparison matches 0/28; Hausdorff distance <=1e-4 matches 0/28. All 28 have current 12x12 open semantic union coverage >=0.9 (range 0.9..1.0), suppressing generated owners in `planAutoZonesForLevel`.

## Ownership and scope

One Luna owner may edit `packages/core/src/lib/space-detection.ts`, `packages/core/src/lib/space-detection.test.ts`, `packages/mcp/src/modeling-agent-manual.ts`, and existing exposure assertions in `packages/mcp/src/resources/resources.test.ts` and `apps/editor/lib/ai-contract.test.ts`. Preserve concurrent edits. No importer/detector/wall/opening/UI/schema changes. Coordinate shared manual/resource files with the importer owner, which has finished its correction.

In `createMissingZones` coverage construction, an effective Zone cannot suppress a generated physical owner when all hold: effective enclosureStatus is open, effective metadata source is apt-vector, and boundaryNeedsReview is true. Preserve the existing exclusion for open generatedFrom detected-space. Preserve user/manual open coverage and semantic-union behavior. Do not change polygonCoverageRatio, its 0.9 threshold, or sample resolution.

An exact adopted apt-vector Zone or existing enclosed exact owner continues to claim/suppress its Space. Keep open semantic nodes, ids, names, classes, colors, sourceRoomIds, polygons, and content, apart from already-required open/review reconciliation.

## Fail-first and controls

Use one square detected Space and two apt-vector semantic subdivisions whose union covers it, with adoptContainedApartmentZones true and createMissingZones source apt-vector/generatedFrom detected-space. Before repair create is zero; after repair both semantics remain open/review and exactly one enclosed Zone has the Space polygon/wallIds and provenance. Apply updates/create and re-plan: create/update zero, without id churn.

Controls: exact apt-vector source Zone is adopted/enclosed with metadata preserved and no duplicate; existing enclosed generated owner creates no duplicate; existing source:user manual open coverage and semantic subdivision union tests remain create/update zero; unrelated open apt-vector review polygons do not alter source geometry.

## Canonical manual

Every confirmed closed apartment Space has exactly one enclosed physical Zone. Open apt-vector semantic review subdivisions remain preserved overlays and cannot prove or suppress physical enclosure. Exact adopted or existing enclosed owners prevent duplicates. Resource and AI exposure tests assert this single canonical policy.

## Validation and final gates

Run focused fail-first core tests, relevant core regressions/history, resource and AI manual exposure, types/Biome and core/MCP builds. Freeze exact source files, snapshots, logs and contract hashes; no final replay/build/browser until parent combined source gate.

Fresh same50 audit binds final source hashes and reports both full-float canonical and existing simplifyClosedPolygon(...,1e-6) identities. Every imported closed Space has exactly one enclosed Zone; zero unmapped Spaces, duplicate enclosed footprints/owners or missing boundary-wall references. Lane A predicts 374/374 owners, 190 preserved open review semantic Zones, and 28 new generated owners (346 to374). Final R4 uses this relational invariant if Space counts change. All six original fail-closed rejects remain unchanged; raw/probes/calibration/source geometry stay fixed.

Browser gate on a disposable actual apartment: enclosed Zone count equals detected closed Space count, semantic review overlays remain visible; one Undo restores the prior whole graph, Redo restores identical ids, save/reload preserves the whole graph, and console errors are checked. Existing p07/p30 and synthetic quick-repair browser gates remain required.

Threshold/sample tuning, detector changes, geometry edits and fabricated boundaries are outside scope.
