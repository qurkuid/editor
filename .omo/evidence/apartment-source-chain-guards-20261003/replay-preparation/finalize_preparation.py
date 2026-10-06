#!/usr/bin/env python3
"""Bind preparation outputs and harness hashes into a new manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[4]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def entry(path: Path) -> dict[str, Any]:
    path = path.resolve()
    return {"path": str(path.relative_to(REPO)), "sha256": sha256_file(path), "bytes": path.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--metric", type=Path, required=True)
    parser.add_argument("--o5", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = load(args.manifest)
    metric = load(args.metric)
    o5 = load(args.o5)
    verification = load(args.verification)
    preparation_root = args.manifest.parent
    scripts = [
        preparation_root / "contained_duplicate_span.py",
        preparation_root / "prepare_lane_b_inputs.py",
        preparation_root / "verify_preparation.py",
        preparation_root / "o5_source_window_check.py",
        preparation_root / "finalize_preparation.py",
    ]
    manifest["artifacts"] = {
        "containedDuplicateSpan": entry(args.metric),
        "o5SourceWindowCheck": entry(args.o5),
        "preparationVerification": entry(args.verification),
    }
    manifest["harness"] = {
        "kind": "evidence-only-python",
        "candidateExecution": False,
        "scripts": [entry(path) for path in scripts],
        "reuses": {
            "rawV15": manifest["rawInputs"]["root"],
            "frozenLaneAImported": manifest["baseline"]["imported"]["root"],
            "frozenLaneAEvaluation": manifest["baseline"]["evaluation"]["root"],
            "immutableAnnotationImages": manifest["frozenAnnotations"]["annotationImageFreeze"]["path"],
        },
    }
    manifest["baselineMetricSummary"] = {
        "acceptedImportedCases": metric["summary"]["acceptedImportedCases"],
        "rejectedCases": metric["summary"]["rejectedCases"],
        "pairCount": metric["summary"]["pairCount"],
        "containedLengthM": metric["summary"]["containedLengthM"],
        "p07": metric["p07Expectation"],
        "other43": metric["summary"]["other43"],
    }
    manifest["o5BaselineCheck"] = {"status": o5["status"], "checks": o5["checks"], "artifact": entry(args.o5)}
    manifest["verification"] = {"status": verification["status"], "artifact": entry(args.verification)}
    manifest["candidateExecutionGuard"] = {"allowed": False, "executed": False, "sourceFreezeRequired": True, "reason": "Lane B implementation/source freeze and candidate run remain outside this preparation task."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "metric": manifest["baselineMetricSummary"], "verification": verification["status"], "o5": o5["status"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
