# Current detector performance evidence

Sol/high reviewer `/root/zone_plan` approved replacing the unavailable historical ratio gate with explicitly scoped current-source latency evidence. `timing-recovery/sha-recovery-audit.json` records five failed evidence-only reconstructions and 36 Git commits: none matched the historical `4dc5a167...` source. The original <=1.25x ratio remains UNVERIFIED.

The final saved measurement is `timing-recovery/current-detector-benchmark-0b926754.json`, recorded at 2026-10-02T23:59:26.030Z. The same 44 imported graphs received two warmups and 12 measured calls each, for 528 measured calls. Per-call median: 0.779375 ms; p95: 1.828792 ms; max: 3.12575 ms; errors: 0; geometry drift: 0. The per-case median sum of 36.631211 ms represents one representative pass. The 447.723258 ms total is the 528-call accumulated detector time, not one batch latency.

The earlier review message used an earlier timing sample (median: 0.835 ms; p95: 1.965 ms; max: 3.309 ms; per-case median sum: 38.725 ms). Those values are review history, not the final saved measurement; they must not be mixed with its recordedAt or claimed as the saved JSON. The approved evidence method and limitations remain the same.

No interrupting timeout was instrumented. Report observed maximum and zero errors, not timeout protection. Tested graphs have 21–84 walls; larger-graph scalability and historical relative latency remain unverified. Core source SHA stays `0b92675436829c6fbde644544309a125485433c8c94669b12d92825f63bcbe11`.
