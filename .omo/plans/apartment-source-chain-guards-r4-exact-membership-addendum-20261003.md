# R4 exact opening-source membership and pier addendum — corrected

Applies to b42fb1c50bab593950cb457583d0bd0e1fd7c1515ce2904a19df2dc8fc0fe0c4 and 3770840b61d27f1c52edbd1c2c24b880fce4d05e3634004759bafea7e871b80e. It preserves every earlier gate, especially p07 9/9 and at least 302/330 fixed probes. Raw p30 source remains V15 SHA 7d2423fe84e481f778130834a590c8feea132a0cd565da45265c5a526229b950.

## Exact source-trace membership

For each immutable original opening with finite non-degenerate `a/b` and finite positive `wallThickness`, construct its square-ended source trace rectangle: centerline `a..b`, lateral half-width `wallThickness/2`, and no longitudinal extension beyond either endpoint. Never use a capsule, angular budget, semantic distance, or new margin.

For a candidate full-span ray, build an undirected graph from same-type original `ray|pair|frame` openings. An edge exists only when the two immutable source trace rectangles have strictly positive-area intersection: separating-axis overlap is greater than the existing numerical epsilon on every rectangle axis. Boundary-only contact is not an edge. The candidate cluster is its complete connected component, not a radius query.

The component is admissible only when it contains exactly one ray (the candidate), at least one non-ray member, every other member is `pair` or `frame`, and every non-ray centerline’s longitudinal projection is wholly contained in the candidate raw `a..b` interval using only the existing numerical epsilon. If another ray, unsupported source kind, invalid geometry, or an out-of-span connected member occurs, reject the entire candidate branch without mutation.

Every non-ray member must additionally have an exact source-chain witness, so an overlapping independent different-axis opening is not silently suppressed. A witness is either:

(a) its centerline intersects another non-ray component member within both closed immutable source segments using the existing numerical epsilon; or

(b) it and another `frame` member are an exact translated-frame family: normalize endpoint direction deterministically (for example, lexicographic endpoint order), require equal directed displacement vectors within the existing numerical epsilon, equal positive source `wallThickness` within that epsilon, distinct non-collinear centerlines (absolute lateral translation greater than the existing numerical epsilon), and strictly positive-area intersection of their exact source trace rectangles.

Clause (b) deliberately does not require pure transverse translation or equal candidate-axis projection intervals. It uses exact repeated source geometry plus physical trace overlap, with no distance or angular allowance. If a nonparallel/offset member has neither witness, the component is ambiguous and the entire candidate branch fails closed.

This rule is source-backed for p30. Exact positive SAT overlap depths are o28-o2 245.619mm, o28-o21 107.973mm, o2-o22 86.543mm, and o21-o22 9.638mm. Across all original p30 door `ray|pair|frame` records, the component seeded by o28 is exactly `[o2,o21,o22,o28]`. o2 and o21 centerlines intersect inside both segments (t=0.812785, u=0.804269), satisfying (a). o21 and o22 both have directed displacement `[690,-40]`mm and source thickness 151.2mm; their translation is `[0,-141.8]`mm with longitudinal component `+8.206511861`mm and lateral component `-141.562329605`mm, and their exact trace rectangles overlap positively by 9.638mm, satisfying corrected clause (b). No pure-transverse or equal-projection claim is made.

A nearby opening whose longitudinal projection is contained and whose axis falls within the old 0.35m radius remains independent when its source trace rectangle is disjoint. If it overlaps the component but lacks exact witness (a) or (b), it makes the branch ambiguous and the ray override is rejected; it is never absorbed by a lateral or angular heuristic.

## Exact support, thickness, and pier rules

Jamb support remains the disjoint original support sets from clarification 3770840b. A barrier witness belongs to a support only when it lies in/on the square-ended immutable original wall footprint using the existing numerical epsilon. Select the nearest centerline projection; equal-distance ties are allowed only when the projected contacts coincide within that epsilon. Do not use a support-thickness similarity threshold.

`barrierThickness` must be finite and positive and is preserved exactly after unit conversion as the synthesized host thickness. Any unsupported value fails closed; it is never clamped. Raw o28 `a/b` must fit the selected host without clamping as already required.

An intermediate pier exists when any non-support immutable original wall footprint contains or crosses any interior point of the open candidate passage axis between raw `a/b`. Test the exact wall footprint, independent of wall angle. Do not use a 15-degree split, endpoint extension, or separate 80mm margin. Boundary-only/degenerate contact is ambiguous and fails closed. A wall whose footprint is disjoint from the open passage, including proven p30 w45 53.7mm residual, is not a pier.

## Fail-first coverage

1. Exact p30 fixture: component exactly o2/o21/o22/o28; winner o28; three provenance-accounted losers; selected jamb contacts `(10057.2,4319.7)` and `(11503.3,4319.7)`mm; raw 1286.7mm interval and thickness 270.8mm unchanged; no clamp.
2. Same longitudinal containment and old-lateral-budget proximity, but a disjoint different-axis trace rectangle: it remains outside the cluster and is not deduped.
3. Positive-overlap different-axis trace with neither in-segment intersection witness nor exact translated-frame-family witness: whole override branch rejects atomically and normal placement receives untouched source records.
4. Boundary-only rectangle contact, second connected ray, unsupported connected source kind, invalid/zero thickness, and connected out-of-span member: each rejects without partial DSU, source endpoint, relation-key, or provenance mutation.
5. Exact positives separately prove o2/o21 via in-segment centerline intersection and o21/o22 via equal directed displacement, equal thickness, distinct parallel centerlines, and positive trace overlap. Perturb either exact displacement vector or thickness beyond existing epsilon and remove every alternative witness to prove fail-closed. Also prove a collinear translated segment does not qualify as a frame family.
6. Shallow-angle wall footprint crossing the passage is a pier; parallel crossing footprint is a pier; an infinite-line intersection up to 80mm beyond a wall endpoint whose actual footprint is disjoint is not a pier.
7. Support walls with differing thicknesses but the same proven witness remain one support set; differing nearest tied contacts reject. Raw positive barrier thickness is preserved; invalid/out-of-range values reject rather than clamp.
8. All earlier retained-contact, relation-key, atomic rollback, provenance, cluster-outside geometry, p30 6/6, p07 9/9, per-seed no-loss, ≥302/330, exact surface overlap zero, undo/redo/save/reload, and browser gates remain unchanged.

## Stop condition

This addendum removes the WIP `max(0.25, expectedThickness+0.08)`, support `0.08m` thickness delta, barrier-thickness clamp, 15-degree pier split, and ±0.08m pier endpoint reach. Product freeze remains blocked until focused counterfactual tests prove these exact predicates. This artifact does not approve the current WIP or authorize candidate execution.
