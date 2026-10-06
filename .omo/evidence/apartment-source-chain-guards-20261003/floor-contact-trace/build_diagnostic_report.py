#!/usr/bin/env python3
from __future__ import annotations

import collections
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUTPUTS = ROOT / "outputs"
SOURCES = ROOT / "source-variants"
PLAN_IDS = {"p07": "3FO40C71IWG4", "p09": "3FO3YR6LHA15"}
VARIANTS = [
    "lane-a",
    "pair-local-only",
    "retained-only",
    "retained-no-move-guard",
    "retained-union-only",
    "r3",
    "r3-source-order-only",
    "r3-weld-fix-only",
    "r3-source-order-weld-fix",
]
TRACE_VARIANTS = {"r3": "r3-traced-v3", "r3-source-order-only": "r3-source-order-traced-v2"}
RAW_ROOT = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
DUPLICATE_HELPER = (
    REPO
    / ".omo/evidence/apartment-source-chain-guards-20261003/product-final/r3/replay-final/contained_duplicate_span_r3.py"
)


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return str(path.relative_to(REPO))


def case(variant: str, plan_id: str) -> dict[str, Any]:
    return load(OUTPUTS / variant / f"{plan_id}.json")


def probe_map(document: dict[str, Any]) -> dict[str, bool]:
    return {row["id"]: row["hit"] for row in document["probeRows"]}


def wall_key(wall: dict[str, Any]) -> tuple[float, ...]:
    return tuple(round(value, 12) for point in (wall["start"], wall["end"]) for value in point) + (
        round(wall["thickness"], 12),
    )


def semantic_projection(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "walls": [
            {
                "start": wall["start"],
                "end": wall["end"],
                "thickness": wall["thickness"],
                "frontSide": wall.get("frontSide"),
                "backSide": wall.get("backSide"),
            }
            for wall in document["walls"]
        ],
        "spaces": [
            {"polygon": space.get("polygon"), "holes": space.get("holes", [])}
            for space in document["spaces"]
        ],
        "slabs": [
            {"polygon": slab.get("polygon"), "holes": slab.get("holes", [])}
            for slab in document["slabs"]
        ],
        "probes": [
            {"id": row["id"], "worldPointM": row["worldPointM"], "hit": row["hit"]}
            for row in document["probeRows"]
        ],
        "counts": document["counts"],
    }


def events(document: dict[str, Any], operation: str) -> list[dict[str, Any]]:
    return [event for event in document["traceEvents"] if event.get("operation") == operation]


def source_diff(first: str, second: str) -> list[str]:
    first_lines = (SOURCES / f"{first}.ts").read_text().splitlines()
    second_lines = (SOURCES / f"{second}.ts").read_text().splitlines()
    return list(difflib.unified_diff(first_lines, second_lines, fromfile=first, tofile=second, lineterm=""))


spec = importlib.util.spec_from_file_location("contained_duplicate_span_r3", DUPLICATE_HELPER)
assert spec and spec.loader
duplicate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(duplicate_module)


summaries = {variant: load(OUTPUTS / variant / "summary.json") for variant in VARIANTS}
documents = {
    variant: {label: case(variant, plan_id) for label, plan_id in PLAN_IDS.items()}
    for variant in VARIANTS
}
trace_documents = {
    label: {plan: case(trace_variant, plan_id) for plan, plan_id in PLAN_IDS.items()}
    for label, trace_variant in TRACE_VARIANTS.items()
}

probe_matrix: dict[str, list[dict[str, Any]]] = {}
for label in PLAN_IDS:
    ids = list(probe_map(documents["lane-a"][label]))
    probe_matrix[label] = [
        {
            "id": probe_id,
            "hits": {
                variant: probe_map(documents[variant][label])[probe_id]
                for variant in [
                    "lane-a",
                    "pair-local-only",
                    "retained-only",
                    "r3",
                    "r3-source-order-only",
                    "r3-weld-fix-only",
                    "r3-source-order-weld-fix",
                ]
            },
        }
        for probe_id in ids
    ]

duplicate_metrics: dict[str, dict[str, Any]] = {}
for variant in [
    "lane-a",
    "pair-local-only",
    "retained-only",
    "r3",
    "r3-source-order-only",
    "r3-weld-fix-only",
    "r3-source-order-weld-fix",
]:
    matches = duplicate_module.contained_duplicate_spans(documents[variant]["p07"]["walls"])
    duplicate_metrics[variant] = {
        "pairCount": len(matches),
        "containedLengthM": sum(item["shortLengthM"] for item in matches),
    }

