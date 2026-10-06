#!/usr/bin/env python3
"""Build a standalone, source-backed HTML report for the frozen 50-plan baseline."""

from __future__ import annotations

import collections
import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(name: str):
    return json.loads((ROOT / name).read_text())


manifest = read("manifest.json")
vectors = read("vectorize-summary.json")
machine = read("machine-metrics.json")
visual = read("visual-metrics.json")
floor = read("floor-metrics.json")
wall_probes = read("wall-probe-metrics.json")
visual_by_key = {entry["key"]: entry for entry in visual["cases"]}


def esc(value) -> str:
    return html.escape("" if value is None else str(value))


def fmt(value, digits=2):
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return esc(value)


def link(path: str, label: str) -> str:
    return f'<a href="{html.escape(path)}">{html.escape(label)}</a>'


results = machine["results"]
style_counts = collections.Counter((entry.get("cli", {}).get("metrics") or {}).get("style", "unknown") for entry in results)
size_counts = collections.Counter(entry["sizeBin"] for entry in manifest["plans"])
index_counts = collections.Counter(entry["indexBucket"] for entry in manifest["plans"])
status_counts = machine["statuses"]
legacy_lost_loops = sum(sum(len(c["spaceIds"]) - 1 for c in entry["collisions"]) for entry in machine["legacySpaceCollisions"])


def card(label: str, value, detail: str = "") -> str:
    return f'<div class="card"><div class="card-label">{esc(label)}</div><div class="card-value">{esc(value)}</div><div class="card-detail">{esc(detail)}</div></div>'


rows = []
for entry in results:
    key = entry["key"]
    folder = key
    importer = entry.get("importer") or {}
    boundary = importer.get("boundary") or {}
    legacy = importer.get("legacySpaceIdProbe") or {}
    planners = importer.get("planners") or {}
    cli_metrics = entry.get("cli", {}).get("metrics") or {}
    dim = (visual_by_key.get(key) or {}).get("dimensionEvidence") or {}
    rel_error = dim.get("relativeErrorVsManualAnnotation")
    status_class = "ok" if entry["status"] == "IMPORTED" else "reject"
    links = " ".join(
        [
            link(f"{folder}/source.jpg", "source"),
            link(f"{folder}/baseline-overlay.jpg", "overlay"),
            link(f"{folder}/comparison.jpg", "compare"),
            link(f"{folder}/wall-floor-comparison.jpg", "floor"),
            link(f"{folder}/evaluation.json", "eval"),
        ]
    )
    rows.append(
        "<tr>"
        f"<td>{entry['ordinal']:02d}</td>"
        f"<td><strong>{esc(entry['name'])}</strong><br><code>{esc(entry['planId'])}</code></td>"
        f"<td>{esc(entry['areaBin'])}<br><small>{esc(entry['indexBucket'])}</small></td>"
        f"<td><span class='status {status_class}'>{esc(entry['status'])}</span><br><small>{esc(importer.get('reason', ''))}</small></td>"
        f"<td>{esc(cli_metrics.get('style', '—'))}<br>IoU {fmt(cli_metrics.get('wallIoU'))}</td>"
        f"<td>{fmt(entry['sourceDocument'].get('mmPerPx'), 4)}<br>{entry['sourceDocument'].get('walls', '—')}W / {entry['sourceDocument'].get('openings', '—')}O / {entry['sourceDocument'].get('rooms', '—')}R</td>"
        f"<td>{boundary.get('spaces', '—')} / {boundary.get('uniqueSpaceIds', '—')}<br>legacy {legacy.get('collisionCount', '—')}</td>"
        f"<td>Z {((planners.get('zones') or {}).get('create', '—'))}<br>S {((planners.get('slabs') or {}).get('create', '—'))} / C {((planners.get('ceilings') or {}).get('create', '—'))}</td>"
        f"<td>{fmt(rel_error * 100 if isinstance(rel_error, (int, float)) else None, 1)}%</td>"
        f"<td class='links'>{links}</td>"
        "</tr>"
    )


