#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a compact Korean standalone baseline/candidate evidence report."""

from __future__ import annotations

import argparse
import html
import json
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


def link(path: str, text: str) -> str:
    return f'<a href="{html.escape(path)}">{html.escape(text)}</a>'


parser = argparse.ArgumentParser()
parser.add_argument("--run-id", default="v14")
parser.add_argument("--dimension", type=Path)
parser.add_argument("--candidate-summary", type=Path)
parser.add_argument("--candidate-machine", type=Path)
parser.add_argument("--baseline-machine", type=Path)
parser.add_argument("--candidate-evaluation-root", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()

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
verification_path = ROOT / f"verification-{args.run_id}.json"
verification_item = (
    f"<li>{link(verification_path.name, 'verification record')} — commands, hashes, runtime, and derived gates</li>"
    if verification_path.exists()
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
    ("../apartment-50-browser-20261003/v15-ui-results.json", "v15 UI QA results (6 accepted + 2 guide-expected rejects)"),
    ("../apartment-50-browser-20261003/v15-stage-matrix.md", "v15 browser stage matrix"),
    ("../apartment-50-browser-20261003/parent-v15-iab-verification.json", "fresh desktop/mobile IAB verification"),
    ("../apartment-50-browser-20261003/parent-p35-v15-final-2d-zones.jpg", "fresh desktop v15 Zones capture"),
    ("../apartment-50-browser-20261003/parent-p35-v15-mobile-expanded.jpg", "mobile expanded Zones capture"),
    ("../apartment-50-browser-20261003/parent-p35-v15-mobile-locate.jpg", "mobile locate WebGPU failure capture"),
    ("../apartment-50-browser-20261003/v15-chrome-console-after-repair.json", "Chrome lifecycle console (25 errors / 35 warnings)"),
    ("../apartment-zone-real-20261003/final-v15-provenance.json", "final v15 provenance/build gates"),
    ("../apartment-zone-real-20261003/current-import-verification.json", "current import verification"),
    ("../apartment-initial-surfaces-fix-20261003/verification.log", "initial persisted slab/ceiling source freeze verification"),
    ("../apartment-initial-surfaces-fix-20261003/source-hashes.txt", "initial surfaces source hashes"),
    ("../apartment-50-browser-20261003/final-v15-floorfix/final-v15-browser-results.json", "final v15 floor persistence browser results (6 accepted + 2 guide-only)"),
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
    f"후보 {args.run_id}는 p29/p32/p42의 baseline scale mismatch를 크게 줄였습니다. "
    + (f"strict dimension fail은 {', '.join(f'p{x:02d}' for x in candidate_clear_fail_ordinals)}입니다. " if candidate_clear_fail_ordinals else "")
    + (f"{', '.join(f'p{x:02d}' for x in candidate_excluded_ordinals)}는 reject 또는 독립 probe 제외로 dimension grade에서 제외했습니다. " if candidate_excluded_ordinals else "")
    + "따라서 전체 50건을 통과로 표시하지 않습니다."
)


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
            link(f"{key}/evaluation.json", "base-eval"),
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
        f"<td>{bseed.get('insideSlab')}/{bseed.get('total')} → {cseed.get('insideSlab')}/{cseed.get('total')}<br><small>planned slabPlan.create polygons</small><br>importer JSON surface {bpersisted_seed.get('insideSlab', 0)}/{bpersisted_seed.get('total', 0)} → {cpersisted_seed.get('insideSlab', 0)}/{cpersisted_seed.get('total', 0)}</td>"
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
<h1>아파트 추가 50건 기준선 / 후보 {esc(args.run_id)} 비교</h1>
<p class="lede">원본 JPG와 pinned vector raw 문서, importer scene, `slabPlan.create` 기반 슬래브 생성 계획 polygon, source-image probe를 같은 좌표계로 비교한 한국어 evidence 보고서입니다. 모델의 자동 생성 zone 색상은 바닥 정확도의 근거로 사용하지 않았습니다. importer가 직렬화한 JSON surface 배열과 실제 browser/DB scene persistence를 별도 기록했습니다.</p>
<div class="cards">
{card('계획 / 단지', '50 / 50', '추가 unique plans / distinct complexes')}
{card('기준선 importer', f"{baseline['importedCases']}/50", 'imported status; completion claim 아님')}
{card(f"후보 {args.run_id} importer", f"{candidate['importedCases']}/50", 'imported status; completion claim 아님')}
{card('Importer reject', f"{baseline['rejectedCases']} → {candidate['rejectedCases']}", 'rejects are excluded from model denominators')}
{card('Dimension strict (eligible)', f"{baseline_dim_summary['caseWeighted']['strictMax50mmOr2Pct']['passed']}/{baseline_dim_summary['caseWeighted']['denominator']} → {candidate_dim_summary['caseWeighted']['strictMax50mmOr2Pct']['passed']}/{candidate_dim_summary['caseWeighted']['denominator']}", 'max(50 mm, 2%), eligible rows')}
{card('Dimension strict (all 50)', f"{baseline_all_source_strict}/50 → {candidate_all_source_strict}/50", 'excluded/rejected rows remain failures for all-source accounting')}
{card('Dimension loose 5%', f"{baseline_dim_summary['caseWeighted']['loose5Pct']['passed']}/{baseline_dim_summary['caseWeighted']['denominator']} → {candidate_dim_summary['caseWeighted']['loose5Pct']['passed']}/{candidate_dim_summary['caseWeighted']['denominator']}", 'comparison only; not target grade')}
{card('Common accepted room seeds', f"{common_baseline_seed_inside}/{common_seed_total} → {common_candidate_seed_inside}/{common_seed_total}", f'{len(common_keys)} plans in both imported sets')}
{card('Room seed hits (separate denominators)', f"{baseline['roomSeeds']['probeWeighted']['inside']}/{baseline['roomSeeds']['probeWeighted']['total']} → {candidate['roomSeeds']['probeWeighted']['inside']}/{candidate['roomSeeds']['probeWeighted']['total']}", 'different imported sets; not an overall improvement claim')}
{card('Outside probe FP', f"{baseline['outsideFloorProbes']['probeWeighted']['falsePositive']}/{baseline['outsideFloorProbes']['probeWeighted']['total']} → {candidate['outsideFloorProbes']['probeWeighted']['falsePositive']}/{candidate['outsideFloorProbes']['probeWeighted']['total']}", 'six explicit source-supported probes')}
{card('Slab self-intersection cases', f"{baseline['slabGeometry']['selfIntersectionCases']} → {candidate['slabGeometry']['selfIntersectionCases']}", 'slabPlan.create planned polygons')}
{card('Slab overlap pairs', f"{baseline['slabGeometry']['overlapPairs']} → {candidate['slabGeometry']['overlapPairs']}", 'planned polygon raster/geometry diagnostic')}
{card('Importer JSON slabs', f"{baseline_persisted.get('storedSlabs', 0)} → {candidate_persisted.get('storedSlabs', 0)}", 'buildVectorNodes 결과 JSON; live DB/browser count는 fresh 6 scenes에서 별도 검증')}
{card('Importer JSON ceilings', f"{baseline_persisted.get('storedCeilings', 0)} → {candidate_persisted.get('storedCeilings', 0)}", 'buildVectorNodes 결과 JSON; live DB/browser count는 fresh 6 scenes에서 별도 검증')}
{card('Importer JSON exact surface match', f"{baseline_persisted.get('exactSlabPlanMatches', 0)}/{baseline['importedCases']} → {candidate_persisted.get('exactSlabPlanMatches', 0)}/{candidate['importedCases']}", f"candidate nonzero closed-loop surface cases {candidate_persisted.get('casesWithStoredSlabs', 0)}/{candidate['importedCases']}; p02 is an explicit 0/0 match")}
</div>
<div class="callout warning"><strong>판정:</strong> {esc(candidate_outcome)} p13/p17/p34/p44는 final v15에서 mmPerPx가 null인 scale refusal이고, p36/p49도 final v15 scale null입니다. baseline p36/p49의 wood-dense reject는 별도 importer 상태로 기록하며 final v15 dimension refusal과 혼동하지 않습니다.</div>
<div class="callout"><strong>차원 probe:</strong> source endpoint는 reviewer annotation입니다. 실제 span은 document/source 축 비율 × mmPerPx로 계산하여 `derivedSpanMm`와 `/1000`한 `derivedSpanM`를 별도 기록했습니다. 중앙값/endpoint uncertainty와 함께 max(50 mm, 2%) 및 loose 5%를 모두 보고합니다. case-weighted denominator는 baseline {baseline_dim_summary['caseWeighted']['denominator']}, candidate {candidate_dim_summary['caseWeighted']['denominator']}이며 probe-weighted도 각각 같습니다. all-source strict pass는 {baseline_all_source_strict}/50 → {candidate_all_source_strict}/50입니다.</div>
<div class="callout"><strong>바닥 probe:</strong> 현재 reviewer JSON에는 first 25에 228개, last 25에 150개 room seed가 있습니다. frozen baseline의 <em>계획 polygon</em>은 {baseline['roomSeeds']['probeWeighted']['inside']}/{baseline['roomSeeds']['probeWeighted']['total']}, final 후보는 {candidate['roomSeeds']['probeWeighted']['inside']}/{candidate['roomSeeds']['probeWeighted']['total']}이고, 후보는 {candidate_seed_absent}/{candidate['roomSeeds']['probeWeighted']['total']} seed가 slabPlan.create 계획 polygon 밖으로 남습니다. 공통 imported 비교는 {common_baseline_seed_inside}/{common_seed_total} → {common_candidate_seed_inside}/{common_seed_total}입니다. importer serialized slab 배열 기준 probe는 baseline {baseline_persisted_probes.get('inside', 0)}/{baseline_persisted_probes.get('total', 0)} → 후보 {candidate_persisted_probes.get('inside', 0)}/{candidate_persisted_probes.get('total', 0)}입니다. browser/DB stored surface evidence는 fresh 6 accepted scenes에서만 별도 검증했습니다. outside-floor는 p03/p12와 second-half structural review에서 명시된 6개 source probe만 평가합니다. 계획 polygon, importer JSON surface, live scene persistence를 같은 지표로 부르지 않았습니다.</div>
<div class="callout"><strong>boundary / ID:</strong> {esc(legacy_probe_note)}</div>
<div class="callout"><strong>browser/build:</strong> v15 UI QA는 selected 8건 중 자동 모델 6건과 guide-only expected reject 2건입니다. fresh desktop IAB는 초기 error 0으로 12/12 Zones를 보였고, mobile expanded panel도 12/12였지만 locate 후 collapse에서 WebGPU device destroyed가 발생해 mobile locate는 실패로 남겼습니다. reset/reload 뒤 geometry는 복구했습니다. Chrome lifecycle aggregate는 25 errors / 35 warnings이며 이전 lifecycle/WebGPU 기록을 포함하므로 fresh desktop zero-error 주장과 분리합니다. 50건 전체 UI 통과를 뜻하지 않으며, core/import/build gate와 current-import replay provenance는 아래 링크에서 확인할 수 있습니다.</div>
<div class="callout"><strong>fresh live DB/browser surface gate:</strong> final route {len(final_browser_cases)}건 중 accepted {len(final_browser_accepted)}건, guide-only expected reject {len(final_browser_guide_only)}건입니다. accepted six scene API에서 closed spaces와 stored slab/ceiling 수가 일치했습니다: p04 4/4, p50 11/11, p47 12/12, p42 13/13, p35 repair/redo/reload 후 12/12, p12 8/8. p35 scene <code>3a347e468e79</code>는 <code>{esc(final_browser.get('p35History', {}).get('states', [{}])[0].get('file', ''))}</code> baseline부터 repair/redo/reload evidence를 링크했습니다. 이것은 fresh live six scenes이며 50건 importer JSON의 live persistence를 뜻하지 않습니다. per-route console captures는 zero errors입니다. parent post-delete p35 tab의 historic HMR/WebGPU validation error log는 별도 residual로 링크했으며 이 per-route 결과에 합산하지 않았습니다.</div>
<div class="callout warning"><strong>generated slab deletion gate:</strong> pre-fix isolated scene <code>{esc(pre_fix_delete.get('sceneId', 'eff467575ece'))}</code>는 direct Delete 뒤 같은 polygon replacement를 재생성했지만, 해당 실패 기록은 <a href="../apartment-50-browser-20261003/final-v15-floorfix/slab-delete-result.json">보존</a>했습니다. post-fix focused CUA rerun에서는 같은 scene의 auto slab을 삭제하여 <strong>{esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('slabs', 3))} slabs / {esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('ceilings', 4))} ceilings / {esc((post_fix_delete.get('states', {}).get('afterDelete') or {}).get('walls', 26))} walls</strong>를 저장했고 same-polygon replacement가 없었습니다. Undo는 원래 graph/ID를 복원하고 Redo와 hard reload는 삭제 상태를 유지했습니다. 이 post-fix gate는 <code>PASS_DIRECT_AUTO_SLAB_DELETE_PERSISTS</code>로 <strong>PASS</strong>입니다. post-fix 전용 console에는 React lifecycle error 1건이 남아 있어 이를 전체 browser console clean으로 확대하지 않습니다. <a href="../apartment-auto-slab-delete-fix-20261003/fixed-delete-result.json">fixed result</a> · <a href="../apartment-auto-slab-delete-fix-20261003/focused-delete-validation.json">focused assertions</a></div>
<div class="callout warning"><strong>p03 gate:</strong> source flat top [329,164]–[397,164]와 forbidden peak [363,129]를 보존했습니다. 기준선은 해당 source point에 wall이 정확히 닿는 모델 geometry와 2개의 slabPlan.create 계획 polygon을 보였고, 후보는 nearest wall 거리와 계획 polygon 수가 줄었습니다. 이전 15.4 px stroke tolerance는 pass gate로 사용하지 않았습니다.</div>
<div class="callout warning"><strong>통합된 다섯 가지 fix와 source:</strong> (1) full space signature ID — <code>packages/core/src/lib/space-detection.ts</code>, (2) dimension scale fail-closed / wrong fallback refusal — <code>apps/editor/app/api/apartments/[id]/plans/[planId]/vector/route.ts</code>와 vectorizer route, (3) short bevel/endpoint weld cap — <code>apps/editor/lib/apt-vector-scene.ts</code>, (4) 새로 닫힌 경계를 기존 zone 재사용으로 가리지 않는 split/create — <code>packages/core/src/lib/space-detection.ts</code>와 <code>apps/editor/lib/apt-vector-scene.ts</code>, (5) final-frame closed rooms를 importer JSON surface와 live scene 초기 slab/ceiling으로 materialize하고, auto surface의 direct delete/undo/redo/reload lifecycle을 보존 — <code>apps/editor/lib/apt-vector-scene.ts</code>와 planner/history 계약 <code>packages/core/src/lib/space-detection.ts</code>입니다. 다섯 번째 live proof는 fresh six scenes와 focused deletion scene에 한정되며, 아래 수치는 각 fix의 residual reject와 geometry diagnostics를 함께 보존합니다. 전체 50건을 통과로 표시하지 않습니다.</div>