p07_r3_trace = trace_documents["r3"]["p07"]
p07_fixed_trace = trace_documents["r3-source-order-only"]["p07"]
p09_r3_trace = trace_documents["r3"]["p09"]
p09_fixed_trace = trace_documents["r3-source-order-only"]["p09"]

p09_relevant_events: dict[str, list[dict[str, Any]]] = {}
for label, document in [("r3", p09_r3_trace), ("r3-source-order-only", p09_fixed_trace)]:
    p09_relevant_events[label] = [
        event
        for event in document["traceEvents"]
        if set(event.get("segmentSources", [])) & {11, 30}
        or set(event.get("otherSources", [])) & {7, 11, 30}
    ]

p07_final_r3 = events(p07_r3_trace, "final-merged-segment")
p07_final_fixed = events(p07_fixed_trace, "final-merged-segment")
p09_final_r3 = events(p09_r3_trace, "final-merged-segment")
p09_final_fixed = events(p09_fixed_trace, "final-merged-segment")

raw_references: dict[str, Any] = {}
for label, indices in {"p07": [2, 24, 20], "p09": [7, 11, 30]}.items():
    raw_path = RAW_ROOT / f"{PLAN_IDS[label]}.json"
    raw = load(raw_path)
    raw_references[label] = {
        "path": rel(raw_path),
        "sha256": sha256(raw_path),
        "mmPerPx": raw["mmPerPx"],
        "imageSize": raw["imageSize"],
        "walls": [raw["walls"][index] for index in indices],
    }

order_diff = source_diff("r3", "r3-source-order-only")
weld_diff = source_diff("r3", "r3-weld-fix-only")
combined_diff = source_diff("r3", "r3-source-order-weld-fix")

assert sum(line.startswith("+") and not line.startswith("+++") for line in order_diff) == 4
assert sum(line.startswith("-") and not line.startswith("---") for line in order_diff) == 2
assert sum(line.startswith("-") and not line.startswith("---") for line in weld_diff) == 1
assert "relationMoveRejected" not in "\n".join(order_diff + weld_diff + combined_diff)

assert documents["r3"]["p07"]["counts"]["probeHits"] == 8
assert documents["r3"]["p09"]["counts"]["probeHits"] == 3
assert documents["r3-source-order-only"]["p07"]["counts"]["probeHits"] == 9
assert documents["r3-source-order-only"]["p09"]["counts"]["probeHits"] == 6
assert documents["r3-weld-fix-only"]["p07"]["counts"]["probeHits"] == 8
assert documents["r3-weld-fix-only"]["p09"]["counts"]["probeHits"] == 3
assert documents["r3-source-order-weld-fix"]["p07"]["counts"]["probeHits"] == 9
assert documents["r3-source-order-weld-fix"]["p09"]["counts"]["probeHits"] == 6

assert probe_map(documents["r3-source-order-only"]["p07"])["p07_3FO40C71IWG4-room-05"]
for probe_id in [
    "p09_3FO3YR6LHA15-room-01",
    "p09_3FO3YR6LHA15-room-03",
    "p09_3FO3YR6LHA15-room-04",
]:
    assert probe_map(documents["r3-source-order-only"]["p09"])[probe_id]

assert duplicate_metrics["r3-source-order-only"] == {"pairCount": 0, "containedLengthM": 0}
assert collections.Counter(wall_key(wall) for wall in documents["r3"]["p07"]["walls"]) == collections.Counter(
    wall_key(wall) for wall in documents["r3-source-order-only"]["p07"]["walls"]
)
assert [wall_key(wall) for wall in documents["r3"]["p07"]["walls"]] != [
    wall_key(wall) for wall in documents["r3-source-order-only"]["p07"]["walls"]
]

instrumentation_checks: dict[str, dict[str, bool]] = {}
for label in TRACE_VARIANTS:
    instrumentation_checks[label] = {}
    for plan in PLAN_IDS:
        instrumentation_checks[label][plan] = semantic_projection(documents[label][plan]) == semantic_projection(
            trace_documents[label][plan]
        )
        assert instrumentation_checks[label][plan]

assert len(events(p09_r3_trace, "retained-chain-discovered")) == 0
assert len(events(p09_r3_trace, "snap-pair-local-already-contact-rejected")) == 0
assert len(events(p09_fixed_trace, "retained-chain-discovered")) == 0
assert len(events(p09_fixed_trace, "snap-pair-local-already-contact-rejected")) == 0

