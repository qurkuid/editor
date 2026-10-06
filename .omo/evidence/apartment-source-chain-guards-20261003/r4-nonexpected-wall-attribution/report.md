# R4 non-p07/p30 changed-wall source attribution

## Outcome

Both remaining canonical-plan deltas are source-supported. Neither requires a raw-duplicate allowance, a tolerance increase, or an inferred wall.

- **p35 `3FO3YCX91KCS`**: the final `73 -> 74` wall change is a retained-source/contact cluster activation already present in R3. R4 keeps the count at 74 and makes the winning source intersection deterministic. The local horizontal contact changes from raw `w12 × w32` in R3 to raw `w12 × w74` in R4.
- **p47 `3FO3Y6TBLWT1`**: the final `57 -> 58` wall change is a compact non-parallel corner/split cluster activation already present in R3. R4 keeps the count at 58 and changes the split winner from raw `w53 × w56` to raw `w52 × w56` through source-index-stable materialization order.
- The removed R3 weld exact-contact skip is **not the direct cause** of either remaining delta. That removed check exists only in the near-parallel `weldDanglingEnds` branch. Every changed R4 endpoint below is an immutable raw endpoint or a recomputed non-parallel raw-line intersection. The R4 exact-contact guard in `snapJunctions` remains in place.

## Method and immutable inputs

The analysis canonicalizes every output wall as orientation-independent `(start.x, start.y, end.x, end.y, thickness)` at 12 decimal places, computes exact multisets for Lane A/R3/R4, converts raw candidate15 millimetres with the frozen importer frame, and recomputes raw-line intersections. Assertions use `1e-9 m` except two p47 coordinates serialized after earlier arithmetic (`2e-5 m` and `5e-5 m`).

The executable analysis is `analyze.py`; its generated complete multiset and raw geometry record is `attribution.json`.

| Plan | Lane A SHA-256 | R3 SHA-256 | R4 SHA-256 | raw candidate15 SHA-256 |
|---|---|---|---|---|
| p35 | `d5056f4d1988cb3ec4b33cc6b3b41eb86202ef9ee697aea3857e5cbc69508eaf` | `a8398b8d28f54fae7d2425e8f070966afc24521fca57e4ec989d8a30ec933537` | `205d61bd5b7642ec0f6130b6f289cdc6e8fbdd751a8f0d28fa8079f857e0e353` | `27a7fa367023d843826a5d76e92049551a321c83ab30ff708183109eb020a549` |
| p47 | `00c58353b52b305b71232a36f281508f2419c7f28c271c1d73a46a1938784b3d` | `3173477cce418a974c0dd287ffae60722a76d44ed67f426f67f922b467da71ea` | `91023766a684f53721225b67e92bec072776b5412ee5fdfbe9f842cbba5faa2c` | `82f3ffe17e230970393bdb762725fbf6033f8dde106a575a547670dab1721aa0` |

Frozen importer SHA-256: R3 `d66fb5f94c65a61632fedac01477d086cae331e0204650b900f0d7910d8cad2f`; R4 `5507e2d16586ec1068799d0bfa64788c4958f71ad26889cdbe03cb0e8b35901a`.

## p35 exact Lane A to R4 multiset

Lane A-only (`4` walls):

| start | end | th |
|---|---|---:|
| `[-5.890317318599, 3.603421787601]` | `[-1.355327142812, 3.603421787601]` | `0.2708` |
| `[-1.573315844258, 4.997521787601]` | `[-1.465017318599, 4.304921787601]` | `0.2708` |
| `[-1.573315844258, 4.997521787601]` | `[2.752782681401, 4.997521787601]` | `0.2580` |
| `[-1.465017318599, 4.304921787601]` | `[-1.355327142812, 3.603421787601]` | `0.2708` |

R4-only (`5` walls):

| start | end | th | raw support |
|---|---|---:|---|
| `[-5.890317318599, 3.603421787601]` | `[-1.354601871566, 3.603421787601]` | `0.2708` | `w12.start -> w12 × w74` |
| `[-1.465017318599, 4.304921787601]` | `[-1.465017318599, 4.997521787601]` | `0.2708` | exact raw `w37` run |
| `[-1.465017318599, 4.304921787601]` | `[-1.355327142812, 3.603421787601]` | `0.2482` | raw `w10.start -> w10 × w12`, retaining raw `w10` thickness |
| `[-1.465017318599, 4.997521787601]` | `[2.752782681401, 4.997521787601]` | `0.2580` | `w16.start -> w16 × w38`, retaining raw `w16` thickness |
| `[-1.354601871566, 3.603421787601]` | `[-1.335017318599, 4.265021787601]` | `0.2708` | `w12 × w74 -> w74 × w75`, retaining raw `w74` thickness |

