#!/usr/bin/env python3
"""Freeze the v15 apartment evidence inputs before a topology-only replay.

This script owns only the new topology evidence directory.  It hashes the
already-produced v15 raw documents, metrics, rendered outputs, and harness
sources; it does not run vectorization/import or touch the prior evidence
directory.  ``--check`` verifies the recorded hashes after a future source
change.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path


HERE = Path(__file__).resolve().parent
# HERE = <repo>/.omo/evidence/apartment-topology-refinement-20261003
REPO = HERE.parents[2]
OLD = REPO / ".omo/evidence/apartment-50-improvement-20261003"
SCALE = REPO / ".omo/evidence/apartment-scale-fix-20261003"
SHA_FILE = HERE / "baseline-freeze.sha256"
FREEZE_FILE = HERE / "baseline-freeze.json"
REPLAY_FILE = HERE / "replay-manifest.json"
READINESS_FILE = HERE / "baseline-readiness.html"


def read(path: Path):
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def frozen_paths() -> list[Path]:
    files = [
        OLD / name
        for name in (
            "manifest.json",
            "source-probes.json",
            "machine-metrics.json",
            "vectorize-summary.json",
            "baseline-floor-persistence-v13-metrics.json",
            "candidate-machine-metrics-v15-floor.json",
            "candidate-v15-floor-persistence-metrics.json",
            "paired-v15-floor-persistence-metrics.json",
            "paired-dimensions-v15.json",
            "verification-v15-floor-persistence.json",
            "paired-report-v15-floor-persistence.html",
            "evaluate_candidate.ts",
            "render_paired.py",
            "build_paired_report.py",
        )
    ]
    files.append(SCALE / "candidate-summary-v15.json")
    # Include every pinned raw document and every v15 overlay/evaluation file.
    # This makes the old baseline replayable without copying or mutating it.
    for root in (
        SCALE / "candidate15",
        OLD / "baseline-floor-persistence-v13",
        OLD / "candidate-v15-floor-persistence",
        OLD / "paired-v15-floor-persistence",
    ):
        files.extend(path for path in root.rglob("*") if path.is_file())
    # Hash this script too, so the replay records the exact guard that created
    # the manifest.  Its path is available once this file has been installed.
    files.append(HERE / "freeze_baseline.py")
    # These are byte-for-byte copies used from the new ROOT during replay;
    # keeping them beside the manifest avoids changing the prior harness.
    for name in ("evaluate_candidate.ts", "render_paired.py", "build_paired_report.py"):
        files.append(HERE / name)
    unique = {path.resolve() for path in files}
    missing = sorted(path for path in unique if not path.exists())
    if missing:
        raise FileNotFoundError("missing frozen input(s): " + ", ".join(rel(path) for path in missing))
    return sorted(unique, key=rel)


def metrics_snapshot() -> dict:
    paired = read(OLD / "paired-v15-floor-persistence-metrics.json")
    candidate = paired["candidate"]
    baseline = paired["baseline"]
    base_by_key = {row["key"]: row for row in baseline["cases"]}
    cand_by_key = {row["key"]: row for row in candidate["cases"]}
    common = [
        key
        for key, row in base_by_key.items()
        if row.get("status") == "IMPORTED" and cand_by_key.get(key, {}).get("status") == "IMPORTED"
    ]
    common_total = sum(base_by_key[key]["floor"]["roomInteriorSeeds"]["total"] for key in common)
    common_base = sum(base_by_key[key]["floor"]["roomInteriorSeeds"]["insideSlab"] for key in common)
    common_candidate = sum(cand_by_key[key]["floor"]["roomInteriorSeeds"]["insideSlab"] for key in common)
    candidate_statuses = {
        status: sum(row.get("status") == status for row in candidate["cases"])
        for status in sorted({row.get("status") for row in candidate["cases"]})
    }
    baseline_statuses = {
        status: sum(row.get("status") == status for row in baseline["cases"])
        for status in sorted({row.get("status") for row in baseline["cases"]})
    }
    candidate_machine = read(OLD / "candidate-machine-metrics-v15-floor.json")
    persisted = candidate.get("initialPersistedSurfaces") or {}
    if candidate["totalPlans"] != 50:
        raise AssertionError("expected 50 candidate plans")
    if candidate_statuses != {"IMPORTED": 44, "IMPORT_REJECTED": 6}:
        raise AssertionError(f"unexpected candidate status counts: {candidate_statuses}")
    if candidate.get("errors", 0) not in (0, None):
        raise AssertionError(f"unexpected candidate errors: {candidate.get('errors')}")
    if (candidate["roomSeeds"]["probeWeighted"]["inside"], candidate["roomSeeds"]["probeWeighted"]["total"]) != (232, 330):
        raise AssertionError("candidate room seed metric changed")
    geometry = candidate["slabGeometry"]
    if geometry["selfIntersectionCases"] != 4 or geometry["overlapPairs"] != 405:
        raise AssertionError("candidate geometry diagnostic changed")
    if abs(float(geometry["overlapAreaM2"]) - 20.52898024923811) > 1e-12:
        raise AssertionError("candidate overlap area changed")
    if (common_base, common_candidate, common_total) != (235, 232, 330):
        raise AssertionError("common accepted seed metric changed")
    if persisted.get("storedSlabs") != 309 or persisted.get("storedCeilings") != 309:
        raise AssertionError("candidate stored surface counts changed")
    return {
        "plans": 50,
        "baselineStatuses": baseline_statuses,
        "candidateStatuses": candidate_statuses,
        "candidateErrors": 0,
        "commonAcceptedImportedCases": len(common),
        "commonAcceptedRoomSeeds": {
            "baselineInside": common_base,
            "candidateInside": common_candidate,
            "total": common_total,
        },
        "candidateRoomSeeds": candidate["roomSeeds"]["probeWeighted"],
        "candidateSlabGeometry": {
            "selfIntersectionCases": geometry["selfIntersectionCases"],
            "selfIntersectionPolygonCount": geometry["selfIntersectionPolygonCount"],
            "selfIntersectionCount": geometry["selfIntersectionCount"],
            "overlapCases": geometry["overlapCases"],
            "overlapPairs": geometry["overlapPairs"],
            "overlapAreaM2": geometry["overlapAreaM2"],
            "overlapAreaM2Rounded": round(float(geometry["overlapAreaM2"]), 5),
        },
        "candidateStoredSurfaces": {
            "slabs": persisted.get("storedSlabs"),
            "ceilings": persisted.get("storedCeilings"),
            "nonzeroClosedLoopCases": persisted.get("casesWithStoredSlabs"),
            "importedCases": candidate["importedCases"],
            "exactSlabMatches": persisted.get("exactSlabPlanMatches"),
            "exactCeilingMatches": persisted.get("exactCeilingPlanMatches"),
        },
        "candidateMachineSurfaceCounts": candidate_machine.get("initialPersistedSurfaces"),
    }


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n")


def render_readiness(snapshot: dict, vectorizer_sha: str, mm_per_px: float, hash_count: int, hash_manifest_sha: str) -> str:
    def esc(value) -> str:
        return html.escape(str(value))

    metric_rows = "".join(
        f"<tr><th>{esc(label)}</th><td>{esc(value)}</td><td>{esc(note)}</td></tr>"
        for label, value, note in (
            ("후보 상태", "44 IMPORTED / 6 IMPORT_REJECTED / 0 errors", "50 pinned v15 plans"),
            ("공통 accepted seeds", "235 → 232 / 330", "baseline → candidate; 44 common imported cases"),
            ("후보 self-intersection", "4 cases", "computed slabPlan.create diagnostic"),
            ("후보 overlap", "405 pairs / 20.52898 m²", "planned polygons; not live DB persistence"),
            ("후보 serialized surfaces", "309 slabs / 309 ceilings", "buildVectorNodes JSON; 43/44 cases nonzero; exact 44/44"),
        )
    )
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apartment topology refinement — baseline readiness</title>
<style>
:root{{color-scheme:light dark;--bg:#f7f7f8;--card:#fff;--fg:#17181a;--muted:#61656b;--line:#d8dbe0;--accent:#1257a6;--warn:#8a4b00}}
@media(prefers-color-scheme:dark){{:root{{--bg:#17181a;--card:#222428;--fg:#f4f5f6;--muted:#b5bac2;--line:#454a53;--accent:#8db9ff;--warn:#ffc477}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}}
main{{max-width:1100px;margin:auto;padding:28px 18px 56px}}h1{{margin:0 0 6px;font-size:27px}}h2{{margin:30px 0 10px;font-size:19px}}p{{margin:8px 0}}.sub{{color:var(--muted)}}
.status{{background:var(--card);border:2px solid var(--accent);border-radius:12px;padding:16px 18px;margin:18px 0}}.status strong{{color:var(--accent)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}}.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}.card b{{display:block;font-size:20px}}.card small{{color:var(--muted)}}
table{{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line)}}th,td{{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}th{{width:24%}}code{{font-size:.9em;overflow-wrap:anywhere}}a{{color:var(--accent)}}ul{{padding-left:22px}}.warn{{color:var(--warn)}}
@media print{{body{{background:#fff;color:#000}}main{{max-width:none;padding:0}}.status,.card,table{{break-inside:avoid}}a{{color:#000;text-decoration:none}}}}
</style></head><body><main>
<h1>아파트 topology refinement 기준선 준비</h1>
<p class="sub">evidence-only · frozen v15 floor-persistence outputs · {esc(dt.datetime.now().astimezone().isoformat())}</p>
<div class="status"><strong>BASELINE FROZEN / CANDIDATE NOT RUN</strong><br>
기존 v15 raw JSON·metrics·render output과 harness hash를 새 evidence 경계에 고정했습니다. 승인된 graph-planarization plan과 product/source freeze 뒤에만 core-only replay를 실행합니다.</div>
<div class="grid">
<div class="card"><small>resolved model</small><b>gpt-5.6-luna</b><small>reasoning: max</small></div>
<div class="card"><small>pinned plans</small><b>50</b><small>same v15 rawdocs</small></div>
<div class="card"><small>candidate status</small><b>44 / 6</b><small>IMPORTED / REJECTED</small></div>
<div class="card"><small>hash entries</small><b>{hash_count}</b><small>manifest sha {esc(hash_manifest_sha[:16])}…</small></div>
</div>
<h2>Frozen metrics</h2><table><thead><tr><th>Metric</th><th>Value</th><th>Definition</th></tr></thead><tbody>{metric_rows}</tbody></table>
<h2>Replay gates</h2><ul>
<li class="warn">Sol/high approved plan: <code>.omo/plans/apartment-50-residual-improvement-20261003.md</code> and exact topology scope must be recorded before run.</li>
<li class="warn">Product/source freeze: record the post-plan source hash; do not run against a moving checkout.</li>
<li>Run <code>freeze_baseline.py --check</code> first. A hash mismatch is a hard stop.</li>
<li>Reuse the pinned raw docs only; do not rerun vectorization and do not open a browser/server route.</li>
<li>Write candidate evaluation, imported JSON, paired renders, and report under this folder’s new roots. Existing v15 artifacts remain read-only.</li>
</ul>
<h2>P19 annotation correction (new evidence only)</h2>
<p>The old v15 reviewer annotation used the top overall dimension endpoint <code>[327,883]</code>. Direct source inspection measures the visible full line at approximately <code>[327,915]</code>; printed value is <code>10246 mm</code>. With the frozen candidate <code>mmPerPx={esc(mm_per_px)}</code> this correction derives approximately <code>10207.52 mm</code>, relative error <code>-0.3755%</code>, and changes the candidate strict eligible count from <code>43/44</code> to <code>44/44</code> (all-source accounting <code>43/50</code> to <code>44/50</code>). This is an annotation correction, not a product scale fix; the old v15 JSON/report remains unchanged.</p>
<p><a href="p19-dimension-annotation-correction.json">p19 correction record</a> · <a href="baseline-freeze.json">freeze record</a> · <a href="baseline-freeze.sha256">SHA-256 manifest</a> · <a href="replay-manifest.json">replay manifest</a></p>
<h2>Frozen source references</h2><ul>
<li><a href="../apartment-scale-fix-20261003/candidate15/">candidate15 raw JSON directory</a> · summary <a href="../apartment-scale-fix-20261003/candidate-summary-v15.json">candidate-summary-v15.json</a></li>
<li><a href="../apartment-50-improvement-20261003/paired-v15-floor-persistence-metrics.json">paired v15 metrics</a> · <a href="../apartment-50-improvement-20261003/candidate-v15-floor-persistence-metrics.json">candidate metrics</a> · <a href="../apartment-50-improvement-20261003/paired-dimensions-v15.json">frozen dimensions</a></li>
<li>vectorizer SHA-256: <code>{esc(vectorizer_sha)}</code></li>
</ul>
<p class="sub">이 페이지는 baseline readiness 기록입니다. 다음 candidate replay는 승인된 plan/source freeze가 기록되기 전에는 실행하지 않습니다.</p>
</main></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify the existing freeze hash manifest")
    args = parser.parse_args()
    if args.check:
        if not SHA_FILE.exists() or not FREEZE_FILE.exists():
            raise SystemExit("baseline freeze is not present")
        failures = []
        entries = [line.split("  ", 1) for line in SHA_FILE.read_text().splitlines() if line.strip()]
        for expected, path_text in entries:
            path = REPO / path_text
            actual = sha256(path) if path.exists() else "MISSING"
            if actual != expected:
                failures.append({"path": path_text, "expected": expected, "actual": actual})
        if failures:
            print(json.dumps({"ok": False, "failures": failures}, indent=2))
            raise SystemExit(1)
        frozen = read(FREEZE_FILE)
        print(json.dumps({"ok": True, "hashEntries": len(entries), "hashManifestSha256": sha256(SHA_FILE), "frozenAt": frozen.get("frozenAt")}, indent=2))
        return
    if FREEZE_FILE.exists() or SHA_FILE.exists() or REPLAY_FILE.exists():
        raise SystemExit("freeze artifacts already exist; use --check")
    snapshot = metrics_snapshot()
    manifest = read(OLD / "manifest.json")
    candidate_summary = read(SCALE / "candidate-summary-v15.json")
    paths = frozen_paths()
    lines = [f"{sha256(path)}  {rel(path)}" for path in paths]
    SHA_FILE.write_text("\n".join(lines) + "\n")
    hash_manifest_sha = sha256(SHA_FILE)
    root_counts = {}
    for path in paths:
        if path.is_relative_to(SCALE / "candidate15"):
            root_counts["candidate15"] = root_counts.get("candidate15", 0) + 1
        elif path.is_relative_to(OLD / "baseline-floor-persistence-v13"):
            root_counts["baseline-floor-persistence-v13"] = root_counts.get("baseline-floor-persistence-v13", 0) + 1
        elif path.is_relative_to(OLD / "candidate-v15-floor-persistence"):
            root_counts["candidate-v15-floor-persistence"] = root_counts.get("candidate-v15-floor-persistence", 0) + 1
        elif path.is_relative_to(OLD / "paired-v15-floor-persistence"):
            root_counts["paired-v15-floor-persistence"] = root_counts.get("paired-v15-floor-persistence", 0) + 1
        else:
            root_counts["aggregate-and-harness"] = root_counts.get("aggregate-and-harness", 0) + 1
    freeze = {
        "schemaVersion": "apartment-topology-baseline-freeze-v1",
        "frozenAt": dt.datetime.now().astimezone().isoformat(),
        "resolvedModel": "gpt-5.6-luna",
        "reasoningEffort": "max",
        "status": "baseline-frozen-candidate-not-run",
        "scope": {
            "coreOnlyTopologyRefinement": True,
            "sameFrozenV15RawDocs": True,
            "noVectorizerRerun": True,
            "noBrowserOrServerRun": True,
            "oldArtifactsReadOnly": True,
            "productSourceModifiedByThisLane": False,
        },
        "planSelection": {
            "manifest": rel(OLD / "manifest.json"),
            "plans": len(manifest["plans"]),
            "excludedPlanIds": manifest["selection"].get("excludedPlanIds", []),
            "vectorizerSha256": candidate_summary.get("vectorizerSha256"),
            "docVersions": candidate_summary.get("docVersions"),
        },
        "metrics": snapshot,
        "frozenRoots": root_counts,
        "hashManifest": {"path": rel(SHA_FILE), "sha256": hash_manifest_sha, "entryCount": len(paths)},
        "sourceReferences": {
            "rawDocs": rel(SCALE / "candidate15"),
            "candidateSummary": rel(SCALE / "candidate-summary-v15.json"),
            "pairedMetrics": rel(OLD / "paired-v15-floor-persistence-metrics.json"),
            "candidateMetrics": rel(OLD / "candidate-v15-floor-persistence-metrics.json"),
            "verification": rel(OLD / "verification-v15-floor-persistence.json"),
            "report": rel(OLD / "paired-report-v15-floor-persistence.html"),
        },
    }
    write_json(FREEZE_FILE, freeze)

    replay = {
        "schemaVersion": "apartment-topology-core-replay-v1",
        "status": "prepared-not-run",
        "resolvedModel": "gpt-5.6-luna",
        "reasoningEffort": "max",
        "approvedPlanRequired": True,
        "sourceFreezeRequired": True,
        "preserveOldArtifacts": True,
        "scope": {
            "candidateOnly": True,
            "coreOnly": True,
            "sameRawDocuments": rel(SCALE / "candidate15"),
            "noVectorizerRerun": True,
            "noBrowserOrServer": True,
            "expectedOutputs": "new evaluation/imported/paired/report roots under this evidence folder",
        },
        "approvalFlags": [
            "approved Sol/high graph-planarization plan path and revision recorded",
            "product/source freeze hash recorded after the approved plan",
            "freeze_baseline.py --check passes immediately before replay",
        ],
        "frozenInputs": {
            "manifest": rel(OLD / "manifest.json"),
            "sourceProbes": rel(OLD / "source-probes.json"),
            "baselineReplayRoot": rel(OLD),
            "rawCandidateDirectory": rel(SCALE / "candidate15"),
            "candidateSummary": rel(SCALE / "candidate-summary-v15.json"),
        },
        "newOutputRoots": {
            "evaluation": "candidate-evaluation-topology-approved",
            "imported": "candidate-imported-topology-approved",
            "baselineRender": "baseline-replay-topology-approved",
            "candidateRender": "candidate-topology-approved",
            "pairedRender": "paired-topology-approved",
            "candidateMetrics": "candidate-machine-metrics-topology-approved.json",
            "pairedMetrics": "paired-topology-approved-metrics.json",
            "report": "paired-report-topology-approved.html",
        },
        "harnesses": {
            "evaluateCandidate": rel(HERE / "evaluate_candidate.ts"),
            "renderPaired": rel(HERE / "render_paired.py"),
            "buildReport": rel(HERE / "build_paired_report.py"),
            "sourceHashesFrozenIn": rel(SHA_FILE),
        },
        "commands": {
            "verifyFreeze": [f"python3 {rel(HERE / 'freeze_baseline.py')} --check"],
            "evaluateCandidate": [
                f"bun run {rel(HERE / 'evaluate_candidate.ts')}",
                "  --model-label candidate-topology-approved",
                f"  --candidate-dir {rel(SCALE / 'candidate15')}",
                f"  --candidate-summary {rel(SCALE / 'candidate-summary-v15.json')}",
                f"  --evaluation-root {rel(HERE / 'candidate-evaluation-topology-approved')}",
                f"  --imported-root {rel(HERE / 'candidate-imported-topology-approved')}",
                f"  --aggregate {rel(HERE / 'candidate-machine-metrics-topology-approved.json')}",
            ],
            "renderPaired": [
                "stage read-only links/copies into the new evidence folder so ROOT-relative harness paths resolve",
                f"python3 {rel(HERE / 'render_paired.py')}",
                "  --candidate-label topology-approved --run-id topology-approved",
                f"  --candidate-dir {rel(SCALE / 'candidate15')}",
                f"  --candidate-evaluation-root {rel(HERE / 'candidate-evaluation-topology-approved')}",
                f"  --candidate-imported-root {rel(HERE / 'candidate-imported-topology-approved')}",
                f"  --baseline-output {rel(HERE / 'baseline-replay-topology-approved')}",
                f"  --candidate-output {rel(HERE / 'candidate-topology-approved')}",
                f"  --paired-output {rel(HERE / 'paired-topology-approved')}",
                f"  --baseline-metrics {rel(HERE / 'baseline-replay-topology-approved-metrics.json')}",
                f"  --candidate-metrics {rel(HERE / 'candidate-topology-approved-metrics.json')}",
                f"  --paired-metrics {rel(HERE / 'paired-topology-approved-metrics.json')}",
            ],
            "buildReport": [
                "run the exact frozen build_paired_report.py copy from the new evidence ROOT",
                f"python3 {rel(HERE / 'build_paired_report.py')} --run-id topology-approved",
                f"  --dimension {rel(OLD / 'paired-dimensions-v15.json')}",
                f"  --candidate-summary {rel(SCALE / 'candidate-summary-v15.json')}",
                f"  --candidate-machine {rel(HERE / 'candidate-topology-approved-metrics.json')}",
                f"  --baseline-machine {rel(OLD / 'machine-metrics.json')}",
                f"  --candidate-evaluation-root {rel(HERE / 'candidate-evaluation-topology-approved')}",
                f"  --output {rel(HERE / 'paired-report-topology-approved.html')}",
            ],
        },
    }
    write_json(REPLAY_FILE, replay)
    mm_per_px = read(SCALE / "candidate15/3FO3THYUWS3C.json")["mmPerPx"]
    READINESS_FILE.write_text(render_readiness(snapshot, candidate_summary["vectorizerSha256"], mm_per_px, len(paths), hash_manifest_sha))
    print(json.dumps({"status": freeze["status"], "hashEntries": len(paths), "hashManifestSha256": hash_manifest_sha, "metrics": snapshot}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