report = {
    "schemaVersion": "apartment-floor-contact-trace-v1",
    "scope": "Read-only frozen R3 counterfactual diagnosis for p07 and p09; no production, raw, probe, or database mutation.",
    "finding": {
        "rootCause": "R3 iterates DSU groupMembers in union/root insertion order when materializing merged segments. That order feeds order-sensitive snap/weld and final space detection. Sorting groups by minimum source index and members ascending restores all five new p07/p09 probe losses.",
        "smallestFixForP07P09": "Sort DSU groups by their minimum source index and sort each group's members ascending before merged-segment materialization.",
        "separateR4Fix": "Removing only the weld exact-contact skip is compatible with the ordering repair but does not restore any p07/p09 loss by itself; it addresses other same-50 regressions.",
        "excludedCauses": [
            "pair-local already-contact guard: pair-local-only loses none of these probes; p09 emits zero guard events",
            "retained relation move rejection: disabling it does not recover p07/p09",
            "held-contact restoration: removing it does not recover p07/p09",
            "weld exact-contact skip alone: p07 remains 8/9 and p09 remains 3/7",
        ],
    },
    "inputs": {
        "runner": {"path": rel(ROOT / "run_two_plan_counterfactual.ts"), "sha256": sha256(ROOT / "run_two_plan_counterfactual.ts")},
        "sourceProbes": summaries["r3"]["immutableInputs"]["sourceProbes"],
        "raw": raw_references,
        "frozenDependencies": documents["r3"]["p07"]["frozenDependencies"],
        "sources": {
            variant: {"path": summaries[variant]["source"]["path"], "sha256": summaries[variant]["source"]["sha256"]}
            for variant in VARIANTS
        },
        "duplicateHelper": {"path": rel(DUPLICATE_HELPER), "sha256": sha256(DUPLICATE_HELPER)},
    },
    "results": {
        "counts": {
            variant: {label: documents[variant][label]["counts"] for label in PLAN_IDS}
            for variant in VARIANTS
        },
        "probeMatrix": probe_matrix,
        "p07ContainedDuplicateSpan": duplicate_metrics,
    },
    "causalTrace": {
        "p07": {
            "rawWalls": raw_references["p07"]["walls"],
            "retainedChainR3": events(p07_r3_trace, "retained-chain-discovered"),
            "retainedChainSorted": events(p07_fixed_trace, "retained-chain-discovered"),
            "blockedUnionR3": events(p07_r3_trace, "union-rejected-retained-chain-opposite-roots"),
            "blockedUnionSorted": events(p07_fixed_trace, "union-rejected-retained-chain-opposite-roots"),
            "r3FirstGroups": p07_final_r3[:10],
            "sortedFirstGroups": p07_final_fixed[:10],
            "wallMultisetEqual": True,
            "wallSequenceEqual": False,
            "interpretation": "The retained w2-w24-w20 relation and its blocked w2/w20 normal union are unchanged. The physical wall multiset is unchanged, but deterministic source ordering changes the emitted sequence; frozen detectSpaces then restores balcony room-05 and produces seven spaces/slabs.",
        },
        "p09": {
            "rawWalls": raw_references["p09"]["walls"],
            "r3RelevantSnapEvents": p09_relevant_events["r3"],
            "sortedRelevantSnapEvents": p09_relevant_events["r3-source-order-only"],
            "r3GroupW11W30": [event for event in p09_final_r3 if set(event["sourceIndices"]) == {11, 30}],
            "sortedGroupW11W30": [event for event in p09_final_fixed if set(event["sourceIndices"]) == {11, 30}],
            "retainedChainEventCount": {"r3": 0, "sorted": 0},
            "pairLocalAlreadyContactEventCount": {"r3": 0, "sorted": 0},
            "interpretation": "R3 materializes [w30,w11] after w7 and applies a second-pass snap from y=0.3007623048 to y=0.3154838602 against w7. Source ordering materializes [w11,w30] earlier and keeps y=0.3007623048, restoring room-01, room-03, and room-04.",
        },
    },
    "counterfactualIntegrity": {
        "r3ToOrderOnlyDiff": order_diff,
        "r3ToWeldOnlyDiff": weld_diff,
        "r3ToCombinedDiff": combined_diff,
        "relationMoveRejectedPreserved": True,
        "snapExactContactGuardPreserved": True,
        "traceInstrumentationSemanticEquality": instrumentation_checks,
    },
}

(ROOT / "diagnostic-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")

