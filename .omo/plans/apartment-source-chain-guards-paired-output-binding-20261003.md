# Apartment source-chain guards — paired output binding clarification

Resolved lane: gpt-5.6-sol / high.

`afterCanonicalExpectedParity` is currently a historical Lane-A baseline comparison, so intended p07 geometry changes make it false by design; keep it only as an observational delta field. The final binding gate must instead freeze the successful R4 50-case replay’s per-plan canonical outputs, then require the paired benchmark `after` variant to equal those fresh R4 hashes for every accepted case (and the same 6 calibration rejects), with same-version idempotence still separately true. Do not rewrite/drop the Lane-A mismatch list: retain it as source-attributed before→after geometry evidence, not a performance correctness gate.
