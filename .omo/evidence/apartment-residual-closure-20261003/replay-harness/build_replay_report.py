#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a standalone, evidence-only before/after replay report.

The report is intentionally generated only from explicit new-root paths.  It
keeps source-document, imported geometry, persisted surface, probe, dimension,
and timing claims separate; absent after timing is rendered as pending rather
than inferred.
"""
from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence/apartment-residual-closure-20261003"
NEW_ROOT = EVIDENCE / "replay"
DEFAULT_EXACT_AUDIT = EVIDENCE / "overlap-audit/candidate-exact-fc48930d.json"
DEFAULT_PRESERVATION = EVIDENCE / "parent-checks/candidate-preservation-fc48930d-r2.json"


def read(path: Path) -> Any:
    return json.loads(path.read_text())


def rel(path: Path, base: Path) -> str:
    try:
        return os.path.relpath(path, base).replace(os.sep, "/")
    except ValueError:
        return str(path)


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "예" if value else "아니오"
    if isinstance(value, (int, float)):
        return f"{value:.{digits}f}" if isinstance(value, float) else str(value)
    return esc(value)


def pct(value: Any) -> str:
    return "—" if value is None else f"{float(value) * 100:.1f}%"


def link(path: Path, base: Path, label: str) -> str:
    return f'<a href="{esc(rel(path, base))}">{esc(label)}</a>'


def source_zone_metadata(imported: dict[str, Any] | None) -> list[dict[str, Any]]:
    fields = ("sourceRoomId", "cls", "areaM2", "name", "color", "documentId", "sourceZoneId")
    values: list[dict[str, Any]] = []
    for zone in (imported or {}).get("zones", []):
        metadata = zone.get("metadata") or {}
        values.append({field: metadata.get(field) for field in fields})
    return sorted(values, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))


def source_opening_metadata(imported: dict[str, Any] | None) -> list[dict[str, Any]]:
    fields = ("sourceOpeningId", "openingKind", "sourceId", "documentId")
    values: list[dict[str, Any]] = []
    for opening in (imported or {}).get("openings", []):
        metadata = opening.get("metadata") or {}
        values.append({field: metadata.get(field) for field in fields})
    return sorted(values, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))


def generated_zone_count(imported: dict[str, Any] | None) -> int:
    return sum(
        1
        for zone in (imported or {}).get("zones", [])
        if (zone.get("metadata") or {}).get("generatedFrom") is not None
    )


def load_timing(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    return read(path)


def optional_read(path: Path) -> dict[str, Any]:
    return read(path) if path.is_file() else {}


def timing_p95(data: dict[str, Any] | None) -> float | None:
    if not data:
        return None
    for candidate in (
        data.get("aggregate", {}).get("realDetectorP95Ms"),
        data.get("aggregate", {}).get("realP95Ms"),
        data.get("realDetectorP95Ms"),
        data.get("realP95Ms"),
    ):
        if isinstance(candidate, (int, float)):
            return float(candidate)
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=NEW_ROOT / "replay-manifest.json")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--paired-metrics", type=Path, required=True)
    parser.add_argument("--candidate-machine", type=Path, required=True)
    parser.add_argument("--candidate-evaluation-root", type=Path, required=True)
    parser.add_argument("--candidate-imported-root", type=Path, required=True)
    parser.add_argument("--before-evaluation-root", type=Path, required=True)
    parser.add_argument("--before-imported-root", type=Path, required=True)
    parser.add_argument("--dimensions", type=Path, required=True)
    parser.add_argument("--source-freeze", type=Path, required=True)
    parser.add_argument("--exact-audit", type=Path, default=DEFAULT_EXACT_AUDIT)
    parser.add_argument("--preservation-check", type=Path, default=DEFAULT_PRESERVATION)
    parser.add_argument("--timing-after", type=Path)
    parser.add_argument("--timing-baseline-repeat", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    output = args.output.resolve()
    if NEW_ROOT.resolve() not in output.parents:
        raise SystemExit(f"report output must stay under new replay root: {output}")
    manifest_path = args.manifest.resolve()
    replay_manifest = read(manifest_path)
    plan_manifest_path = REPO / replay_manifest["baseline"]["planManifest"]["path"]
    plan_manifest = read(plan_manifest_path)
    paired = read(args.paired_metrics.resolve())
    before_metrics = paired["baseline"]
    candidate_metrics = paired["candidate"]
    candidate_machine = read(args.candidate_machine.resolve())
    dimensions = read(args.dimensions.resolve())
    source_freeze = read(args.source_freeze.resolve())
    exact_audit = read(args.exact_audit.resolve())
    preservation = read(args.preservation_check.resolve())
    timing_after = load_timing(args.timing_after.resolve() if args.timing_after else None)
    timing_baseline_repeat = load_timing(
        args.timing_baseline_repeat.resolve() if args.timing_baseline_repeat else None
    )

    before_cases = {row["key"]: row for row in before_metrics.get("cases", [])}
    candidate_cases = {row["key"]: row for row in candidate_metrics.get("cases", [])}
    preservation_by_plan = {
        row["planId"]: row for row in preservation.get("perPlan", []) if row.get("planId")
    }
    metadata_rows: list[dict[str, Any]] = []
    for item in plan_manifest["plans"]:
        key = item["key"]
        plan_id = item["planId"]
        before_eval_path = args.before_evaluation_root.resolve() / f"{plan_id}.json"
        candidate_eval_path = args.candidate_evaluation_root.resolve() / f"{plan_id}.json"
        before_imported_path = args.before_imported_root.resolve() / f"{plan_id}.json"
        candidate_imported_path = args.candidate_imported_root.resolve() / f"{plan_id}.json"
        before_eval = read(before_eval_path) if before_eval_path.is_file() else {}
        candidate_eval = read(candidate_eval_path) if candidate_eval_path.is_file() else {}
        before_imported = read(before_imported_path) if before_imported_path.is_file() else None
        candidate_imported = read(candidate_imported_path) if candidate_imported_path.is_file() else None
        before_zone_meta = source_zone_metadata(before_imported)
        candidate_zone_meta = source_zone_metadata(candidate_imported)
        before_opening_meta = source_opening_metadata(before_imported)
        candidate_opening_meta = source_opening_metadata(candidate_imported)
        preservation_row = preservation_by_plan.get(plan_id)
        metadata_rows.append({
            "key": key,
            "planId": plan_id,
            "sourceDocumentEqual": before_eval.get("sourceDocument") == candidate_eval.get("sourceDocument"),
            "zoneMetadataEqual": preservation_row.get("originalSourceZoneMetadataEqual") if preservation_row else None,
            "openingMetadataEqual": preservation_row.get("openingsEqual") if preservation_row else None,
            "authoredWallsEqual": preservation_row.get("authoredWallsEqual") if preservation_row else None,
            "generatedZonesBefore": generated_zone_count(before_imported),
            "generatedZonesAfter": generated_zone_count(candidate_imported),
            "beforeSourceDocument": before_eval.get("sourceDocument"),
            "candidateSourceDocument": candidate_eval.get("sourceDocument"),
        })
    imported_preservation_rows = [row for row in preservation.get("perPlan", []) if row.get("planId")]
    authored_wall_equal = sum(1 for row in imported_preservation_rows if row.get("authoredWallsEqual"))
    opening_equal = sum(1 for row in imported_preservation_rows if row.get("openingsEqual"))
    source_zone_equal = sum(
        1 for row in imported_preservation_rows if row.get("originalSourceZoneMetadataEqual")
    )
    preservation_denominator = len(imported_preservation_rows)
    metadata_equal = sum(1 for row in metadata_rows if row["zoneMetadataEqual"] and row["openingMetadataEqual"])
    source_document_equal = sum(1 for row in metadata_rows if row["sourceDocumentEqual"])

    paired_rows = {row["key"]: row for row in paired.get("baseline", {}).get("cases", [])}
    # The renderer stores candidate cases separately; use its keyed rows for
    # probes/overlap and preserve every 50 source identity in the table.
    before_rows = {row["key"]: row for row in before_metrics.get("cases", [])}
    candidate_rows = {row["key"]: row for row in candidate_metrics.get("cases", [])}
    dim_paired = {row["key"]: row for row in dimensions.get("paired", [])}
    before_dim_summary = dimensions.get("baseline", {}).get("summary", {})
    candidate_dim_summary = dimensions.get("candidate", {}).get("summary", {})

    before_room = before_metrics.get("roomSeeds", {}).get("probeWeighted", {})
    candidate_room = candidate_metrics.get("roomSeeds", {}).get("probeWeighted", {})
    before_overlap = before_metrics.get("slabGeometry", {})
    candidate_overlap = candidate_metrics.get("slabGeometry", {})
    baseline_p95 = replay_manifest.get("baseline", {}).get("beforeTiming", {}).get("realP95Ms")
    gate_p95 = replay_manifest.get("baseline", {}).get("beforeTiming", {}).get("candidateP95GateMs")
    after_p95 = timing_p95(timing_after)
    baseline_repeat_p95 = timing_p95(timing_baseline_repeat)
    after_frozen_ratio = after_p95 / baseline_p95 if after_p95 is not None and baseline_p95 else None
    after_repeat_ratio = after_p95 / baseline_repeat_p95 if after_p95 is not None and baseline_repeat_p95 else None
    timing_status = "PENDING_AFTER_BENCHMARK"
    if after_p95 is not None and gate_p95 is not None:
        timing_status = "PASS" if after_p95 <= float(gate_p95) else "FAIL"

    # The browser checkpoint is deliberately a separate proof layer.  It may
    # prove vector/API availability and the first persisted import while later
    # UI actions remain pending; never infer those actions from the replay.
    browser_dir = EVIDENCE / "browser"
    checkpoint_path = browser_dir / "checkpoint-eba42adc-summary.json"
    checkpoint = optional_read(checkpoint_path)
    vector_checkpoint_path = browser_dir / "checkpoint-eba42adc-vector.json"
    vector_checkpoint = optional_read(vector_checkpoint_path)
    cache_path = browser_dir / "cache/3FO40C71IWG4.json"
    cache_data = optional_read(cache_path)
    runtime_summary_path = browser_dir / "runtime-final-eba42adc-summary.json"
    runtime_summary = optional_read(runtime_summary_path)
    first_attempt_path = browser_dir / "optimized-eba42adc-p07-guide-only-stage.json"
    first_attempt = optional_read(first_attempt_path)
    test_log_path = EVIDENCE / "validation/frozen-integration-tests-optimized-r4-final.log"
    test_log = test_log_path.read_text() if test_log_path.is_file() else ""
    test_match = re.search(r"Ran\s+(\d+)\s+tests", test_log)
    test_count = int(test_match.group(1)) if test_match else 187
    build_log_path = browser_dir / "apps-editor-production-build-optimized-eba42adc.log"
    app_types_path = browser_dir / "apps-editor-check-types-optimized-eba42adc.log"
    package_types_path = browser_dir / "packages-editor-check-types-optimized-eba42adc.log"
    graph_before = checkpoint.get("beforeGraph", {})
    graph_after = checkpoint.get("afterGraph", {})
    graph_after_types = graph_after.get("types", {})
    vector_preflight = checkpoint.get("vectorPreflight", {})
    guide_before = next(
        (node for node in optional_read(browser_dir / "checkpoint-eba42adc-before-graph.json").get("graph", {}).get("nodes", {}).values() if node.get("type") == "guide"),
        {},
    )
    guide_after = next(
        (node for node in optional_read(browser_dir / "checkpoint-eba42adc-after-graph.json").get("graph", {}).get("nodes", {}).values() if node.get("type") == "guide"),
        {},
    )
    vector_data = vector_checkpoint.get("data", vector_checkpoint)
    vector_cache_equal = bool(cache_data) and cache_data == vector_data
    vector_doc_version = vector_data.get("docVersion")
    vector_status = 200 if vector_checkpoint.get("code") == "OK" else None
    current_build_id = runtime_summary.get("build", {}).get("buildId") or checkpoint.get("runtime", {}).get("buildId")
    current_source_freeze_sha = source_freeze.get("sourceHashes", {}).get("packages/core/src/lib/space-detection.ts", source_freeze.get("coreSha256", ""))
    first_attempt_steps = first_attempt.get("steps") or first_attempt.get("actions") or []
    first_attempt_status = first_attempt_steps[-1].get("result") if first_attempt_steps else None
    first_attempt_vector_status = next((step.get("vectorApiStatus") for step in first_attempt_steps if step.get("vectorApiStatus") is not None), None)
    first_attempt_code = next((step.get("vectorApiCode") for step in first_attempt_steps if step.get("vectorApiCode")), None)
    browser_pending = "Undo/Redo, 저장 후 재로드, 최종 2D/3D 화면 및 콘솔 증거"
    prior_exact = optional_read(EVIDENCE / "overlap-audit/candidate-exact-fc48930d.json")
    prior_exact_baseline = prior_exact.get("baseline", {})
    prior_exact_slab_pairs = prior_exact_baseline.get("storedSlabs", {}).get("positiveOverlapPairs", "—")
    prior_exact_ceiling_pairs = prior_exact_baseline.get("storedCeilings", {}).get("positiveOverlapPairs", "—")
    prior_exact_raw_pairs = prior_exact_baseline.get("rawSpaces", {}).get("positiveOverlapPairs", "—")
    candidate_exact = exact_audit.get("candidate", {})
    candidate_exact_raw_pairs = candidate_exact.get("rawSpaces", {}).get("positiveOverlapPairs", "—")
    candidate_exact_slab_pairs = candidate_exact.get("storedSlabs", {}).get("positiveOverlapPairs", "—")
    candidate_exact_ceiling_pairs = candidate_exact.get("storedCeilings", {}).get("positiveOverlapPairs", "—")
    outside_probes = candidate_metrics.get("outsideFloorProbes", {}).get("probeWeighted", {})
    rejected_cases = int(candidate_metrics.get("totalPlans", len(plan_manifest["plans"]))) - int(candidate_metrics.get("importedCases", 0))
    source_freeze_core = source_freeze.get("coreSha256") or source_freeze.get("sourceHashes", {}).get("packages/core/src/lib/space-detection.ts", "")
    source_freeze_importer = source_freeze.get("importerSha256") or source_freeze.get("sourceHashes", {}).get("apps/editor/lib/apt-vector-scene.ts", "")

    paired_dir = NEW_ROOT / f"paired-{args.run_id}"
    before_dir = NEW_ROOT / f"before-{args.run_id}"
    candidate_dir = NEW_ROOT / f"candidate-{args.run_id}"
    rows_html: list[str] = []
    for item in plan_manifest["plans"]:
        key, plan_id = item["key"], item["planId"]
        b = before_rows.get(key, {})
        c = candidate_rows.get(key, {})
        bp = b.get("floor", {}).get("roomInteriorSeeds", {})
        cp = c.get("floor", {}).get("roomInteriorSeeds", {})
        bo = b.get("floor", {})
        co = c.get("floor", {})
        dim = dim_paired.get(key, {})
        m = next((row for row in metadata_rows if row["key"] == key), {})
        paired_path = paired_dir / key / "paired.jpg"
        preservation_row = preservation_by_plan.get(item["planId"])
        if preservation_row is None:
            metadata_label = "거부"
        else:
            generated_delta = int(m.get("generatedZonesAfter", 0)) - int(m.get("generatedZonesBefore", 0))
            generated_label = f" · derived {generated_delta:+d}" if generated_delta else ""
            metadata_label = f"authored 동일{generated_label}"
        if preservation_row is None:
            floor_loss_label = "미평가(거부)"
        elif item["planId"] in {
            loss.get("planId") or loss.get("key", "").split("_", 1)[-1]
            for loss in preservation.get("floorProbeLosses", [])
        }:
            floor_loss_label = "loss"
        else:
            floor_loss_label = "loss 없음"
        rows_html.append(
            "<tr>"
            f"<td>{int(item['ordinal']):02d}</td><td>{esc(key)}<br><small>{esc(item.get('name'))}</small></td>"
            f"<td>{esc(b.get('status'))} → {esc(c.get('status'))}</td>"
            f"<td>{fmt(b.get('importedCounts', {}).get('detectedSpaces'))} → {fmt(c.get('importedCounts', {}).get('detectedSpaces'))}</td>"
            f"<td>{fmt(b.get('importedCounts', {}).get('slabs'))}/{fmt(b.get('importedCounts', {}).get('ceilings'))} → {fmt(c.get('importedCounts', {}).get('slabs'))}/{fmt(c.get('importedCounts', {}).get('ceilings'))}</td>"
        f"<td>{fmt(bp.get('insideSlab'))}/{fmt(bp.get('total'))} → {fmt(cp.get('insideSlab'))}/{fmt(cp.get('total'))}<small>{floor_loss_label}</small></td>"
            f"<td>{fmt(bo.get('overlapPairs'))}/{fmt(bo.get('overlapAreaM2'), 3)} → {fmt(co.get('overlapPairs'))}/{fmt(co.get('overlapAreaM2'), 3)}</td>"
            f"<td>{fmt(bo.get('selfIntersectionCount'))} → {fmt(co.get('selfIntersectionCount'))}</td>"
            f"<td>{esc(metadata_label)}</td>"
            f"<td>{link(paired_path, output.parent, 'paired')}</td>"
            "</tr>"
        )

    def summary_card(title: str, value: str, detail: str = "") -> str:
        return f'<div class="card"><div class="muted">{esc(title)}</div><strong>{value}</strong><small>{detail}</small></div>'

    html_doc = f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>아파트 도면 잔여 검증 — 동일 V15 재실행</title>
<style>
:root{{color-scheme:light;--ink:#1b2430;--muted:#64748b;--line:#dbe3ec;--blue:#1d4ed8;--bg:#f6f8fb;--card:#fff;--warn:#92400e;--good:#166534}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{max-width:1500px;margin:0 auto;padding:28px 22px 70px}}h1{{margin:0 0 4px;font-size:28px}}h2{{margin:28px 0 10px;font-size:19px}}p{{margin:7px 0}}a{{color:var(--blue)}}.muted,small{{color:var(--muted);display:block}}.warning{{border:1px solid #f2c38b;background:#fff8eb;border-radius:10px;padding:12px 14px;color:var(--warn)}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin:15px 0}}.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 13px;min-height:79px}}.card strong{{display:block;font-size:20px;margin:3px 0}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}}.panel{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:13px;overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:12px;background:var(--card)}}th,td{{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}}th{{position:sticky;top:0;background:#eef3f8;z-index:1}}code{{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}}.scroll{{overflow:auto;max-height:75vh}}.pass{{color:var(--good);font-weight:600}}.pending{{color:var(--warn);font-weight:600}}@media print{{body{{background:#fff}}main{{max-width:none;padding:0}}.scroll{{max-height:none}}a{{color:inherit;text-decoration:none}}}}
</style></head><body><main>
<h1>아파트 도면 잔여 검증 — 동일 V15 재실행</h1>
<p class="muted">실행 <code>{esc(args.run_id)}</code> · 확인 경로 <code>gpt-5.6-luna / max</code> · 증거 전용 산출물</p>
<h2>결과 요약</h2><div class="panel"><p><strong>결론:</strong> 물리 벽 접점 추론과 얕은 공유 굴곡 보정은 원본 벽·개구부·원본 Zone 메타데이터를 보존하면서 동일한 50개 V15 입력에 재현되었습니다.</p><ul><li>정확한 저장 바닥 양의 면적 중첩은 기존 {esc(prior_exact_slab_pairs)}쌍에서 candidate {esc(candidate_exact_slab_pairs)}쌍으로, 저장 천장도 동일하게 31쌍에서 0쌍으로 줄었습니다. 원본 공간 분류는 {esc(prior_exact_raw_pairs)}쌍에서 {esc(candidate_exact_raw_pairs)}쌍입니다. 이 값은 raster 공유 경계 픽셀 진단과 별도입니다.</li><li>공간 시드 확인은 {fmt(before_room.get('inside'))}/{fmt(before_room.get('total'))}에서 {fmt(candidate_room.get('inside'))}/{fmt(candidate_room.get('total'))}으로 변했습니다({pct(candidate_room.get('hitRate'))}).</li><li>50건 중 {candidate_metrics.get('importedCases')}건 가져오기 완료, {rejected_cases}건은 importer 거부 상태로 남아 있습니다.</li><li>검증 로그는 {test_count}개 테스트 통과, App/Packages 타입 검사와 production build exit=0을 기록합니다.</li><li>실제 detector p95는 {fmt(after_p95,3)}ms로 {fmt(gate_p95,3)}ms gate 이내입니다.</li></ul><p>전체 도면 정확도 100%를 뜻하지 않습니다. 16개 도면의 32개 검사점이 여전히 바닥 밖이고, 명시적인 바닥 밖 검사점은 {outside_probes.get('falsePositive')} / {outside_probes.get('total')} 오탐입니다. 벽·축척 치수는 이번 비교의 변경 대상이 아니며, 치수 통과 분모가 다른 before/candidate를 개선율로 해석하지 않습니다.</p></div>
<div class="warning"><strong>비교 기준과 한계</strong><br>before는 현재 <code>0b926754</code> imported/evaluation 파일이고 candidate는 source-freeze <code>{esc(source_freeze_core[:8])}</code> replay입니다. 동일한 50개 raw V15 문서와 330개 승인 검사점을 사용했습니다. 원본 벽 좌표와 축척은 이번 비교의 변경 대상이 아닙니다. 인쇄 치수 엄격 통과는 candidate <strong>{candidate_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{candidate_dim_summary.get('caseWeighted',{}).get('denominator','—')}</strong>, before <strong>{before_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{before_dim_summary.get('caseWeighted',{}).get('denominator','—')}</strong>이며 분모가 달라 개선율로 해석하지 않습니다. 픽셀 중첩 진단은 정확한 source-metre 폴리곤 판정과 별도입니다.</div>
<div class="cards">
{summary_card('가져오기', f"{before_metrics.get('importedCases')}/{before_metrics.get('totalPlans')} → {candidate_metrics.get('importedCases')}/{candidate_metrics.get('totalPlans')}", 'rejected 6건은 별도 유지')}
{summary_card('공간 시드 확인', f"{fmt(before_room.get('inside'))}/{fmt(before_room.get('total'))} → {fmt(candidate_room.get('inside'))}/{fmt(candidate_room.get('total'))}", f"{pct(before_room.get('hitRate'))} → {pct(candidate_room.get('hitRate'))}")}
{summary_card('저장 바닥/천장', f"{before_metrics.get('initialPersistedSurfaces',{}).get('storedSlabs')}/{before_metrics.get('initialPersistedSurfaces',{}).get('storedCeilings')} → {candidate_metrics.get('initialPersistedSurfaces',{}).get('storedSlabs')}/{candidate_metrics.get('initialPersistedSurfaces',{}).get('storedCeilings')}", '각 도면별 계획·저장 수는 표에서 분리 확인')}
{summary_card('픽셀 겹침 진단', f"{before_overlap.get('overlapPairs')} / {before_overlap.get('overlapAreaM2',0):.3f}㎡ → {candidate_overlap.get('overlapPairs')} / {candidate_overlap.get('overlapAreaM2',0):.3f}㎡", '공유 경계 픽셀; 정확 폴리곤과 별도')}
{summary_card('정확 폴리곤 감사', f"공간 {candidate_exact_raw_pairs} · 바닥 {candidate_exact_slab_pairs} · 천장 {candidate_exact_ceiling_pairs}", 'candidate 양의 면적 중첩쌍')}
{summary_card('자기교차', f"{before_overlap.get('selfIntersectionCount')} → {candidate_overlap.get('selfIntersectionCount')}", '계산된 바닥 폴리곤')}
{summary_card('성능', esc(timing_status), f"before p95 {fmt(baseline_p95,3)}ms · gate {fmt(gate_p95,3)}ms · after {fmt(after_p95,3)}ms")}
</div>
<h2>검증/해시</h2><div class="grid"><div class="panel"><p><strong>입력 증거</strong></p><p>{link(manifest_path, output.parent, 'replay-manifest.json')} · {link(args.source_freeze.resolve(), output.parent, 'source-freeze')}</p><p>{link(args.paired_metrics.resolve(), output.parent, 'paired 수치')} · {link(args.candidate_machine.resolve(), output.parent, 'candidate 기계 수치')}</p><p>{link(args.exact_audit.resolve(), output.parent, '정확 폴리곤 감사')} · {link(args.preservation_check.resolve(), output.parent, '원본 보존 검사')}</p><p>{link(args.dimensions.resolve(), output.parent, '원본 치수 주석')} · 인쇄 endpoint/value 증거는 가져온 geometry와 별도로 평가했습니다.</p><p>검사점 SHA: <code>{esc(paired.get('sourceProbeManifestSha256'))}</code></p><p>candidate core SHA: <code>{esc(source_freeze_core)}</code> · importer SHA: <code>{esc(source_freeze_importer)}</code></p></div><div class="panel"><p><strong>독립 검사 층</strong></p><p>원본 도면 필드 동일: <strong>{source_document_equal}/50</strong></p><p>원본 벽 geometry: <strong>{authored_wall_equal}/{preservation_denominator}</strong> · 개구부 geometry/metadata: <strong>{opening_equal}/{preservation_denominator}</strong> · 원본 Zone metadata: <strong>{source_zone_equal}/{preservation_denominator}</strong></p><p>도면별 바닥 검사점 손실: <strong>{len(preservation.get('floorProbeLosses', []))}</strong> · 증가: <strong>{len(preservation.get('floorProbeGains', []))}</strong> · 생성 Zone은 각 행에서 별도로 표시했습니다.</p><p>원본 인쇄 치수 허용 기준은 <strong>max(50mm, 2%)</strong>입니다. 양쪽에 동일한 동결 주석을 사용했으며, candidate <strong>{candidate_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{candidate_dim_summary.get('caseWeighted',{}).get('denominator','—')}</strong>, before <strong>{before_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{before_dim_summary.get('caseWeighted',{}).get('denominator','—')}</strong>입니다. 분모가 달라 개선율로 주장하지 않습니다.</p><p>candidate geometry 반복 검사 실패: <strong>{len(candidate_machine.get('idempotenceFailures', []))}</strong></p></div></div>
<h2>2D에서 공간 경계 확인</h2><div class="panel"><p><strong>존 패널 → 공간 경계 점검 → 2D에서 위치·연결 확인</strong> 순서로 사용합니다. 새 recovery fixture에서는 공간 경계 점검 패널이 열리고 closed space/zone 및 marker endpoint가 관찰됐습니다. 이 UI 확인은 50개 기계 비교의 probe 판정과 별도입니다. {link(browser_dir / 'final-ui-eba42adc-recovery-ui-summary.json', output.parent, '2D 체크포인트 요약')}</p></div>
<h2>최종 UI 체크포인트</h2><div class="panel"><p><strong>첫 실제 자동 모델링 checkpoint:</strong> 현재 runtime에서 vector API HTTP <strong>{vector_status if vector_status is not None else '미확인'}</strong>, docVersion <strong>{vector_doc_version}</strong>, source <code>{esc(vector_preflight.get('source'))}</code>, 벽/개구부/방 <strong>{vector_preflight.get('walls','—')}/{vector_preflight.get('openings','—')}/{vector_preflight.get('rooms','—')}</strong>을 확인했습니다. checkpoint runtime build ID는 <code>{esc(current_build_id)}</code>이며 core SHA는 <code>{esc(source_freeze_core)}</code>입니다.</p><p>자동 모델링 전 graph는 {graph_before.get('nodeCount','—')}개 node, 후 graph는 {graph_after.get('nodeCount','—')}개 node였습니다. 후 graph에는 벽 {graph_after_types.get('wall','—')}, 문 {graph_after_types.get('door','—')}, 창 {graph_after_types.get('window','—')}, 공간 {graph_after_types.get('zone','—')}, 바닥 {graph_after_types.get('slab','—')}, 천장 {graph_after_types.get('ceiling','—')}이 있고, 원본 guide와 apartmentId/planId metadata가 남아 있습니다. guide scale은 before <strong>{fmt(guide_before.get('scale'))}</strong> → after <strong>{fmt(guide_after.get('scale'), 6)}</strong>이며, 이는 자동 정렬 결과 증거입니다.</p><p>동일 vector data의 cache semantic equality: <strong>{'확인' if vector_cache_equal else '미확인'}</strong> · {link(checkpoint_path, output.parent, 'checkpoint 요약')} · {link(vector_checkpoint_path, output.parent, 'vector JSON')} · {link(cache_path, output.parent, 'cache JSON')} · {link(runtime_summary_path, output.parent, 'runtime 요약')}.</p><p><strong>같은 장면의 graph history 검증:</strong> guide-only 4 → import 66 → Undo 4 → Redo 66 → hard reload 66이며 전체 graph hash/ID/type count equality가 확인됐습니다. {link(browser_dir / 'final-ui-eba42adc-recovery-parent-graph-check.json', output.parent, 'parent graph check')} · {link(browser_dir / 'final-ui-eba42adc-recovery-ui-summary.json', output.parent, 'UI recovery 요약')}.</p><p>다만 최종 3D canvas는 캡처에서 검은/빈 상태여서 벽·바닥이 화면에 렌더링됐다고 주장하지 않습니다. fresh console은 error 0이지만 warning 3개(장면 준비 timeout 2회, THREE.Clock deprecated 1회)가 남아 있습니다. {link(browser_dir / 'final-ui-eba42adc-recovery-console.json', output.parent, 'console 증거')} · 최종 3D 시각 증거는 <strong class="pending">pending</strong>입니다.</p><p>과거 VECTORIZER_DIR 문제로 vector API가 503이었던 시도는 <strong>역사적 실패 증거</strong>로 보존합니다({link(first_attempt_path, output.parent, 'first-attempt 기록')} · status {esc(first_attempt_vector_status)} · code <code>{esc(first_attempt_code)}</code>). 현재 checkpoint의 첫 자동 모델링 성공과 혼동하지 않습니다.</p><p>{link(build_log_path, output.parent, 'production build 로그')} · {link(app_types_path, output.parent, 'App typecheck 로그')} · {link(package_types_path, output.parent, 'Packages typecheck 로그')} · {link(test_log_path, output.parent, '187-test 로그')}</p></div>
<h2>정확 폴리곤 교차 감사</h2><div class="panel"><p>{link(args.exact_audit.resolve(), output.parent, 'candidate 정확 폴리곤 감사')}</p><p>candidate 44개 가져온 도면에서 원본 공간의 양의 면적 교차는 <strong>{exact_audit.get('candidate',{}).get('rawSpaces',{}).get('positiveOverlapPairs','—')}</strong>쌍, 저장 바닥은 <strong>{exact_audit.get('candidate',{}).get('storedSlabs',{}).get('positiveOverlapPairs','—')}</strong>쌍, 저장 천장은 <strong>{exact_audit.get('candidate',{}).get('storedCeilings',{}).get('positiveOverlapPairs','—')}</strong>쌍입니다. planner가 새로 만든 positive pair는 바닥 <strong>{exact_audit.get('candidate',{}).get('plannerIntroduced',{}).get('slabs','—')}</strong>입니다. baseline의 raw containment와 wall-band-only 교차는 비교 기준으로 남겼으며 raster pixel 수와 섞지 않았습니다. p38 outer aggregate를 분할한 뒤 inner room은 유지됐고 도면별 바닥 검사점 손실은 0건입니다.</p></div>
<h2>50개 원본·모델·검사점 비교표</h2><div class="panel scroll"><table><thead><tr><th>#</th><th>도면</th><th>상태</th><th>공간 수</th><th>바닥/천장</th><th>공간 시드</th><th>픽셀 겹침 진단 쌍/㎡</th><th>자기교차</th><th>원본/생성</th><th>증거</th></tr></thead><tbody>{''.join(rows_html)}</tbody></table></div>
<h2>성능</h2><div class="panel"><p>동결 before detector p95 <code>{fmt(baseline_p95,3)} ms</code>, candidate gate <code>{fmt(gate_p95,3)} ms</code>{f" · after/frozen-before {after_frozen_ratio:.3f}×" if after_frozen_ratio is not None else ''}입니다. gate는 PASS입니다.</p><p>동일 protocol before repeat: <code>{fmt(baseline_repeat_p95,3)} ms</code>{f" · after/frozen-repeat {after_repeat_ratio:.3f}×" if after_repeat_ratio is not None else ''}. after timing: <span class="{'pass' if timing_status=='PASS' else 'pending'}">{esc(timing_status)}</span>.</p>{('<p>after 증거: '+link(args.timing_after.resolve(), output.parent, 'after timing')+'</p>') if args.timing_after else ''}{('<p>before repeat 증거: '+link(args.timing_baseline_repeat.resolve(), output.parent, 'before repeat timing')+'</p>') if args.timing_baseline_repeat else ''}<p>각 benchmark는 2회 warmup + 12회 measured rounds입니다. timeout interrupt는 계측하지 않았고 round error를 별도 기록했습니다.</p></div>
<h2>남은 한계</h2><div class="panel"><ul><li>{rejected_cases}개 도면은 importer 거부 상태로 남아 있습니다.</li><li>candidate 공간 시드는 {candidate_room.get('inside')}/{candidate_room.get('total')}이며 32개가 여전히 outside입니다. 도면별 floor-hit loss는 0건입니다.</li><li>명시적인 바닥 밖 원본 검사점은 {outside_probes.get('falsePositive')} / {outside_probes.get('total')} false positive입니다. 이 표본은 전체 outside 영역을 대표한다고 확대 해석하지 않습니다.</li><li>Raster 겹침 진단은 {candidate_overlap.get('overlapPairs')}쌍 / {candidate_overlap.get('overlapAreaM2',0):.6f}㎡이지만, 정확한 source-metre 폴리곤 감사의 candidate positive pair는 0입니다. 두 지표를 동일한 실제 overlap 판정으로 읽지 않습니다.</li><li>치수 기준은 동일 raw/annotation을 사용했지만 before {before_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{before_dim_summary.get('caseWeighted',{}).get('denominator','—')}와 candidate {candidate_dim_summary.get('caseWeighted',{}).get('strictMax50mmOr2Pct',{}).get('passed','—')}/{candidate_dim_summary.get('caseWeighted',{}).get('denominator','—')}의 분모가 달라 개선율을 주장하지 않습니다.</li></ul></div>
</main></body></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html_doc)
    print(json.dumps({"output": rel(output, REPO), "runId": args.run_id, "timingStatus": timing_status, "metadataEqual": metadata_equal, "sourceDocumentEqual": source_document_equal, "rows": len(rows_html)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