markdown = f"""# R3 p07/p09 floor contact regression diagnosis

## Finding

The p07 and p09 R3 losses come from DSU group iteration order at merged-segment materialization. R3 emits `groupMembers` in retained-root insertion order; the counterfactual sorts groups by minimum source index and each group's members ascending. That one change restores p07 from 8/9 to 9/9 probes and 6 to 7 slabs, and p09 from 3/7 to 6/7 probes and 3 to 4 slabs.

The weld exact-contact deletion alone leaves p07 at 8/9 and p09 at 3/7. It is part of the approved R4 repair for other same-50 cases, but it is not the causal repair for these two plans. `relationMoveRejected` and the snap exact-contact guard stay unchanged.

## Frozen reproduction

| Variant | p07 probes | p07 spaces/slabs | p09 probes | p09 spaces/slabs |
| --- | ---: | ---: | ---: | ---: |
| Lane A | 5/9 | 5/5 | 6/7 | 4/4 |
| Pair-local only | 6/9 | 6/6 | 6/7 | 4/4 |
| Retained only | 7/9 | 5/5 | 3/7 | 3/3 |
| R3 | 8/9 | 6/6 | 3/7 | 3/3 |
| R3 + source order only | 9/9 | 7/7 | 6/7 | 4/4 |
| R3 + weld deletion only | 8/9 | 6/6 | 3/7 | 3/3 |
| R3 + source order + weld deletion | 9/9 | 7/7 | 6/7 | 4/4 |

The source-order-only counterfactual restores p07's earlier room-02/03/04 gains, room-09, and the newly lost balcony room-05. It restores p09 room-01/03/04; room-02 remains the pre-existing miss.

## Operation trace

- p07 keeps the same source-backed retained relation `w2.end -> w24.start`, `w24.end -> w20.start` and the same rejected normal union `(2,20)` before and after sorting. Its final physical wall multiset is identical, while its emitted sequence changes. Frozen space detection returns seven spaces/slabs and room-05 after ordering.
- p09 emits zero retained-chain events and zero pair-local already-contact rejections in both runs. In R3, `[w30,w11]` appears after `w7`; its endpoint first moves from y=0.2681838602 to 0.3007623048, then a second pass moves it to 0.3154838602 against `w7`. With source ordering, `[w11,w30]` appears earlier and remains at 0.3007623048. That restores room-01/03/04.
- Instrumented runs match their uninstrumented counterparts for wall sequence/coordinates/thickness, space and slab rings, probe outcomes, and counts for both p07 and p09.

## Duplicate-span guardrail

The frozen canonical duplicate helper reports p07 Lane A at 3 pairs / 1.2844009967 m, R3 at 0 / 0 m, source-order-only at 0 / 0 m, and combined R4 at 0 / 0 m. Sorting preserves the R3 duplicate correction.

## Evidence identities

- Frozen R3 source: `{summaries['r3']['source']['sha256']}`
- Source-order-only source: `{summaries['r3-source-order-only']['source']['sha256']}`
- Combined order+weld source: `{summaries['r3-source-order-weld-fix']['source']['sha256']}`
- Runner: `{sha256(ROOT / 'run_two_plan_counterfactual.ts')}`
- Raw p07: `{raw_references['p07']['sha256']}`
- Raw p09: `{raw_references['p09']['sha256']}`
- Source probes: `{summaries['r3']['immutableInputs']['sourceProbes']['sha256']}`
- Frozen duplicate helper: `{sha256(DUPLICATE_HELPER)}`

Machine-readable per-seed results, complete trace events, raw endpoints, diffs, and dependency hashes are in `diagnostic-report.json` and the referenced `outputs/` files.
"""
(ROOT / "diagnostic-report.md").write_text(markdown)

print(json.dumps({
    "report": {"path": rel(ROOT / "diagnostic-report.json"), "sha256": sha256(ROOT / "diagnostic-report.json")},
    "markdown": {"path": rel(ROOT / "diagnostic-report.md"), "sha256": sha256(ROOT / "diagnostic-report.md")},
    "checks": {
        "p07SourceOrderProbeHits": documents["r3-source-order-only"]["p07"]["counts"]["probeHits"],
        "p09SourceOrderProbeHits": documents["r3-source-order-only"]["p09"]["counts"]["probeHits"],
        "p07SourceOrderDuplicatePairs": duplicate_metrics["r3-source-order-only"]["pairCount"],
        "instrumentationSemanticEquality": instrumentation_checks,
    },
}, indent=2))
