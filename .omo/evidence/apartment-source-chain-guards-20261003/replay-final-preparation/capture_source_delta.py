#!/usr/bin/env python3
"""Capture live workspace drift against the immutable Lane A source freeze.

This is evidence-only.  It records mismatches without changing, restoring, or
temporarily swapping product files; later source lanes may continue editing the
workspace after this snapshot.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
DEFAULT_FREEZE = REPO / ".omo/evidence/apartment-next-residual-20261003/source-freeze-lane-a-final.json"
DEFAULT_OUTPUT = ROOT / "source-delta-lane-a-live-snapshot.json"


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--freeze", type=Path, default=DEFAULT_FREEZE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    freeze_path = args.freeze.resolve()
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    expected = freeze.get("sourceHashes") or {}
    files = []
    for relative, expected_sha in sorted(expected.items()):
        path = REPO / relative
        actual_sha = sha256(path)
        files.append(
            {
                "path": relative,
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
                "exists": actual_sha is not None,
                "matches": actual_sha == expected_sha,
            }
        )

    mismatches = [item for item in files if not item["matches"]]
    result = {
        "schemaVersion": 1,
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
        "status": "LIVE_SOURCE_DRIFT_RECORDED" if mismatches else "LIVE_SOURCE_MATCHES_FREEZE",
        "freeze": {
            "path": str(freeze_path.relative_to(REPO)),
            "sha256": sha256(freeze_path),
            "revision": freeze.get("revision"),
        },
        "sourceCount": len(files),
        "matchingCount": len(files) - len(mismatches),
        "mismatchCount": len(mismatches),
        "files": files,
        "benchmarkBinding": {
            "frozenCore": ".omo/evidence/apartment-next-residual-20261003/lane-a-source/packages/core/src/lib/space-detection.ts",
            "frozenImporter": ".omo/evidence/apartment-next-residual-20261003/lane-a-source/apps/editor/lib/apt-vector-scene.ts",
            "frozenImportFrame": ".omo/evidence/apartment-next-residual-20261003/lane-a-source/apps/editor/lib/apt-import-frame.ts",
            "liveWorkspaceWasNotRestored": True,
            "note": "Lane A benchmark source copies are bound to immutable snapshots; live mismatches are retained as concurrent workspace drift and are not silently treated as Lane A parity evidence.",
        },
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "sourceCount": len(files), "matchingCount": len(files) - len(mismatches), "mismatchCount": len(mismatches), "output": str(output.relative_to(REPO))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
