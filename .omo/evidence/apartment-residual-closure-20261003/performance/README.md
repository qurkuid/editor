# Residual-closure detector performance baseline

This directory contains an evidence-only source-copy benchmark. It imports the
frozen source snapshots through generated files under `runtime/`; it does not
import or edit the product files directly.

## Frozen inputs

- Parent freeze: `../baseline-parent/baseline-manifest.json` (`168` entries:
  `24` source, `50` raw-v15, `44` imported, `50` evaluation).
- Core snapshot SHA-256: `0b92675436829c6fbde644544309a125485433c8c94669b12d92825f63bcbe11`.
- Importer snapshot SHA-256: `6092586698577501b55cf656696bdc78e02e6aae77644a75708a419dc61b8b46`.
- All `24` frozen source files are checked from `baseline-parent/source-snapshots/`
  so later shared-checkout edits cannot silently change this baseline.
- Normalized wall input: `inputs/manifest-current-normalized-walls.json`,
  `44` imported plans and `2038` walls.

## Baseline commands

Real-plan-only timing (44 plans, 528 timed calls) is retained at
`baseline-v15-current-0b926754-detector-benchmark.json`. The guarded baseline
adds the bounded stress cases and writes a separate immutable path:

```sh
bun .omo/evidence/apartment-residual-closure-20261003/performance/benchmark_sourcecopy.ts \
  --variant-label baseline-v15-current-0b926754-stress-100-500-1000-final \
  --synthetic-counts "100,500,1000" \
  --output .omo/evidence/apartment-residual-closure-20261003/performance/baseline-v15-current-0b926754-stress-100-500-1000-final-detector-benchmark.json

python3 .omo/evidence/apartment-residual-closure-20261003/performance/verify_baseline_benchmark.py
```

The baseline uses two warmups and twelve timed rounds per case. Importer
wall-signature verification runs outside the timed region. The current guarded
run has `44/44` importer matches, `564` timed calls, zero round errors, zero
geometry-normalization failures, and a baseline-only `NOT_MEASURED`
before/after ratio. Synthetic 100/500/1000-wall cases are stress bounds and are
reported separately from the 44 real plans. The real-only sample is useful for
the actual imported wall-count range; the stress-inclusive file is the artifact
checked by `verify_baseline_benchmark.py`.

## Future after variant

Run an after variant only after its source freeze, using a new label and output
path. The same runner accepts explicit `--core-source` and `--importer-source`
paths, plus `--expected-core-sha` and `--expected-importer-sha`; keep the
baseline command and JSON immutable. A before/after ratio must be calculated by
a separate comparison step only after both complete artifacts exist.

Timing is detector-only (`detectSpacesForLevel` on a fixed normalized wall
graph). Timeout interruptions are not instrumented; round errors are counted
separately, so the baseline does not claim watchdog or timeout safety.
