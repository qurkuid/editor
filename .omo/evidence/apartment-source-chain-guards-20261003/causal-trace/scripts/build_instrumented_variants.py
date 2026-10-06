from pathlib import Path
import json

ROOT = Path('.omo/evidence/apartment-source-chain-guards-20261003/causal-trace')

HELPERS = r'''

type TraceRecorder = { enabled: boolean; events: Record<string, unknown>[] }
function emitTrace(stage: string, payload: Record<string, unknown> = {}): void {
  const recorder = (globalThis as { __aptSourceTrace?: TraceRecorder }).__aptSourceTrace
  if (recorder?.enabled) recorder.events.push({ stage, ...payload })
}
function tracePoint(point: Vec2): Vec2 { return [point[0], point[1]] }
function sourceIdsOf(seg: Seg): string[] { return [...(seg.sourceIds ?? [])] }
function traceSegment(seg: Seg, index?: number): Record<string, unknown> {
  return { ...(index === undefined ? {} : { index }), sourceIds: sourceIdsOf(seg), start: tracePoint(seg.start), end: tracePoint(seg.end), thickness: seg.th, length: segLen(seg) }
}
function traceWall(wall: any, index: number, sourceIds: string[] = []): Record<string, unknown> {
  return { index, id: wall.id, sourceIds: [...sourceIds], start: tracePoint(wall.start), end: tracePoint(wall.end), thickness: wall.thickness ?? wall.th ?? null, children: [...(wall.children ?? [])] }
}
function duplicateTrace(segments: readonly { start: Vec2; end: Vec2; th: number; sourceIds?: string[] }[]): { count: number; length: number; pairs: Record<string, unknown>[] } {
  const len = (s: { start: Vec2; end: Vec2 }) => Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1])
  let count = 0
  let length = 0
  const pairs: Record<string, unknown>[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    const sl = len(s)
    if (sl <= 1e-9) continue
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const l = segments[j]!
      const ll = len(l)
      if (sl > ll + 1e-6 || ll <= 1e-9) continue
      const dx = (l.end[0] - l.start[0]) / ll
      const dy = (l.end[1] - l.start[1]) / ll
      const directionDot = Math.abs(((s.end[0] - s.start[0]) / sl) * dx + ((s.end[1] - s.start[1]) / sl) * dy)
      if (directionDot < 0.99) continue
      const project = (p: Vec2) => (p[0] - l.start[0]) * dx + (p[1] - l.start[1]) * dy
      const distance = (p: Vec2) => Math.abs((p[0] - l.start[0]) * dy - (p[1] - l.start[1]) * dx)
      if (![s.start, s.end].every((p) => project(p) >= -1e-6 && project(p) <= ll + 1e-6 && distance(p) <= l.th / 2 + 1e-6)) continue
      count += 1
      length += sl
      pairs.push({ shorterIndex: i, longerIndex: j, shorterLength: sl, longerLength: ll, shorterSourceIds: [...(s.sourceIds ?? [])], longerSourceIds: [...(l.sourceIds ?? [])] })
      break
    }
  }
  return { count, length, pairs }
}
function envelopeTrace(segments: readonly { start: Vec2; end: Vec2; th: number; sourceIds?: string[] }[]): { count: number; length: number; pairs: Record<string, unknown>[] } {
  const len = (s: { start: Vec2; end: Vec2 }) => Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1])
  let count = 0
  let length = 0
  const pairs: Record<string, unknown>[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    const sl = len(s)
    if (sl <= 1e-9) continue
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const l = segments[j]!
      const ll = len(l)
      if (sl > ll + 1e-6 || ll <= 1e-9) continue
      const dx = (l.end[0] - l.start[0]) / ll
      const dy = (l.end[1] - l.start[1]) / ll
      const project = (p: Vec2) => (p[0] - l.start[0]) * dx + (p[1] - l.start[1]) * dy
      const distance = (p: Vec2) => Math.abs((p[0] - l.start[0]) * dy - (p[1] - l.start[1]) * dx)
      if (![s.start, s.end].every((p) => project(p) >= -1e-6 && project(p) <= ll + 1e-6 && distance(p) <= l.th / 2 + 1e-6)) continue
      count += 1
      length += sl
      pairs.push({ shorterIndex: i, longerIndex: j, shorterLength: sl, longerLength: ll, shorterSourceIds: [...(s.sourceIds ?? [])], longerSourceIds: [...(l.sourceIds ?? [])] })
      break
    }
  }
  return { count, length, pairs }
}
function sameRunMetrics(a: Seg, b: Seg): Record<string, unknown> {
  const da = segDir(a)
  const lengthA = segLen(a)
  const lengthB = segLen(b)
  const b0 = along(b.start, a.start, da)
  const b1 = along(b.end, a.start, da)
  const intervalB = [Math.min(b0, b1), Math.max(b0, b1)]
  const gap = Math.max(0, Math.max(0, intervalB[0]!) - Math.min(lengthA, intervalB[1]!))
  const alignment = Math.abs(da[0] * segDir(b)[0] + da[1] * segDir(b)[1])
  const lateral = (p: Vec2) => Math.abs((p[0] - a.start[0]) * da[1] - (p[1] - a.start[1]) * da[0])
  const facing = intervalB[0]! >= lengthA ? [a.end, b0 <= b1 ? b.start : b.end] : intervalB[1]! <= 0 ? [a.start, b0 <= b1 ? b.end : b.start] : null
  return { thicknessDelta: Math.abs(a.th - b.th), alignment, lateralBStart: lateral(b.start), lateralBEnd: lateral(b.end), intervalA: [0, lengthA], intervalB, longitudinalGap: gap, facingEndpoints: facing?.map(tracePoint) ?? null, lengths: [lengthA, lengthB] }
}
function pointsMatchTrace(a: Vec2, b: Vec2): boolean { return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6 }
function bridgeCandidatesTrace(i: number, j: number, segs: Seg[], metrics: Record<string, unknown>): Record<string, unknown>[] {
  const facing = metrics.facingEndpoints as Vec2[] | null
  if (!facing) return []
  const out: Record<string, unknown>[] = []
  for (let k = 0; k < segs.length; k++) {
    if (k === i || k === j) continue
    const candidate = segs[k]!
    const matches = (pointsMatchTrace(candidate.start, facing[0]!) && pointsMatchTrace(candidate.end, facing[1]!)) || (pointsMatchTrace(candidate.start, facing[1]!) && pointsMatchTrace(candidate.end, facing[0]!))
    if (!matches) continue
    out.push({ index: k, sourceIds: sourceIdsOf(candidate), unionableWithFirst: isSameWallRun(candidate, segs[i]!), unionableWithSecond: isSameWallRun(candidate, segs[j]!), start: tracePoint(candidate.start), end: tracePoint(candidate.end), thickness: candidate.th })
  }
  return out
}
function sourceIdsForWallTrace(wall: any, bases: any[], baseIds: string[][]): string[] {
  const out = new Set<string>()
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]!
    const length = Math.hypot(base.end[0] - base.start[0], base.end[1] - base.start[1])
    if (length <= 1e-9) continue
    const dx = (base.end[0] - base.start[0]) / length
    const dy = (base.end[1] - base.start[1]) / length
    const distance = (p: Vec2) => Math.abs((p[0] - base.start[0]) * dy - (p[1] - base.start[1]) * dx)
    const at = (p: Vec2) => (p[0] - base.start[0]) * dx + (p[1] - base.start[1]) * dy
    if (distance(wall.start) <= 1e-6 && distance(wall.end) <= 1e-6 && at(wall.start) >= -1e-6 && at(wall.start) <= length + 1e-6 && at(wall.end) >= -1e-6 && at(wall.end) <= length + 1e-6) for (const id of baseIds[i] ?? []) out.add(id)
  }
  return [...out].sort()
}
'''

