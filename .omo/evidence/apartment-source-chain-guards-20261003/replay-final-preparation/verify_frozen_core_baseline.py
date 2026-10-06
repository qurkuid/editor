#!/usr/bin/env python3
"""Verify the evidence-only Lane A frozen-core importer baseline.

The workspace is intentionally dirty while Lane B is being implemented.  This
verifier checks immutable source-copy snapshots and evidence files directly;
it records live-source drift as a condition rather than requiring the mutable
workspace to match the old freeze.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
DEFAULT_MANIFEST = ROOT / "preparation-manifest-lane-b-final-frozen-core-baseline-measured.json"
DEFAULT_OUTPUT = ROOT / "preparation-verification-frozen-core-baseline.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_for(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def check_file(value: str, expected: str | None, errors: list[str], checked: list[dict[str, Any]]) -> None:
    path = path_for(value)
    if not path.is_file():
        errors.append(f"missing evidence file: {value}")
        return
    actual = sha256(path)
    matched = expected is None or actual == expected
    checked.append({"path": value, "expectedSha256": expected, "actualSha256": actual, "match": matched})
    if not matched:
        errors.append(f"SHA mismatch: {value}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    errors: list[str] = []
    checked: list[dict[str, Any]] = []
    if not manifest_path.is_file():
        raise SystemExit(f"missing manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if manifest.get("candidateRunExecuted") is not False:
        errors.append("manifest claims candidate execution")
    if manifest.get("resolvedRoute") != {"model": "gpt-5.6-luna", "reasoningEffort": "max"}:
        errors.append("resolved model/reasoning mismatch")
    if manifest.get("status") != "PREPARED_WITH_LANE_A_FROZEN_CORE_BASELINE_TIMED_WAITING_FOR_FINAL_SOURCE_FREEZE":
        errors.append("unexpected preparation status")

    baseline = manifest.get("baseline") or {}
    for key in ("sourceFreeze", "parentAutomaticSourceGate", "metrics", "machine", "pairedMetrics", "exactAudit", "preservation", "rawSummary", "planManifest", "sourceProbes", "dimensionAnnotations", "annotationImageFreeze", "liveWorkspaceSourceDelta", "sourceContactAttribution"):
        record = baseline.get(key) or {}
        if record.get("path"):
            check_file(str(record["path"]), record.get("sha256"), errors, checked)
        else:
            errors.append(f"missing baseline evidence link: {key}")

    contact = baseline.get("sourceContactAttribution") or {}
    contact_path = path_for(str(contact.get("path", "")))
    if contact_path.is_file():
        try:
            contact_record = json.loads(contact_path.read_text(encoding="utf-8"))
            if contact_record.get("status") != "DIRECT_CORE_DEPENDENCIES_ATTRIBUTED":
                errors.append("direct core dependency attribution status is not explicit")
            if contact_record.get("frozenCore", {}).get("sha256") != "eba42adce60d84cfe2943cd5bcdc5132754453df6a1925576bfe06f93f79c570":
                errors.append("direct core dependency attribution is not bound to eba42adc frozen core")
            if len(contact_record.get("dependencies") or []) != 13:
                errors.append("direct core dependency attribution does not record 13 imports")
        except Exception as exc:
            errors.append(f"invalid direct core dependency attribution: {exc}")

    performance = manifest.get("performance") or {}
    input_manifest_path = str(performance.get("inputManifest", ""))
    input_manifest = path_for(input_manifest_path)
    if not input_manifest.is_file():
        errors.append("missing performance input manifest")
    else:
        record = json.loads(input_manifest.read_text(encoding="utf-8"))
        if record.get("status") != "READY_LANE_A_BASELINE_ONLY":
            errors.append("performance input manifest is not baseline-only")
        if record.get("rawInputCount") != 50 or len(record.get("cases") or []) != 44:
            errors.append("performance input set is not 50 raw/44 accepted")
        if record.get("protocol", {}).get("warmups") != 2 or record.get("protocol", {}).get("rounds") != 12:
            errors.append("performance protocol is not 2 warmups/12 rounds")
        if record.get("candidateExecution", {}).get("executed") is not False:
            errors.append("performance input manifest claims candidate execution")

    lane_a = performance.get("laneAImporter") or {}
    benchmark_path = str(lane_a.get("benchmarkPath", ""))
    benchmark_file = path_for(benchmark_path)
    benchmark: dict[str, Any] = {}
    if not benchmark_file.is_file():
        errors.append("missing frozen-core importer benchmark")
    else:
        check_file(benchmark_path, lane_a.get("benchmarkSha256"), errors, checked)
        benchmark = json.loads(benchmark_file.read_text(encoding="utf-8"))
        source = benchmark.get("sourceSnapshot") or {}
        for name, expected in (("core", "eba42adce60d84cfe2943cd5bcdc5132754453df6a1925576bfe06f93f79c570"), ("importer", "eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89"), ("aptImportFrame", "b275cfb3490651314e24cfaf81e888412ddc81b40832f1f472915cd11b29a271")):
            item = source.get(name) or {}
            if item.get("actualSha256") != expected or item.get("verified") is not True:
                errors.append(f"{name} source-copy SHA/verification mismatch")
        agg = benchmark.get("aggregate") or {}
        verification = benchmark.get("importerVerification") or {}
        if (verification.get("matchCount"), verification.get("caseCount")) != (44, 44):
            errors.append("importer canonical parity is not 44/44")
        if any(agg.get(key) != value for key, value in (("completedCases", 44), ("errorCases", 0), ("roundErrorCount", 0), ("timedCalls", 528), ("geometryIdempotencePass", True), ("expectedModelParityPass", True))):
            errors.append("importer baseline aggregate mismatch")
        if agg.get("importerP95Ms") != lane_a.get("importerP95Ms"):
            errors.append("manifest importer p95 differs from benchmark")

    paired = performance.get("pairedProtocolPreparation") or {}
    paired_script = path_for(str(paired.get("script", "")))
    paired_output = path_for(str(paired.get("output", "")))
    if not paired_script.is_file() or not paired_output.is_file():
        errors.append("paired importer protocol preparation artifacts are missing")
    else:
        check_file(str(paired_script.relative_to(REPO)), paired.get("scriptSha256"), errors, checked)
        check_file(str(paired_output.relative_to(REPO)), paired.get("outputSha256"), errors, checked)
        try:
            paired_record = json.loads(paired_output.read_text(encoding="utf-8"))
            protocol = paired_record.get("protocol") or {}
            if paired_record.get("status") != "BLOCKED_PREPARATION_ONLY" or paired_record.get("candidateRunExecuted") is not False:
                errors.append("paired importer protocol preparation is not candidate-blocked")
            if protocol.get("warmupRoundsPerVariantAndCase") != 2 or protocol.get("timedRoundsPerVariantAndCase") != 12:
                errors.append("paired importer protocol is not 2 warmups/12 rounds")
            if protocol.get("bothWarmupSetsFinishBeforeMeasuredRounds") is not True or protocol.get("cloneOutsideTiming") is not True or protocol.get("canonicalGeometryOutsideTiming") is not True:
                errors.append("paired importer timing boundaries are incomplete")
            if "fresh paired Lane A p95" not in str(protocol.get("ratioDenominator", "")):
                errors.append("paired importer ratio denominator is not fresh paired Lane A p95")
        except Exception as exc:
            errors.append(f"invalid paired importer protocol preparation: {exc}")

    exact = manifest.get("exactSurfaces") or {}
    if any(exact.get(key) != 0 for key in ("rawPositiveOverlapPairs", "storedSlabPositiveOverlapPairs", "storedCeilingPositiveOverlapPairs")):
        errors.append("exact surface overlap audit is not zero")
    guard = manifest.get("outputs", {}).get("candidateGuardBlockedCheck") or {}
    if guard.get("candidateRunExecuted") is not False or guard.get("exitCode") != 2:
        errors.append("candidate guard proof is missing or does not block")

    delta = baseline.get("liveWorkspaceSourceDelta") or {}
    delta_path = path_for(str(delta.get("path", "")))
    live_delta = json.loads(delta_path.read_text(encoding="utf-8")) if delta_path.is_file() else {}
    if live_delta.get("status") != "LIVE_SOURCE_DRIFT_RECORDED":
        errors.append("live source drift was not explicitly recorded")

    result = {
        "schemaVersion": 1,
        "status": "PASS" if not errors else "FAIL",
        "phase": "baseline-frozen-core",
        "manifest": str(manifest_path.relative_to(REPO)),
        "manifestSha256": sha256(manifest_path),
        "candidateExecutionAllowed": False,
        "errors": errors,
        "checkedFiles": checked,
        "baseline": {
            "rawCases": 50,
            "acceptedCases": 44,
            "rejectedCases": 6,
            "probeHits": "298/330",
            "canonicalParity": "44/44",
            "importerP95Ms": (benchmark.get("aggregate") or {}).get("importerP95Ms"),
            "importerGateUpperBoundMs": (manifest.get("performance") or {}).get("performanceComparison", {}).get("laneABaselineUpperBoundMs"),
            "liveSourceMismatchCount": live_delta.get("mismatchCount"),
            "fullTransitiveLaneASourceClosureVerified": False,
        },
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "errorCount": len(errors), "output": str(output.relative_to(REPO))}, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
