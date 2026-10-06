#!/usr/bin/env python3
"""Run one guarded direct-V15 topology replay.

Evidence-only orchestration. It refuses to run when the caller's recorded core
source hashes have drifted, refuses to reuse an output run ID, and always passes
explicit V15 before-side roots to the renderer/comparator. It never vectorizes,
starts a server, opens a browser, or mutates the prior evidence directories.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RAW = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate15"
SUMMARY = REPO / ".omo/evidence/apartment-scale-fix-20261003/candidate-summary-v15.json"
BASE_IMPORTED = REPO / ".omo/evidence/apartment-50-improvement-20261003/candidate-imported-v15-floor"
BASE_EVAL = REPO / ".omo/evidence/apartment-50-improvement-20261003/candidate-evaluation-v15-floor"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], log: Path | None = None) -> None:
    if log:
        with log.open("w") as handle:
            result = subprocess.run(command, cwd=REPO, stdout=handle, stderr=subprocess.STDOUT, text=True)
    else:
        result = subprocess.run(command, cwd=REPO, text=True)
    if result.returncode:
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(command)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-freeze", type=Path, required=True)
    args = parser.parse_args()
    freeze_path = args.source_freeze.resolve()
    freeze = json.loads(freeze_path.read_text())
    expected = freeze.get("sourceHashes", {})
    if not expected:
        raise SystemExit("source freeze has no sourceHashes")
    mismatches = []
    for path_text, expected_hash in expected.items():
        path = REPO / path_text
        actual = sha256(path) if path.exists() else "MISSING"
        if actual != expected_hash:
            mismatches.append({"path": path_text, "expected": expected_hash, "actual": actual})
    if mismatches:
        raise SystemExit(json.dumps({"sourceFreezeMismatch": mismatches}, ensure_ascii=False))
    run_id = args.run_id
    names = {
        "evaluation": HERE / f"candidate-evaluation-{run_id}",
        "imported": HERE / f"candidate-imported-{run_id}",
        "candidateOutput": HERE / f"candidate-{run_id}",
        "baselineOutput": HERE / f"baseline-v15-before-{run_id}",
        "pairedOutput": HERE / f"paired-{run_id}",
        "candidateMetrics": HERE / f"candidate-{run_id}-metrics.json",
        "baselineMetrics": HERE / f"baseline-v15-before-{run_id}-metrics.json",
        "pairedMetrics": HERE / f"paired-{run_id}-metrics.json",
        "comparison": HERE / f"normalized-geometry-v15-{run_id}.json",
        "report": HERE / f"paired-report-{run_id}.html",
        "evaluateLog": HERE / f"evaluate-{run_id}.log",
        "renderLog": HERE / f"render-{run_id}.log",
    }
    existing = [path for path in names.values() if path.exists()]
    if existing:
        raise SystemExit("refusing to reuse output paths: " + ", ".join(str(path.relative_to(REPO)) for path in existing))

    run(["python3", str(HERE / "freeze_baseline.py"), "--check"])
    run(["python3", str(HERE / "freeze_v15_baseline.py"), "--check"])
    run(
        [
            "bun",
            "run",
            str(HERE / "evaluate_candidate.ts"),
            "--model-label",
            f"candidate-{run_id}",
            "--candidate-dir",
            str(RAW),
            "--candidate-summary",
            str(SUMMARY),
            "--evaluation-root",
            str(names["evaluation"]),
            "--imported-root",
            str(names["imported"]),
            "--aggregate",
            str(HERE / f"candidate-machine-metrics-{run_id}.json"),
        ],
        names["evaluateLog"],
    )
    run(
        [
            "uv",
            "run",
            "--with",
            "opencv-python-headless",
            "--with",
            "numpy",
            "--with",
            "pillow",
            "python3",
            str(HERE / "render_paired_v15.py"),
            "--run-id",
            run_id,
            "--baseline-label",
            "v15-floor-before",
            "--candidate-label",
            run_id,
            "--baseline-doc-root",
            str(RAW),
            "--baseline-imported-root",
            str(BASE_IMPORTED),
            "--baseline-evaluation-root",
            str(BASE_EVAL),
            "--candidate-dir",
            str(RAW),
            "--candidate-evaluation-root",
            str(names["evaluation"]),
            "--candidate-imported-root",
            str(names["imported"]),
            "--baseline-output",
            str(names["baselineOutput"]),
            "--candidate-output",
            str(names["candidateOutput"]),
            "--paired-output",
            str(names["pairedOutput"]),
            "--baseline-metrics",
            str(names["baselineMetrics"]),
            "--candidate-metrics",
            str(names["candidateMetrics"]),
            "--paired-metrics",
            str(names["pairedMetrics"]),
        ],
        names["renderLog"],
    )
    run(
        [
            "python3",
            str(HERE / "compare_topology_v15.py"),
            "--baseline-doc-root",
            str(RAW),
            "--baseline-imported-root",
            str(BASE_IMPORTED),
            "--baseline-evaluation-root",
            str(BASE_EVAL),
            "--candidate-doc-root",
            str(RAW),
            "--candidate-imported-root",
            str(names["imported"]),
            "--candidate-evaluation-root",
            str(names["evaluation"]),
            "--run-id",
            run_id,
            "--output",
            str(names["comparison"]),
        ]
    )
    run(
        [
            "python3",
            str(HERE / "build_paired_report_v15.py"),
            "--run-id",
            run_id,
            "--baseline-label",
            "v15-floor-before",
            "--dimension",
            str(HERE / "paired-dimensions-v15.json"),
            "--candidate-summary",
            str(SUMMARY),
            "--baseline-machine",
            str(names["baselineMetrics"]),
            "--candidate-machine",
            str(names["candidateMetrics"]),
            "--baseline-evaluation-root",
            str(BASE_EVAL),
            "--candidate-evaluation-root",
            str(names["evaluation"]),
            "--topology-comparison",
            str(names["comparison"]),
            "--source-freeze",
            str(freeze_path),
            "--annotation-correction",
            str(HERE / "p19-dimension-annotation-correction.json"),
            "--output",
            str(names["report"]),
        ]
    )
    print(json.dumps({"ok": True, "runId": run_id, "report": str(names["report"].relative_to(REPO)), "sourceFreeze": str(freeze_path.relative_to(REPO))}, ensure_ascii=False))


if __name__ == "__main__":
    main()
