#!/usr/bin/env python3
"""Build dormant R4 DSU trace and one-line old-key mutation copies.

This script requires an explicit R4 source-freeze manifest, copies only its
verified importer snapshot to source-final.ts, and writes the trace variants
under the sibling atomic-trace-r4-final evidence tree. It never reads the
live product source as a transform input and never runs the importer.
"""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COPIES = ROOT / "copies"
SOURCE = COPIES / "source-final.ts"
INSTRUMENTED = COPIES / "apt-vector-scene.instrumented.ts"
MUTATED = COPIES / "apt-vector-scene.old-key-mutated.ts"
FREEZE_MANIFEST = Path(
    os.environ.get(
        "ATOMIC_TRACE_R4_FINAL_GATE",
        os.environ.get(
            "ATOMIC_TRACE_R4_FREEZE_MANIFEST",
            ".omo/evidence/apartment-source-chain-guards-20261003/product-final/r4/source-freeze-r4.json",
        ),
    )
)

REPO = next(
    (candidate for candidate in (Path.cwd(), *Path.cwd().parents) if (candidate / ".git").exists()),
    Path.cwd(),
)


def resolve_repo_path(path: str, base: Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    options = [base / candidate, REPO / candidate, base.parent / candidate]
    for option in options:
        if option.exists():
            return option.resolve()
    return (REPO / candidate).resolve()


def nested_manifest_paths(payload: dict, base: Path) -> list[tuple[Path, str | None]]:
    found: list[tuple[Path, str | None]] = []
    for key in (
        "sourceFreeze",
        "sourceFreezeManifest",
        "sourceSnapshotManifest",
        "snapshotManifest",
        "freezeArtifact",
        "combinedSourceFreeze",
        "sourceFreezeSupplement",
        "sourceSupplement",
        "supplement",
        "parentSourceGate",
        "parentGate",
    ):
        value = payload.get(key)
        if isinstance(value, dict) and isinstance(value.get("path"), str):
            found.append((resolve_repo_path(value["path"], base), value.get("sha256")))
        elif isinstance(value, str):
            found.append((resolve_repo_path(value, base), None))
    references = payload.get("references")
    if isinstance(references, list):
        for value in references:
            if not isinstance(value, dict) or not isinstance(value.get("path"), str):
                continue
            found.append((resolve_repo_path(value["path"], base), value.get("sha256")))
    return found


def load_gate_payloads(path: Path) -> list[tuple[Path, dict]]:
    queue = [path.resolve()]
    seen: set[Path] = set()
    loaded: list[tuple[Path, dict]] = []
    while queue:
        current = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        payload = json.loads(current.read_text()) if current.suffix == ".json" else {}
        loaded.append((current, payload))
        for referenced, expected_hash in nested_manifest_paths(payload, current.parent):
            if expected_hash:
                if not referenced.is_file():
                    raise RuntimeError(f"missing referenced final-gate manifest: {referenced}")
                actual_hash = sha256_bytes(referenced.read_bytes())
                if actual_hash != expected_hash:
                    raise RuntimeError(
                        f"final-gate manifest hash mismatch: {referenced} "
                        f"expected {expected_hash}, got {actual_hash}"
                    )
            queue.append(referenced)
    return loaded


def all_source_records(payload: dict) -> list[tuple[str, dict, str]]:
    entries: list[tuple[str, dict, str]] = []
    snapshots = payload.get("sourceSnapshots")
    if isinstance(snapshots, dict):
        for source_name, record in snapshots.items():
            if isinstance(record, dict) and source_name.startswith(("apps/", "packages/")):
                entries.append((source_name, record, "sourceSnapshots"))
    source_files = payload.get("sourceFiles")
    if isinstance(source_files, list):
        for record in source_files:
            if not isinstance(record, dict):
                continue
            original = record.get("originalPath") or record.get("path")
            if isinstance(original, str) and original.startswith(("apps/", "packages/")):
                entries.append((original, record, "sourceFiles"))
    product_source_entries = payload.get("productSourceEntries")
    if isinstance(product_source_entries, list):
        for record in product_source_entries:
            if not isinstance(record, dict):
                continue
            source_name = record.get("sourcePath") or record.get("originalPath") or record.get("path")
            if isinstance(source_name, str) and source_name.startswith(("apps/", "packages/")):
                entries.append((source_name, record, "productSourceEntries"))
    snapshot_entries = payload.get("entries")
    if isinstance(snapshot_entries, list):
        for record in snapshot_entries:
            if not isinstance(record, dict):
                continue
            source_name = record.get("sourcePath") or record.get("originalPath") or record.get("path")
            if isinstance(source_name, str) and source_name.startswith(("apps/", "packages/")):
                entries.append((source_name, record, "entries"))
    product_files = payload.get("productFiles")
    if isinstance(product_files, dict):
        for freeze_key, record in product_files.items():
            if not isinstance(record, dict):
                continue
            source_name = record.get("path") or freeze_key
            if isinstance(source_name, str) and source_name.startswith(("apps/", "packages/")):
                entries.append((source_name, record, "productFiles"))
    owned_files = payload.get("ownedProductFiles")
    if isinstance(owned_files, dict):
        for source_name, record in owned_files.items():
            if isinstance(record, dict) and source_name.startswith(("apps/", "packages/")):
                entries.append((source_name, record, "ownedProductFiles"))
    source_hashes = payload.get("sourceFileSha256")
    if isinstance(source_hashes, dict):
        for source_name, value in source_hashes.items():
            if source_name.startswith(("apps/", "packages/")) and isinstance(value, str):
                entries.append((source_name, {"path": source_name, "sha256": value}, "sourceFileSha256"))
    return entries


def source_entries(payload: dict) -> list[tuple[str, dict, str]]:
    return [
        (source_name, record, kind)
        for source_name, record, kind in all_source_records(payload)
        if source_name == "apps/editor/lib/apt-vector-scene.ts" or record.get("freezeKey") == "source"
    ]


def source_binding(payloads: list[tuple[Path, dict]]) -> tuple[Path, dict, list[dict]]:
    statuses = [str(payload.get("status", "")).upper() for _, payload in payloads]
    if not any("READY" in status and "BLOCKED" not in status for status in statuses):
        raise RuntimeError("final R4 source gate is not an explicit READY gate")
    candidates: list[tuple[Path, dict, str]] = []
    for manifest_path, payload in payloads:
        for _, record, kind in source_entries(payload):
            candidates.append((manifest_path, record, kind))
    selected = next(
        (
            (manifest_path, record, kind)
            for manifest_path, record, kind in candidates
            if isinstance(record.get("snapshotPath"), str)
        ),
        None,
    ) or next(
        (
            (manifest_path, record, kind)
            for manifest_path, record, kind in candidates
            if isinstance(record.get("path"), str)
        ),
        None,
    )
    if selected is None:
        raise RuntimeError("final R4 source gate has no importer snapshot record")
    manifest_path, record, kind = selected
    source_path_value = record.get("snapshotPath") or record.get("path")
    source_hash = record.get("snapshotSha256") or record.get("sha256") or record.get("freezeSha256")
    if not isinstance(source_path_value, str) or not isinstance(source_hash, str):
        raise RuntimeError("final R4 importer snapshot record is missing path or SHA-256")
    if record.get("snapshotPath"):
        snapshot_path = resolve_repo_path(source_path_value, REPO)
    else:
        snapshot_path = resolve_repo_path(source_path_value, manifest_path.parent / "../..")
    if not snapshot_path.is_file():
        raise RuntimeError(f"missing final R4 importer snapshot: {snapshot_path}")
    actual_hash = sha256_bytes(snapshot_path.read_bytes())
    if actual_hash != source_hash:
        raise RuntimeError(
            f"final R4 importer snapshot hash mismatch: expected {source_hash}, got {actual_hash}"
        )
    normalized = {
        "path": str(snapshot_path),
        "sha256": source_hash,
        "manifestPath": str(manifest_path),
        "recordKind": kind,
    }
    auxiliary_candidates: dict[str, list[tuple[int, Path, dict, str]]] = {}
    for payload_index, (other_manifest, payload) in enumerate(payloads):
        for source_name, aux_record, record_kind in all_source_records(payload):
            path_value = aux_record.get("snapshotPath") or aux_record.get("path")
            if source_name == "apps/editor/lib/apt-vector-scene.ts" or not isinstance(path_value, str):
                continue
            # Immutable snapshot records outrank live-path/hash-only records. This
            # lets the combined final gate supersede historical intermediate
            # productFiles entries while preserving their referenced hashes.
            priority = (0 if isinstance(aux_record.get("snapshotPath"), str) else 1, payload_index)
            auxiliary_candidates.setdefault(source_name, []).append(
                (priority[0] * 1_000_000 + priority[1], other_manifest, aux_record, record_kind)
            )
    auxiliary: list[dict] = []
    for source_name, candidates_for_source in auxiliary_candidates.items():
        _, other_manifest, aux_record, record_kind = min(candidates_for_source, key=lambda item: item[0])
        path_value = aux_record.get("snapshotPath") or aux_record.get("path")
        expected = aux_record.get("snapshotSha256") or aux_record.get("sha256") or aux_record.get("freezeSha256")
        actual_path = resolve_repo_path(path_value, REPO)
        if isinstance(expected, str) and actual_path.is_file() and sha256_bytes(actual_path.read_bytes()) != expected:
            raise RuntimeError(f"final-gate auxiliary hash mismatch: {actual_path}")
        auxiliary.append(
            {
                "sourcePath": source_name,
                "path": str(actual_path),
                "sha256": expected,
                "manifestPath": str(other_manifest),
                "recordKind": record_kind,
            }
        )
    return snapshot_path, normalized, auxiliary


TRACE_HELPERS = r'''
type AtomicTraceEvent = Record<string, unknown>

function emitAtomicTrace(stage: string, data: Record<string, unknown>): void {
  const sink = (globalThis as unknown as {
    __pascalAtomicDsuTrace?: { enabled: boolean; events: AtomicTraceEvent[] }
  }).__pascalAtomicDsuTrace
  if (!sink?.enabled) return
  sink.events.push({ stage, ...data })
}
'''


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new)


