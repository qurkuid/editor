# Apartment source-chain guards — union safety addendum 2026-10-03

Route: gpt-5.6-sol / high. Supplements bc6ff65c and e05dfd89; no gate weakening. Sol/high authored this contract in the read-only reviewer lane; parent saved the supplied text.

## 1. Union reason is explicit

Replace the shared boolean-only union decision with an internal reason-aware operation: `same-run-normalization` or `opening-host`. The DSU/root re-key logic stays shared, but retained-chain blocking applies only to `same-run-normalization`. Callers must consume the result; an opening placement may never be appended after a failed/unsupported union.

For a valid two-flank opening, opening-host semantics retain Lane A precedence. If its two roots are exactly the opposite outer roots of a retained relation, the opening union succeeds and only that internal protection relation is marked superseded before re-keying. Do not remove the bridge segment, opening, wall contributor, metric evidence, or public metadata. Output for this contradictory source combination must equal frozen Lane A geometry/hosting after stable-ID normalization; any pre-existing duplicate remains visible to the canonical metric and may not be suppressed. This exception does not authorize a new wall or source deletion.

If an opening-host union would make a different, non-superseded retained contact unrepresentable, return the importer’s existing fail-closed result for the document; never emit an opening attached to an unmerged flank and never silently discard that relation. Actual p07/o5 must not enter either conflict path.

## 2. Validate held-contact representability before every normal union

Before mutating `parent`, form the candidate member set and use the same longest-member projection used by materialization. For every active relation side owned by either root:

- the authored contact must remain within 1e-6 m of exactly one projected group extremum;
- multiple markers at that extremum are allowed only when their authored points match within 1e-6 m; preserve every relation identity and restore the coordinate once;
- if a contact becomes interior, matches neither extent, or distinct authored points compete for one extent, reject only this proposed normal union and leave both DSU groups/relations unchanged.

Do not freeze a source segment or coordinate globally. A far-side legal continuation such as p07 w20+w9 remains eligible because the bridge contact remains the opposite extent. A union that absorbs material across both sides of a held contact is safely blocked. Snap/weld keep the existing relation-owned checks; they receive all same-contact relation identities, not the first marker only.

DSU updates are atomic: perform all representability/conflict checks first; only then remove old root-pair keys, change parent, merge relation-id sets, and rebuild keys. Rejected unions must leave `parent`, `relationIdsByRoot`, blocked keys, and held provenance byte-equivalent. Input order must not change the accepted groups.

## 3. Focused fail-first additions

Add only these fixtures beyond the frozen eight:

1. **Opening precedence conflict:** A/C are valid opening flanks and also opposite roots of one retained relation. Assert union succeeds, opening parent/width/world interval/source metadata equal Lane A, bridge/source contributors remain, no stale held guard changes either endpoint, and canonical duplicate output equals Lane A rather than being hidden.
2. **Opening plus other relation:** opening union that keeps another held contact extremal succeeds and preserves all its relation identities; a variant that would interiorize that other contact fails the whole import before placement.
3. **Both-side absorption:** one legal far-side continuation merges; a later union that would put the authored contact inside the group is rejected while unrelated groups still merge.
4. **Competing extrema:** two nonabsorbable, nonmergeable bridge relations sharing one exact contact retain both identities; two distinct contact points competing for the same projected extent reject the union instead of first-match restoration.
5. **DSU order:** permute source-wall order and legal union order for two relations sharing/absorbing roots; accepted canonical geometry, blocked opposite pairs, openings, and relation contacts are invariant.

The existing adjacent-bucket endpoint fixture remains enabled. The competing fixture must use bridges that cannot merge under the 0.08 m thickness tolerance; identical collinear 0.12/0.13 bridges alone are insufficient.

## 4. Acceptance/evidence

- p07 exact V15 remains duplicate 0/length 0, four targeted probes, o5 world parity 0, and no authored contributor loss.
- Same-50 attribution remains relation-scoped. For every non-p07 change, record raw wall IDs, facing endpoint identities, bridge nonabsorbability, union reason, held-contact before/after/extremum proof, canonical duplicate delta, and opening/zone/surface parity. Unrelated geometry is strict parity.
- Add a counterfactual report for the generic exact-centerline pair rule: Lane A, Lane A + pair-local rule only, and final. Every changed pair must identify both source contributor sets and prove the pre-move endpoint already lay on the evaluated segment centerline within 1e-6 m. A derived-only contact without source ownership returns to Sol/high.
- Preserve 44 imported/6 strict scale rejects, per-case floor-hit loss 0, no new duplicate, exact stored Slab/Ceiling positive overlap 0, detector fixed gate, paired importer 1.25x gate, types/Biome/build/manual exposure, and owned browser Undo/Redo/save/reload/2D/real 3D/console gates.
- Separate manifests: Lane B geometry binds `space-detection.ts` frozen hash; concurrent `room-boundary.ts` diagnostic/manual-repair changes receive their own hash and tests. Diagnostic deltas cannot satisfy or invalidate importer geometry parity unless an explicit integration assertion proves the boundary diagnostics over the same final wall graph.

Stop and return to Sol/high if an opening conflict cannot preserve Lane A host output without dropping source evidence, if a held contact needs a split/new segment/global anchor, or if a relation cannot be represented by one straight merged group.
