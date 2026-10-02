# Zone finish takeoff — code review

## Current verdict

**APPROVE — source, focused regressions, typecheck, build, and browser behavior pass.**

- Reviewer profile: `gpt-5.6-sol`, reasoning `high` (`~/.codex/agents/code-reviewer.toml`).
- Baseline: `999b2771b3a0f1aa84f18d74fda82c77b29aad08`.
- Reviewed files: `apps/editor/lib/quantity-takeoff.ts`, `apps/editor/lib/quantity-takeoff.test.ts`.
- Reviewed uncommitted diff SHA-256: `537e9afe77ba0c8728216cfae5b9cb6820f90724a46c44e4abd298333fd4706c`.
- Source findings: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 0.
- The identical feature diff was integrated into the original checkout and retained the same SHA-256; unrelated dirty files remained outside this review.

## Spec and root-cause review

- The patch repairs the actual loss point in `deriveTakeoff`: wall finish quantities now consume active face-band slots and normalized `finishRegions`; it does not add a masking fallback or alternate submission path.
- Vertical spans use `getWallFaceBandConfig`, so lower/middle/upper values are clamped by the core contract before the remaining upper/top height is calculated. The spans conserve the effective wall height and skip zero-area bands.
- Curved-wall classification reuses core `isCurvedWall`, including its straight-snap threshold. Curved walls retain `getWallCurveLength` base quantities and ignore partial regions, matching the renderer's NaN station behavior.
- Straight regions match only the exact active slot role. A missing persisted band slot falls back only to the corresponding persisted whole-side slot; renderer-only visual defaults remain excluded.
- A per-wall material map recombines base, band, side, and region contributions before the existing global `push`, so equal refs conserve area and add each contributing wall ID once.
- Door/window children remain outside the calculation, preserving the explicitly approved gross wall-area semantics. The calculation only reads and normalizes copied region data; the frozen-input regression covers non-mutation.

## Focused evidence read

- `focused-regression.log`: 64 pass, 0 fail, 138 assertions across takeoff, estimate conversion, and scene-material override suites.
- `biome.log`: both owned files checked clean.
- `check-types-final.log`: `bun run --bun --cwd apps/editor check-types` passed after route generation with no diagnostics.
- `build.log`: isolated Next.js production build compiled successfully, generated all 13 static pages, and completed with build ID `lF-ZXFuTjrQJw7PnZ3Y7-`.
- The focused cases cover unbanded override/remainder, uncovered no-base area, 2/3/4 bands, missing-band side fallback, ignored inactive and whole-side roles, adjacent/disjoint recombination, unique node IDs, curved arc length, gross openings, and frozen input.
- Manual conservation checks match the fixtures: unbanded 4 m × 2.5 m split gives 5 + 5 m²; two-band exact-role case gives 2 + 2 + 6 m²; disjoint equal-ref regions give 7.5 + 2.5 m².
- `integration-tests.log`: the original-checkout integration rerun also passed 64 tests, 0 failures, and 138 assertions against the same diff hash.

## Browser evidence and boundary

`zone-finish-qa-result.json` and `validation-summary.txt` prove the visible scene-tree Zone flow on a deterministic synthetic fixture:

- Zone-selected finish: 5.00 m²; uncovered lower-band base: 2.00 m²; uncovered upper-band base: 3.00 m².
- Undo removed the region and its Stats row; redo restored it. Real local scene `PUT`/`GET` requests returned 200, and reload retained the region and all three quantities.
- `consoleErrors`, `pageErrors`, `failedResponses`, and `externalMutations` are all empty.
- The fixture mocked unavailable company/catalogue endpoints plus icon, texture, decoder, thumbnail, and template responses for deterministic browser safety. The scene persistence requests were real. This proves takeoff and persistence behavior; it is not evidence of an actual company catalogue, product pricing, estimate submission, or production mutation.

The earlier failed `check-types` artifacts document dependency/output setup failures and are superseded by `check-types-final.log`. No source change is requested. A changed feature diff requires a fresh review.

## Recommendation

**APPROVE.**
