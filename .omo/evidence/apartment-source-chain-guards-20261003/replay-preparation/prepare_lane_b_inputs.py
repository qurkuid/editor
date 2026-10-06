#!/usr/bin/env python3
"""Freeze read-only Lane B preparation inputs and their hashes."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[4]
RAW_ROOT = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
IMPORTED_ROOT = REPO / ".omo/evidence/apartment-next-residual-20261003/replay/candidate-imported-lane-a-final"
EVALUATION_ROOT = REPO / ".omo/evidence/apartment-next-residual-20261003/replay/candidate-evaluation-lane-a-final"
SOURCE_FREEZE = REPO / ".omo/evidence/apartment-next-residual-20261003/source-freeze-lane-a-final.json"
SOURCE_GATE = REPO / ".omo/evidence/apartment-next-residual-20261003/verification/parent-lane-a-automatic-source-gate.json"
SOURCE_PROBES = REPO / ".omo/evidence/apartment-50-improvement-20261003/source-probes.json"
DIMENSIONS = REPO / ".omo/evidence/apartment-50-improvement-20261003/paired-dimensions-v15.json"
IMAGE_FREEZE = REPO / ".omo/evidence/apartment-residual-closure-20261003/annotation-image-freeze.json"
LANE_A_MANIFEST = REPO / ".omo/evidence/apartment-next-residual-20261003/replay/replay-manifest-lane-a-final-qa-reviewed.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_entry(path: Path, root: Path | None = None) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(REPO) if root is not None else path),
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def tree_entries(root: Path) -> list[dict[str, Any]]:
    return [file_entry(path, REPO) for path in sorted(root.glob("*.json"))]


def tree_sha256(entries: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in entries:
        digest.update(entry["path"].encode())
        digest.update(b"\0")
        digest.update(entry["sha256"].encode())
        digest.update(b"\n")
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)

    raw_entries = tree_entries(RAW_ROOT)
    imported_entries = tree_entries(IMPORTED_ROOT)
    evaluation_entries = tree_entries(EVALUATION_ROOT)
    evaluation_docs = {Path(entry["path"]).stem: load(REPO / entry["path"]) for entry in evaluation_entries}
    imported_ids = {Path(entry["path"]).stem for entry in imported_entries}
    rejected_ids = sorted(set(evaluation_docs) - imported_ids)

    image_freeze = load(IMAGE_FREEZE)
    image_entries: list[dict[str, Any]] = []
    image_missing: list[str] = []
    image_mismatches: list[dict[str, str]] = []
    for frozen in image_freeze["files"]:
        path = REPO / frozen["path"]
        entry = {"path": frozen["path"], "expectedSha256": frozen.get("sha256")}
        if not path.exists():
            entry["exists"] = False
            image_missing.append(frozen["path"])
        else:
            actual = sha256_file(path)
            entry.update({"exists": True, "actualSha256": actual, "bytes": path.stat().st_size, "matches": actual == frozen.get("sha256")})
            if actual != frozen.get("sha256"):
                image_mismatches.append({"path": frozen["path"], "expected": frozen.get("sha256"), "actual": actual})
        image_entries.append(entry)

    source_freeze_sha = sha256_file(SOURCE_FREEZE)
    source_gate = load(SOURCE_GATE)
    result = {
        "schemaVersion": "apartment-source-chain-lane-b-preparation-v1",
        "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "resolvedRoute": {"model": "gpt-5.6-luna", "reasoningEffort": "max"},
        "status": "READY_BASELINE_METRIC_ONLY",
        "scope": "Read-only preparation for Lane B source-chain guards; no product/source/build/UI/candidate mutation.",
        "approvedPlan": {"path": ".omo/plans/apartment-source-chain-guards-20261003.md", "sha256": sha256_file(REPO / ".omo/plans/apartment-source-chain-guards-20261003.md")},
        "baseline": {
            "identity": "lane-a-final-frozen-imported-evaluation",
            "sourceFreeze": {"path": str(SOURCE_FREEZE.relative_to(REPO)), "sha256": source_freeze_sha, "expectedSha256": "55c24008cf3697d2732b92179d1e1053ec3e90521a1697a60601a2392a12667d"},
            "parentAutomaticSourceGate": {"path": str(SOURCE_GATE.relative_to(REPO)), "sha256": sha256_file(SOURCE_GATE), "status": source_gate.get("status")},
            "imported": {"root": str(IMPORTED_ROOT.relative_to(REPO)), "count": len(imported_entries), "treeSha256": tree_sha256(imported_entries), "files": imported_entries},
            "evaluation": {"root": str(EVALUATION_ROOT.relative_to(REPO)), "count": len(evaluation_entries), "treeSha256": tree_sha256(evaluation_entries), "files": evaluation_entries},
            "acceptedCount": len(imported_entries),
            "rejectedCount": len(rejected_ids),
            "rejectedPlanIds": rejected_ids,
            "knownCounters": {"rawDocuments": 50, "sourceProbes": 330, "floorProbeHits": 298, "floorProbeTotal": 330},
        },
        "rawInputs": {"root": str(RAW_ROOT.relative_to(REPO)), "count": len(raw_entries), "treeSha256": tree_sha256(raw_entries), "files": raw_entries},
        "frozenAnnotations": {
            "sourceProbes": file_entry(SOURCE_PROBES, REPO),
            "dimensions": file_entry(DIMENSIONS, REPO),
            "annotationImageFreeze": {"path": str(IMAGE_FREEZE.relative_to(REPO)), "sha256": sha256_file(IMAGE_FREEZE), "declaredCount": image_freeze.get("count"), "sourceProbeManifestSha256": image_freeze.get("sourceProbeManifestSha256"), "files": image_entries, "missing": image_missing, "mismatches": image_mismatches},
        },
        "laneAReferenceManifest": file_entry(LANE_A_MANIFEST, REPO),
        "metricContract": {
            "name": "containedDuplicateSpan",
            "source": "apps/editor/lib/apt-vector-scene.test.ts helper semantics copied into new evidence-only script",
            "intervalToleranceM": 1e-6,
            "centerlineDistanceToleranceM": 1e-6,
            "parallelDirectionDotMinimum": 0.99,
            "p07Expected": {"planId": "3FO40C71IWG4", "pairCount": 3, "containedLengthM": 1.284401},
            "normalJunctionRule": "L/T/X and offset/adjacent/crossing controls remain zero unless a full short wall satisfies the contained parallel-span rule; generic polygon overlap is excluded.",
        },
        "o5Contract": {"sourceOpeningId": "o5", "type": "window", "widthM": 3.275, "rawWorldIntervalToleranceM": 1e-6, "required": ["source type/width/id", "host child/parent integrity", "raw transformed interval"]},
        "candidateExecution": {"allowed": False, "executed": False, "reason": "Source freeze for Lane B is not approved; this artifact is preparation and baseline-only."},
        "imageFreezeVerification": {"allFilesExist": not image_missing, "allHashesMatch": not image_mismatches, "declaredCount": image_freeze.get("count"), "actualCount": len(image_entries)},
    }
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"raw": len(raw_entries), "imported": len(imported_entries), "evaluation": len(evaluation_entries), "rejected": len(rejected_ids), "imageMissing": len(image_missing), "imageMismatches": len(image_mismatches), "sourceFreezeSha256": source_freeze_sha}, ensure_ascii=False))


if __name__ == "__main__":
    main()