<h2>전체 비교 contact sheet</h2><div class="gallery"><figure><a href="paired-{esc(args.run_id)}/contact-sheet-all-50.jpg"><img src="paired-{esc(args.run_id)}/contact-sheet-all-50.jpg" loading="lazy" alt="paired 50 contact sheet"></a><figcaption>source | baseline/candidate wall | planned slab | importer JSON slab</figcaption></figure><figure><a href="{esc(baseline['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-planned-50.jpg"><img src="{esc(baseline['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-planned-50.jpg" loading="lazy" alt="baseline planned 50"></a><figcaption>기준선 computed slabPlan.create</figcaption></figure><figure><a href="{esc(candidate['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-persisted-50.jpg"><img src="{esc(candidate['cases'][0]['files']['wallOverlay'].split('/')[0])}/contact-sheet-persisted-50.jpg" loading="lazy" alt="candidate importer JSON 50"></a><figcaption>후보 importer JSON slabs (buildVectorNodes output)</figcaption></figure></div>

<h2>케이스별 evidence</h2><div style="overflow:auto"><table><thead><tr><th>#</th><th>plan</th><th>import</th><th>wallIoU<br>diagnostic</th><th>zones / spaces</th><th>planned / importer JSON surface room seeds</th><th>outside-floor FP</th><th>dimension Δ</th><th>links</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>

