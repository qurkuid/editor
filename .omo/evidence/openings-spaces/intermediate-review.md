# Intermediate source review

Read-only review by gpt-5.6-sol/high, source hash prefix 511ece61, 2026-09-30. These findings block the current candidate from release or browser regeneration.

1. Reuse one raw Hough result for normal and relaxed thickness passes. Recover only candidates rejected by the short-thin condition, not long or normally accepted structural lines.
2. Require connection to a retained structural endpoint, junction, or segment within 3*UP. Candidate-created gaps cannot provide their own independent anchor evidence. The current isolated candidate near source (447.38,325.12)-(459.63,337.37) is about 21 source pixels from retained structure.
3. Restore ordinary door thresholds and local separation. The current bright-run helper accepts an all-white image, so it cannot justify globally lowering the door hypothesis to 0.35 or bypassing gap separation. A bounded fixture-split exception needs independent clustered fixture and topology evidence.
4. Replace the 70*UP split threshold with physical parent/half width checks. The actual two-door parent gap is 66.98 source pixels, about 1472.5mm, and is currently excluded. Preserve fixture-split provenance and validate each half separately.

Current metrics: walls55, doors6, windows4, openings3, rooms12. The target source regression still fails on two merged OCR-label components. Negative checks must include isolated symbol lines, non-short candidate promotion, all-white fixture rejection, and ordinary low-score door rejection.
