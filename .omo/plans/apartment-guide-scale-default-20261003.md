# Apartment default guide scale — Sol/high approved contract

Reviewer `/root/zone_plan`: APPROVE TO IMPLEMENT. Implementation and browser verification use installed `luna-max` (GPT-5.6 Luna/max). Preserve unrelated work and every existing scene. Core topology remains frozen at `0b926754...`.

## Proven root and outcome

`현재 씬에 깔기` creates an apartment guide with scale 1 and no scaleReference. Sidebar automatic modeling passes that placeholder as an explicit import frame, shrinking source-physical geometry by `1 / physicalGuideScale`. Fresh p12/p14 imports consequently produce 6/5 Slabs instead of physical-source 10/7; small rooms fall below the existing area threshold. No-guide import and apt-trace already use physical scale correctly.

## Smallest implementation

1. In `apps/editor/lib/apt-import-frame.ts`, preserve position and yaw in `getAptGuideImportFrame`. Omit the scale property only for exactly `guide.scaleReference === null && guide.scale === 1`. Preserve every non-default numeric scale and every explicit scaleReference, including calibrated scale 1. No epsilon, inferred scale, schema or new metadata marker.
2. In `apps/editor/components/apt-search-panel.tsx`, add `scale: built.guideScale` to the existing-guide update inside the same successful import history step. Placeholder scale becomes physical source scale; calibrated/resized imports return the same guide scale and remain unchanged. Preserve guide id, position, rotation, scaleReference, opacity and metadata. No mutation on failure.
3. Add fail-first regressions to the existing apt import-frame tests: default property omission and preserved position/yaw; manual scale 1.5 preservation; explicit calibration at scale 1 preservation; default-frame output equals no-frame physical geometry for walls/zones/Slabs/Ceilings; guide promotion and imported graph restore in one Undo/Redo and hydration replay. If necessary, one existing vector-scene regression proves position/yaw/flips-only frames preserve physical dimensions and thickness.
4. Repository AGENTS requires the canonical modeling manual to track unit/modeling rules: extend its existing apartment orientation/import paragraph with this default placeholder versus explicit scale policy. Update existing ontology/resource exposure checks. No new modeling operation or AI-specific mutation path.

## Verification and browser completion

Focused regressions must fail before the fix and pass afterward. Run relevant apt/manual/core regression, app/editor types, changed-file Biome, core/MCP builds as needed for manual exposure, isolated production build and diff check. Use fresh isolated p12/p14 scenes: `현재 씬에 깔기` (scale1/null) then automatic modeling. Compare saved graphs with same-source physical imports, including physical guide scale, normalized walls/openings/zones/Slabs/Ceilings and 10/7 detected surfaces. One Undo restores the scale1 guide-only graph; Redo/save/reload restore exact imported graph. Verify actual 2D selection, 3D appearance, console/network, and a calibrated/manual-resized guide transform preservation case. Keep user3002 and all QA scenes untouched.

## Explicit limit

Existing stored state cannot distinguish a default placeholder from an uncalibrated guide manually returned to exactly scale 1. Treat scale1/null as default; scaleReference at scale1 remains authoritative. This bounded policy uses existing state without a new marker. Source-physical 50-case replay remains unchanged if the pure vector importer/core are unchanged; report hashes and fresh UI evidence must include the new sidebar/helper/manual sources.
