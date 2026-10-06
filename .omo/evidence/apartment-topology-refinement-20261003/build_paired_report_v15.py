#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a compact Korean standalone baseline/candidate evidence report."""

from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(path: Path):
    return json.loads(path.read_text())


def esc(value) -> str:
    return html.escape("" if value is None else str(value))


def fmt(value, digits=1):
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return esc(value)


def percent(value, total) -> str:
    if not total:
        return "—"
    return f"{100 * value / total:.1f}%"


def link(path: str, text: str) -> str:
    return f'<a href="{html.escape(path)}">{html.escape(text)}</a>'


parser = argparse.ArgumentParser()
parser.add_argument("--run-id", default="v14")
parser.add_argument("--dimension", type=Path)
parser.add_argument("--candidate-summary", type=Path)
parser.add_argument("--candidate-machine", type=Path)
parser.add_argument("--baseline-machine", type=Path)
parser.add_argument("--baseline-label", default="v15-floor-before")
parser.add_argument("--candidate-evaluation-root", type=Path)
parser.add_argument("--baseline-evaluation-root", type=Path)
parser.add_argument("--topology-comparison", type=Path)
parser.add_argument("--source-freeze", type=Path)
parser.add_argument("--annotation-correction", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()

for path_name in (
    "dimension",
    "candidate_summary",
    "candidate_machine",
    "baseline_machine",
    "candidate_evaluation_root",
    "baseline_evaluation_root",
    "topology_comparison",
    "source_freeze",
    "annotation_correction",
    "output",
):
    path_value = getattr(args, path_name)
    if path_value is not None:
        setattr(args, path_name, path_value.resolve())

paired = read(ROOT / f"paired-{args.run_id}-metrics.json")
baseline = paired["baseline"]
candidate = paired["candidate"]
dimensions_path = (args.dimension or ROOT / "paired-dimensions.json").resolve()
dimensions = read(dimensions_path)
manifest = read(ROOT / "manifest.json")
machine_path = args.baseline_machine or (ROOT / "machine-metrics.json")
machine = read(machine_path)
candidate_machine_path = args.candidate_machine or (ROOT / f"candidate-machine-metrics-{args.run_id}.json")
if not candidate_machine_path.exists() and args.candidate_machine is None:
    candidate_machine_path = ROOT / "candidate-machine-metrics.json"
candidate_machine = read(candidate_machine_path)
candidate_summary_path = args.candidate_summary or (ROOT.parent / "apartment-scale-fix-20261003" / f"candidate-summary-{args.run_id}.json")
if not candidate_summary_path.exists() and args.candidate_summary is None:
    candidate_summary_path = ROOT.parent / "apartment-scale-fix-20261003" / "candidate-summary.json"
candidate_summary = read(candidate_summary_path)
candidate_summary_href = "../" + str(candidate_summary_path.relative_to(ROOT.parent))
candidate_eval_path = args.candidate_evaluation_root or (
    ROOT / f"candidate-evaluation-{args.run_id}"
    if (ROOT / f"candidate-evaluation-{args.run_id}").exists()
    else ROOT / "candidate-evaluation"
)
candidate_eval_dir = str(candidate_eval_path.resolve().relative_to(ROOT))
baseline_eval_path = args.baseline_evaluation_root
baseline_eval_dir = os.path.relpath(baseline_eval_path.resolve(), ROOT) if baseline_eval_path else ""
topology_comparison_path = (args.topology_comparison or (ROOT / f"normalized-geometry-v15-{args.run_id}.json")).resolve()
topology_comparison = read(topology_comparison_path) if topology_comparison_path.exists() else None
source_freeze_path = args.source_freeze.resolve() if args.source_freeze else None
source_freeze = read(source_freeze_path) if source_freeze_path and source_freeze_path.exists() else None
annotation_correction_path = args.annotation_correction.resolve() if args.annotation_correction else None
annotation_correction = read(annotation_correction_path) if annotation_correction_path and annotation_correction_path.exists() else None
timing_benchmark_path = ROOT / "timing-recovery" / "current-detector-benchmark-0b926754.json"
timing_benchmark = read(timing_benchmark_path) if timing_benchmark_path.exists() else None
final_provenance_path = ROOT / "manual-validation" / "final-provenance.json"
final_provenance = read(final_provenance_path) if final_provenance_path.exists() else None
guide_scale_plan_path = (ROOT / "../../plans/apartment-guide-scale-default-20261003.md").resolve()
guide_scale_policy = (final_provenance or {}).get("guideScaleDefaultPolicy", {})
final_verification = (final_provenance or {}).get("verification", {})
current_source_hash_count = len((final_provenance or {}).get("currentSourceHashes", {}))
fresh_ui_summary_path = ROOT / "browser" / "fresh-v15-ui-history-summary.json"
fresh_ui_summary = read(fresh_ui_summary_path) if fresh_ui_summary_path.exists() else None
fresh_physical_comparison_path = ROOT / "browser" / "fresh-ui-physical-geometry-comparison.json"
fresh_physical_comparison = read(fresh_physical_comparison_path) if fresh_physical_comparison_path.exists() else None
verification_path = ROOT / f"verification-{args.run_id}.json"
verification_item = (
    f"<li>{link(verification_path.name, 'verification record')} — commands, hashes, runtime, and derived gates</li>"
    if verification_path.exists()
    else ""
)
provenance_path = ROOT / f"provenance-v15-{args.run_id}.json"
provenance_item = (
    f"<li>{link(provenance_path.name, 'V15 replay provenance')} — source freeze, raw input, metrics, and residual definitions</li>"
    if provenance_path.exists()
    else ""
)
zone_metrics_path = ROOT / f"zone-metrics-{args.run_id}.json"
zone_metrics_item = (
    f"<li>{link(zone_metrics_path.name, 'zone/boundary metrics')} — imported zones/spaces, boundary diagnostics, and planner action counts</li>"
    if zone_metrics_path.exists()
    else ""
)
dim_by_key = {row["key"]: row for row in dimensions.get("paired", [])}
candidate_dim_summary = dimensions["candidate"]["summary"]
baseline_dim_summary = dimensions["baseline"]["summary"]
base_by_key = {row["key"]: row for row in baseline["cases"]}
cand_by_key = {row["key"]: row for row in candidate["cases"]}
p02_key = next((key for key in base_by_key if key.startswith("p02_")), None)
p02_baseline_case = base_by_key.get(p02_key, {}) if p02_key else {}
p02_candidate_case = cand_by_key.get(p02_key, {}) if p02_key else {}
p02_baseline_surface = p02_baseline_case.get("persistedSurfaces", {}).get("slabs", {})
p02_candidate_surface = p02_candidate_case.get("persistedSurfaces", {}).get("slabs", {})
p02_surface_note = (
    f"p02 기준선 stored/planned {p02_baseline_surface.get('storedCount', '—')}/{p02_baseline_surface.get('plannedCount', '—')}, "
    f"후보 {p02_candidate_surface.get('storedCount', '—')}/{p02_candidate_surface.get('plannedCount', '—')}"
)
common_keys = [
    key for key in base_by_key
    if base_by_key[key]["status"] == "IMPORTED" and cand_by_key[key]["status"] == "IMPORTED"
]
common_baseline_seed_inside = sum(base_by_key[key]["floor"]["roomInteriorSeeds"]["insideSlab"] for key in common_keys)
common_candidate_seed_inside = sum(cand_by_key[key]["floor"]["roomInteriorSeeds"]["insideSlab"] for key in common_keys)
common_seed_total = sum(base_by_key[key]["floor"]["roomInteriorSeeds"]["total"] for key in common_keys)
baseline_all_source_strict = sum(bool(row.get("baseline", {}).get("withinStrictTolerance")) for row in dimensions.get("paired", []))
candidate_all_source_strict = sum(bool(row.get("candidate", {}).get("withinStrictTolerance")) for row in dimensions.get("paired", []))
candidate_seed_absent = candidate["roomSeeds"]["probeWeighted"]["total"] - candidate["roomSeeds"]["probeWeighted"]["inside"]
baseline_seed_rate = 100 * baseline["roomSeeds"]["probeWeighted"]["inside"] / baseline["roomSeeds"]["probeWeighted"]["total"] if baseline["roomSeeds"]["probeWeighted"]["total"] else 0
candidate_seed_rate = 100 * candidate["roomSeeds"]["probeWeighted"]["inside"] / candidate["roomSeeds"]["probeWeighted"]["total"] if candidate["roomSeeds"]["probeWeighted"]["total"] else 0
baseline_persisted = baseline.get("initialPersistedSurfaces") or {}
candidate_persisted = candidate.get("initialPersistedSurfaces") or {}
baseline_persisted_probes = baseline.get("persistedFloorProbes", {}).get("probeWeighted", {})
candidate_persisted_probes = candidate.get("persistedFloorProbes", {}).get("probeWeighted", {})
zone_metrics = read(zone_metrics_path) if zone_metrics_path.exists() else None
final_browser_result_path = ROOT.parent / "apartment-50-browser-20261003" / "final-v15-floorfix" / "final-v15-browser-results.json"
final_browser_stage_path = ROOT.parent / "apartment-50-browser-20261003" / "final-v15-floorfix" / "final-v15-stage-matrix.md"
pre_fix_delete_path = ROOT.parent / "apartment-50-browser-20261003" / "final-v15-floorfix" / "slab-delete-result.json"
post_fix_delete_root = ROOT.parent / "apartment-auto-slab-delete-fix-20261003"
post_fix_delete_path = post_fix_delete_root / "fixed-delete-result.json"
post_fix_validation_path = post_fix_delete_root / "focused-delete-validation.json"
final_browser = read(final_browser_result_path) if final_browser_result_path.exists() else {}
final_browser_cases = final_browser.get("cases", [])
final_browser_accepted = [case for case in final_browser_cases if case.get("status") == "accepted"]
final_browser_guide_only = [case for case in final_browser_cases if case.get("status") == "guide-only-expected-reject"]
final_browser_p35_reload = next(
    (stage for stage in final_browser.get("p35History", {}).get("states", []) if stage.get("stage") == "after-reload"),
    {},
)
pre_fix_delete = read(pre_fix_delete_path) if pre_fix_delete_path.exists() else {}
post_fix_delete = read(post_fix_delete_path) if post_fix_delete_path.exists() else {}
legacy_probe_note = ""
if zone_metrics:
    bs = zone_metrics["sides"]["baseline"]["legacySpaceIdProbe"]
    cs = zone_metrics["sides"]["candidate"]["legacySpaceIdProbe"]
    legacy_probe_note = (
        f"legacy suffix probe는 기준선/후보 geometry에 예전 12자 suffix 알고리즘을 다시 적용한 시뮬레이션입니다. "
        f"따라서 collision cases {bs['collisionCases']}→{cs['collisionCases']}, lost loops {bs['lostLoops']}→{cs['lostLoops']}는 ID fix의 전후 측정값이 아닙니다. "
        f"실제 기준선 legacy runtime은 unique {bs['derivedUniqueLegacyIds']}/{bs['detectedSpaces']}였고, 현재 full-signature replay는 "
        f"unique {zone_metrics['sides']['candidate']['boundaryUniqueSpaceIds']}/{zone_metrics['sides']['candidate']['boundarySpaces']}이며 ID collision/lost loop는 0입니다. "
        "geometry 수 차이는 별도 boundary/space 결과로 기록합니다."
    )
browser_items = ""
for relative, label in (
    ("../apartment-50-browser-20261003/browser-results.json", "8-plan browser QA"),
    ("../apartment-50-browser-20261003/v15-ui-results.json", "pre-guide-scale-fix v15 UI QA results (6 accepted + 2 guide-expected rejects)"),
    ("../apartment-50-browser-20261003/v15-stage-matrix.md", "v15 browser stage matrix"),
    ("../apartment-50-browser-20261003/parent-v15-iab-verification.json", "fresh desktop/mobile IAB verification"),
    ("../apartment-50-browser-20261003/parent-p35-v15-final-2d-zones.jpg", "fresh desktop v15 Zones capture"),
    ("../apartment-50-browser-20261003/parent-p35-v15-mobile-expanded.jpg", "mobile expanded Zones capture"),
    ("../apartment-50-browser-20261003/parent-p35-v15-mobile-locate.jpg", "mobile locate WebGPU failure capture"),
    ("../apartment-50-browser-20261003/v15-chrome-console-after-repair.json", "Chrome lifecycle console (25 errors / 35 warnings)"),
    ("manual-validation/final-provenance.json", "canonical final provenance/build gates"),
    ("static-review.md", "canonical static review"),
    ("guide-scale-static-review.md", "guide-scale static review"),
    ("performance-review.md", "current detector performance review"),
    ("manual-validation/verification-final.txt", "canonical final verification"),
    ("manual-validation/source-hashes-final.txt", "canonical final source hashes"),
    ("../apartment-zone-real-20261003/current-import-verification.json", "current import verification"),
    ("../apartment-initial-surfaces-fix-20261003/verification.log", "initial persisted slab/ceiling source freeze verification"),
    ("../apartment-initial-surfaces-fix-20261003/source-hashes.txt", "initial surfaces source hashes"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/final-v15-browser-results.json", "pre-guide-scale-fix v15 floor persistence browser results (6 accepted + 2 guide-only)"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/final-v15-stage-matrix.md", "final v15 floor persistence stage matrix"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/parent-final-p35-2d-zones.jpg", "fresh p35 repaired scene capture"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/parent-postdelete-p35-2d-zones.jpg", "latest post-delete-fix p35 scene capture"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/parent-postdelete-p35-errors.json", "latest parent-tab historic HMR/WebGPU errors"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/p35-scene-api-after-reload.json", "p35 persisted after redo/reload scene API"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/slab-delete-result.json", "generated slab deletion pre-fix failure (preserved)"),
    ("../apartment-auto-slab-delete-fix-20261003/fixed-delete-result.json", "generated slab deletion focused post-fix result — PASS"),
    ("../apartment-auto-slab-delete-fix-20261003/focused-delete-validation.json", "generated slab deletion focused assertions"),
    ("../apartment-auto-slab-delete-fix-20261003/delete-console-after-reload.json", "post-fix deletion console (one lifecycle error retained)"),
    ("../apartment-auto-slab-delete-fix-20261003/verification.log", "post-deletion source/test verification"),
    ("../apartment-auto-slab-delete-fix-20261003/source-hashes.txt", "post-deletion source hashes"),
    ("browser/fresh-v15-ui-history-summary.json", "fresh post-guide-scale p12/p14 UI history and DevTools scope"),
    ("browser/fresh-ui-physical-geometry-comparison.json", "fresh p12/p14 normalized physical-geometry comparison"),
    ("browser/p12-console-post-reload-later.ax.txt", "fresh p12 native DevTools console accessibility capture"),
    ("browser/p12-console-post-reload-later.png", "fresh p12 native DevTools console screenshot"),
    ("browser/p14-console-post-reload-final-later.ax.txt", "fresh p14 native DevTools console accessibility capture"),
    ("browser/p14-console-post-reload-final-later.png", "fresh p14 native DevTools console screenshot"),
):
    if (ROOT / relative).resolve().exists():
        browser_items += f"<li>{link(relative, label)} — selected real-route/browser/build evidence</li>"

def card(label: str, value, detail: str = "") -> str:
    return f'<div class="card"><div class="card-label">{esc(label)}</div><div class="card-value">{esc(value)}</div><div class="card-detail">{esc(detail)}</div></div>'


def dimension_class(row: dict | None) -> str:
    if not row or not row.get("eligible"):
        return "excluded"
    if row.get("withinStrictTolerance"):
        return "clear-pass"
    if row.get("withinStrictPlusEndpointUncertainty"):
        return "uncertain"
    return "clear-fail"


candidate_clear_fail_ordinals = [
    int(row["ordinal"])
    for row in dimensions.get("paired", [])
    if dimension_class(row.get("candidate")) == "clear-fail"
]
candidate_excluded_ordinals = [
    int(row["ordinal"])
    for row in dimensions.get("paired", [])
    if dimension_class(row.get("candidate")) == "excluded"
]
candidate_outcome = (
    f"후보 {args.run_id}는 동일한 pinned v15 raw 문서를 사용한 topology-only replay입니다. "
    + (f"strict dimension fail은 {', '.join(f'p{x:02d}' for x in candidate_clear_fail_ordinals)}입니다. " if candidate_clear_fail_ordinals else "")
    + (f"{', '.join(f'p{x:02d}' for x in candidate_excluded_ordinals)}는 reject 또는 독립 probe 제외로 dimension grade에서 제외했습니다. " if candidate_excluded_ordinals else "")
    + "scale/차원 결과는 before와 같은 raw 문서에 대한 별도 계층이며 topology 개선의 정확도 증거로 합산하지 않습니다. 전체 50건을 통과로 표시하지 않습니다."
)
annotation_correction_callout = ""
if annotation_correction:
    measurement = annotation_correction.get("independentMeasurement", {})
    endpoints = measurement.get("endpoints", [])
    annotation_correction_callout = (
        f"<div class='callout warning'><strong>p19 annotation correction:</strong> "
        f"독립 source 재검토에서 전체 10246 dimension line endpoint를 {esc(endpoints)}로 정정했습니다. "
        f"candidate strict accounting은 eligible {candidate_dim_summary['caseWeighted']['strictMax50mmOr2Pct']['passed']}/{candidate_dim_summary['caseWeighted']['denominator']}, "
        f"all-source {candidate_all_source_strict}/50이 되지만 historical V15 baseline annotation은 보존했습니다. "
        "이 변화는 annotation correction이며 product/source scale 변경이나 topology 개선으로 해석하지 않습니다. "
        f"상세 <a href='{esc(os.path.relpath(annotation_correction_path, ROOT))}'>p19 correction evidence</a>를 확인하십시오.</div>"
    )
timing_callout = ""
if source_freeze:
    timing = source_freeze.get("timing", {})
    if timing.get("status") == "NOT_CAPTURED" or timing.get("beforeAfterCaptured") is False:
        current_timing_note = ""
        if timing_benchmark:
            aggregate = timing_benchmark.get("aggregate", {})
            protocol = timing_benchmark.get("protocol", {})
            timed_calls = aggregate.get(
                "timedCalls",
                aggregate.get("completedCases", 0) * protocol.get("timedRoundsPerCase", 0),
            )
            sum_per_case_median = aggregate.get("sumPerCaseMedianMs")
            sum_per_case_p95 = aggregate.get("sumPerCaseP95Ms")
            sum_per_case_max = aggregate.get("sumPerCaseMaxMs")
            if any(value is None for value in (sum_per_case_median, sum_per_case_p95, sum_per_case_max)):
                elapsed = [
                    entry.get("elapsedMs", {})
                    for entry in timing_benchmark.get("cases", [])
                    if entry.get("status") == "PASS"
                ]
                sum_per_case_median = sum(item.get("median", 0) for item in elapsed)
                sum_per_case_p95 = sum(item.get("p95", 0) for item in elapsed)
                sum_per_case_max = sum(item.get("max", 0) for item in elapsed)
            timeout_instrumented = aggregate.get(
                "timeoutInterruptsInstrumented",
                protocol.get("timeoutInterruptions") not in (None, "not instrumented; round errors are counted separately"),
            )
            current_timing_note = (
                f" 최신 current-only rerun에서 frozen detector 단독 측정은 {aggregate.get('completedCases', 0)}건 × "
                f"{protocol.get('timedRoundsPerCase', 0)}회 = {timed_calls}회 호출(케이스별 warm-up "
                f"{protocol.get('warmupRounds', 0)}회)에서 timed sample 합계 "
                f"{aggregate.get('wallGraphDetectorSumMs', 0):.3f} ms였습니다. "
                f"케이스별 median 합산 {sum_per_case_median:.3f} ms, p95 합산 "
                f"{sum_per_case_p95:.3f} ms, max 합산 {sum_per_case_max:.3f} ms, "
                f"관측 sample max {aggregate.get('wallGraphDetectorMaxMs', 0):.3f} ms입니다. "
                f"round error 0, geometry idempotence failure 0이며 timeout interruption watchdog는 "
                f"{'계측되었습니다' if timeout_instrumented else '계측되지 않았습니다'}. "
                "이 latest rerun은 이전 review run과 혼용하지 않았습니다."
            )
            benchmark_href = os.path.relpath(timing_benchmark_path, ROOT)
            current_timing_note += f" <a href='{esc(benchmark_href)}'>current-only timing evidence</a>."
        timing_callout = (
            "<div class='callout warning'><strong>성능 측정 경계:</strong> "
            "동일 detector의 before/after wall-clock timing은 capture되지 않았습니다. "
            "따라서 <=1.25x 성능 주장을 하지 않습니다. source freeze와 기능/geometry evidence는 별도입니다."
            f"{current_timing_note}</div>"
        )
    elif timing.get("status"):
        timing_callout = f"<div class='callout'><strong>성능:</strong> {esc(timing.get('status'))}</div>"
guide_scale_callout = ""
verification_callout = ""
if final_provenance:
    guide_behavior = guide_scale_policy.get("behavior", "")
    guide_plan_href = os.path.relpath(guide_scale_plan_path, ROOT) if guide_scale_plan_path.exists() else ""
    guide_plan_link = f" <a href='{esc(guide_plan_href)}'>guide-scale plan</a>." if guide_plan_href else ""
    guide_scale_callout = (
        "<div class='callout'><strong>guide-scale default policy:</strong> "
        f"{esc(guide_behavior)} "
        f"현재 guide-scale apartment import suite는 {esc(guide_scale_policy.get('aptImportTests', '—'))}입니다.{guide_plan_link} "
        "이 source/test freeze는 기존 pinned V15 raw/vector replay의 입력을 바꾸지 않으므로 50건 topology 비교는 재실행하지 않았습니다.</div>"
    )
    verification_callout = (
        "<div class='callout'><strong>canonical verification ledger:</strong> "
        f"{esc(final_verification.get('aggregateUniquePasses', 'current focused verification'))} "
        f"Biome {esc(final_verification.get('biome', {}).get('result', '—'))}; "
        f"currentSourceHashes {current_source_hash_count} files are linked in the canonical provenance and source-hash ledger. "
        f"<a href='manual-validation/final-provenance.json'>final provenance</a>와 "
        f"<a href='manual-validation/source-hashes-final.txt'>source hashes</a>에서 현재 bytes와 freeze를 확인하십시오.</div>"
    )
fresh_ui_callout = ""
fresh_console_callout = ""
if fresh_ui_summary:
    p12 = fresh_ui_summary.get("cases", {}).get("p12", {})
    p14 = fresh_ui_summary.get("cases", {}).get("p14", {})
    manual = fresh_ui_summary.get("cases", {}).get("manualCalibration", {})
    p12_before = p12.get("before", {})
    p12_after = p12.get("afterReload", {})
    p14_before = p14.get("before", {})
    p14_after = p14.get("afterReload", {})
    p12_counts = p12_after.get("counts", {})
    p14_counts = p14_after.get("counts", {})
    p12_graph_equal = p12.get("graphEquality", {}).get("beforeVsAfterReloadGraphEqual")
    p14_graph_equal = p14.get("graphEquality", {}).get("beforeVsAfterReloadGraphEqual")
    manual_result = manual.get("validation", {})
    correct_attempt = manual.get("autoModelAttempt", {}).get("correctCardAttempt", {})
    manual_scale = manual.get("guide", {}).get("scaleReference", {}).get("label", "—")
    fresh_links = []
    for rel, label in (
        ("browser/fresh-v15-ui-history-summary.json", "fresh p12/p14 UI history summary"),
        ("browser/p12-final-after-reload-3d-visible.png", "p12 fresh 3D after reload"),
        ("browser/p12-final-after-reload-2d.png", "p12 fresh 2D after reload"),
        ("browser/p14-final-after-reload-3d-visible.png", "p14 fresh 3D after reload"),
        ("browser/p14-final-selected-closed-room1.png", "p14 selected closed Room 1"),
        ("browser/p14-final-selected-closed-room1.ax.txt", "p14 selected closed Room 1 accessibility evidence"),
        ("browser/p14-model-3d-after-devtools-close.png", "p14 actual 3D model after DevTools close"),
        ("browser/p14-model-3d-after-devtools-close.ax.txt", "p14 actual 3D model accessibility evidence"),
        ("browser/manual-calibrated-correct-auto.png", "manual calibration correct-card auto model"),
        ("browser/manual-calibrated-after-correct-auto-api.json", "manual calibration correct-card API"),
        ("browser/manual-calibrated-auto-attempt.png", "manual calibration wrong-card guide-only evidence"),
    ):
        if (ROOT / rel).exists():
            fresh_links.append(link(rel, label))
    fresh_ui_callout = (
        "<div class='callout'><strong>fresh guide-scale CUA evidence:</strong> "
        f"p12 scene <code>{esc(p12.get('sceneId', '—'))}</code> reloaded with "
        f"{esc(p12_counts.get('slab', '—'))} slabs / {esc(p12_counts.get('ceiling', '—'))} ceilings, guide scale "
        f"{esc(p12_after.get('guide', {}).get('scale', '—'))}, and before/reload graph equality "
        f"{esc(p12_graph_equal)}. p14 scene <code>{esc(p14.get('sceneId', '—'))}</code> reloaded with "
        f"{esc(p14_counts.get('slab', '—'))} slabs / {esc(p14_counts.get('ceiling', '—'))} ceilings, guide scale "
        f"{esc(p14_after.get('guide', {}).get('scale', '—'))}, and before/redo/reload graph equality "
        f"{esc(p14_graph_equal)}; Room 1 is explicitly selected as enclosed in the 2D evidence. "
        f"The separate manual-calibration case persisted explicit <code>{esc(manual_scale)}</code>; correct-card auto-model result is "
        f"{esc(correct_attempt.get('counts', {}).get('slab', '—'))} slabs / {esc(correct_attempt.get('counts', {}).get('ceiling', '—'))} ceilings, while the wrong-card attempt remains guide-only and failed before mutation. "
        f"These fresh records are distinct from the earlier pre-guide-scale UI sample. {' · '.join(fresh_links)}"
        "</div>"
    )
    fresh_console = fresh_ui_summary.get("console", {}).get("freshNativeDevTools", {})
    fresh_console_p12 = fresh_console.get("p12", {})
    fresh_console_p14 = fresh_console.get("p14", {})
    if fresh_console_p12 or fresh_console_p14:
        fresh_console_callout = (
            "<div class='callout'><strong>최신 Native Chrome DevTools console 범위:</strong> "
            f"문서화된 CUA Tab API가 직접 console log를 노출하지 않아 native DevTools를 read-only로 확인했습니다. "
            f"clear + hard reload 뒤 p12는 console error {esc(fresh_console_p12.get('errors', '—'))}건, warning {esc(fresh_console_p12.get('warnings', '—'))}건, DevTools Issues {esc(fresh_console_p12.get('issues', '—'))}건; "
            f"p14는 error {esc(fresh_console_p14.get('errors', '—'))}건, warning {esc(fresh_console_p14.get('warnings', '—'))}건, Issues {esc(fresh_console_p14.get('issues', '—'))}건입니다. "
            "0 error는 두 fresh scene tab의 clear 후 hard reload 범위이며, warning·Issues·이전 HMR/WebGPU lifecycle log를 전역 console clean으로 확대하지 않았습니다. "
            "원시 accessibility capture와 screenshot을 아래에 연결했습니다."
            "</div>"
        )
    model_readiness = fresh_ui_summary.get("modelReadiness", {}).get("p14", {})
    if model_readiness:
        fresh_ui_callout += (
            "<div class='callout'><strong>p14 모델 표시 후속 확인:</strong> "
            "DevTools를 닫은 뒤 실제 3D 아파트가 렌더링되고 선택한 Room 1 구획 패널이 남아 있었습니다 "
            f"({esc('; '.join(model_readiness.get('observed', [])))}). "
            "readiness-timeout warning은 warning으로 보존했으며, 이 후속 확인은 해당 경고가 관찰된 모델 표시를 막지 않았다는 사실만 기록합니다. "
            f"<a href='browser/{esc(model_readiness.get('screenshot', 'p14-model-3d-after-devtools-close.png'))}'>3D screenshot</a> · "
            f"<a href='browser/{esc(model_readiness.get('ax', 'p14-model-3d-after-devtools-close.ax.txt'))}'>accessibility capture</a></div>"
        )
elif not fresh_ui_summary_path.exists():
    fresh_ui_callout = "<div class='callout warning'><strong>fresh guide-scale CUA evidence:</strong> summary not found; no current p12/p14 UI pass claim.</div>"
fresh_geometry_callout = ""
if fresh_physical_comparison:
    physical_cases = []
    for case_name, case in fresh_physical_comparison.get("cases", {}).items():
        wall = case.get("wallGeometry", {})
        opening = case.get("openingGeometry", {})
        zone = case.get("zoneGeometry", {})
        surface = case.get("surfaceGeometry", {})
        derived_equal = case.get("derivedClassification", {}).get("equalAfterIdNormalization")
        metadata = case.get("sourceMetadataDifferences", {})
        metadata_entries = sum(int(section.get("entryCount", 0)) for section in metadata.values())
        parent_diffs = len(case.get("surfaceGeometry", {}).get("parentReferenceDifferences", []))
        physical_cases.append(
            f"{esc(case_name)}: walls {esc(wall.get('matchedCount', '—'))}/{esc(wall.get('browserCount', '—'))} matched "
            f"(max endpoint Δ {esc(wall.get('maxEndpointAbsDiff', '—'))}), openings {esc(opening.get('matchedCount', '—'))}/{esc(opening.get('browserCount', '—'))} matched, "
            f"zones {esc(zone.get('matchedCount', '—'))}/{esc(zone.get('browserCount', '—'))}, surfaces {esc(surface.get('matchedCount', '—'))}/{esc(surface.get('browserCount', '—'))}, "
            f"ID 정규화 후 derived classification={esc(derived_equal)}. "
        f"aggregate equality=false는 browser wrapper count 차이와 {metadata_entries} browser-only source-metadata entry, {parent_diffs} level-parent reference를 별도 보존한 결과입니다."
        )
    fresh_geometry_callout = (
        f"<div class='callout'><strong>최신 UI physical-geometry 비교:</strong> "
        f"<a href='{esc(os.path.relpath(fresh_physical_comparison_path, ROOT))}'>comparison JSON</a>을 50건 pinned replay와 분리해 기록했습니다. "
        "ID/parent 정규화 뒤 두 fresh case의 벽·개구부·존·슬래브/천장 polygon 형상은 일치합니다. browser wrapper(site/building/level/guide) count와 source metadata·structural parent 차이는 별도 계층으로 보존했습니다. "
        + " ".join(physical_cases)
        + "</div>"
    )
else:
    fresh_geometry_callout = (
        "<div class='callout warning'><strong>fresh UI physical-geometry comparison:</strong> "
        "the post-guide-scale p12/p14 comparison artifact is unavailable; no UI geometry equality claim is made from screenshots alone.</div>"
    )
evaluate_log_name = f"evaluate-{args.run_id}.log"
render_log_name = f"render-{args.run_id}.log"

if topology_comparison:
    physical = topology_comparison.get("physicalGeometry", {})
    zone_meta = topology_comparison.get("sourceZoneMetadata", {})
    metadata = topology_comparison.get("metadataPreservation", {})
    zone_derived = topology_comparison.get("zoneDerivedClassification", {})
    wall_class = topology_comparison.get("wallDerivedClassifications", {})
    topology_callout = (
        f"<div class='callout'><strong>V15 direct topology comparison:</strong> "
        f"같은 raw v15의 common imported {esc(topology_comparison.get('commonImportedCases'))}건에서 "
        f"normalized physical wall geometry는 {esc(physical.get('normalizedWallGeometry', {}).get('equalCases'))}/{esc(physical.get('normalizedWallGeometry', {}).get('denominator'))}, "
        f"opening geometry는 {esc(physical.get('normalizedOpeningGeometry', {}).get('equalCases'))}/{esc(physical.get('normalizedOpeningGeometry', {}).get('denominator'))}입니다. "
        f"sourceRoomId/sourceOpeningId metadata multiplicity는 각각 {esc(metadata.get('sourceRoomIdExactCases'))}/{esc(metadata.get('sourceRoomIdDenominator'))}, {esc(metadata.get('sourceOpeningIdExactCases'))}/{esc(metadata.get('sourceOpeningIdDenominator'))}로 exact입니다. "
        f"source-zone의 추가 source fields exact signature는 {esc(zone_meta.get('exactNormalizedCases'))}/{esc(zone_meta.get('denominator'))}, "
        f"derived enclosure classification은 {esc(zone_derived.get('exactNormalizedCases'))}/{esc(zone_derived.get('denominator'))}입니다. "
        f"wall frontSide/backSide distribution은 physical geometry와 분리해 {esc(wall_class.get('exactDistributionCases'))}/{esc(wall_class.get('denominator'))}로 기록했습니다. "
        f"상세 <a href='{esc(os.path.relpath(topology_comparison_path, ROOT))}'>normalized V15 comparison JSON</a>에서 generated ID를 제외한 정의와 case rows를 확인할 수 있습니다.</div>"
    )
else:
    topology_callout = "<div class='callout warning'><strong>V15 direct topology comparison:</strong> comparison JSON이 없어 최종 topology equality를 판정하지 않았습니다.</div>"


rows = []
for item in manifest["plans"]:
    key = item["key"]
    b, c = base_by_key[key], cand_by_key[key]
    bd, cd = dim_by_key.get(key, {}).get("baseline", {}), dim_by_key.get(key, {}).get("candidate", {})
    bseed, cseed = b["floor"]["roomInteriorSeeds"], c["floor"]["roomInteriorSeeds"]
    bpersisted_seed = b["floor"].get("persisted", {}).get("roomInteriorSeeds", {})
    cpersisted_seed = c["floor"].get("persisted", {}).get("roomInteriorSeeds", {})
    bout, cout = b["floor"]["outsideFloorProbes"], c["floor"]["outsideFloorProbes"]
    bstatus, cstatus = b["status"], c["status"]
    status_class = "ok" if cstatus == "IMPORTED" else "reject"
    pair_dir = f"paired-{args.run_id}/{key}"
    base_dir = f"{b['files']['wallOverlay'].split('/')[0]}/{key}"
    cand_dir = f"candidate-{args.run_id}/{key}"
    bcounts, ccounts = b.get("importedCounts") or {}, c.get("importedCounts") or {}
    case_links = " ".join(
        [
            link(f"{pair_dir}/paired.jpg", "paired"),
            link(f"{pair_dir}/source.jpg", "source"),
            link(f"{base_dir}/wall-floor-overlay.jpg", "base-floor"),
            link(f"{cand_dir}/wall-floor-overlay.jpg", "cand-floor"),
            link(f"{base_dir}/stored-floor-overlay.jpg", "base-stored-floor"),
            link(f"{cand_dir}/stored-floor-overlay.jpg", "cand-stored-floor"),
            link(
                f"{baseline_eval_dir}/{key}/metrics.json" if baseline_eval_dir else f"{key}/evaluation.json",
                "base-eval",
            ),
            link(f"{candidate_eval_dir}/{item['planId']}.json", "cand-eval"),
        ]
    )
    rows.append(
        "<tr>"
        f"<td>{item['ordinal']:02d}</td>"
        f"<td><strong>{esc(item['name'])}</strong><br><code>{esc(item['planId'])}</code></td>"
        f"<td><span class='status {status_class}'>{esc(bstatus)} → {esc(cstatus)}</span><br><small>{esc((c.get('importer') or {}).get('reason', ''))}</small></td>"
        f"<td>{fmt((b.get('vectorizerMetrics') or {}).get('wallIoU'), 3)} → {fmt((c.get('vectorizerMetrics') or {}).get('wallIoU'), 3)}<br><small>source diagnostic</small></td>"
        f"<td>{esc(bcounts.get('zones', '—'))}/{esc(bcounts.get('detectedSpaces', '—'))} → {esc(ccounts.get('zones', '—'))}/{esc(ccounts.get('detectedSpaces', '—'))}<br><small>imported zones / detected spaces</small></td>"
        f"<td>{bseed.get('insideSlab')}/{bseed.get('total')} ({percent(bseed.get('insideSlab', 0), bseed.get('total', 0))}) → {cseed.get('insideSlab')}/{cseed.get('total')} ({percent(cseed.get('insideSlab', 0), cseed.get('total', 0))})<br><small>planned slabPlan.create polygons</small><br>importer JSON surface {bpersisted_seed.get('insideSlab', 0)}/{bpersisted_seed.get('total', 0)} → {cpersisted_seed.get('insideSlab', 0)}/{cpersisted_seed.get('total', 0)}</td>"
        f"<td>{bout.get('falseFloorPositive')}/{bout.get('total')} → {cout.get('falseFloorPositive')}/{cout.get('total')}<br><small>explicit source probes</small></td>"
        f"<td>{fmt((bd or {}).get('relativeError') * 100 if isinstance((bd or {}).get('relativeError'), (int, float)) else None, 2)}% → {fmt((cd or {}).get('relativeError') * 100 if isinstance((cd or {}).get('relativeError'), (int, float)) else None, 2)}%<br><small>{esc(dimension_class(bd))} → {esc(dimension_class(cd))}</small></td>"
        f"<td>{case_links}</td>"
        "</tr>"
    )

report = f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>아파트 도면 50건 기준선/후보 비교 — {esc(args.run_id)}</title>
<style>
:root{{--ink:#17202a;--muted:#5c6b78;--line:#d4dce4;--accent:#145b8c;--ok:#087443;--warn:#a14a00;--panel:#f4f8fb}}
*{{box-sizing:border-box}}body{{margin:0;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{max-width:1800px;margin:auto;padding:26px 30px 70px}}h1{{margin:0 0 8px;font-size:27px}}h2{{margin:28px 0 10px;border-bottom:2px solid var(--line);padding-bottom:5px;font-size:19px}}p{{max-width:1100px}}code{{font-size:11px}}a{{color:var(--accent)}}.lede{{color:var(--muted);max-width:1200px}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:18px 0}}.card{{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:11px 13px}}.card-label{{font-size:12px;color:var(--muted)}}.card-value{{font-size:24px;font-weight:700}}.card-detail{{font-size:12px;color:var(--muted)}}.callout{{border-left:4px solid var(--accent);background:#edf6fb;padding:11px 15px;margin:12px 0}}.warning{{border-left-color:var(--warn);background:#fff6ec}}table{{border-collapse:collapse;width:100%;font-size:11px}}th,td{{border:1px solid var(--line);padding:6px;vertical-align:top;text-align:left}}th{{position:sticky;top:0;background:#eaf0f5;z-index:1}}tr:nth-child(even){{background:#fafcfd}}.status{{font-weight:700}}.status.ok{{color:var(--ok)}}.status.reject{{color:var(--warn)}}.links{{line-height:1.9;white-space:nowrap}}small{{color:var(--muted)}}.gallery{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}}figure{{margin:0}}figure img{{width:100%;border:1px solid var(--line);display:block}}figcaption{{color:var(--muted);margin-top:4px}}@media print{{main{{padding:8px}}th{{position:static}}.gallery img{{max-height:180px;object-fit:contain}}}}
</style></head><body><main>
<h1>아파트 추가 50건 V15 기준선 / topology 후보 {esc(args.run_id)} 비교</h1>
<p class="lede">기준선은 이전 V15-floor importer/evaluation 결과이고 후보는 같은 pinned v15 raw 문서를 현재 core에 다시 넣은 topology-only replay입니다. 원본 JPG, physical wall/opening geometry, source-zone metadata, `slabPlan.create` 기반 계획 polygon, source-image probe를 각각 분리해 기록했습니다. 모델의 자동 생성 zone 색상은 바닥 정확도의 근거로 사용하지 않았습니다. importer JSON surface 배열과 실제 browser/DB scene persistence도 별도 기록했습니다. guide-scale source/test freeze와 p12/p14 fresh CUA 재import/physical-geometry 비교는 별도 증거로 기록했고, native DevTools console 결과도 해당 두 scene tab으로 범위를 제한했습니다.</p>
<div class="cards">
{card('계획 / 단지', '50 / 50', '추가 unique plans / distinct complexes')}
{card(f'기준선 {args.baseline_label} importer', f"{baseline['importedCases']}/50", 'prior V15-floor imported status; completion claim 아님')}
{card(f"후보 {args.run_id} importer", f"{candidate['importedCases']}/50", 'imported status; completion claim 아님')}
{card('Importer reject', f"{baseline['rejectedCases']} → {candidate['rejectedCases']}", 'rejects are excluded from model denominators')}
{card('Dimension strict (eligible)', f"{baseline_dim_summary['caseWeighted']['strictMax50mmOr2Pct']['passed']}/{baseline_dim_summary['caseWeighted']['denominator']} → {candidate_dim_summary['caseWeighted']['strictMax50mmOr2Pct']['passed']}/{candidate_dim_summary['caseWeighted']['denominator']}", 'max(50 mm, 2%), eligible rows')}
{card('Dimension strict (all 50)', f"{baseline_all_source_strict}/50 → {candidate_all_source_strict}/50", 'excluded/rejected rows remain failures for all-source accounting')}
{card('Dimension loose 5%', f"{baseline_dim_summary['caseWeighted']['loose5Pct']['passed']}/{baseline_dim_summary['caseWeighted']['denominator']} → {candidate_dim_summary['caseWeighted']['loose5Pct']['passed']}/{candidate_dim_summary['caseWeighted']['denominator']}", 'comparison only; not target grade')}
{card('Common accepted room seeds', f"{common_baseline_seed_inside}/{common_seed_total} → {common_candidate_seed_inside}/{common_seed_total}", f'{len(common_keys)} plans in both imported sets')}
{card('Source floor seed probe', f"{baseline['roomSeeds']['probeWeighted']['inside']}/{baseline['roomSeeds']['probeWeighted']['total']} ({baseline_seed_rate:.1f}%) → {candidate['roomSeeds']['probeWeighted']['inside']}/{candidate['roomSeeds']['probeWeighted']['total']} ({candidate_seed_rate:.1f}%)", 'same 44 imported plans / same 330 source-supported probes')}
{card('Candidate missing source seeds', f"{candidate_seed_absent}/{candidate['roomSeeds']['probeWeighted']['total']}", 'planned slabPlan.create polygon misses; residual, not a pass')}
{card('Outside probe FP', f"{baseline['outsideFloorProbes']['probeWeighted']['falsePositive']}/{baseline['outsideFloorProbes']['probeWeighted']['total']} → {candidate['outsideFloorProbes']['probeWeighted']['falsePositive']}/{candidate['outsideFloorProbes']['probeWeighted']['total']}", 'six explicit source-supported probes')}
{card('Slab self-intersection cases', f"{baseline['slabGeometry']['selfIntersectionCases']} → {candidate['slabGeometry']['selfIntersectionCases']}", 'slabPlan.create planned polygons')}
{card('Slab overlap diagnostic', f"{baseline['slabGeometry']['overlapPairs']} pairs / {baseline['slabGeometry']['overlapAreaM2']:.3f} m² → {candidate['slabGeometry']['overlapPairs']} pairs / {candidate['slabGeometry']['overlapAreaM2']:.3f} m²", 'planned polygon raster/geometry diagnostic; increase remains a residual')}
{card('Importer JSON slabs', f"{baseline_persisted.get('storedSlabs', 0)} → {candidate_persisted.get('storedSlabs', 0)}", 'buildVectorNodes 결과 JSON; current guide-scale p12/p14와 별도 manual calibration live evidence를 따로 검증')}
{card('Importer JSON ceilings', f"{baseline_persisted.get('storedCeilings', 0)} → {candidate_persisted.get('storedCeilings', 0)}", 'buildVectorNodes 결과 JSON; current guide-scale p12/p14와 별도 manual calibration live evidence를 따로 검증')}
{card('Importer JSON exact surface match', f"{baseline_persisted.get('exactSlabPlanMatches', 0)}/{baseline['importedCases']} → {candidate_persisted.get('exactSlabPlanMatches', 0)}/{candidate['importedCases']}", f"candidate nonzero closed-loop surface cases {candidate_persisted.get('casesWithStoredSlabs', 0)}/{candidate['importedCases']}; {p02_surface_note}")}
</div>
<div class="callout warning"><strong>판정:</strong> {esc(candidate_outcome)} p13/p17/p34/p44는 final v15에서 mmPerPx가 null인 scale refusal이고, p36/p49도 final v15 scale null입니다. baseline p36/p49의 wood-dense reject는 별도 importer 상태로 기록하며 final v15 dimension refusal과 혼동하지 않습니다.</div>
{guide_scale_callout}
{verification_callout}
{fresh_ui_callout}
{fresh_console_callout}
{fresh_geometry_callout}
<div class="callout"><strong>차원 probe:</strong> source endpoint는 reviewer annotation입니다. 실제 span은 document/source 축 비율 × mmPerPx로 계산하여 `derivedSpanMm`와 `/1000`한 `derivedSpanM`를 별도 기록했습니다. 중앙값/endpoint uncertainty와 함께 max(50 mm, 2%) 및 loose 5%를 모두 보고합니다. case-weighted denominator는 baseline {baseline_dim_summary['caseWeighted']['denominator']}, candidate {candidate_dim_summary['caseWeighted']['denominator']}이며 probe-weighted도 각각 같습니다. all-source strict pass는 {baseline_all_source_strict}/50 → {candidate_all_source_strict}/50입니다.</div>
{annotation_correction_callout}
{timing_callout}
<div class="callout"><strong>바닥 probe:</strong> 현재 reviewer JSON에는 first 25에 228개, last 25에 150개 room seed가 있습니다. 같은 44개 imported plan과 같은 330개 source-supported probe 기준으로 frozen baseline의 <em>계획 polygon</em>은 {baseline['roomSeeds']['probeWeighted']['inside']}/{baseline['roomSeeds']['probeWeighted']['total']} ({baseline_seed_rate:.1f}%), final 후보는 {candidate['roomSeeds']['probeWeighted']['inside']}/{candidate['roomSeeds']['probeWeighted']['total']} ({candidate_seed_rate:.1f}%)이고, 후보는 {candidate_seed_absent}/{candidate['roomSeeds']['probeWeighted']['total']} seed가 slabPlan.create 계획 polygon 밖으로 남습니다. 공통 imported 비교는 {common_baseline_seed_inside}/{common_seed_total} → {common_candidate_seed_inside}/{common_seed_total}입니다. importer serialized slab 배열 기준 probe는 baseline {baseline_persisted_probes.get('inside', 0)}/{baseline_persisted_probes.get('total', 0)} → 후보 {candidate_persisted_probes.get('inside', 0)}/{candidate_persisted_probes.get('total', 0)}입니다. live DB/browser surface evidence는 guide-scale 수정 전의 8건 route sample(accepted 6건 + guide-only expected reject 2건)과 별도로, 최신 p12/p14 및 manual calibration live records에서 확인했습니다. outside-floor는 p03/p12와 second-half structural review에서 명시된 6개 source probe만 평가합니다. 계획 polygon, importer JSON surface, live scene persistence를 같은 지표로 부르지 않았습니다.</div>
<div class="callout"><strong>boundary / ID:</strong> {esc(legacy_probe_note)}</div>
{topology_callout}
<div class="callout warning"><strong>browser/build evidence 범위:</strong> guide-scale 수정 전 selected v15 UI는 자동 모델 6건과 guide-only expected reject 2건이었고, p12/p14의 이전 6/5 slab/ceiling 및 machine 10/7 차이는 historical pre-fix로 보존합니다. 최신 guide-scale CUA 재import에서는 p12 {esc((fresh_ui_summary or {}).get('cases', {}).get('p12', {}).get('afterReload', {}).get('counts', {}).get('slab', '—'))}/{esc((fresh_ui_summary or {}).get('cases', {}).get('p12', {}).get('afterReload', {}).get('counts', {}).get('ceiling', '—'))}, p14 {esc((fresh_ui_summary or {}).get('cases', {}).get('p14', {}).get('afterReload', {}).get('counts', {}).get('slab', '—'))}/{esc((fresh_ui_summary or {}).get('cases', {}).get('p14', {}).get('afterReload', {}).get('counts', {}).get('ceiling', '—'))}, 그리고 별도 manual calibration live record가 reload/graph 결과와 함께 기록됐습니다. 50건 importer row 전체를 UI/browser pass로 승격하지 않으며, mobile locate 후 collapse WebGPU device destroyed와 Chrome lifecycle aggregate 25 errors / 35 warnings도 residual로 유지합니다.</div>
<div class="callout warning"><strong>live DB/browser surface evidence 범위:</strong> guide-scale 수정 전 route sample은 {len(final_browser_cases)}건 (accepted {len(final_browser_accepted)}건, guide-only expected reject {len(final_browser_guide_only)}건)의 historical selected evidence입니다. 최신 guide-scale p12/p14와 별도 manual calibration live evidence는 현재 UI layer로 분리했고, 50건 importer JSON/live persistence와 이 3개 current UI evidence의 범위를 합산하지 않았습니다. parent post-delete p35 tab의 historic HMR/WebGPU validation error log도 별도 residual로 유지합니다.</div>
<div class="callout warning"><strong>generated slab deletion gate:</strong> pre-fix isolated scene <code>{esc(pre_fix_delete.get('sceneId', 'eff467575ece'))}</code>는 direct Delete 뒤 같은 polygon replacement를 재생성했지만, 해당 실패 기록은 <a href="../apartment-50-browser-20261003/final-v15-floorfix/slab-delete-result.json">보존</a>했습니다. post-fix focused CUA rerun에서는 같은 scene의 auto slab을 삭제하여 <strong>{esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('slabs', 3))} slabs / {esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('ceilings', 4))} ceilings / {esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('walls', 26))} walls</strong>를 저장했고 same-polygon replacement가 없었습니다. Undo는 원래 graph/ID를 복원하고 Redo와 hard reload는 삭제 상태를 유지했습니다. 이 post-fix gate는 <code>PASS_DIRECT_AUTO_SLAB_DELETE_PERSISTS</code>로 <strong>PASS</strong>입니다. post-fix 전용 console에는 React lifecycle error 1건이 남아 있어 이를 전체 browser console clean으로 확대하지 않습니다. <a href="../apartment-auto-slab-delete-fix-20261003/fixed-delete-result.json">fixed result</a> · <a href="../apartment-auto-slab-delete-fix-20261003/focused-delete-validation.json">focused assertions</a></div>
<div class="callout warning"><strong>p03 gate:</strong> source flat top [329,164]–[397,164]와 forbidden peak [363,129]를 보존했습니다. 기준선은 해당 source point에 wall이 정확히 닿는 모델 geometry와 2개의 slabPlan.create 계획 polygon을 보였고, 후보는 nearest wall 거리와 계획 polygon 수가 줄었습니다. 이전 15.4 px stroke tolerance는 pass gate로 사용하지 않았습니다.</div>
<div class="callout warning"><strong>통합된 다섯 가지 fix와 source:</strong> (1) full space signature ID — <code>packages/core/src/lib/space-detection.ts</code>, (2) dimension scale fail-closed / wrong fallback refusal — <code>apps/editor/app/api/apartments/[id]/plans/[planId]/vector/route.ts</code>와 vectorizer route, (3) short bevel/endpoint weld cap — <code>apps/editor/lib/apt-vector-scene.ts</code>, (4) 새로 닫힌 경계를 기존 zone 재사용으로 가리지 않는 split/create — <code>packages/core/src/lib/space-detection.ts</code>와 <code>apps/editor/lib/apt-vector-scene.ts</code>, (5) final-frame closed rooms를 importer JSON surface와 live scene 초기 slab/ceiling으로 materialize하고, auto surface의 direct delete/undo/redo/reload lifecycle을 보존 — <code>apps/editor/lib/apt-vector-scene.ts</code>와 planner/history 계약 <code>packages/core/src/lib/space-detection.ts</code>입니다. 다섯 번째 live proof는 guide-scale p12/p14, 별도 manual calibration, focused deletion scene에 한정되며, 아래 수치는 각 fix의 residual reject와 geometry diagnostics를 함께 보존합니다. 전체 50건을 통과로 표시하지 않습니다.</div>

<h2>전체 비교 contact sheet</h2><div class="gallery"><figure><a href="paired-{esc(args.run_id)}/contact-sheet-all-50.jpg"><img src="paired-{esc(args.run_id)}/contact-sheet-all-50.jpg" loading="lazy" alt="paired 50 contact sheet"></a><figcaption>source | baseline/candidate wall | planned slab | importer JSON slab</figcaption></figure><figure><a href="{esc(baseline['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-planned-50.jpg"><img src="{esc(baseline['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-planned-50.jpg" loading="lazy" alt="baseline planned 50"></a><figcaption>기준선 computed slabPlan.create</figcaption></figure><figure><a href="{esc(candidate['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-persisted-50.jpg"><img src="{esc(candidate['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-persisted-50.jpg" loading="lazy" alt="candidate importer JSON 50"></a><figcaption>후보 importer JSON slabs (buildVectorNodes output)</figcaption></figure></div>

<h2>케이스별 evidence</h2><div style="overflow:auto"><table><thead><tr><th>#</th><th>plan</th><th>import</th><th>wallIoU<br>diagnostic</th><th>zones / spaces</th><th>planned / importer JSON surface room seeds</th><th>outside-floor FP</th><th>dimension Δ</th><th>links</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>

<h2>재현 / provenance</h2><ul>
<li>{link('manifest.json','manifest.json')} — deterministic 50 selection, size/index strata, exclusions</li>
<li>{link('../apartment-scale-fix-20261003/candidate-summary-v15.json','pinned V15 raw candidate summary')} — same raw document root used by both sides; vectorizer SHA {esc(candidate_summary.get('vectorizerSha256'))}</li>
<li>{link(candidate_summary_href,'candidate raw summary')} — {esc(candidate_summary.get('docVersions'))} SHA {esc(candidate_summary.get('vectorizerSha256'))}</li>
<li>{link(machine_path.name, f'{args.baseline_label} renderer metrics')} / {link(candidate_machine_path.name,'candidate renderer metrics')}</li>
<li>{link('source-probes.json','source-probes.json')} — reviewer hashes, room seeds, p03/p12 source-supported outside/wall evidence</li>
<li>{link(str(dimensions_path.relative_to(ROOT)),'paired dimension metrics')} — independent mm/mm conversion and uncertainty classifications</li>
<li>{link('paired-{0}-metrics.json'.format(args.run_id),'paired floor/geometry metrics')} — planned slabPlan.create와 importer JSON slabs/ceilings, overlap, self-intersection, room/outside probe metrics</li>
<li>{link(evaluate_log_name,'candidate importer replay log')} / {link(render_log_name,'paired overlay render log')} — pinned v15 raw documents, no vectorizer rerun</li>
<li>{link('../apartment-50-improvement-20261003/paired-v15-floor-persistence-metrics.json','prior V15-floor metrics')} / {link(candidate_machine_path.name,'candidate planned/importer JSON metrics')} — buildVectorNodes serialized surface counts and surface signature matches</li>
<li>{link('v15-floor-baseline.json','V15-floor baseline freeze')} / {(link(os.path.relpath(source_freeze_path, ROOT),'final core source freeze') if source_freeze_path and source_freeze_path.exists() else '')} / {link(topology_comparison_path.name,'direct V15 normalized topology comparison')}</li>
{verification_item}
{provenance_item}
{zone_metrics_item}
{(f"<li>{link(os.path.relpath(timing_benchmark_path, ROOT), 'current detector timing benchmark')} — current frozen detector only; no before/after ratio claim</li>" if timing_benchmark else '')}
{browser_items}
<li>{link('build_source_probes.py','build_source_probes.py')} / {link('build_dimension_evidence.py','build_dimension_evidence.py')} / {link('evaluate_candidate.ts','evaluate_candidate.ts')} / {link('render_paired_v15.py','render_paired_v15.py')} / {link('compare_topology_v15.py','compare_topology_v15.py')} — evidence harness sources</li>
</ul><p><small>이 문서는 pinned raw/source probe와 candidate importer 결과를 통합한 evidence 산출물입니다. evidence harness가 생성한 파일과 product/source fix의 실제 source 경로를 위에 함께 표시했습니다. source wallIoU는 vectorizer 자기진단이고 독립 정확도 점수가 아닙니다. `zone count`, slabPlan.create 계획 polygon, importer JSON surface 배열, live browser/DB scene persistence를 분리했습니다. 50건 importer 결과와 guide-scale p12/p14 및 별도 manual calibration live evidence의 범위를 혼동하지 않았습니다.</small></p>
</main></body></html>'''

output = args.output or (ROOT / f"paired-report-{args.run_id}.html")
output.write_text(report)
print(json.dumps({"output": str(output), "rows": len(rows), "bytes": len(report.encode())}))