def once_any(text: str, variants: list[tuple[str, str]], label: str) -> str:
    matches = [(old, new) for old, new in variants if text.count(old) == 1]
    if len(matches) != 1:
        counts = [text.count(old) for old, _ in variants]
        raise RuntimeError(f"{label}: expected one bounded variant match, got counts {counts}")
    old, new = matches[0]
    return text.replace(old, new)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def instrument(text: str) -> str:
    text = once(
        text,
        "const SOURCE_ENDPOINT_EPS_M = 1e-6\n",
        "const SOURCE_ENDPOINT_EPS_M = 1e-6\n" + TRACE_HELPERS,
        "trace helpers",
    )
    text = once_any(
        text,
        [
            (
                "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n}",
                "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  /** Trace-only provenance; never read by product geometry logic. */\n  atomicSourceIds?: string[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n}",
            ),
            (
                "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n  /** A source-backed opening host is materialized after source unions and\n   * remains fixed while the ordinary junction passes run. */\n  openingHostOnly?: boolean\n}",
                "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  /** Trace-only provenance; never read by product geometry logic. */\n  atomicSourceIds?: string[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n  /** A source-backed opening host is materialized after source unions and\n   * remains fixed while the ordinary junction passes run. */\n  openingHostOnly?: boolean\n}",
            ),
        ],
        "trace-only Seg provenance",
    )
    text = once(
        text,
        "      sourceIndices: [sourceIndex],\n    })",
        "      sourceIndices: [sourceIndex],\n      atomicSourceIds: [wall.id],\n    })",
        "source IDs",
    )
    text = once(
        text,
        "  type UnionReason = 'same-run-normalization' | 'opening-host'\n",
        """  const atomicSourceIds = (segment: Seg): string[] => [...(segment.atomicSourceIds ?? [])].sort()\n  const atomicRelationState = () => ({\n    roots: [...new Set(parent.map((_, index) => find(index)))].sort((a, b) => a - b).map((root) => ({\n      root,\n      members: [...(groupMembers.get(root) ?? [])].sort((a, b) => a - b),\n      relationIds: [...(relationIdsByRoot.get(root) ?? [])].sort((a, b) => a - b),\n    })),\n    blockedKeys: [...blockedSourceChainRootPairs].sort(),\n    supersededRelationIds: [...supersededSourceChainRelationIds].sort((a, b) => a - b),\n  })\n\n  type UnionReason = 'same-run-normalization' | 'opening-host'\n""",
        "atomic state helper",
    )
    text = once(
        text,
        """  const orderedGroups = [...groupMembers.entries()]
    .map(([root, memberSet]) => ({ root, members: [...memberSet].sort((a, b) => a - b) }))
    .sort((a, b) => a.members[0]! - b.members[0]!)
  for (const { root, members } of orderedGroups) {
""",
        """  const orderedGroups = [...groupMembers.entries()]
    .map(([root, memberSet]) => ({ root, members: [...memberSet].sort((a, b) => a - b) }))
    .sort((a, b) => a.members[0]! - b.members[0]!)
  emitAtomicTrace('materialization-groups', {
    orderedGroups: orderedGroups.map(({ root, members }) => ({
      root,
      members,
      sourceIndices: members,
      sourceIds: members.flatMap((member) => atomicSourceIds(segs[member]!)).sort(),
      relationIds: [...(relationIdsByRoot.get(root) ?? [])].sort((a, b) => a - b),
    })),
    state: atomicRelationState(),
  })
  for (const { root, members } of orderedGroups) {
""",
        "R4 materialization trace",
    )
    text = once(
        text,
        "    if (firstRoot === secondRoot) return { ok: true }\n    const rootPair = sourceChainRootPairKey(firstRoot, secondRoot)\n    const openingConflicts =\n      reason === 'opening-host' ? relationIdsForRootPair(firstRoot, secondRoot) : []\n    const blocked = blockedSourceChainRootPairs.has(rootPair)\n",
        """    if (firstRoot === secondRoot) {\n      emitAtomicTrace('union-candidate', {\n        i,\n        j,\n        reason,\n        firstRoot,\n        secondRoot,\n        result: 'already-united',\n        state: atomicRelationState(),\n      })\n      return { ok: true }\n    }\n    const rootPair = sourceChainRootPairKey(firstRoot, secondRoot)\n    const openingConflicts =\n      reason === 'opening-host' ? relationIdsForRootPair(firstRoot, secondRoot) : []\n    const blocked = blockedSourceChainRootPairs.has(rootPair)\n    emitAtomicTrace('union-candidate', {\n      i,\n      j,\n      reason,\n      firstRoot,\n      secondRoot,\n      rootPair,\n      blocked,\n      openingConflicts: [...openingConflicts],\n      firstRelationIds: [...(relationIdsByRoot.get(firstRoot) ?? [])].sort((a, b) => a - b),\n      secondRelationIds: [...(relationIdsByRoot.get(secondRoot) ?? [])].sort((a, b) => a - b),\n      firstSourceIds: atomicSourceIds(segs[i]!),\n      secondSourceIds: atomicSourceIds(segs[j]!),\n      state: atomicRelationState(),\n    })\n""",
        "union candidate trace",
    )
    text = once(
        text,
        "    if (reason === 'opening-host' && openingConflicts.length > 1) {\n      return { ok: false, reason: 'retained-chain' }\n    }\n    if (blocked && (reason !== 'opening-host' || openingConflicts.length !== 1)) {\n      return { ok: false, reason: 'retained-chain' }\n    }\n",
        """    if (reason === 'opening-host' && openingConflicts.length > 1) {\n      emitAtomicTrace('union-result', {\n        i,\n        j,\n        reason,\n        result: 'rejected',\n        rejection: 'retained-chain',\n        phase: 'blocked-key-preflight',\n        state: atomicRelationState(),\n      })\n      return { ok: false, reason: 'retained-chain' }\n    }\n    if (blocked && (reason !== 'opening-host' || openingConflicts.length !== 1)) {\n      emitAtomicTrace('union-result', {\n        i,\n        j,\n        reason,\n        result: 'rejected',\n        rejection: 'retained-chain',\n        phase: 'blocked-key-preflight',\n        state: atomicRelationState(),\n      })\n      return { ok: false, reason: 'retained-chain' }\n    }\n""",
        "blocked-key rejection trace",
    )
    text = once(
        text,
        "    if (!firstMembers || !secondMembers)\n      return { ok: false, reason: 'held-contact-unrepresentable' }\n",
        """    if (!firstMembers || !secondMembers) {\n      emitAtomicTrace('union-result', {\n        i,\n        j,\n        reason,\n        result: 'rejected',\n        rejection: 'held-contact-unrepresentable',\n        phase: 'member-preflight',\n        state: atomicRelationState(),\n      })\n      return { ok: false, reason: 'held-contact-unrepresentable' }\n    }\n""",
        "member-preflight trace",
    )
    text = once(
        text,
        "    const heldCheck = heldContactsForMembers(candidateMembers)\n    if (!heldCheck.ok) {\n      if (openingConflicts.length === 1)\n        supersededSourceChainRelationIds.delete(openingConflicts[0]!)\n      return { ok: false, reason: 'held-contact-unrepresentable' }\n    }\n",
        """    emitAtomicTrace('held-preflight', {\n      i,\n      j,\n      reason,\n      movingRoot,\n      retainedRoot,\n      candidateMembers: [...candidateMembers].sort((a, b) => a - b),\n      state: atomicRelationState(),\n    })\n    const heldCheck = heldContactsForMembers(candidateMembers)\n    if (!heldCheck.ok) {\n      if (openingConflicts.length === 1)\n        supersededSourceChainRelationIds.delete(openingConflicts[0]!)\n      emitAtomicTrace('union-result', {\n        i,\n        j,\n        reason,\n        result: 'rejected',\n        rejection: 'held-contact-unrepresentable',\n        phase: 'held-contact-preflight',\n        movingRoot,\n        retainedRoot,\n        state: atomicRelationState(),\n      })\n      return { ok: false, reason: 'held-contact-unrepresentable' }\n    }\n""",
        "held-preflight trace",
    )
    text = once(
        text,
        "    return { ok: true }\n  }\n\n  for (let i = 0; i < segs.length; i++) {",
        """    emitAtomicTrace('union-result', {\n      i,\n      j,\n      reason,\n      result: 'accepted',\n      movingRoot,\n      retainedRoot,\n      state: atomicRelationState(),\n    })\n    return { ok: true }\n  }\n\n  for (let i = 0; i < segs.length; i++) {""",
        "accepted union trace",
    )
    result_prefix = "emitAtomicTrace('union-result', {\n"
    result_head = result_prefix + "        i,\n        j,\n"
    result_replacement = (
        result_prefix
        + "        i,\n        j,\n"
        + "        firstSourceIds: atomicSourceIds(segs[i]!),\n"
        + "        secondSourceIds: atomicSourceIds(segs[j]!),\n"
    )
    if text.count(result_head) != 4:
        raise RuntimeError(f"union result trace heads: expected 4, got {text.count(result_head)}")
    text = text.replace(result_head, result_replacement, 4)
    accepted_result_head = result_prefix + "      i,\n      j,\n"
    accepted_result_replacement = (
        result_prefix
        + "      i,\n      j,\n"
        + "      firstSourceIds: atomicSourceIds(segs[i]!),\n"
        + "      secondSourceIds: atomicSourceIds(segs[j]!),\n"
    )
    text = once(text, accepted_result_head, accepted_result_replacement, "accepted trace source IDs")
    held_prefix = "emitAtomicTrace('held-preflight', {\n      i,\n      j,\n"
    held_replacement = (
        "emitAtomicTrace('held-preflight', {\n      i,\n      j,\n"
        "      firstSourceIds: atomicSourceIds(segs[i]!),\n"
        "      secondSourceIds: atomicSourceIds(segs[j]!),\n"
    )
    text = once(text, held_prefix, held_replacement, "held trace source IDs")
    return text


