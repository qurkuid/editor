#!/usr/bin/env python3
"""Freeze the prior candidate-v15-floor replay used as the direct before side.

This is separate from baseline-freeze.sha256 (the historical 974-entry freeze)
because the old v15 importer/evaluation JSON directories were produced after
that manifest. It hashes them without copying or modifying the old evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OLD = REPO / ".omo/evidence/apartment-50-improvement-20261003"
SCALE = REPO / ".omo/evidence/apartment-scale-fix-20261003"
MANIFEST = HERE / "v15-floor-baseline.sha256"
SUMMARY = HERE / "v15-floor-baseline.json"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def relative(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def files() -> list[Path]:
    roots = [
        SCALE / "candidate15",
        OLD / "candidate-imported-v15-floor",
        OLD / "candidate-evaluation-v15-floor",
        OLD / "candidate-v15-floor-persistence",
    ]
    exact = [
        OLD / "manifest.json",
        OLD / "source-probes.json",
        OLD / "paired-dimensions-v15.json",
        OLD / "candidate-v15-floor-persistence-metrics.json",
        OLD / "paired-v15-floor-persistence-metrics.json",
        OLD / "verification-v15-floor-persistence.json",
        SCALE / "candidate-summary-v15.json",
    ]
    paths = exact[:]
    for root in roots:
        paths.extend(path for path in root.rglob("*") if path.is_file())
    unique = sorted({path.resolve() for path in paths}, key=relative)
    missing = [path for path in unique if not path.exists()]
    if missing:
        raise FileNotFoundError("missing v15 baseline path(s): " + ", ".join(relative(path) for path in missing))
    return unique


def rows() -> list[str]:
    return [f"{digest(path)}  {relative(path)}" for path in files()]


def write() -> dict:
    values = rows()
    MANIFEST.write_text("\n".join(values) + "\n")
    manifest_sha = digest(MANIFEST)
    record = {
        "schemaVersion": "apartment-v15-floor-baseline-freeze-v1",
        "scope": "direct before side for same raw v15 topology replay",
        "entries": len(values),
        "manifestSha256": manifest_sha,
        "paths": {
            "rawCandidate": "../apartment-scale-fix-20261003/candidate15",
            "candidateImported": "../apartment-50-improvement-20261003/candidate-imported-v15-floor",
            "candidateEvaluation": "../apartment-50-improvement-20261003/candidate-evaluation-v15-floor",
            "priorPairedOverlays": "../apartment-50-improvement-20261003/candidate-v15-floor-persistence",
        },
        "note": "This direct V15 baseline supersedes V13 as the before side for topology claims. The historical 974-entry baseline-freeze.sha256 remains separately preserved.",
    }
    SUMMARY.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return {"ok": True, **record}


def check() -> dict:
    expected = MANIFEST.read_text().splitlines()
    actual = rows()
    if expected != actual:
        raise SystemExit("v15 baseline hash mismatch; expected manifest differs from current files")
    return {"ok": True, "entries": len(actual), "manifestSha256": digest(MANIFEST)}


parser = argparse.ArgumentParser()
parser.add_argument("--write", action="store_true")
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.write:
    print(json.dumps(write(), ensure_ascii=False, indent=2))
elif args.check:
    print(json.dumps(check(), ensure_ascii=False, indent=2))
else:
    parser.error("choose --write or --check")