html_doc = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apartment vector baseline 50 — 2026-10-03</title>
<style>
:root {{ color-scheme: light; --ink:#17202a; --muted:#607080; --line:#d6dde5; --accent:#145b8c; --ok:#087443; --warn:#a14a00; --panel:#f5f8fb; }}
* {{ box-sizing:border-box; }} body {{ margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:#fff; }}
main {{ max-width:1680px; margin:0 auto; padding:28px 34px 70px; }} h1 {{ margin:0 0 8px; font-size:28px; }} h2 {{ margin:30px 0 10px; font-size:20px; border-bottom:2px solid var(--line); padding-bottom:6px; }} h3 {{ margin:18px 0 6px; }} p {{ max-width:1100px; }} code {{ font-size:12px; }} a {{ color:var(--accent); }}
.lede {{ color:var(--muted); max-width:1000px; }} .cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin:20px 0; }} .card {{ border:1px solid var(--line); border-radius:8px; padding:12px 14px; background:var(--panel); }} .card-label {{ color:var(--muted); font-size:12px; }} .card-value {{ font-size:25px; font-weight:700; }} .card-detail {{ color:var(--muted); font-size:12px; }}
.callout {{ border-left:4px solid var(--accent); background:#edf6fb; padding:12px 16px; margin:14px 0; }} .warning {{ border-left-color:var(--warn); background:#fff5ec; }} .grid2 {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:18px; }} ul {{ margin-top:6px; }}
table {{ border-collapse:collapse; width:100%; font-size:12px; }} th,td {{ border:1px solid var(--line); padding:7px 6px; vertical-align:top; text-align:left; }} th {{ background:#eaf0f5; position:sticky; top:0; z-index:1; }} tr:nth-child(even) {{ background:#fafcfd; }} .status {{ font-weight:700; }} .status.ok {{ color:var(--ok); }} .status.reject {{ color:var(--warn); }} .links {{ line-height:1.8; white-space:nowrap; }} small {{ color:var(--muted); }}
.gallery {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px; }} figure {{ margin:0; }} figure img {{ display:block; width:100%; border:1px solid var(--line); }} figcaption {{ color:var(--muted); margin-top:4px; }}
@media print {{ main {{ padding:10px; }} .gallery img {{ max-height:180px; object-fit:contain; }} th {{ position:static; }} }}
</style>
</head>
<body><main>
<h1>Apartment vector baseline — additional 50 plans</h1>
<div class="lede">2026-10-03 현재 추출기(v13)와 importer의 동결된 기준선입니다. 이 보고서는 원본 JPG, CLI raw JSON, importer 결과, 공간/바닥/천장 계획, ID 충돌 probe, 차원 annotation 비교 및 오버레이를 같은 evidence 폴더에서 연결합니다.</div>
<div class="cards">
{card('선정 계획', len(results), '추가 unique plans')}
{card('고유 단지', manifest['selection']['distinctComplexes'], 'distinct complexes')}
{card('Importer 통과', status_counts.get('IMPORTED', 0), 'valid mm + scene build')}
{card('Importer 거절', status_counts.get('IMPORT_REJECTED', 0), 'honest reject')}
{card('평가 오류', status_counts.get('EVALUATION_ERROR', 0), 'unhandled errors')}
{card('레거시 충돌 케이스', len(machine['legacySpaceCollisions']), '12-char suffix probe')}
{card('레거시 lost loops', legacy_lost_loops, 'detected minus unique legacy ids')}
{card('ID 안정성 실패', len(machine['idempotenceFailures']), 'normalized geometry compare')}
{card('floor seed hits', f"{floor['roomInteriorSeedsInsideSlab']}/{floor['roomInteriorSeeds']}", 'reviewer room seeds inside slab')}
{card('outside-floor false positives', floor['outsideFloorFalsePositives'], 'structural probes')}
{card('false-wall candidates', wall_probes['falseWallCandidateCount'], 'explicit visual probes')}
</div>

<div class="callout"><strong>기준선 실행:</strong> vectorizer SHA-256 <code>{esc(vectors['vectorizerSha256'])}</code>, Python <code>{esc(vectors['python'])}</code>, docVersion 13, direct CLI workers 4. 90초 route-timeout 위험은 <strong>{len(machine['routeTimeoutRisk'])}</strong>건이었습니다. direct CLI limit는 180초였고, 각 elapsed는 raw summary에 남겼습니다.</div>
<div class="callout warning"><strong>차원 해석 경계:</strong> 원본 printed dimension은 시각 리뷰어가 읽은 annotation endpoint evidence입니다. vectorizer mmPerPx와 OCR/merge 결과는 독립적인 ground truth가 아니며, `visual-metrics.json`에 source span, document-scale span, endpoint ±8 px 불확실성을 따로 기록했습니다. p42 LH영천 159A의 19,773 mm annotation 대비 현재 document-scale span은 약 3,356 mm로 상대 오차 -83.0%입니다.</div>
<div class="callout"><strong>Floor surface evidence:</strong> slab planner가 실제로 생성한 polygon을 별도 gray/cyan layer로 렌더링했습니다. source-room zone 색상은 floor truth로 재사용하지 않았습니다. reviewer room seeds 중 {floor['roomInteriorSeedsInsideSlab']}/{floor['roomInteriorSeeds']}개가 slab polygon 안에 있었고, 명시적 outside-floor probe {floor['outsideFloorProbes']}개 중 false floor positive는 {floor['outsideFloorFalsePositives']}개였습니다. 원본과 probe 목록은 <code>floor-metrics.json</code>에 있습니다.</div>
<div class="callout warning"><strong>Explicit false-wall probe:</strong> p03 media-room window top gap의 source point <code>[363,140]</code>는 visual review에서 no-wall-peak으로 표시됐지만 baseline nearest imported wall은 7.6 px (stroke tolerance 15.4 px)로 측정되어 false-wall candidate로 기록됐습니다. 이 한 점은 global wall score가 아니며, raw geometry와 source evidence는 <code>wall-probe-metrics.json</code>에 있습니다.</div>

<h2>시각 비교</h2>
<div class="gallery">
<figure><a href="baseline-comparison-01-25.jpg"><img src="baseline-comparison-01-25.jpg" loading="lazy" alt="baseline comparisons 1-25"></a><figcaption>01–25 source | imported overlay</figcaption></figure>
<figure><a href="baseline-comparison-26-50.jpg"><img src="baseline-comparison-26-50.jpg" loading="lazy" alt="baseline comparisons 26-50"></a><figcaption>26–50 source | imported overlay</figcaption></figure>
<figure><a href="baseline-comparison-all-50.jpg"><img src="baseline-comparison-all-50.jpg" loading="lazy" alt="baseline comparisons all 50"></a><figcaption>all 50 contact sheet</figcaption></figure>
</div>

<h2>선정 균형</h2>
<div class="grid2"><div><h3>크기 bin</h3><ul>{''.join(f'<li>{esc(k)}: {v}</li>' for k,v in sorted(size_counts.items()))}</ul></div><div><h3>source-index bucket</h3><ul>{''.join(f'<li>{esc(k)}: {v}</li>' for k,v in sorted(index_counts.items()))}</ul></div><div><h3>style</h3><ul>{''.join(f'<li>{esc(k)}: {v}</li>' for k,v in sorted(style_counts.items()))}</ul></div></div>
<p>선정 알고리즘: <code>{esc(manifest['selection']['algorithm'])}</code>. 기존 vector-cache 계획 26건과 명시된 세 plan ID를 제외했으며, manifest에는 50개 distinct apartmentId가 기록되어 있습니다.</p>

<h2>케이스별 machine evidence</h2>
<p>W/O/R은 source document wall/opening/room 수입니다. spaces/unique는 현재 공간 추출 결과이며, legacy는 canonical signature 앞 12자만 사용했을 때의 충돌 케이스 수입니다. Z/S/C는 zone/slab/ceiling planner create 수입니다. dimension 오차는 annotation이 있는 케이스만 표시합니다.</p>
<div style="overflow:auto"><table><thead><tr><th>#</th><th>complex / plan</th><th>size / index</th><th>import</th><th>style / wall IoU</th><th>scale / source counts</th><th>spaces / legacy</th><th>planner creates</th><th>dimension Δ</th><th>artifacts</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>

<h2>재현 파일</h2>
<ul>
<li>{link('manifest.json', 'manifest.json')} — deterministic 50 selection and exclusions</li>
<li>{link('source-fetch-summary.json', 'source-fetch-summary.json')} — source HTTP status/hash summary (50/50 image/jpeg)</li>
<li>{link('vectorize-summary.json', 'vectorize-summary.json')} — raw CLI timings/status and pinned vectorizer hash</li>
<li>{link('machine-metrics.json', 'machine-metrics.json')} — importer, diagnostics, planners, dimensions and normalized idempotence</li>
<li>{link('visual-metrics.json', 'visual-metrics.json')} — source/document dimensions and overlay paths</li>
<li>{link('floor-metrics.json', 'floor-metrics.json')} — independent slab polygon and reviewer probe containment</li>
<li>{link('wall-probe-metrics.json', 'wall-probe-metrics.json')} — explicit source-review false-wall proximity probes</li>
<li>{link('ocr-cache-manifest.json', 'ocr-cache-manifest.json')} — copied per-plan baseline OCR cache hashes</li>
<li>{link('evaluate.ts', 'evaluate.ts')} / {link('render_overlays.py', 'render_overlays.py')} — evaluation and render harness source</li>
</ul>
<p><small>Generated by the evidence harness only. No product/source files were edited. Inferred geometry, OCR dimensions, and visual review probes retain their provenance labels.</small></p>
</main></body></html>
'''

(ROOT / "report.html").write_text(html_doc)
print(json.dumps({"path": str(ROOT / "report.html"), "rows": len(rows), "bytes": len(html_doc.encode())}))
