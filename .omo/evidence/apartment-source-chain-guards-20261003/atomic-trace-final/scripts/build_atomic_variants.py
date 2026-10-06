#!/usr/bin/env python3
"""Build the evidence-only DSU trace and one-line old-key mutation.

This script writes only under the sibling atomic-trace-final evidence tree. It
copies the already captured final importer, injects trace-only observations,
then makes a counterfactual mutation of the retained-root re-key loop. The
live product source is never read as a transform input after the source copy
has been captured by the caller.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COPIES = ROOT / "copies"
SOURCE = COPIES / "source-final.ts"
INSTRUMENTED = COPIES / "apt-vector-scene.instrumented.ts"
MUTATED = COPIES / "apt-vector-scene.old-key-mutated.ts"


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


def instrument(text: str) -> str:
    text = once(
        text,
        "const SOURCE_ENDPOINT_EPS_M = 1e-6\n",
        "const SOURCE_ENDPOINT_EPS_M = 1e-6\n" + TRACE_HELPERS,
        "trace helpers",
    )
    text = once(
        text,
        "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n}",
        "type Seg = {\n  start: Vec2\n  end: Vec2\n  th: number\n  sourceIndices?: number[]\n  /** Trace-only provenance; never read by product geometry logic. */\n  atomicSourceIds?: string[]\n  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }\n}",
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
    source_text = SOURCE.read_text()
    instrumented = instrument(source_text)
    mutated = mutate_old_key_bug(instrumented)
    INSTRUMENTED.write_text(instrumented)
    MUTATED.write_text(mutated)
    print(f"instrumented={INSTRUMENTED}")
    print(f"mutated={MUTATED}")


if __name__ == "__main__":
    main()
