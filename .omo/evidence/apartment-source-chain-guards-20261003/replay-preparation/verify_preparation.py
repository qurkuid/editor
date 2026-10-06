#!/usr/bin/env python3
"""Verify the evidence-only Lane B preparation guard."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[4]
EXPECTED_SOURCE_FREEZE_SHA = "55c24008cf3697d2732b92179d1e1053ec3e90521a1697a60601a2392a12667d"
EXPECTED_SOURCE_GATE_STATUS = "PASS_AUTOMATIC_REPLAY_SOURCE_GATE"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--metric", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = load(args.manifest)
    metric = load(args.metric)
    checks: list[dict[str, Any]] = []

    def check(name: str, passed: bool, details: Any) -> None:
        checks.append({"name": name, "passed": bool(passed), "details": details})

    source = manifest["baseline"]["sourceFreeze"]
    actual_source_sha = sha256_file(REPO / source["path"])
    check("source freeze hash", actual_source_sha == EXPECTED_SOURCE_FREEZE_SHA and actual_source_sha == source["sha256"], {"actual": actual_source_sha, "expected": EXPECTED_SOURCE_FREEZE_SHA})
    gate = manifest["baseline"]["parentAutomaticSourceGate"]
    gate_doc = load(REPO / gate["path"])
    check("parent automatic source gate", gate_doc.get("status") == EXPECTED_SOURCE_GATE_STATUS and sha256_file(REPO / gate["path"]) == gate["sha256"], {"status": gate_doc.get("status"), "expected": EXPECTED_SOURCE_GATE_STATUS})
    check("raw 50", manifest["rawInputs"]["count"] == 50, manifest["rawInputs"]["count"])
    check("imported 44", manifest["baseline"]["acceptedCount"] == 44, manifest["baseline"]["acceptedCount"])
    check("rejected 6", manifest["baseline"]["rejectedCount"] == 6, manifest["baseline"]["rejectedCount"])
    hash_mismatches: list[dict[str, str]] = []
    for group_name, group in [("raw", manifest["rawInputs"]), ("imported", manifest["baseline"]["imported"]), ("evaluation", manifest["baseline"]["evaluation"])]:
        for entry in group["files"]:
            path = REPO / entry["path"]
            actual = sha256_file(path) if path.exists() else "MISSING"
            if actual != entry["sha256"]:
                hash_mismatches.append({"group": group_name, "path": entry["path"], "expected": entry["sha256"], "actual": actual})
    check("frozen raw/import/evaluation hashes", not hash_mismatches, {"mismatchCount": len(hash_mismatches), "mismatches": hash_mismatches[:5]})
    check("source probes 330", manifest["baseline"]["knownCounters"]["sourceProbes"] == 330, manifest["baseline"]["knownCounters"])
    check("baseline floor hits 298/330", manifest["baseline"]["knownCounters"]["floorProbeHits"] == 298 and manifest["baseline"]["knownCounters"]["floorProbeTotal"] == 330, manifest["baseline"]["knownCounters"])
    check("annotation image freeze", manifest["imageFreezeVerification"]["allFilesExist"] and manifest["imageFreezeVerification"]["allHashesMatch"] and manifest["imageFreezeVerification"]["actualCount"] == 52, manifest["imageFreezeVerification"])
    p07 = metric["p07Expectation"]
    check("p07 expected pair count", p07["pairCountMatches"], p07)
    check("p07 expected contained length", p07["lengthMatchesWithin1e6M"], p07)
    check("candidate not executed", manifest["candidateExecution"]["allowed"] is False and manifest["candidateExecution"]["executed"] is False, manifest["candidateExecution"])
    check("metric contract", metric["metric"]["tolerances"]["endpointIntervalM"] == 1e-6 and metric["metric"]["tolerances"]["centerlineDistanceM"] == 1e-6 and metric["metric"]["tolerances"]["parallelDirectionDot"] == 0.99, metric["metric"]["tolerances"])
    controls = metric.get("syntheticControls", {})
    check("synthetic junction/parallel controls", bool(controls) and all(item.get("passed") for item in controls.values()), {name: item.get("observedPairCount") for name, item in controls.items()})
    result = {"schemaVersion": "apartment-source-chain-lane-b-preparation-verification-v1", "status": "PASS" if all(item["passed"] for item in checks) else "FAIL", "checks": checks, "manifest": str(args.manifest), "metric": str(args.metric)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "failed": [item["name"] for item in checks if not item["passed"]]}, ensure_ascii=False))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