The Lane A top corner `[-1.573315844258, 4.997521787601]` is exactly raw `w10 × w16`; the Lane A lower corner `[-1.355327142812, 3.603421787601]` is exactly raw `w10 × w12`. R3 already replaces the merged/thick Lane A representation with the native `w10`, `w37`, and `w74` contributors and raises the count from 73 to 74. R4 does not add another wall. It changes the local competing split from exact `w12 × w32 = [-1.354770765555, 3.603421787601]` to exact `w12 × w74 = [-1.354601871566, 3.603421787601]`, while four unrelated R3 endpoint shifts return to their exact Lane A coordinates. The frozen snapshots do not isolate source-order sorting from weld-skip removal for those four canceled intermediate shifts; they are absent from the final Lane A-to-R4 delta and need no final source waiver.

**Cause classification:** retained source-chain/contact cluster activation explains the persistent Lane A-to-R4 topology. Source-index ordering explains the R3-to-R4 local split winner. The near-parallel exact-snap/global-weld branch is excluded as the direct source of the final Lane A-to-R4 multiset because the full topology change already exists in R3; this read-only trace does not assign the four canceled R3-only shifts between the two combined R4 repairs.

## p47 exact Lane A to R4 multiset

Lane A-only (`5` walls):

| start | end | th |
|---|---|---:|
| `[2.917613966905, 1.622109311270]` | `[4.675513966905, 1.622109311270]` | `0.2582` |
| `[4.675513966905, 1.622109311270]` | `[5.199013966905, 1.098609311270]` | `0.2683` |
| `[4.979113966905, -0.085590688730]` | `[4.979113966905, 1.318509311270]` | `0.1506` |
| `[5.199013966905, 1.098609311270]` | `[8.024557035479, -1.726933757304]` | `0.2683` |
| `[5.988137126927, -3.840703473552]` | `[7.986013966905, -1.914190688730]` | `0.2683` |

R4-only (`6` walls):

| start | end | th | raw support |
|---|---|---:|---|
| `[2.917613966905, 1.622109311270]` | `[4.674913966905, 1.622109311270]` | `0.2582` | `w19.start -> w19 × w33` |
| `[4.674913966905, 1.622109311270]` | `[5.046713966905, 1.149009311270]` | `0.2468` | `w19 × w33 -> w52 × w53`; `.2468` source cluster |
| `[4.979113966905, -0.085590688730]` | `[4.979113966905, 1.235027493088]` | `0.1506` | `w14 × w25 -> w53 × w25`; raw `w25` thickness |
| `[5.036734331796, 1.260388946378]` | `[5.198266665629, 1.098856612546]` | `0.2683` | same-run `w59/w66`: `w56 × w66 -> w52 × w66`; line from `w66`, max thickness from `w59` |
| `[5.199013966905, 1.098609311270]` | `[8.100967025494, -1.803343747320]` | `0.2683` | `w11.start -> w9 × w11` |
| `[5.988137126927, -3.840703473552]` | `[8.100967025494, -1.803343747320]` | `0.2683` | `w9 × w37 -> w9 × w11` |

The far corner shared by the last two walls is the exact non-parallel raw intersection `w9 × w11 = [8.100967025494, -1.803343747320]`. The compact added wall is also fully raw-backed: `w59` and `w66` are same-run traces only `0.0005 m` apart; the merged output uses the slightly longer `w66` centerline and the maximum member thickness `0.2683` from `w59`, exactly matching the frozen merge rule.

R3 already produces all far-corner and vertical-contact changes and raises the count from 57 to 58. R4 only replaces three `.2468` cluster segments. R3 chooses `w53 × w56 = [5.016047443612, 1.188053641130]` (serialized output within `0.000017 m`); R4 chooses the exact `w52 × w56 = [5.008498068804, 1.161655938087]`. This is the direct signature of deterministic source order deciding the overlapping junction-cut cluster.

**Cause classification:** non-parallel corner/split cluster activation explains the persistent Lane A-to-R4 topology. Source-index ordering explains the R3-to-R4 split winner. The near-parallel exact-snap/global-weld branch is excluded as the direct source of this multiset.

## Frozen source linkage and stop condition

- R4 materializes groups in minimum-source-index order and members in ascending source index at `apt-vector-scene.ts:1021-1024`.
- Merged centerline reference and maximum source thickness are selected at `apt-vector-scene.ts:1025-1041`.
- Overlapping junction contacts are clustered and choose a deterministic `cut.order` winner at `apt-vector-scene.ts:1376-1427`.
- The retained exact-contact guard is only in the near-parallel snap branch at `apt-vector-scene.ts:1522-1529`; non-parallel corner/tee intersections run at `apt-vector-scene.ts:1552-1573`.
- The removed R3 weld exact-contact skip was in the near-parallel weld branch; R4's non-parallel weld intersections are handled separately at `apt-vector-scene.ts:1647-1668`.

All two non-p07/p30 changed plans named by the final R4 parity audit are accounted for by immutable raw endpoints or exact raw-line intersections. No further causal replay is required for source attribution.

## Evidence hashes

- `analyze.py`: `9e27b20d8111c7e2796b10f517dc071d5b63e9505a21ac1566af1db4382ea916`
- `attribution.json`: `14a35310f9a7bbd440d5c18020b305bb3762781df58b844e57832cc076b006b6`
