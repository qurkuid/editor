#!/usr/bin/env python3
"""Evaluate v15 against frozen v13 vectors and the separate v14 candidate."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / ".omo/evidence/apartment-scale-fix-20261003"
BATCH = ROOT / ".omo/evidence/apartment-50-improvement-20261003"
VECTORIZE = ROOT / ".omx/recovery-20260929/data/vectorize.py"
PYTHON = ROOT / ".omx/recovery-20260929/data/vectorizer-python"
CANDIDATE = EVIDENCE / "candidate15"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(plan_dir):
    plan_id = plan_dir.name.split("_", 1)[1]
    source = plan_dir / "source.jpg"
    baseline = json.loads((plan_dir / "vector.json").read_text())
    output = CANDIDATE / f"{plan_id}.json"
    started = time.time()
    with tempfile.TemporaryDirectory(prefix=f"scale-fix-{plan_id}-") as temp:
        input_file = Path(temp) / f"{plan_id}.jpg"
        shutil.copyfile(source, input_file)
        proc = subprocess.run(
            [str(PYTHON), str(VECTORIZE), "--stdout", str(input_file)],
            cwd=str(ROOT), capture_output=True, text=True, timeout=180,
        )
    if proc.returncode:
        raise RuntimeError(f"{plan_id}: vectorizer exit {proc.returncode}: {proc.stderr[-500:]}")
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"{plan_id}: empty vectorizer output")
    candidate = json.loads(lines[-1])
    output.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n")
    baseline_scale = baseline.get("mmPerPx")
    candidate_scale = candidate.get("mmPerPx")
    return {
        "planId": plan_id,
        "source": plan_dir.name,
        "sourceSha256": sha256(source),
        "baselineDocVersion": baseline.get("docVersion"),
        "candidateDocVersion": candidate.get("docVersion"),
        "baselineScale": baseline_scale,
        "candidateScale": candidate_scale,
        "scaleChanged": baseline_scale != candidate_scale,
        "baselineMetrics": baseline.get("metrics"),
        "candidateMetrics": candidate.get("metrics"),
        "elapsedMs": round((time.time() - started) * 1000, 1),
    }


def main():
    CANDIDATE.mkdir(parents=True, exist_ok=True)
    plans = sorted(BATCH.glob("p*/source.jpg"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda source: run(source.parent), plans))
    results.sort(key=lambda row: row["source"])
    summary = {
        "vectorizer": str(VECTORIZE),
        "vectorizerSha256": sha256(VECTORIZE),
        "plans": len(results),
        "docVersions": sorted({row["candidateDocVersion"] for row in results}),
        "scaleChanged": sum(row["scaleChanged"] for row in results),
        "results": results,
    }
    (EVIDENCE / "candidate-summary-v15.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps({
        "plans": summary["plans"],
        "scaleChanged": summary["scaleChanged"],
        "docVersions": summary["docVersions"],
        "vectorizerSha256": summary["vectorizerSha256"],
    }))


if __name__ == "__main__":
    main()