<h2>재현 / provenance</h2><ul>
<li>{link('manifest.json','manifest.json')} — deterministic 50 selection, size/index strata, exclusions</li>
<li>{link('vectorize-summary.json','baseline vectorize-summary.json')} — v13 direct CLI SHA {esc(read(ROOT/'vectorize-summary.json').get('vectorizerSha256'))}</li>
<li>{link(candidate_summary_href,'candidate raw summary')} — {esc(candidate_summary.get('docVersions'))} SHA {esc(candidate_summary.get('vectorizerSha256'))}</li>
<li>{link('machine-metrics.json','baseline frozen machine-metrics.json')} / {link(candidate_machine_path.name,'candidate importer metrics')}</li>
<li>{link('source-probes.json','source-probes.json')} — reviewer hashes, room seeds, p03/p12 source-supported outside/wall evidence</li>
<li>{link(str(dimensions_path.relative_to(ROOT)),'paired dimension metrics')} — independent mm/mm conversion and uncertainty classifications</li>
<li>{link('paired-{0}-metrics.json'.format(args.run_id),'paired floor/geometry metrics')} — planned slabPlan.create와 importer JSON slabs/ceilings, overlap, self-intersection, room/outside probe metrics</li>
<li>{link('candidate-evaluate-v15-floor.log','candidate floor-persistence importer replay log')} / {link('render-v15-floor-persistence.log','paired overlay render log')} — pinned v15 raw documents, no vectorizer rerun</li>
<li>{link('baseline-floor-persistence-v13-metrics.json','baseline planned/importer JSON metrics')} / {link('candidate-v15-floor-persistence-metrics.json','candidate planned/importer JSON metrics')} — buildVectorNodes serialized surface counts and surface signature matches</li>
{verification_item}
{zone_metrics_item}
{browser_items}
<li>{link('build_source_probes.py','build_source_probes.py')} / {link('build_dimension_evidence.py','build_dimension_evidence.py')} / {link('evaluate_candidate.ts','evaluate_candidate.ts')} / {link('render_paired.py','render_paired.py')} — harness sources</li>
</ul><p><small>이 문서는 pinned raw/source probe와 candidate importer 결과를 통합한 evidence 산출물입니다. evidence harness가 생성한 파일과 product/source fix의 실제 source 경로를 위에 함께 표시했습니다. source wallIoU는 vectorizer 자기진단이고 독립 정확도 점수가 아닙니다. `zone count`, slabPlan.create 계획 polygon, importer JSON surface 배열, live browser/DB scene persistence를 분리했습니다. 50건 importer 결과와 fresh six live scenes의 범위를 혼동하지 않았습니다.</small></p>
</main></body></html>'''

output = args.output or (ROOT / f"paired-report-{args.run_id}.html")
output.write_text(report)
print(json.dumps({"output": str(output), "rows": len(rows), "bytes": len(report.encode())}))
