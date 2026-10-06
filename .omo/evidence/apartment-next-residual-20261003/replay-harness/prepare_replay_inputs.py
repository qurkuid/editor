#!/usr/bin/env python3
"""Prepare the next residual replay without running a candidate.

This is an evidence-only adapter around the frozen eba42adc replay inputs.  It
writes a manifest under the next evidence root and refuses to rasterize,
vectorize, import, or touch historical evidence.  A later evaluator still
requires a parent-delivered source-freeze record.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / ".omo/evidence/apartment-next-residual-20261003"
NEW_ROOT = EVIDENCE / "replay"
BASELINE_MANIFEST = EVIDENCE / "baseline-manifest.json"
OLD_EVIDENCE = REPO / ".omo/evidence/apartment-residual-closure-20261003"
OLD_REPLAY = OLD_EVIDENCE / "replay"
PLAN = REPO / ".omo/plans/apartment-next-residual-improvement-20261003.md"
RAW_ROOT = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
RAW_SUMMARY = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate-summary-v15.json"
PLAN_MANIFEST = REPO / ".omo/evidence/apartment-50-improvement-20261003/manifest.json"
SOURCE_PROBES = REPO / ".omo/evidence/apartment-50-improvement-20261003/source-probes.json"
DIMENSIONS = REPO / ".omo/evidence/apartment-50-improvement-20261003/paired-dimensions-v15.json"
ANNOTATION_FREEZE = OLD_EVIDENCE / "annotation-image-freeze.json"
BEFORE_IMPORTED = OLD_REPLAY / "candidate-imported-residual-closure-eba42adc"
BEFORE_EVALUATION = OLD_REPLAY / "candidate-evaluation-residual-closure-eba42adc"
BEFORE_METRICS = OLD_REPLAY / "candidate-residual-closure-eba42adc-metrics.json"
OLD_PROVENANCE = OLD_REPLAY / "provenance-residual-closure-eba42adc.json"
OLD_MACHINE = OLD_REPLAY / "candidate-machine-residual-closure-eba42adc.json"
OLD_PAIRED = OLD_REPLAY / "paired-residual-closure-eba42adc-metrics.json"
OLD_PRESERVATION = OLD_REPLAY / "candidate-preservation-eba42adc-r5.json"
OLD_EXACT = OLD_EVIDENCE / "overlap-audit/candidate-exact-eba42adc-final.json"
OLD_RENDER_ROOT = OLD_REPLAY / "paired-residual-closure-eba42adc"
OLD_RENDER_MANIFEST = OLD_REPLAY / "paired-render-recursive-manifest-eba42adc.json"
OLD_TIMING = OLD_EVIDENCE / "performance/baseline-v15-current-0b926754-stress-100-500-1000-final-detector-benchmark.json"
OLD_MANIFEST = OLD_REPLAY / "replay-manifest-residual-closure-eba42adc.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def require_file(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"missing required file: {path}")


def require_dir(path: Path) -> None:
    if not path.is_dir():
        raise SystemExit(f"missing required directory: {path}")


def file_record(path: Path, kind: str) -> dict[str, Any]:
    require_file(path)
    return {"path": rel(path), "kind": kind, "sha256": sha256(path), "bytes": path.stat().st_size}


def directory_record(path: Path, kind: str, suffix: str = ".json") -> dict[str, Any]:
    require_dir(path)
    files = sorted(p for p in path.iterdir() if p.is_file() and (not suffix or p.suffix == suffix))
    return {
        "path": rel(path),
        "kind": kind,
        "fileCount": len(files),
        "files": [file_record(p, f"{kind}-file") for p in files],
        "treeSha256": hashlib.sha256("".join(f"{rel(p)}\t{sha256(p)}\n" for p in files).encode()).hexdigest(),
    }


def recursive_record(path: Path, kind: str) -> dict[str, Any]:
    require_dir(path)
    files = sorted(p for p in path.rglob("*") if p.is_file())
    return {
        "path": rel(path),
        "kind": kind,
        "fileCount": len(files),
        "treeSha256": hashlib.sha256("".join(f"{rel(p)}\t{sha256(p)}\n" for p in files).encode()).hexdigest(),
        "manifest": file_record(OLD_RENDER_MANIFEST, "paired-render-recursive-manifest"),
    }


def verify_baseline_manifest() -> tuple[dict[str, Any], list[dict[str, str]]]:
    require_file(BASELINE_MANIFEST)
    baseline = json.loads(BASELINE_MANIFEST.read_text())
    source = baseline.get("sourceFiles") or []
    raw = baseline.get("rawDocuments") or []
    if len(source) != 24:
        raise SystemExit(f"baseline source count must be 24, got {len(source)}")
    if len(raw) != 50:
        raise SystemExit(f"baseline raw count must be 50, got {len(raw)}")
    current_drift: list[dict[str, str]] = []
    for entry in source:
        current = REPO / entry["path"]
        snapshot = REPO / entry["snapshotPath"]
        require_file(current)
        require_file(snapshot)
        current_sha = sha256(current)
        if current_sha != entry["sha256"]:
            current_drift.append({"path": entry["path"], "manifestSha256": entry["sha256"], "currentSha256": current_sha})
        if sha256(snapshot) != entry["sha256"]:
            raise SystemExit(f"baseline source snapshot SHA changed: {entry['snapshotPath']}")
    for entry in raw:
        path = REPO / entry["path"]
        require_file(path)
        if sha256(path) != entry["sha256"]:
            raise SystemExit(f"baseline raw SHA changed: {entry['path']}")
        if entry.get("bytes") != path.stat().st_size:
            raise SystemExit(f"baseline raw byte count changed: {entry['path']}")
    return baseline, current_drift


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="apartment-next-residual-prepared-20261003")
    parser.add_argument("--output", type=Path, default=NEW_ROOT / "replay-manifest.json")
    args = parser.parse_args()
    output = args.output.resolve()
    if NEW_ROOT.resolve() not in output.parents:
        raise SystemExit(f"refusing output outside next replay root: {output}")
    NEW_ROOT.mkdir(parents=True, exist_ok=True)
    baseline, current_source_drift = verify_baseline_manifest()
    for path in [PLAN, RAW_SUMMARY, PLAN_MANIFEST, SOURCE_PROBES, DIMENSIONS, ANNOTATION_FREEZE, OLD_PROVENANCE, OLD_MACHINE, OLD_PAIRED, OLD_PRESERVATION, OLD_EXACT, OLD_RENDER_MANIFEST, OLD_TIMING, OLD_MANIFEST, BEFORE_METRICS]:
        require_file(path)
    for path in [RAW_ROOT, BEFORE_IMPORTED, BEFORE_EVALUATION, OLD_RENDER_ROOT]:
        require_dir(path)

    plans = json.loads(PLAN_MANIFEST.read_text()).get("plans")
    if not isinstance(plans, list) or len(plans) != 50 or len({str(p.get("planId")) for p in plans}) != 50:
        raise SystemExit("source plan manifest must contain 50 unique plans")
    raw_ids = {p.stem for p in RAW_ROOT.glob("*.json")}
    plan_ids = {str(p.get("planId")) for p in plans}
    if len(raw_ids) != 50 or raw_ids != plan_ids:
        raise SystemExit("raw V15 set does not match 50 plan IDs")
    probes = json.loads(SOURCE_PROBES.read_text())
    if len(probes.get("roomSeeds") or []) != 378:
        raise SystemExit("source probe contract must retain 378 annotated room seeds")
    dimensions = json.loads(DIMENSIONS.read_text())
    if len(dimensions.get("paired") or []) != 50:
        raise SystemExit("dimension annotations must cover 50 plans")
    machine = json.loads(OLD_MACHINE.read_text())
    if {k: machine.get(k) for k in ("total", "imported", "rejected", "errors")} != {"total": 50, "imported": 44, "rejected": 6, "errors": 0}:
        raise SystemExit("existing eba42adc machine baseline is not 50/44/6/0")
    paired = json.loads(OLD_PAIRED.read_text())
    candidate = paired.get("candidate", {})
    candidate_seeds = candidate.get("roomSeeds", {}).get("probeWeighted", {})
    if candidate_seeds.get("inside") != 298 or candidate_seeds.get("total") != 330:
        raise SystemExit("existing eba42adc paired baseline is not 298/330")
    exact = json.loads(OLD_EXACT.read_text())
    if exact.get("readiness", {}).get("candidateHasNoStoredSlabPositiveIntersections") is not True or exact.get("readiness", {}).get("candidateHasNoStoredCeilingPositiveIntersections") is not True:
        raise SystemExit("existing exact polygon audit does not prove zero stored positive overlaps")
    preservation = json.loads(OLD_PRESERVATION.read_text())
    if not (preservation.get("importedCases") == 44 and preservation.get("floorProbeLosses") == [] and preservation.get("authoredWallsPreserved") is True and preservation.get("openingsPreserved") is True and preservation.get("originalSourceZoneMetadataPreserved") is True):
        raise SystemExit("existing authored preservation baseline is not clean")
    old_manifest = json.loads(OLD_MANIFEST.read_text())
    timing = json.loads(OLD_TIMING.read_text())
    before_counts = json.loads(BEFORE_METRICS.read_text())
    if {k: before_counts.get(k) for k in ("totalPlans", "importedCases", "rejectedCases")} != {"totalPlans": 50, "importedCases": 44, "rejectedCases": 6}:
        raise SystemExit("eba42adc candidate before metrics are not 50/44/6")
    before_seeds = before_counts.get("roomSeeds", {}).get("probeWeighted", {})
    if before_seeds.get("inside") != 298 or before_seeds.get("total") != 330:
        raise SystemExit("eba42adc candidate before metrics are not 298/330")

    source_records = []
    for entry in baseline["sourceFiles"]:
        source_records.append({"sourcePath": entry["path"], "currentPath": entry["path"], "snapshotPath": entry["snapshotPath"], "sha256": entry["sha256"]})
    raw_records = []
    for entry in baseline["rawDocuments"]:
        raw_records.append({"path": entry["path"], "sha256": entry["sha256"], "bytes": entry["bytes"]})

    payload: dict[str, Any] = {
        "schemaVersion": "apartment-next-residual-replay-inputs-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "status": "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE",
        "candidateRunExecuted": False,
        "run": {"preparedRunId": args.run_id, "candidateRunIdTemplate": "apartment-next-residual-after-<source-freeze-id>", "explicitRunIdRequired": True, "sourceFreezeRequired": True, "sourceFreezeMustBePassedAtCandidateTime": True},
        "scope": {
            "sameRawDocuments": True, "rawDocumentVersion": 15, "rawRasterRerun": False,
            "sameSourceProbesAndAnnotations": True, "manualGuideInjection": False, "manualRecoverySeparate": True,
            "beforeComparisonIdentity": "eba42adc-candidate",
            "beforeUsesEba42adcCandidateImportedEvaluation": True,
            "oldV15FloorBaselineForbidden": True,
            "acceptedRoomSeedCountExpected": 330, "sourceRoomSeedCount": 378, "rejectedCaseCountExpected": 6,
            "writesAllowedOnlyUnder": rel(NEW_ROOT),
        },
        "approvedPlan": file_record(PLAN, "approved-plan"),
        "baselineManifest": file_record(BASELINE_MANIFEST, "next-baseline-manifest"),
        "baselineManifestSummary": {"sourceFiles": len(source_records), "rawDocuments": len(raw_records), "sha256": sha256(BASELINE_MANIFEST), "currentSourceDriftAtPreparation": current_source_drift, "currentSourceDriftPolicy": "allowed while parent implementation is in flight; frozen snapshots remain authoritative until source-freeze"},
        "baseline": {
            "counts": baseline.get("baselineCounts"),
            "rawRoot": rel(RAW_ROOT), "rawFiles": raw_records, "rawSummary": file_record(RAW_SUMMARY, "raw-v15-summary"),
            "planManifest": file_record(PLAN_MANIFEST, "source-plan-manifest"),
            "sourceProbes": file_record(SOURCE_PROBES, "source-probes"),
            "dimensionAnnotations": file_record(DIMENSIONS, "dimension-annotations"),
            "annotationImageFreeze": file_record(ANNOTATION_FREEZE, "annotation-image-freeze"),
            "importedRootEba42adc": directory_record(BEFORE_IMPORTED, "before-eba42adc-imported"),
            "evaluationRootEba42adc": directory_record(BEFORE_EVALUATION, "before-eba42adc-evaluation"),
            "metricsEba42adc": file_record(BEFORE_METRICS, "before-eba42adc-metrics"),
            "comparisonProvenance": file_record(OLD_PROVENANCE, "historical-eba42adc-provenance"),
            "historicalEba42adcMachine": file_record(OLD_MACHINE, "historical-eba42adc-machine"),
            "historicalEba42adcPairedMetrics": file_record(OLD_PAIRED, "historical-eba42adc-paired"),
            "historicalEba42adcPreservation": file_record(OLD_PRESERVATION, "historical-eba42adc-preservation"),
            "historicalEba42adcExactAudit": file_record(OLD_EXACT, "historical-eba42adc-exact-audit"),
            "historicalEba42adc": {"plans": 50, "imported": 44, "rejected": 6, "errors": 0, "floorProbeHits": 298, "floorProbeTotal": 330, "exactStoredOverlapPairs": 0, "floorProbeLossCases": 0, "authoredWallPreservedCases": 44, "openingPreservedCases": 44, "sourceZoneMetadataPreservedCases": 44, "storedSlabs": machine.get("initialPersistedSurfaces", {}).get("storedSlabs"), "storedCeilings": machine.get("initialPersistedSurfaces", {}).get("storedCeilings")},
            "historicalTiming": {"identity": "detector-only historical benchmark; not the before geometry/evaluation reference", "artifact": file_record(OLD_TIMING, "historical-timing"), "realDetectorP95Ms": timing.get("aggregate", {}).get("realDetectorP95Ms"), "rerunPolicy": "core unchanged; no performance rerun in preparation"},
            "renderReuse": {"newCapture": False, "reuseOnly": True, "root": recursive_record(OLD_RENDER_ROOT, "historical-paired-render"), "note": "Existing paired renders are reused by hash; they are not presented as newly captured."},
        },
        "sourceSnapshots": {"count": len(source_records), "records": source_records, "candidateSourceFreezeRecordRequired": True, "candidateSourceFreezePath": None},
        "frozenFiles": [file_record(BASELINE_MANIFEST, "next-baseline-manifest"), file_record(PLAN, "approved-plan"), file_record(RAW_SUMMARY, "raw-v15-summary"), file_record(PLAN_MANIFEST, "source-plan-manifest"), file_record(SOURCE_PROBES, "source-probes"), file_record(DIMENSIONS, "dimension-annotations"), file_record(ANNOTATION_FREEZE, "annotation-image-freeze"), file_record(BEFORE_METRICS, "before-machine-metrics"), file_record(OLD_PROVENANCE, "historical-eba42adc-provenance"), file_record(OLD_MACHINE, "historical-eba42adc-machine"), file_record(OLD_PAIRED, "historical-eba42adc-paired"), file_record(OLD_PRESERVATION, "historical-eba42adc-preservation"), file_record(OLD_EXACT, "historical-eba42adc-exact-audit"), file_record(OLD_TIMING, "historical-timing")],
        "fileSets": {"rawV15": directory_record(RAW_ROOT, "raw-v15"), "beforeImportedEba42adc": directory_record(BEFORE_IMPORTED, "before-eba42adc-imported"), "beforeEvaluationEba42adc": directory_record(BEFORE_EVALUATION, "before-eba42adc-evaluation")},
        "comparisonReference": {"identity": "eba42adc-candidate", "importedRoot": rel(BEFORE_IMPORTED), "evaluationRoot": rel(BEFORE_EVALUATION), "metrics": rel(BEFORE_METRICS), "probeWeightedInside": 298, "probeWeightedTotal": 330},
        "manualRecovery": {"autoDenominator": "not applicable", "targetCases": 6, "separateCases": 6, "separateCasesMeaning": "TARGET_CASE_COUNT", "actualVerifiedCases": None, "verificationStatus": "UNVERIFIED_SEPARATE_UI_EVIDENCE", "neverClaimAsAuto50of50": True, "historicalEvidenceRoot": None, "historicalEvidenceStatus": "WITHHELD_PRIOR_ARTIFACTS_ARE_NOT_SUCCESS_PROOF"},
        "outputs": {"root": rel(NEW_ROOT), "candidateEvaluationTemplate": f"{rel(NEW_ROOT)}/candidate-evaluation-<run-id>", "candidateImportedTemplate": f"{rel(NEW_ROOT)}/candidate-imported-<run-id>", "candidateMachineTemplate": f"{rel(NEW_ROOT)}/candidate-machine-<run-id>.json", "pairedRenderTemplate": f"{rel(NEW_ROOT)}/paired-<run-id>", "reportTemplate": f"{rel(NEW_ROOT)}/report-<run-id>.html", "provenanceTemplate": f"{rel(NEW_ROOT)}/provenance-<run-id>.json"},
        "harnesses": {"prepare": rel(Path(__file__)), "verify": rel(NEW_ROOT.parent / "replay-harness/verify_replay_inputs.py"), "evaluate": rel(NEW_ROOT.parent / "replay-harness/evaluate_candidate.ts"), "render": rel(NEW_ROOT.parent / "replay-harness/render_paired.py"), "report": rel(NEW_ROOT.parent / "replay-harness/build_replay_report.py"), "provenance": rel(NEW_ROOT.parent / "replay-harness/write_replay_provenance.py")},
        "guards": {"candidatePhaseRequiresParentSourceFreeze": True, "candidatePhaseRequiresEba42adcBeforePaths": True, "candidatePhaseRequiresExplicitOutputRoots": True, "candidatePhaseMustNotWriteHistoricalRoots": True, "manualGuideInjection": "forbidden", "rawRasterRerun": "forbidden", "renderPolicy": "reuse historical paired render hashes until a new candidate exists", "performance": "do not rerun when core hash is unchanged"},
        "oldHarnessReference": {"manifest": file_record(OLD_MANIFEST, "historical-preparation-manifest"), "sourceRoot": rel(OLD_EVIDENCE / "replay-harness")},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": rel(output), "sha256": sha256(output), "status": payload["status"], "candidateRunExecuted": False, "counts": payload["baseline"]["historicalEba42adc"], "sourceSnapshots": len(source_records), "rawDocuments": len(raw_records)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