def once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f'{label}: expected 1 match, got {n}')
    return text.replace(old, new)

def instrument(text: str, variant: str) -> str:
    text = once(text, 'type Seg = { start: Vec2; end: Vec2; th: number }', 'type Seg = { start: Vec2; end: Vec2; th: number; sourceIds?: string[] }' + HELPERS, 'helpers')
    if 'const SOURCE_ENDPOINT_EPS_M = 1e-6' not in text:
        text = once(text, 'const MERGE_RUN_GAP_M = 0.35', 'const MERGE_RUN_GAP_M = 0.35\nconst SOURCE_ENDPOINT_EPS_M = 1e-6', 'epsilon')
    text = once(text, """    if (!isFiniteVec2(wall.start) || !isFiniteVec2(wall.end) || !Number.isFinite(wall.thickness)) {
      droppedWallIds.push(wall.id)
      continue
    }""", """    if (!isFiniteVec2(wall.start) || !isFiniteVec2(wall.end) || !Number.isFinite(wall.thickness)) {
      emitTrace('source-segment', { sourceId: wall.id, originalStart: wall.start, originalEnd: wall.end, accepted: false, dropReason: 'invalid' })
      droppedWallIds.push(wall.id)
      continue
    }""", 'invalid source')
    text = once(text, """    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) {
      droppedWallIds.push(wall.id)
      continue
    }
    segs.push({ start, end, th: clamp(wall.thickness / 1000, 0.05, 0.6) })""", """    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) {
      emitTrace('source-segment', { sourceId: wall.id, originalStart: wall.start, originalEnd: wall.end, transformedStart: start, transformedEnd: end, accepted: false, dropReason: 'below-min-wall-length' })
      droppedWallIds.push(wall.id)
      continue
    }
    const sourceSegment = { start, end, th: clamp(wall.thickness / 1000, 0.05, 0.6), sourceIds: [wall.id] }
    segs.push(sourceSegment)
    emitTrace('source-segment', { sourceId: wall.id, originalStart: wall.start, originalEnd: wall.end, transformedStart: start, transformedEnd: end, thickness: sourceSegment.th, accepted: true })""", 'accepted source')
    text = once(text, """  const union = (i: number, j: number) => {
    parent[find(i)] = find(j)
  }""", """  const union = (i: number, j: number, reason = 'unspecified', details: Record<string, unknown> = {}) => {
    const beforeRoots = [find(i), find(j)]
    parent[find(i)] = find(j)
    const afterRoot = find(i)
    const members = segs.map((_, index) => index).filter((index) => find(index) === afterRoot)
    const longest = members.reduce((best, index) => (segLen(segs[index]!) > segLen(segs[best]!) ? index : best), members[0]!)
    const ref = segs[longest]!
    const refLength = segLen(ref)
    const refDir: Vec2 = [(ref.end[0] - ref.start[0]) / refLength, (ref.end[1] - ref.start[1]) / refLength]
    const projected = members.flatMap((index) => [segs[index]!.start, segs[index]!.end]).map((point) => along(point, ref.start, refDir))
    const lo = Math.min(...projected)
    const hi = Math.max(...projected)
    const afterGroup = { memberIndices: members, sourceIds: [...new Set(members.flatMap((index) => sourceIdsOf(segs[index]!)))].sort(), start: [ref.start[0] + refDir[0] * lo, ref.start[1] + refDir[1] * lo] as Vec2, end: [ref.start[0] + refDir[0] * hi, ref.start[1] + refDir[1] * hi] as Vec2, thickness: Math.max(...members.map((index) => segs[index]!.th)) }
    emitTrace('union-apply', { reason, leftIndex: i, rightIndex: j, leftSourceIds: sourceIdsOf(segs[i]!), rightSourceIds: sourceIdsOf(segs[j]!), beforeRoots, afterRoot, afterGroup, ...details })
  }""", 'union')
    if 'const sourceEndpointPairs' not in text:
        text = once(text, """  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (isSameWallRun(segs[i]!, segs[j]!)) union(i, j)
    }
  }""", """  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const sameRun = isSameWallRun(segs[i]!, segs[j]!)
      const metrics = sameRunMetrics(segs[i]!, segs[j]!)
      const bridges = sameRun ? bridgeCandidatesTrace(i, j, segs, metrics) : []
      emitTrace('same-run-candidate', { leftIndex: i, rightIndex: j, leftSourceIds: sourceIdsOf(segs[i]!), rightSourceIds: sourceIdsOf(segs[j]!), sameRun, ...metrics, directBridgeCandidates: bridges, apply: sameRun, reason: sameRun ? 'same-run-union' : 'not-same-run' })
      if (sameRun) union(i, j, 'same-run', { metrics, directBridgeCandidates: bridges })
    }
  }""", 'Lane A same-run')
    else:
        text = once(text, """      if (!isSameWallRun(segs[i]!, segs[j]!)) continue
      // A retained source segment that exactly bridges the proposed gap is a
      // physical part of the wall, even when its thickness differs. Keep its
      // outer source lines out of normal unions so later projection cannot
      // move a chain endpoint across it; ambiguous competing chains are
      // protected by the same precomputed set.
      if (sourceChainProtectedSegments.has(i) || sourceChainProtectedSegments.has(j)) continue
      union(i, j)""", """      const sameRun = isSameWallRun(segs[i]!, segs[j]!)
      const metrics = sameRun ? sameRunMetrics(segs[i]!, segs[j]!) : {}
      const bridges = sameRun ? bridgeCandidatesTrace(i, j, segs, metrics) : []
      const protectedSkip = sameRun && (sourceChainProtectedSegments.has(i) || sourceChainProtectedSegments.has(j))
      emitTrace('same-run-candidate', { leftIndex: i, rightIndex: j, leftSourceIds: sourceIdsOf(segs[i]!), rightSourceIds: sourceIdsOf(segs[j]!), sameRun, ...metrics, directBridgeCandidates: bridges, apply: sameRun && !protectedSkip, reason: !sameRun ? 'not-same-run' : protectedSkip ? 'global-source-chain-protection' : 'same-run-union' })
      if (!sameRun || protectedSkip) continue
      union(i, j, 'same-run', { metrics, directBridgeCandidates: bridges })""", 'WIP same-run')
    if variant == 'lane-a-pair-local':
        text = once(text, """          if (!cross) {
            // near-parallel: bridge an end-to-end split in the same wall run""", """          if (!cross) {
            if (distToSegment(p, b) <= SOURCE_ENDPOINT_EPS_M) {
              emitTrace('snap-pair-skip', { pass, segmentIndex: i, endpoint: endKey, otherIndex: j, sourceIds: sourceIdsOf(a), otherSourceIds: sourceIdsOf(b), reason: 'exact-centerline-contact' })
              continue
            }
            // near-parallel: bridge an end-to-end split in the same wall run""", 'pair guard')
    text = once(text, '    if (covered !== null) {\n      placements.push({ doc: opening, group: covered, width })', """    if (covered !== null) {
      emitTrace('opening-host-union', { openingId: opening.id, decision: 'covered', selectedGroup: covered, selectedSourceIds: sourceIdsOf(segs[covered]!), width })
      placements.push({ doc: opening, group: covered, width })""", 'covered opening')
    text = once(text, '    } else if (left !== null && right !== null && left !== right) {\n      union(left, right)\n      placements.push({ doc: opening, group: left, width })', """    } else if (left !== null && right !== null && left !== right) {
      union(left, right, 'opening-flank', { openingId: opening.id, width })
      emitTrace('opening-host-union', { openingId: opening.id, decision: 'flanks', leftIndex: left, rightIndex: right, leftSourceIds: sourceIdsOf(segs[left]!), rightSourceIds: sourceIdsOf(segs[right]!), selectedSourceIds: [...new Set([...sourceIdsOf(segs[left]!), ...sourceIdsOf(segs[right]!)])], width })
      placements.push({ doc: opening, group: left, width })""", 'flank opening')
    text = once(text, """    } else if ((left !== null || right !== null) && opening.src !== 'boundary') {
      // Extending a single flank across the gap is right for corner doors,""", """    } else if ((left !== null || right !== null) && opening.src !== 'boundary') {
      emitTrace('opening-host-union', { openingId: opening.id, decision: 'single-flank-extension', flankIndex: left ?? right, flankSourceIds: sourceIdsOf(segs[(left ?? right)!]!), width })
      // Extending a single flank across the gap is right for corner doors,""", 'single opening')
    text = once(text, """      if (extendToCrossingWalls(synth, segs)) {
        const index = segs.push(synth) - 1
        parent.push(index)
        placements.push({ doc: opening, group: index, width })""", """      if (extendToCrossingWalls(synth, segs)) {
        synth.sourceIds = [`opening:${opening.id}`]
        const index = segs.push(synth) - 1
        parent.push(index)
        emitTrace('opening-host-union', { openingId: opening.id, decision: 'synthesized-crossing-host', selectedGroup: index, selectedSourceIds: sourceIdsOf(synth), width })
        placements.push({ doc: opening, group: index, width })""", 'synth opening')
    text = once(text, """    members.push(i)
    groupMembers.set(root, members)
  })

  const merged: Seg[] = []""", """    members.push(i)
    groupMembers.set(root, members)
  })
  emitTrace('post-union-groups', { groups: [...groupMembers.entries()].map(([root, members]) => ({ root, memberIndices: [...members], sourceIds: [...new Set(members.flatMap((index) => sourceIdsOf(segs[index]!)))], })) })

  const merged: Seg[] = []""", 'groups')
    text = once(text, """      end: [anchor[0] + dir[0] * hi, anchor[1] + dir[1] * hi],
      th: thickness,
    })""", """      end: [anchor[0] + dir[0] * hi, anchor[1] + dir[1] * hi],
      th: thickness,
      sourceIds: [...new Set(members.flatMap((index) => sourceIdsOf(segs[index]!)))],
    })""", 'merged ids')
    if '  snapJunctions(merged, sourceChainProtectedEndpoints)' in text:
        text = once(text, '  snapJunctions(merged, sourceChainProtectedEndpoints)\n  weldDanglingEnds(merged, sourceChainProtectedEndpoints)', """  emitTrace('merged-before-snap', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })
  snapJunctions(merged, sourceChainProtectedEndpoints)
  emitTrace('post-snap', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })
  weldDanglingEnds(merged, sourceChainProtectedEndpoints)
  emitTrace('post-weld', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })""", 'WIP stages')
    else:
        text = once(text, '  snapJunctions(merged)\n  weldDanglingEnds(merged)', """  emitTrace('merged-before-snap', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })
  snapJunctions(merged)
  emitTrace('post-snap', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })
  weldDanglingEnds(merged)
  emitTrace('post-weld', { segments: merged.map(traceSegment), containedDuplicateSpan: duplicateTrace(merged), containedEnvelopeSpan: envelopeTrace(merged) })""", 'Lane A stages')
    text = once(text, """  const connected = connectWallJunctions(walls, openings)
  const detection = detectSpacesForLevel('apt-vector-import', connected.walls)""", """  const sourceIdsByWallIndex = merged.map((segment) => sourceIdsOf(segment))
  emitTrace('before-connect', { walls: walls.map((wall, index) => traceWall(wall, index, sourceIdsByWallIndex[index] ?? [])), openings: openings.map((opening) => ({ id: opening.id, wallId: opening.wallId, width: opening.width, position: opening.position })) })
  const connected = connectWallJunctions(walls, openings)
  emitTrace('after-connect', { walls: connected.walls.map((wall, index) => traceWall(wall, index, sourceIdsForWallTrace(wall, walls, sourceIdsByWallIndex))), openings: connected.openings.map((opening) => ({ id: opening.id, wallId: opening.wallId, parentId: opening.parentId, width: opening.width, position: opening.position })) })
  const detection = detectSpacesForLevel('apt-vector-import', connected.walls)""", 'connect')
    text = once(text, """  const finalRoomPolygons = finalSpaces.map((space) => space.polygon.map(([x, y]) => ({ x, y })))
  return {
    ...framed,""", """  const finalRoomPolygons = finalSpaces.map((space) => space.polygon.map(([x, y]) => ({ x, y })))
  const finalTraceWalls = framed.walls.map((wall, index) => traceWall(wall, index, sourceIdsForWallTrace(wall, connected.walls, connected.walls.map((baseWall) => sourceIdsForWallTrace(baseWall, walls, sourceIdsByWallIndex)))))
  emitTrace('final', { walls: finalTraceWalls, openings: framed.openings.map((opening) => ({ id: opening.id, wallId: opening.wallId, parentId: opening.parentId, width: opening.width, position: opening.position })), containedDuplicateSpan: duplicateTrace(finalTraceWalls.map((wall) => ({ start: wall.start as Vec2, end: wall.end as Vec2, th: Number(wall.thickness ?? 0.1), sourceIds: wall.sourceIds as string[] }))), containedEnvelopeSpan: envelopeTrace(finalTraceWalls.map((wall) => ({ start: wall.start as Vec2, end: wall.end as Vec2, th: Number(wall.thickness ?? 0.1), sourceIds: wall.sourceIds as string[] }))) })
  return {
    ...framed,""", 'final')
    # snap structures and candidate provenance
    text = text.replace('let bestCorner: { q: Vec2; d: number } | null = null', 'let bestCorner: { q: Vec2; d: number; candidateIndex: number; branch: string } | null = null')
    text = text.replace('let bestTee: { q: Vec2; d: number } | null = null', 'let bestTee: { q: Vec2; d: number; candidateIndex: number; branch: string } | null = null')
    text = text.replace('bestTee = { q: target, d: gap }', "bestTee = { q: target, d: gap, candidateIndex: j, branch: 'near-parallel' }")
    text = text.replace('bestCorner = { q: cross, d }', "bestCorner = { q: cross, d, candidateIndex: j, branch: 'corner' }")
    text = text.replace('bestTee = { q: cross, d: move }', "bestTee = { q: cross, d: move, candidateIndex: j, branch: 'tee' }")
    snap_old = """        const target = bestCorner ?? bestTee
        if (target && Math.hypot(p[0] - target.q[0], p[1] - target.q[1]) > 1e-6) {
          const otherEnd = a[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target.q[0] - otherEnd[0], target.q[1] - otherEnd[1]) >= 0.1) {
            a[endKey] = [target.q[0], target.q[1]]
          }
        }"""
    snap_new = """        const target = bestCorner ?? bestTee
        const oldPoint = tracePoint(p)
        const proposedPoint = target ? tracePoint(target.q) : null
        let snapApplied = false
        let snapReason = target ? 'candidate-rejected' : 'no-candidate'
        if (target && Math.hypot(p[0] - target.q[0], p[1] - target.q[1]) > 1e-6) {
          const otherEnd = a[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target.q[0] - otherEnd[0], target.q[1] - otherEnd[1]) >= 0.1) {
            a[endKey] = [target.q[0], target.q[1]]
            snapApplied = true
            snapReason = 'applied'
          } else {
            snapReason = 'other-end-too-close'
          }
        } else if (target) {
          snapReason = 'within-epsilon'
        }
        emitTrace('snap-step', { pass, segmentIndex: i, sourceIds: sourceIdsOf(a), endpoint: endKey, oldPoint, proposedPoint, selectedCandidateIndex: target?.candidateIndex ?? null, selectedCandidateSourceIds: target ? sourceIdsOf(segs[target.candidateIndex]!) : [], branch: target?.branch ?? null, moveDistance: target ? Math.hypot(oldPoint[0] - target.q[0], oldPoint[1] - target.q[1]) : 0, applied: snapApplied, reason: snapReason })"""
    if snap_old in text:
        text = once(text, snap_old, snap_new, 'snap step')
    text = text.replace('if (protectedSourceEndpoints.some((point) => sourcePointsMatch(p, point))) continue', """if (protectedSourceEndpoints.some((point) => sourcePointsMatch(p, point))) {
          emitTrace('snap-step', { pass, segmentIndex: i, sourceIds: sourceIdsOf(a), endpoint: endKey, oldPoint: tracePoint(p), proposedPoint: null, selectedCandidateIndex: null, selectedCandidateSourceIds: [], branch: null, moveDistance: 0, applied: false, reason: 'global-source-endpoint-protection' })
          continue
        }""")
    text = text.replace('if (distToSegment(p, b) <= SOURCE_ENDPOINT_EPS_M) continue', """if (distToSegment(p, b) <= SOURCE_ENDPOINT_EPS_M) {
              emitTrace('snap-pair-skip', { pass, segmentIndex: i, endpoint: endKey, otherIndex: j, sourceIds: sourceIdsOf(a), otherSourceIds: sourceIdsOf(b), reason: 'exact-centerline-contact' })
              continue
            }""")
    # weld trace
    text = once(text, '        let bestMove = Number.POSITIVE_INFINITY\n        for (let otherIndex', '        let bestMove = Number.POSITIVE_INFINITY\n        let bestCandidateIndex: number | null = null\n        let bestBranch: string | null = null\n        for (let otherIndex', 'weld metadata')
    text = text.replace('              target = cross\n', "              target = cross\n              bestCandidateIndex = otherIndex\n              bestBranch = 'cross'\n")
    text = text.replace('              target = candidate\n', "              target = candidate\n              bestCandidateIndex = otherIndex\n              bestBranch = 'near-parallel'\n")
    weld_old = """        if (target) {
          const otherEnd = seg[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target[0] - otherEnd[0], target[1] - otherEnd[1]) >= 0.1) {
            seg[endKey] = target
          }
        }"""
    weld_new = """        const oldPoint = tracePoint(p)
        const proposedPoint = target ? tracePoint(target) : null
        let weldApplied = false
        let weldReason = target ? 'candidate-rejected' : 'no-candidate'
        if (target) {
          const otherEnd = seg[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target[0] - otherEnd[0], target[1] - otherEnd[1]) >= 0.1) {
            seg[endKey] = target
            weldApplied = true
            weldReason = 'applied'
          } else {
            weldReason = 'other-end-too-close'
          }
        }
        emitTrace('weld-step', { pass, segmentIndex: segs.indexOf(seg), sourceIds: sourceIdsOf(seg), endpoint: endKey, oldPoint, proposedPoint, selectedCandidateIndex: bestCandidateIndex, selectedCandidateSourceIds: bestCandidateIndex === null ? [] : sourceIdsOf(segs[bestCandidateIndex]!), branch: bestBranch, movementBudget: ownBudget, dangling: dangling.has(endId(segs, seg, endKey)), touchesBefore: touches(p, seg), applied: weldApplied, reason: weldReason })"""
    if weld_old in text:
        text = once(text, weld_old, weld_new, 'weld step')
    text = once(text, "  for (let pass = 0; pass < 2; pass++) {\n    const dangling = new Set<string>()", "  for (let pass = 0; pass < 2; pass++) {\n    emitTrace('weld-pass', { pass, segmentCount: segs.length })\n    const dangling = new Set<string>()", 'weld pass')
    return text

for variant in ('lane-a', 'lane-a-pair-local', 'paused-wip'):
    original = ROOT / 'copies' / variant / 'source-original.ts'
    instrumented = instrument(original.read_text(), variant)
    (original.parent / 'apt-vector-scene-trace.ts').write_text(instrumented)


def pair_local_control(text: str) -> str:
    """Build the uninstrumented pair-local comparison from the frozen Lane A copy."""
    text = once(text, 'const MERGE_RUN_GAP_M = 0.35', 'const MERGE_RUN_GAP_M = 0.35\nconst SOURCE_ENDPOINT_EPS_M = 1e-6', 'control epsilon')
    return once(text, """          if (!cross) {
            // near-parallel: bridge an end-to-end split in the same wall run""", """          if (!cross) {
            if (distToSegment(p, b) <= SOURCE_ENDPOINT_EPS_M) continue
            // near-parallel: bridge an end-to-end split in the same wall run""", 'control pair guard')

pair_original = ROOT / 'copies' / 'lane-a-pair-local' / 'source-original.ts'
(pair_original.parent / 'source-control.ts').write_text(pair_local_control(pair_original.read_text()))
