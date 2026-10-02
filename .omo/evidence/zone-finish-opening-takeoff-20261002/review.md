# Zone finish opening takeoff — source review

## Verdict

**APPROVE (source gate).** Reviewed the 11-file patch against `e5a4fb15` at patch SHA-256 `238a62ea6251e393d55069de88c4f1b8be50d95b844e166da6134a56ed20a915`.

No CRITICAL, HIGH, MEDIUM, or LOW source findings remain. Browser/runtime acceptance remains a separate completion gate owned by the implementation/QA lane.

Reviewer profile: installed `code-reviewer` role, `gpt-5.6-sol`, reasoning effort `high`.

## Scope reviewed

- `apps/editor/components/stats-tab.tsx`
- `apps/editor/lib/estimate-submit.ts`
- `apps/editor/lib/estimate-submit.test.ts`
- `apps/editor/lib/quantity-takeoff.ts`
- `apps/editor/lib/quantity-takeoff.test.ts`
- `packages/editor/src/i18n/dictionary/furniture.ts`
- `packages/viewer/src/index.ts`
- `packages/viewer/src/lib/polygon-union.ts`
- `packages/viewer/src/lib/polygon-union.test.ts`
- `packages/viewer/src/systems/wall/opening-cutout-geometry.ts`
- `packages/viewer/src/systems/wall/opening-cutout-geometry.test.ts`

## Contract verification

- Strict union accepts only finite, simple, convex input rings. Self-crossing, concave, point-touching, and boundary-key collision fixtures fail closed.
- Strict assembly requires one incoming/outgoing segment per keyed endpoint, verifies every actual endpoint join with `pointsEqual`, closes every walk, consumes every boundary segment, and rejects non-simple assembled rings.
- Mutually separate assembled rings are checked for contact/crossing before containment. Containment depth uses an actual ring vertex, preserving outer/hole parity for normal and thin-frame fixtures.
- The union result is finite and bounded by the largest normalized input area and the sum of normalized input areas. Strict failure is returned to takeoff as conservative gross quantity with an explicit unsupported state.
- Takeoff reuses `buildOpeningCutoutShape(...).extractPoints(24)` through the new viewer profile helper. The renderer still uses the same shape and the same `curveSegments: 24`; no rendered-geometry behavior changed.
- Only door/window nodes in `wall.children` are deducted. Other child kinds follow renderer filtering; missing/invalid children, item cutouts, curved walls with openings, and strict-union failures remain gross and visible as unsupported.
- Active band heights, exact-role finish regions, and whole-side base fallback are preserved. Openings are clipped to the wall envelope and each material cell, then unioned before deduction.
- Gross, known deduction, and deducted/mixed/unsupported status merge across same-material walls. A fully deducted zero-net contribution remains in the internal aggregation, contributes gross/deduction/node ID to a positive same-material line, and a standalone zero purchase line is removed before the public report.
- Stats and INTM descriptions distinguish fully deducted, mixed, and unsupported bases. Unsupported rows say gross is retained and deduction is unverified; they are not labeled as proven net area.
- `deriveTakeoff` remains read-only; the frozen-scene regression passes. Pricing consumes the resulting net or conservative gross quantity without adding a scene/pricing mutation path.
- Public viewer exports are limited to the shared profile, rectangle clip, and strict area result. Existing `unionPolygons` and subtraction callers are unchanged.

## Fresh validation

- Focused and adjacent regressions: **141 pass, 0 fail, 525 expectations** across polygon union, opening profile, quantity takeoff, estimate submission, estimate pricing, scene material overrides, and wall assembly takeoff.
- `bun run --bun --cwd apps/editor check-types`: **PASS**.
- `bun run --cwd packages/viewer build`: **PASS**.
- Biome 2.4.16 over all 11 scoped files: **PASS**, 11 files checked, no fixes applied.
- `git diff --check e5a4fb15`: **PASS**.

## Remaining completion gate

Source approval does not replace the required disposable-scene browser proof: Zone finish plus door/window changes must update Stats, unsupported copy must remain gross, undo/redo and save/reload must preserve values, and the run must record console/page errors and external mutation boundaries.
