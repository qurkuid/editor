#!/usr/bin/env python3
"""Describe direct relative imports used by the frozen Lane A core copy.

This attribution is intentionally separate from timing.  It shows which
imports are present in the 24-file freeze and which are resolved from the
current shared workspace, without changing or swapping any product source.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
CORE = REPO / ".omo/evidence/apartment-next-residual-20261003/lane-a-source/packages/core/src/lib/space-detection.ts"
FREEZE = REPO / ".omo/evidence/apartment-next-residual-20261003/source-freeze-lane-a-final.json"
OUTPUT = ROOT / "source-contact-attribution-lane-a.json"
# Resolve imports against the package layout in the shared workspace.  The
# immutable Lane A directory intentionally contains only the frozen files, so
# resolving relative to CORE.parent would turn every dependency into a false
# "missing" result.
CURRENT_CORE_LIB = REPO / "packages/core/src/lib"


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_import(specifier: str) -> Path | None:
    base = CURRENT_CORE_LIB
    raw = (base / specifier).resolve()
    candidates = [raw, Path(f"{raw}.ts"), Path(f"{raw}.tsx"), Path(f"{raw}.js"), raw / "index.ts"]
    return next((path for path in candidates if path.is_file()), None)


def main() -> int:
    freeze = json.loads(FREEZE.read_text(encoding="utf-8"))
    frozen_hashes = freeze.get("sourceHashes") or {}
    core_text = CORE.read_text(encoding="utf-8")
    specs = sorted(set(re.findall(r"from\s+['\"](\.\.?/[^'\"]+)['\"]", core_text)))
    dependencies = []
    for specifier in specs:
        resolved = resolve_import(specifier)
        relative = resolved.relative_to(REPO).as_posix() if resolved else None
        expected = frozen_hashes.get(relative) if relative else None
        actual = sha256(resolved) if resolved else None
        dependencies.append({
            "specifier": specifier,
            "resolvedPath": relative,
            "exists": resolved is not None,
            "currentSha256": actual,
            "freezeSha256": expected,
            "inLaneAFrozen24": expected is not None,
            "matchesFreeze": expected is not None and actual == expected,
        })
    result = {
        "schemaVersion": 1,
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
        "status": "DIRECT_CORE_DEPENDENCIES_ATTRIBUTED",
        "frozenCore": {"path": str(CORE.relative_to(REPO)), "sha256": sha256(CORE)},
        "laneAFrozen24": {"path": str(FREEZE.relative_to(REPO)), "sha256": sha256(FREEZE), "fileCount": len(frozen_hashes)},
        "scope": "direct relative imports in frozen space-detection.ts only; transitive imports are not recursively closed by this artifact",
        "dependencies": dependencies,
        "currentWorkspaceWasNotRestored": True,
        "interpretation": "A benchmark using the frozen core source copy still has explicitly attributed current-workspace transitive dependencies when a dependency is outside the 24-file snapshot.",
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "dependencyCount": len(dependencies), "frozenDirect": sum(item["inLaneAFrozen24"] for item in dependencies), "output": str(OUTPUT.relative_to(REPO))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
