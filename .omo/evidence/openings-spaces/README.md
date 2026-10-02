# Openings and spaces verifier

`verify-scene.ts` is a read-only acceptance probe for a saved Pascal scene. It
checks the source-backed room and opening contract without importing editor
code or changing a scene.

```sh
bun run .omo/evidence/openings-spaces/verify-scene.ts \
  .omo/evidence/openings-spaces/scene.json \
  .omo/evidence/openings-spaces/api-vector.json
```

The API vector argument is optional. When present, the verifier derives the
source-to-scene frame from `mmPerPx`, the API image scale, and exact-length
wall matches. Without it, the fixture contains a documented fallback frame
captured from the baseline API vector (`w0`, `w2`, and `w7`); the report marks
that path as `fixture-fallback`.

`space-probes.json` contains 15 interior source-image probes: three bedrooms,
two baths, five dress rooms, entrance, living, kitchen, and two balconies.
Fourteen are OCR-recognized and one is the unlabeled upper-left-bedroom color
fallback. Opening probes cover entrance and interior doors, the uncertain
internal fixtures (`openingKind: "opening"`), top-dress double swing, and
balcony glazing. The forbidden probe protects against the old false vertical
window near `[960,157]`.

The verifier requires one distinct `ZoneNode` per room probe, finite simple
non-overlapping polygons, source-backed `metadata.cls` and room names, and
hosted opening nodes whose `parentId`, `wallId`, and wall `children` agree.
Opening centers are derived from the hosted wall's actual `start`/`end` and
the node's `wallT` or local `position`; source-coordinate metadata is used
only when a host placement is unavailable.
The baseline run is retained in `verify-baseline-20260930.log`; it fails on
the pre-repair ten-room merge, wrong internal-window classifications, missing
top-dress double swing, and balcony-partition classification. The forbidden
false-vertical probe remains in the fixture; the baseline graph has already
dropped that unhosted node.

## Final verification 2026-09-30

- Frozen source extractor: 51 source wall segments, 9 doors, 3 windows, 4 uncertain/passage openings, 15 rooms; 14 OCR labels have unique room ownership.
- Saved UI scene: 47 merged walls, all 16 openings, 15 zones. All source probes passed using actual hosted wall positions; unhosted and phantom candidates are absent.
- Final direct UI regeneration, 2D distinct left-bedroom selection, 3D render, exact graph undo and redo passed. History comparison uses stable scene-redo.json before final generation; initial editor hydration adds existing derived slab/ceiling and wall-side classification.
- Source/room/entrance/missing-wall regressions passed; final importer 14 tests/96 assertions, typecheck, Biome and isolated production build passed. Console errors: none.
- Local private extractor changes are retained in vectorize-extractor.patch; no commit, push or deployment performed.