def mutate_old_key_bug(text: str) -> str:
    needle = """    for (const relationId of affectedRelations) {\n      if (supersededSourceChainRelationIds.has(relationId)) continue\n      const relation = sourceChainRelations[relationId]!\n      const outerARoot = find(relation.outerA.index)\n      const outerCRoot = find(relation.outerC.index)\n      if (outerARoot !== outerCRoot)\n        blockedSourceChainRootPairs.add(sourceChainRootPairKey(outerARoot, outerCRoot))\n    }\n    emitAtomicTrace('union-result',"""
    replacement = """    for (const relationId of movingRelations) {\n      if (supersededSourceChainRelationIds.has(relationId)) continue\n      const relation = sourceChainRelations[relationId]!\n      const outerARoot = find(relation.outerA.index)\n      const outerCRoot = find(relation.outerC.index)\n      if (outerARoot !== outerCRoot)\n        blockedSourceChainRootPairs.add(sourceChainRootPairKey(outerARoot, outerCRoot))\n    }\n    emitAtomicTrace('union-result',"""
    return once(text, needle, replacement, "old retained-root re-key mutation")


def main() -> None:
    if not FREEZE_MANIFEST.exists():
        raise RuntimeError(f"missing explicit R4 source-freeze manifest: {FREEZE_MANIFEST}")
    payloads = load_gate_payloads(FREEZE_MANIFEST)
    source_snapshot_path, source_entry, auxiliary = source_binding(payloads)
    source_bytes = source_snapshot_path.read_bytes()
    source_hash = sha256_bytes(source_bytes)
    SOURCE.write_bytes(source_bytes)
    source_text = source_bytes.decode()
    instrumented = instrument(source_text)
    mutated = mutate_old_key_bug(instrumented)
    INSTRUMENTED.write_text(instrumented)
    MUTATED.write_text(mutated)
    print(f"source={SOURCE} sha256={source_hash}")
    print(f"instrumented={INSTRUMENTED}")
    print(f"mutated={MUTATED}")
    print(f"gate={FREEZE_MANIFEST} sha256={sha256_bytes(FREEZE_MANIFEST.read_bytes())}")
    print(f"auxiliaryBindings={len(auxiliary)}")


if __name__ == "__main__":
    main()
