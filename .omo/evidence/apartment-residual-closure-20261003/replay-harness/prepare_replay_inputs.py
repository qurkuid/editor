#!/usr/bin/env python3
"""Guard and pin the residual-closure replay inputs.

This preparation step writes only under the new ``replay`` evidence root.  It
never copies, rewrites, or deletes files in the historical evidence roots or
in product source.  The eventual candidate command must pass an explicit
source-freeze record; this manifest intentionally remains
``PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE`` until then.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence/apartment-residual-closure-20261003"
NEW_ROOT = EVIDENCE / "replay"
HARNESS_ROOT = EVIDENCE / "replay-harness"

PLAN = REPO / ".omo/plans/apartment-residual-closure-20261003.md"
PARENT_MANIFEST = EVIDENCE / "baseline-parent/baseline-manifest.json"
PARENT_VERIFICATION = EVIDENCE / "performance/baseline-verification.json"
BASELINE_BENCHMARK = EVIDENCE / "performance/baseline-v15-current-0b926754-stress-100-500-1000-final-detector-benchmark.json"
RAW_ROOT = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
RAW_SUMMARY = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate-summary-v15.json"
SOURCE_MANIFEST = REPO / ".omo/evidence/apartment-50-improvement-20261003/manifest.json"
SOURCE_PROBES = REPO / ".omo/evidence/apartment-50-improvement-20261003/source-probes.json"
DIMENSIONS = REPO / ".omo/evidence/apartment-50-improvement-20261003/paired-dimensions-v15.json"
SOURCE_ROOT = REPO / ".omo/evidence/apartment-topology-refinement-20261003"
ANNOTATION_FREEZE = EVIDENCE / "annotation-image-freeze.json"
BEFORE_IMPORTED = REPO / ".omo/evidence/apartment-topology-refinement-20261003/candidate-imported-topology-final-0b926754"
BEFORE_EVALUATION = REPO / ".omo/evidence/apartment-topology-refinement-20261003/candidate-evaluation-topology-final-0b926754"
BEFORE_METRICS = REPO / ".omo/evidence/apartment-topology-refinement-20261003/candidate-machine-metrics-topology-final-0b926754.json"
BASELINE_SOURCE_SNAPSHOTS = EVIDENCE / "baseline-parent/source-snapshots"
BASELINE_PARENT_SOURCE_MANIFEST = EVIDENCE / "baseline-parent/baseline-manifest.json"

EXPECTED_COUNTS = {"plans": 50, "raw": 50, "imported": 44, "evaluation": 50, "roomSeeds": 378}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def require_file(path: Path) -> Path:
    if not path.is_file():
        raise SystemExit(f"missing required file: {path}")
    return path


def require_dir(path: Path) -> Path:
    if not path.is_dir():
        raise SystemExit(f"missing required directory: {path}")
    return path


def file_record(path: Path, *, kind: str) -> dict[str, Any]:
    require_file(path)
    return {"path": rel(path), "kind": kind, "sha256": sha256(path), "bytes": path.stat().st_size}


def directory_record(path: Path, *, kind: str, suffix: str = ".json") -> dict[str, Any]:
    require_dir(path)
    files = [p for p in sorted(path.iterdir()) if p.is_file() and (not suffix or p.suffix == suffix)]
    return {
        "path": rel(path),
        "kind": kind,
        "fileCount": len(files),
        "files": [file_record(p, kind=f"{kind}-file") for p in files],
        "treeSha256": hashlib.sha256(
            "".join(f"{rel(p)}\t{sha256(p)}\n" for p in files).encode()
        ).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="residual-closure-prepared-20261003")
    parser.add_argument("--output", type=Path, default=NEW_ROOT / "replay-manifest.json")
    args = parser.parse_args()

    output = args.output.resolve()
    if NEW_ROOT.resolve() not in output.parents:
        raise SystemExit(f"refusing output outside new replay root: {output}")

    for path in (
        PLAN,
        PARENT_MANIFEST,
        PARENT_VERIFICATION,
        BASELINE_BENCHMARK,
        RAW_SUMMARY,
        SOURCE_MANIFEST,
        SOURCE_PROBES,
        DIMENSIONS,
        BEFORE_METRICS,
        ANNOTATION_FREEZE,
    ):
        require_file(path)
    for path in (RAW_ROOT, SOURCE_ROOT, BEFORE_IMPORTED, BEFORE_EVALUATION, BASELINE_SOURCE_SNAPSHOTS):
        require_dir(path)

    source_manifest = json.loads(SOURCE_MANIFEST.read_text())
    plans = source_manifest.get("plans")
    if not isinstance(plans, list) or len(plans) != EXPECTED_COUNTS["plans"]:
        raise SystemExit(f"expected 50 source plans, found {len(plans) if isinstance(plans, list) else 0}")
    plan_ids = [str(item.get("planId")) for item in plans]
    if len(set(plan_ids)) != len(plan_ids):
        raise SystemExit("source manifest has duplicate plan IDs")

    raw_paths = sorted(RAW_ROOT.glob("*.json"))
    raw_ids = [p.stem for p in raw_paths]
    if len(raw_paths) != EXPECTED_COUNTS["raw"] or set(raw_ids) != set(plan_ids):
        raise SystemExit(f"raw V15 set mismatch: files={len(raw_paths)} ids={len(set(raw_ids)) ^ len(set(plan_ids))}")

    raw_summary = json.loads(RAW_SUMMARY.read_text())
    summary_results = raw_summary.get("results")
    summary_ids = [str(item.get("planId")) for item in summary_results or []]
    if len(summary_ids) != EXPECTED_COUNTS["plans"] or set(summary_ids) != set(plan_ids):
        raise SystemExit("candidate-summary-v15 does not cover the same 50 plan IDs")

    before_imported_paths = sorted(BEFORE_IMPORTED.glob("*.json"))
    before_evaluation_paths = sorted(BEFORE_EVALUATION.glob("*.json"))
    if len(before_imported_paths) != EXPECTED_COUNTS["imported"]:
        raise SystemExit(f"expected 44 before imported files, found {len(before_imported_paths)}")
    if len(before_evaluation_paths) != EXPECTED_COUNTS["evaluation"]:
        raise SystemExit(f"expected 50 before evaluation files, found {len(before_evaluation_paths)}")

    probes = json.loads(SOURCE_PROBES.read_text())
    room_seeds = probes.get("roomSeeds")
    if not isinstance(room_seeds, list) or len(room_seeds) != EXPECTED_COUNTS["roomSeeds"]:
        raise SystemExit(f"expected 378 unchanged source room seeds, found {len(room_seeds) if isinstance(room_seeds, list) else 0}")

    dimensions = json.loads(DIMENSIONS.read_text())
    if len(dimensions.get("paired", [])) != EXPECTED_COUNTS["plans"]:
        raise SystemExit("dimension annotation set does not cover all 50 plans")

    annotation_freeze = json.loads(ANNOTATION_FREEZE.read_text())
    if annotation_freeze.get("count") != 52 or len(annotation_freeze.get("files", [])) != 52:
        raise SystemExit("annotation image freeze must contain 52 files (manifest, probes, 50 source JPGs)")
    source_probe_hash = sha256(SOURCE_PROBES)
    if annotation_freeze.get("sourceProbeManifestSha256") != source_probe_hash:
        raise SystemExit("annotation freeze does not match current source-probes SHA")
    annotation_records: list[dict[str, Any]] = []
    for frozen in annotation_freeze.get("files", []):
        frozen_path = require_file(REPO / frozen["path"])
        actual_frozen_sha = sha256(frozen_path)
        if actual_frozen_sha != frozen["sha256"]:
            raise SystemExit(f"annotation freeze hash mismatch: {frozen['path']}")
        annotation_records.append({"path": frozen["path"], "sha256": actual_frozen_sha, "bytes": frozen_path.stat().st_size})

    parent_manifest = json.loads(PARENT_MANIFEST.read_text())
    parent_files = parent_manifest.get("files", [])
    if parent_manifest.get("verified") is not True or len(parent_files) != 168:
        raise SystemExit("parent 168-file freeze is not verified")
    source_entries = [item for item in parent_files if item.get("kind") == "source"]
    if len(source_entries) != 24:
        raise SystemExit(f"expected 24 source entries in parent freeze, found {len(source_entries)}")
    source_snapshot_records: list[dict[str, Any]] = []
    for entry in source_entries:
        snapshot = BASELINE_SOURCE_SNAPSHOTS / entry["path"]
        require_file(snapshot)
        actual = sha256(snapshot)
        if actual != entry["sha256"]:
            raise SystemExit(f"source snapshot hash mismatch: {entry['path']}")
        source_snapshot_records.append({
            "sourcePath": entry["path"],
            "snapshotPath": rel(snapshot),
            "sha256": actual,
        })

    before_metrics = json.loads(BEFORE_METRICS.read_text())
    expected_before_counts = {
        "total": before_metrics.get("total"),
        "imported": before_metrics.get("imported"),
        "rejected": before_metrics.get("rejected"),
        "errors": before_metrics.get("errors"),
    }
    if expected_before_counts != {"total": 50, "imported": 44, "rejected": 6, "errors": 0}:
        raise SystemExit(f"unexpected current 0b926 before machine counts: {expected_before_counts}")

    file_sets = {
        "rawV15": directory_record(RAW_ROOT, kind="raw-v15"),
        "beforeImportedCurrent0b926": directory_record(BEFORE_IMPORTED, kind="before-imported"),
        "beforeEvaluationCurrent0b926": directory_record(BEFORE_EVALUATION, kind="before-evaluation"),
    }
    frozen_files = [
        file_record(PLAN, kind="approved-plan"),
        file_record(PARENT_MANIFEST, kind="parent-freeze-manifest"),
        file_record(PARENT_VERIFICATION, kind="baseline-verification"),
        file_record(BASELINE_BENCHMARK, kind="before-timing-benchmark"),
        file_record(RAW_SUMMARY, kind="raw-summary"),
        file_record(SOURCE_MANIFEST, kind="source-plan-manifest"),
        file_record(SOURCE_PROBES, kind="source-probes"),
        file_record(DIMENSIONS, kind="dimension-annotations"),
        file_record(ANNOTATION_FREEZE, kind="annotation-image-freeze"),
        file_record(BEFORE_METRICS, kind="before-machine-metrics"),
    ]

    benchmark = json.loads(BASELINE_BENCHMARK.read_text())
    real_p95 = benchmark.get("aggregate", {}).get("realDetectorP95Ms")
    if real_p95 is None:
        raise SystemExit("baseline benchmark lacks aggregate.realDetectorP95Ms")
    gate_p95 = float(real_p95) * 1.25

    payload: dict[str, Any] = {
        "schemaVersion": "apartment-residual-closure-replay-inputs-v1",
        "createdAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "status": "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE",
        "candidateRunExecuted": False,
        "run": {
            "preparedRunId": args.run_id,
            "candidateRunIdTemplate": "residual-closure-after-<source-freeze-id>",
            "explicitRunIdRequired": True,
            "sourceFreezeRequired": True,
            "sourceFreezeMustBePassedAtCandidateTime": True,
        },
        "scope": {
            "sameRawDocuments": True,
            "rawDocumentVersion": 15,
            "rawRasterRerun": False,
            "sameSourceProbesAndAnnotations": True,
            "frozenSourceImages": True,
            "roomSeedCount": len(room_seeds),
            "acceptedRoomSeedCountExpected": 330,
            "rejectedCaseCountExpected": 6,
            "beforeUsesCurrent0b926ImportedEvaluation": True,
            "oldV15FloorBaselineForbidden": True,
            "writesAllowedOnlyUnder": rel(NEW_ROOT),
        },
        "approvedPlan": file_record(PLAN, kind="approved-plan"),
        "baseline": {
            "parentFreezeManifest": file_record(PARENT_MANIFEST, kind="parent-freeze-manifest"),
            "parentVerification": file_record(PARENT_VERIFICATION, kind="baseline-verification"),
            "beforeTimingBenchmark": file_record(BASELINE_BENCHMARK, kind="before-timing-benchmark"),
            "beforeTiming": {
                "realP95Ms": real_p95,
                "candidateP95GateMs": round(float(real_p95) * 1.25, 6),
                "protocol": benchmark.get("protocol", {}),
                "ratioStatus": "UNVERIFIED_UNTIL_AFTER_RUN",
            },
            "rawRoot": rel(RAW_ROOT),
            "rawSummary": file_record(RAW_SUMMARY, kind="raw-summary"),
            "planManifest": file_record(SOURCE_MANIFEST, kind="source-plan-manifest"),
            "sourceRoot": rel(SOURCE_ROOT),
            "sourceProbes": file_record(SOURCE_PROBES, kind="source-probes"),
            "dimensionAnnotations": file_record(DIMENSIONS, kind="dimension-annotations"),
            "annotationImageFreeze": {"manifest": file_record(ANNOTATION_FREEZE, kind="annotation-image-freeze"), "count": len(annotation_records), "files": annotation_records},
            "importedRootCurrent0b926": directory_record(BEFORE_IMPORTED, kind="before-imported"),
            "evaluationRootCurrent0b926": directory_record(BEFORE_EVALUATION, kind="before-evaluation"),
            "machineMetricsCurrent0b926": file_record(BEFORE_METRICS, kind="before-machine-metrics"),
            "machineCounts": expected_before_counts,
        },
        "sourceSnapshots": {
            "parentSourceCount": len(source_snapshot_records),
            "parentManifest": rel(BASELINE_PARENT_SOURCE_MANIFEST),
            "records": source_snapshot_records,
            "requiredForBeforeCopy": [
                "packages/core/src/lib/space-detection.ts",
                "packages/core/src/lib/room-boundary.ts",
                "apps/editor/lib/apt-vector-scene.ts",
            ],
            "candidateSourceFreezeRecordRequired": True,
            "candidateSourceFreezePath": None,
        },
        "frozenFiles": frozen_files,
        "fileSets": file_sets,
        "outputs": {
            "root": rel(NEW_ROOT),
            "candidateEvaluationTemplate": f"{rel(NEW_ROOT)}/candidate-evaluation-<run-id>",
            "candidateImportedTemplate": f"{rel(NEW_ROOT)}/candidate-imported-<run-id>",
            "beforeRenderTemplate": f"{rel(NEW_ROOT)}/before-<run-id>",
            "candidateRenderTemplate": f"{rel(NEW_ROOT)}/candidate-<run-id>",
            "pairedRenderTemplate": f"{rel(NEW_ROOT)}/paired-<run-id>",
            "candidateMetricsTemplate": f"{rel(NEW_ROOT)}/candidate-machine-<run-id>.json",
            "pairedMetricsTemplate": f"{rel(NEW_ROOT)}/paired-<run-id>-metrics.json",
            "reportTemplate": f"{rel(NEW_ROOT)}/report-<run-id>.html",
            "timingTemplate": f"{rel(NEW_ROOT)}/after-timing-<run-id>.json",
            "provenanceTemplate": f"{rel(NEW_ROOT)}/provenance-<run-id>.json",
        },
        "harnesses": {
            "prepare": rel(HARNESS_ROOT / "prepare_replay_inputs.py"),
            "verify": rel(HARNESS_ROOT / "verify_replay_inputs.py"),
            "evaluate": rel(HARNESS_ROOT / "evaluate_candidate.ts"),
            "render": rel(HARNESS_ROOT / "render_paired.py"),
            "report": rel(HARNESS_ROOT / "build_replay_report.py"),
            "orchestrator": rel(HARNESS_ROOT / "run_candidate_replay.py"),
        },
        "guards": {
            "parentInputVerificationCommand": "python3 .omo/evidence/apartment-residual-closure-20261003/verify_inputs.py <new-root-output>.json",
            "candidatePhaseRequiresSourceFreeze": True,
            "candidatePhaseRequiresCurrent0b926BeforePaths": True,
            "candidatePhaseRequiresExplicitOutputRoots": True,
            "candidatePhaseMustNotWriteHistoricalRoots": True,
            "timingGate": f"after realDetectorP95Ms <= {gate_p95:.6f} ms (1.25x baseline); exact before/after ratio otherwise UNVERIFIED",
            "timeoutSemantics": "round errors and measured elapsed times are recorded; no interrupt watchdog is inferred",
        },
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output": rel(output),
        "status": payload["status"],
        "runId": args.run_id,
        "counts": {"plans": len(plans), "raw": len(raw_paths), "beforeImported": len(before_imported_paths), "beforeEvaluation": len(before_evaluation_paths), "roomSeeds": len(room_seeds), "sourceSnapshots": len(source_snapshot_records), "frozenAnnotationFiles": len(annotation_records)},
        "baselineRealP95Ms": real_p95,
        "candidateP95GateMs": gate_p95,
        "candidateRunExecuted": False,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
