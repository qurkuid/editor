#!/usr/bin/env python3
"""Prepare the Lane B final replay contract without running a candidate.

This script only hashes and copies immutable evidence inputs.  It deliberately
does not import product modules, run buildVectorNodes, render images, or write
outside replay-final-preparation/.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
EVIDENCE = REPO / ".omo/evidence"
LANE_A = EVIDENCE / "apartment-next-residual-20261003"
RAW_ROOT = EVIDENCE / "apartment-scale-fix-20261003/candidate15"
IMPORTED_ROOT = LANE_A / "replay/candidate-imported-lane-a-final"
EVALUATION_ROOT = LANE_A / "replay/candidate-evaluation-lane-a-final"
FREEZE = LANE_A / "source-freeze-lane-a-final.json"
PARENT_GATE = LANE_A / "verification/parent-lane-a-automatic-source-gate.json"
MACHINE = LANE_A / "replay/candidate-machine-lane-a-final.json"
METRICS = LANE_A / "replay/candidate-lane-a-final-metrics.json"
PAIRED = LANE_A / "replay/paired-lane-a-final-metrics.json"
EXACT = ROOT / "exact-surface-audit-lane-a-final.json"
PRESERVATION = LANE_A / "replay/candidate-preservation-lane-a-final.json"
RAW_SUMMARY = EVIDENCE / "apartment-scale-fix-20261003/candidate-summary-v15.json"
PLAN_MANIFEST = EVIDENCE / "apartment-50-improvement-20261003/manifest.json"
SOURCE_PROBES = EVIDENCE / "apartment-50-improvement-20261003/source-probes.json"
DIMENSIONS = EVIDENCE / "apartment-50-improvement-20261003/paired-dimensions-v15.json"
IMAGE_FREEZE = EVIDENCE / "apartment-residual-closure-20261003/annotation-image-freeze.json"
PRODUCT_PLAN = REPO / ".omo/plans/apartment-source-chain-guards-product-revision-20261003.md"
ACCEPTANCE_PLAN = REPO / ".omo/plans/apartment-source-chain-guards-acceptance-clarification-20261003.md"
HISTORICAL_TIMING = EVIDENCE / "apartment-residual-closure-20261003/performance/after-residual-closure-eba42adc-detector-benchmark.json"
HISTORICAL_TIMING_SHA = "d61d9a2984fb761846483bb9380954549f89037b196f643bf86d6a289f9f5af6"
DETECTOR_REFERENCE = EVIDENCE / "apartment-residual-closure-20261003/performance/baseline-v15-current-0b926754-stress-100-500-1000-final-detector-benchmark.json"
DETECTOR_REFERENCE_SHA = "c28f110c4cc612b44939f4cb13f6465a4379990544225dae3ca8a78f9b5f03ce"

LANE_A_CORE = LANE_A / "lane-a-source/packages/core/src/lib/space-detection.ts"
LANE_A_ROOM = LANE_A / "lane-a-source/packages/core/src/lib/room-boundary.ts"
LANE_A_IMPORTER = LANE_A / "lane-a-source/apps/editor/lib/apt-vector-scene.ts"
LANE_A_APT_FRAME = LANE_A / "lane-a-source/apps/editor/lib/apt-import-frame.ts"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"missing required evidence file: {path}")


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def file_record(path: Path, kind: str) -> dict[str, Any]:
    require(path)
    return {"path": rel(path), "kind": kind, "sha256": sha256(path), "bytes": path.stat().st_size}


def tree_record(root: Path, kind: str) -> dict[str, Any]:
    if not root.is_dir():
        raise SystemExit(f"missing evidence directory: {root}")
    files = []
    for path in sorted(root.glob("*.json")):
        files.append(file_record(path, f"{kind}-file"))
    tree_sha = hashlib.sha256(
        "".join(f"{entry['path']}\t{entry['sha256']}\n" for entry in files).encode()
    ).hexdigest()
    return {"path": rel(root), "kind": kind, "fileCount": len(files), "treeSha256": tree_sha, "files": files}


def load(path: Path) -> Any:
    require(path)
    return json.loads(path.read_text(encoding="utf-8"))


def copy_normalized_wall_snapshots(imported_paths: list[Path]) -> list[dict[str, Any]]:
    """Create benchmark-only wall snapshots from frozen Lane A JSON.

    These are evidence copies, not a vectorizer rerun.  The benchmark uses the
    snapshot only to compare normalized wall geometry while timing the frozen
    source copy.  Random node IDs are intentionally ignored by its signature.
    """
    snapshot_root = ROOT / "performance-inputs/normalized-walls-lane-a"
    snapshot_root.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, Any]] = []
    for imported_path in imported_paths:
        document = load(imported_path)
        plan_id = imported_path.stem
        walls = document.get("walls")
        if not isinstance(walls, list) or not walls:
            raise SystemExit(f"Lane A imported document has no walls: {imported_path}")
        snapshot = {
            "schemaVersion": "lane-a-final-normalized-wall-snapshot-v1",
            "levelId": f"lane-a-final-{plan_id}",
            "source": {"kind": "frozen-lane-a-imported-evidence", "importedPath": rel(imported_path), "importedSha256": sha256(imported_path)},
            "walls": walls,
        }
        snapshot_path = snapshot_root / imported_path.name
        snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        cases.append({
            "planId": plan_id,
            "rawPath": rel(RAW_ROOT / imported_path.name),
            "snapshotPath": rel(snapshot_path),
            "snapshotSha256": sha256(snapshot_path),
            "wallCount": len(walls),
        })
    return cases


def main() -> int:
    for path in [
        FREEZE, PARENT_GATE, MACHINE, METRICS, PAIRED, EXACT, PRESERVATION,
        RAW_SUMMARY, PLAN_MANIFEST, SOURCE_PROBES, DIMENSIONS, IMAGE_FREEZE,
        PRODUCT_PLAN, ACCEPTANCE_PLAN, HISTORICAL_TIMING, DETECTOR_REFERENCE,
        LANE_A_CORE, LANE_A_ROOM, LANE_A_IMPORTER, LANE_A_APT_FRAME,
    ]:
        require(path)
    raw_paths = sorted(RAW_ROOT.glob("*.json"))
    imported_paths = sorted(IMPORTED_ROOT.glob("*.json"))
    evaluation_paths = sorted(EVALUATION_ROOT.glob("*.json"))
    raw_ids = {path.stem for path in raw_paths}
    imported_ids = {path.stem for path in imported_paths}
    evaluation_ids = {path.stem for path in evaluation_paths}
    if len(raw_paths) != 50 or len(raw_ids) != 50:
        raise SystemExit(f"expected 50 unique raw V15 documents, found {len(raw_paths)}")
    if len(imported_paths) != 44 or len(imported_ids) != 44:
        raise SystemExit(f"expected 44 Lane A imported documents, found {len(imported_paths)}")
    if len(evaluation_paths) != 50 or evaluation_ids != raw_ids:
        raise SystemExit("Lane A evaluation set does not cover the same 50 raw plan IDs")
    if not imported_ids.issubset(raw_ids):
        raise SystemExit("Lane A imported IDs are not a subset of raw V15 IDs")

    machine = load(MACHINE)
    metrics = load(METRICS)
    exact = load(EXACT)
    if {key: machine.get(key) for key in ("total", "imported", "rejected", "errors")} != {"total": 50, "imported": 44, "rejected": 6, "errors": 0}:
        raise SystemExit("Lane A machine counts are not 50/44/6/0")
    seeds = metrics.get("roomSeeds", {}).get("probeWeighted", {})
    if seeds.get("inside") != 298 or seeds.get("total") != 330:
        raise SystemExit("Lane A probe baseline is not 298/330")
    exact_candidate = exact.get("candidate", {})
    for key in ("rawSpaces", "storedSlabs", "storedCeilings"):
        if exact_candidate.get(key, {}).get("positiveOverlapPairs") != 0:
            raise SystemExit(f"Lane A exact audit is not zero for {key}")

    normalized_cases = copy_normalized_wall_snapshots(imported_paths)
    performance_manifest = {
        "schemaVersion": "lane-b-importer-performance-inputs-v1",
        "status": "READY_LANE_A_BASELINE_ONLY",
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "sourceSnapshots": {
            "core": {"path": rel(LANE_A_CORE), "sha256": sha256(LANE_A_CORE)},
            "roomBoundary": {"path": rel(LANE_A_ROOM), "sha256": sha256(LANE_A_ROOM)},
            "importer": {"path": rel(LANE_A_IMPORTER), "sha256": sha256(LANE_A_IMPORTER)},
            "aptImportFrame": {"path": rel(LANE_A_APT_FRAME), "sha256": sha256(LANE_A_APT_FRAME)},
        },
        "protocol": {
            "warmups": 2,
            "rounds": 12,
            "acceptedCaseCount": 44,
            "syntheticCounts": [100, 500, 1000],
            "timedOperation": "buildVectorNodes(cloned raw V15 document) only for importer pair; core detector benchmark is separate",
            "pairedImporterRequirement": "Run frozen Lane A eb96 importer and final frozen importer with this same raw V15 set, 2 warmups, and 12 timed rounds per accepted case before claiming the 1.25x ratio.",
        },
        "cases": normalized_cases,
        "rawInputRoot": rel(RAW_ROOT),
        "rawInputCount": len(raw_paths),
        "baselineImportedRoot": rel(IMPORTED_ROOT),
        "baselineEvaluationRoot": rel(EVALUATION_ROOT),
        "manualGuideInjection": False,
        "rawRasterRerun": False,
        "candidateExecution": {"allowed": False, "executed": False, "reason": "B source freeze is not supplied in preparation phase."},
    }
    performance_manifest_path = ROOT / "performance-input-manifest-lane-a.json"
    performance_manifest_path.write_text(json.dumps(performance_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source_freeze = load(FREEZE)
    source_hashes = source_freeze.get("sourceHashes", {})
    if source_hashes.get("apps/editor/lib/apt-vector-scene.ts") != sha256(LANE_A_IMPORTER) or source_hashes.get("packages/core/src/lib/space-detection.ts") != sha256(LANE_A_CORE):
        raise SystemExit("Lane A source snapshot SHA does not match its freeze record")

    contract = {
        "schemaVersion": "apartment-source-chain-guards-lane-b-final-preparation-v1",
        "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "status": "PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE",
        "phaseStatus": "READY_WAITING_FOR_B_SOURCE_FREEZE",
        "candidateRunExecuted": False,
        "scope": {
            "evidenceOnly": True,
            "productSourceMutation": False,
            "testBuildRuntimeBrowserMutation": False,
            "sameRawV15": True,
            "rawRasterRerun": False,
            "manualGuideInjection": False,
            "oldV15FloorBaselineForbidden": True,
            "candidateExecutionBlockedUntilExplicitSourceFreeze": True,
            "sameRawDocuments": True,
            "sameSourceProbesAndAnnotations": True,
            "beforeComparisonIdentity": "eba42adc-candidate",
            "beforeUsesEba42adcCandidateImportedEvaluation": True,
            "acceptedRoomSeedCountExpected": 330,
            "rejectedCaseCountExpected": 6,
            "writesAllowedOnlyUnder": rel(ROOT),
        },
        "approvedPlan": file_record(PRODUCT_PLAN, "approved-product-contract"),
        "acceptanceClarification": file_record(ACCEPTANCE_PLAN, "approved-acceptance-clarification"),
        "baseline": {
            "identity": "lane-a-eba42adc-core-eb96fcb-imported-evaluation",
            "sourceFreeze": file_record(FREEZE, "lane-a-source-freeze"),
            "parentAutomaticSourceGate": file_record(PARENT_GATE, "lane-a-source-gate"),
            "sourceHashes": {
                "core": {"path": rel(LANE_A_CORE), "sha256": sha256(LANE_A_CORE)},
                "roomBoundary": {"path": rel(LANE_A_ROOM), "sha256": sha256(LANE_A_ROOM)},
                "importer": {"path": rel(LANE_A_IMPORTER), "sha256": sha256(LANE_A_IMPORTER)},
            },
            "raw": tree_record(RAW_ROOT, "raw-v15"),
            "imported": tree_record(IMPORTED_ROOT, "lane-a-imported"),
            "evaluation": tree_record(EVALUATION_ROOT, "lane-a-evaluation"),
            "counts": {"plans": 50, "imported": 44, "rejected": 6, "errors": 0, "floorProbeHits": 298, "floorProbeTotal": 330, "storedSlabs": 374, "storedCeilings": 374, "exactRawOverlapPairs": 0, "exactStoredSlabOverlapPairs": 0, "exactStoredCeilingOverlapPairs": 0, "perCaseFloorProbeLosses": 0},
            "metrics": file_record(METRICS, "lane-a-machine-metrics"),
            "machine": file_record(MACHINE, "lane-a-machine-aggregate"),
            "pairedMetrics": file_record(PAIRED, "lane-a-paired-metrics"),
            "exactAudit": file_record(EXACT, "lane-a-exact-surface-audit"),
            "preservation": file_record(PRESERVATION, "lane-a-preservation-audit"),
            "rawSummary": file_record(RAW_SUMMARY, "raw-v15-summary"),
            "planManifest": file_record(PLAN_MANIFEST, "source-plan-manifest"),
            "sourceProbes": file_record(SOURCE_PROBES, "source-probes"),
            "dimensionAnnotations": file_record(DIMENSIONS, "dimension-annotations"),
            "annotationImageFreeze": file_record(IMAGE_FREEZE, "annotation-image-freeze"),
        },
        "comparisonReference": {
            "identity": "eba42adc-candidate",
            "importedRoot": rel(IMPORTED_ROOT),
            "evaluationRoot": rel(EVALUATION_ROOT),
            "metrics": rel(METRICS),
            "probeWeightedInside": 298,
            "probeWeightedTotal": 330,
        },
        "containedDuplicateSpan": {
            "metricScript": rel(ROOT / "contained_duplicate_span.py"),
            "definition": "Shorter S counts once when both endpoints project inside longer L interval +/-1e-6m, both endpoint distances are <= L construction half-thickness +1e-6m, and abs direction dot >=0.99.",
            "baselinePairs": 20,
            "baselineContainedLengthM": 5.837984476195861,
            "p07": {"planId": "3FO40C71IWG4", "pairs": 3, "containedLengthM": 1.2844009967433032},
            "other43": {"pairs": 17, "containedLengthM": 4.553583479452558},
            "normalJunctionControlsMustScoreZero": True,
        },
        "o5Window": {"script": rel(ROOT / "o5_source_window_check.py"), "sourceOpeningId": "o5", "widthM": 3.275, "toleranceM": 1e-6, "worldIntervalParityRequired": True, "hostChildIntegrityRequired": True},
        "exactSurfaces": {"script": rel(ROOT / "exact_surface_audit.py"), "rawPositiveOverlapPairs": 0, "storedSlabPositiveOverlapPairs": 0, "storedCeilingPositiveOverlapPairs": 0, "rasterSharedEdgePixelsAreSeparate": True},
        "derivedAudits": {
            "containedDuplicateSpan": file_record(ROOT / "contained-duplicate-span-lane-a-final.json", "lane-a-contained-duplicate-audit"),
            "o5Window": file_record(ROOT / "o5-source-window-lane-a-final.json", "lane-a-o5-window-audit"),
            "exactSurfaces": file_record(EXACT, "lane-a-exact-surface-audit-current"),
        },
        "performance": {
            "inputManifest": rel(performance_manifest_path),
            "sourceCopyBenchmark": rel(ROOT / "benchmark_sourcecopy.ts"),
            "protocol": performance_manifest["protocol"],
            "detectorReference": {"path": rel(DETECTOR_REFERENCE), "sha256": sha256(DETECTOR_REFERENCE), "realDetectorP95Ms": 2.2555, "gateMs": 2.819375, "note": "Detector reference only; never use as Lane A importer baseline."},
            "priorCandidateDetector": {"path": rel(HISTORICAL_TIMING), "sha256": sha256(HISTORICAL_TIMING), "sha256Expected": HISTORICAL_TIMING_SHA, "realDetectorP95Ms": 2.729875, "note": "Historical candidate detector result, not Lane A importer timing."},
            "laneAImporter": {"status": "NOT_MEASURED_IN_THIS_PREPARATION", "requiredBeforeFinalRatio": True, "sourceSha256": sha256(LANE_A_IMPORTER)},
            "finalImporter": {"status": "NOT_RUN_BEFORE_B_SOURCE_FREEZE"},
            "ratioStatus": "UNVERIFIED",
            "gate": "final importer p95 <= 1.25x measured frozen Lane A importer p95; zero errors and parity checks",
        },
        "manualRecovery": {"targetCases": 6, "separateCases": 6, "separateCasesMeaning": "TARGET_CASE_COUNT", "actualVerifiedCases": None, "separateFromAutoDenominator": True, "verificationStatus": "UNVERIFIED_SEPARATE_UI_EVIDENCE", "historicalEvidenceRoot": None},
        "outputs": {"candidateImportedTemplate": f"{rel(ROOT)}/candidate-imported-<run-id>", "candidateEvaluationTemplate": f"{rel(ROOT)}/candidate-evaluation-<run-id>", "pairedRenderTemplate": f"{rel(ROOT)}/paired-<run-id>", "reportTemplate": f"{rel(ROOT)}/report-<run-id>.html"},
        "harnesses": {"candidate": rel(ROOT / "evaluate_candidate.ts"), "candidateGuard": rel(ROOT / "run_candidate_guarded.ts"), "verify": rel(ROOT / "verify_final_preparation.py"), "contained": rel(ROOT / "contained_duplicate_span.py"), "o5": rel(ROOT / "o5_source_window_check.py"), "exactSurfaces": rel(ROOT / "exact_surface_audit.py"), "performance": rel(ROOT / "benchmark_sourcecopy.ts"), "importerPerformance": rel(ROOT / "benchmark_importer_sourcecopy.ts"), "preservation": rel(ROOT / "check_preservation_lane_a.py"), "renderer": rel(ROOT / "render_paired.py")},
    }
    manifest_path = ROOT / "preparation-manifest-lane-b-final.json"
    manifest_path.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": contract["status"], "manifest": rel(manifest_path), "manifestSha256": sha256(manifest_path), "performanceInputManifest": rel(performance_manifest_path), "raw": len(raw_paths), "imported": len(imported_paths), "evaluation": len(evaluation_paths), "candidateRunExecuted": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
