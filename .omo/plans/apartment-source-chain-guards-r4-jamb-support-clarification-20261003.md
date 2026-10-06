# R4 original jamb support clarification

This bounded clarification applies to b42fb1c50bab593950cb457583d0bd0e1fd7c1515ce2904a19df2dc8fc0fe0c4 and preserves every other acceptance gate, including p07 9/9 and at least 302/330 fixed probes.

Sol/high original-source preflight found multiple original wall envelopes at each p30 jamb. Therefore one support means the set of original footprints that exactly contain the same barrier witness, rather than exactly one wall record. No distance or semantic grouping threshold is added. The two sets must be disjoint. Choose the minimum barrier-to-centerline projection distance within each set; tied minima are permissible only when their contact coordinates coincide within the existing numerical epsilon. Differing tied contacts fail closed.

For original V15 SHA 7d2423fe84e481f778130834a590c8feea132a0cd565da45265c5a526229b950, left support is w6/w19/w52 and right support is w60/w67/w68. The chosen contacts are (10057.2,4319.7) and (11503.3,4319.7) mm. Left w6/w19 tie at the same point; right w68 is the unique minimum. The 1446.1mm host contains o28's original 1286.7mm interval with margins 85.0mm and 74.4mm, without clamping. No internal wall pier crosses the passage; w45 is outside the envelope, with 53.7mm residual. The local opening cluster is o2/o21/o22/o28, with o28 the unique full-span barrier ray.

Original source endpoints, retained contacts, relation keys, atomic rollback, ambiguity rejection, negative controls, provenance, and cluster-outside geometry gates remain mandatory. This is a physical support identity clarification, not permission to widen tolerances or bypass safety guards.

Derived preflight: /tmp/p30-opening-cluster-preflight.json, SHA 086848a4944ad9f24044b540f5baee8dd3b8150c0bfe33a2f643e0f9207b7573. A byte copy is preserved under product-final/r4/diagnostics/p30-original-jamb-support-preflight.json.
