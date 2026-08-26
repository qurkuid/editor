import {
  createDefaultWallFaceBands,
  DoorNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'

/** JSON document produced by the floorplan-vectorizer CLI (`--stdout`). */
export type AptVectorDoc = {
  unit: 'mm' | 'px'
  docVersion?: number
  imageSize: [number, number]
  mmPerPx: number | null
  walls: {
    id: string
    kind: 'exterior' | 'interior'
    start: [number, number]
    end: [number, number]
    thickness: number
  }[]
  openings: {
    id: string
    type: 'door' | 'window' | 'opening'
    a: [number, number]
    b: [number, number]
    wallThickness: number
    src?: 'pair' | 'ray' | 'boundary'
    hinge?: [number, number]
    radius?: number
  }[]
  rooms: {
    id: string
    name: string | null
    cls: string
    areaM2: number | null
    polygon?: [number, number][]
  }[]
  metrics?: { style?: string; wallIoU?: number }
}

export type VectorDiagnostics = {
  /** doc opening ids that never got hosted on a wall (no flank, too small). */
  unhostedOpeningIds: string[]
  /** doc opening ids suppressed as duplicate detections of a kept opening. */
  dedupedOpeningIds: string[]
  /** doc wall ids filtered out for being shorter than the minimum length. */
  droppedWallIds: string[]
}

export type VectorSceneNodes = {
  /** Parsed wall nodes; children/parentId linking is the caller's job. */
  walls: WallNode[]
  /** Wall-hosted doors/windows/openings; `wallId` names the host wall. */
  openings: (DoorNode | WindowNode)[]
  /** Room zones (OCR label + polygon) for space documentation. */
  zones: ZoneNode[]
  /** guide.scale that makes the 10 m guide plane match the plan's real size. */
  guideScale: number
  /** What the conversion left out — the debug viewer's defect layer. */
  diagnostics: VectorDiagnostics
}

const MIN_WALL_LENGTH_M = 0.12
const FLANK_LATERAL_M = 0.25
const FLANK_ALONG_M = 0.45
const SNAP_CORNER_M = 0.3
const SNAP_TEE_LATERAL_M = 0.35
const SNAP_COLLINEAR_M = 0.6
const SNAP_MAX_MOVE_M = 0.6
const MERGE_THICKNESS_TOL_M = 0.08
const MERGE_RUN_GAP_M = 0.35
const OPENING_OVERLAP_FRAC = 0.3
const DOOR_HEIGHT_M = 2.1
const WINDOW_HEIGHT_M = 1.5
const WINDOW_SILL_M = 0.9

const ROOM_NAME_KO: Record<string, string> = {
  bedroom: '방',
  living: '거실',
  kitchen: '주방',
  bath: '욕실',
  balcony: '발코니',
  entrance: '현관',
  dress: '드레스룸',
  storage: '창고',
  utility: '다용도실',
  study: '서재',
  hall: '복도',
  shelter: '대피공간',
  elevator: '코어',
}

const ROOM_COLOR: Record<string, string> = {
  bedroom: '#c98f4e',
  living: '#8f8878',
  kitchen: '#a09a8b',
  bath: '#6fa7c7',
  balcony: '#b0a468',
  entrance: '#9b8f7f',
  dress: '#b08d55',
  storage: '#8d8577',
  utility: '#8d8577',
}

type Vec2 = [number, number]
type Seg = { start: Vec2; end: Vec2; th: number }
type OpeningPlacement = { doc: AptVectorDoc['openings'][number]; group: number; width: number }

/**
 * Maps a vectorizer document (mm, image-origin top-left) into scene nodes
 * (metres, level origin at the plan center — matching a guide node placed at
 * [0,0,0] with the returned `guideScale`).
 *
 * The vectorizer emits openings as GAPS between wall segments; the editor
 * hosts doors/windows INSIDE a continuous wall (`cut-opening` model). So the
 * collinear walls flanking each gap are merged into one wall spanning the
 * opening, and the opening is then hosted wall-locally on the merged wall.
 * A junction-snap pass then closes the remaining corner/tee gaps (extending
 * each wall along its own axis, so directions are preserved and enclosed
 * spaces actually close), and the vectorizer's labeled room polygons become
 * room zones.
 *
 * Returns null when the document is not trustworthy enough to auto-model
 * (no scale, degraded render variant, or too few walls) so callers can fall
 * back to the plain guide flow.
 */
export function buildVectorNodes(doc: AptVectorDoc): VectorSceneNodes | null {
  if (doc.unit !== 'mm' || !doc.mmPerPx || doc.mmPerPx <= 0) return null
  if (doc.metrics?.style === 'wood-dense') return null

  const [imageW, imageH] = doc.imageSize
  const cx = (imageW * doc.mmPerPx) / 2
  const cy = (imageH * doc.mmPerPx) / 2
  const toLevel = ([x, y]: Vec2): Vec2 => [(x - cx) / 1000, (y - cy) / 1000]

  const droppedWallIds: string[] = []
  const segs: Seg[] = []
  for (const wall of doc.walls) {
    const start = toLevel(wall.start)
    const end = toLevel(wall.end)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) {
      droppedWallIds.push(wall.id)
      continue
    }
    segs.push({ start, end, th: clamp(wall.thickness / 1000, 0.05, 0.6) })
  }
  if (segs.length < 3) return null

  // Union-find over wall segments; every opening unions its two collinear
  // flanks (or extends its single flank across the gap for corner doors).
  const parent = segs.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j)
  }

  // The vectorizer splits one physical wall run into several segments (and
  // occasionally traces a thick wall twice, slightly offset). Merge same-run
  // segments up front so one wall face comes out as ONE wall node instead of
  // seam-touching fragments. Different-thickness continuations stay separate
  // walls and are only end-snapped later.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (isSameWallRun(segs[i]!, segs[j]!)) union(i, j)
    }
  }
  // Extra coverage points a group must span (far gap ends of single-flank
  // openings), keyed by any member index.
  const extraPoints: { member: number; point: Vec2 }[] = []

  const placements: OpeningPlacement[] = []
  for (const opening of doc.openings) {
    const a = toLevel(opening.a)
    const b = toLevel(opening.b)
    const gapLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (gapLen < 0.05) continue
    const dir: Vec2 = [(b[0] - a[0]) / gapLen, (b[1] - a[1]) / gapLen]
    const width = clampOpeningWidth(opening.type, gapLen)
    if (!width) continue

    let left: number | null = null
    let right: number | null = null
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!
      if (!isCollinearWith(seg, a, dir)) continue
      const p0 = along(seg.start, a, dir)
      const p1 = along(seg.end, a, dir)
      const lo = Math.min(p0, p1)
      const hi = Math.max(p0, p1)
      if (
        hi >= -FLANK_ALONG_M &&
        hi <= 0.15 &&
        (left === null || hi > alongHi(segs[left]!, a, dir))
      )
        left = i
      if (
        lo >= gapLen - 0.15 &&
        lo <= gapLen + FLANK_ALONG_M &&
        (right === null || lo < alongLo(segs[right]!, a, dir))
      )
        right = i
    }

    if (left !== null && right !== null && left !== right) {
      union(left, right)
      placements.push({ doc: opening, group: left, width })
    } else if ((left !== null || right !== null) && opening.src !== 'boundary') {
      // Extending a single flank across the gap is right for corner doors,
      // but a boundary glazing span next to one stray collinear stub would
      // stretch that stub metres across to a glazed corner with nothing to
      // weld the far end to — boundary spans go through the both-ends
      // synthesis below instead.
      const member = (left ?? right)!
      extraPoints.push({ member, point: left !== null ? b : a })
      placements.push({ doc: opening, group: member, width })
    } else if (gapLen >= MIN_WALL_LENGTH_M) {
      // No collinear flank at all — silhouette-boundary glazing whose corner
      // piers merged into the perpendicular walls. Materialize the host wall
      // the vectorizer asserted, but only when BOTH ends reach a crossing
      // wall to weld onto — a floating span would just trade an unhosted
      // opening for two dangling wall ends.
      const th = clamp(opening.wallThickness / 1000, 0.05, 0.6)
      const synth: Seg = { start: [...a] as Vec2, end: [...b] as Vec2, th }
      if (extendToCrossingWalls(synth, segs)) {
        const index = segs.push(synth) - 1
        parent.push(index)
        placements.push({ doc: opening, group: index, width })
      }
    }
  }

  // Build one merged segment per group: project member endpoints (plus
  // coverage points) onto the longest member's line and keep the extremes.
  const groupMembers = new Map<number, number[]>()
  segs.forEach((_, i) => {
    const root = find(i)
    const members = groupMembers.get(root) ?? []
    members.push(i)
    groupMembers.set(root, members)
  })

  const merged: Seg[] = []
  const mergedIndexByRoot = new Map<number, number>()
  for (const [root, members] of groupMembers) {
    const longest = members.reduce((best, i) => (segLen(segs[i]!) > segLen(segs[best]!) ? i : best))
    const ref = segs[longest]!
    const len0 = segLen(ref)
    const dir: Vec2 = [(ref.end[0] - ref.start[0]) / len0, (ref.end[1] - ref.start[1]) / len0]
    const anchor = ref.start
    const points: Vec2[] = members.flatMap((i) => [segs[i]!.start, segs[i]!.end])
    for (const extra of extraPoints) if (find(extra.member) === root) points.push(extra.point)
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const point of points) {
      const t = along(point, anchor, dir)
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    if (hi - lo < MIN_WALL_LENGTH_M) continue
    const thickness = Math.max(...members.map((i) => segs[i]!.th))
    mergedIndexByRoot.set(root, merged.length)
    merged.push({
      start: [anchor[0] + dir[0] * lo, anchor[1] + dir[1] * lo],
      end: [anchor[0] + dir[0] * hi, anchor[1] + dir[1] * hi],
      th: thickness,
    })
  }

  snapJunctions(merged)
  weldDanglingEnds(merged)

  const walls: WallNode[] = []
  const hostByMerged: ({ node: WallNode; anchor: Vec2; dir: Vec2; len: number } | null)[] = []
  for (const seg of merged) {
    const len = segLen(seg)
    if (len < 0.05) {
      hostByMerged.push(null)
      continue
    }
    const node = WallNode.parse({
      start: seg.start,
      end: seg.end,
      thickness: seg.th,
      faceBands: createDefaultWallFaceBands(seg.th),
    })
    walls.push(node)
    hostByMerged.push({
      node,
      anchor: seg.start,
      dir: [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len],
      len,
    })
  }

  // Host every placement first, then resolve overlaps per wall: duplicate
  // detections of the same physical opening (a pair gap plus an overshooting
  // ray gap) would otherwise stack two windows on one wall. Doors outrank
  // windows outrank bare openings; among equals the tighter span wins.
  type Hosted = {
    docId: string
    mergedIndex: number
    at: number
    width: number
    type: 'door' | 'window' | 'opening'
  }
  const hosted: Hosted[] = []
  for (const placement of placements) {
    const mergedIndex = mergedIndexByRoot.get(find(placement.group))
    if (mergedIndex === undefined) continue
    const host = hostByMerged[mergedIndex]
    if (!host || host.len < placement.width) continue
    const a = toLevel(placement.doc.a)
    const b = toLevel(placement.doc.b)
    const center: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const at = clamp(
      along(center, host.anchor, host.dir),
      placement.width / 2,
      host.len - placement.width / 2,
    )
    hosted.push({
      docId: placement.doc.id,
      mergedIndex,
      at,
      width: placement.width,
      type: placement.doc.type,
    })
  }
  const typeRank = { door: 0, window: 1, opening: 2 } as const
  hosted.sort(
    (p, q) =>
      p.mergedIndex - q.mergedIndex || typeRank[p.type] - typeRank[q.type] || p.width - q.width,
  )
  const kept: Hosted[] = []
  const dedupedOpeningIds: string[] = []
  for (const candidate of hosted) {
    const clash = kept.some((other) => {
      if (other.mergedIndex !== candidate.mergedIndex) return false
      const overlap =
        Math.min(candidate.at + candidate.width / 2, other.at + other.width / 2) -
        Math.max(candidate.at - candidate.width / 2, other.at - other.width / 2)
      return overlap > OPENING_OVERLAP_FRAC * Math.min(candidate.width, other.width)
    })
    if (clash) dedupedOpeningIds.push(candidate.docId)
    else kept.push(candidate)
  }
  const placedIds = new Set([...kept.map((item) => item.docId), ...dedupedOpeningIds])
  const unhostedOpeningIds = doc.openings
    .filter((opening) => !placedIds.has(opening.id))
    .map((opening) => opening.id)

  const openings: (DoorNode | WindowNode)[] = []
  for (const item of kept) {
    const host = hostByMerged[item.mergedIndex]!
    if (item.type === 'door') {
      openings.push(
        DoorNode.parse({
          wallId: host.node.id,
          width: item.width,
          height: DOOR_HEIGHT_M,
          position: [item.at, DOOR_HEIGHT_M / 2, 0],
        }),
      )
    } else {
      const isOpening = item.type === 'opening'
      const height = isOpening ? DOOR_HEIGHT_M : WINDOW_HEIGHT_M
      const sill = isOpening ? 0 : WINDOW_SILL_M
      openings.push(
        WindowNode.parse({
          wallId: host.node.id,
          width: item.width,
          height,
          ...(isOpening ? { openingKind: 'opening' } : {}),
          position: [item.at, sill + height / 2, 0],
        }),
      )
    }
  }

  const zones: ZoneNode[] = []
  for (const room of doc.rooms) {
    if (!room.polygon || room.polygon.length < 3) continue
    // white-tile rooms without an OCR label are utility/service spaces as
    // often as bathrooms — only small ones get the 욕실 guess
    const fallback =
      room.cls === 'bath' && (room.areaM2 == null || room.areaM2 > 5)
        ? '공간'
        : (ROOM_NAME_KO[room.cls] ?? '공간')
    zones.push(
      ZoneNode.parse({
        name: room.name ?? fallback,
        polygon: room.polygon.map(toLevel),
        spaceRole: 'room',
        ...(ROOM_COLOR[room.cls] ? { color: ROOM_COLOR[room.cls] } : {}),
        metadata: { source: 'apt-vector', cls: room.cls, areaM2: room.areaM2 },
      }),
    )
  }

  return {
    walls,
    openings,
    zones,
    guideScale: (imageW * doc.mmPerPx) / 10000,
    diagnostics: { unhostedOpeningIds, dedupedOpeningIds, droppedWallIds },
  }
}

/**
 * Closes corner and tee gaps by moving endpoints ALONG each wall's own axis:
 * an L-corner pair meets at the intersection of the two wall lines, and a
 * tee endpoint extends to the crossed wall's centerline. Directions never
 * change, so hosted opening projections stay valid.
 */
function snapJunctions(segs: Seg[]): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i]!
      for (const endKey of ['start', 'end'] as const) {
        const p = a[endKey]
        let bestCorner: { q: Vec2; d: number } | null = null
        let bestTee: { q: Vec2; d: number } | null = null
        for (let j = 0; j < segs.length; j++) {
          if (j === i) continue
          const b = segs[j]!
          const cross = lineIntersection(a, b)
          if (!cross) {
            // near-parallel: bridge an end-to-end split in the same wall run
            // (hosted openings sit INSIDE walls, so this cannot seal a door)
            const da = segDir(a)
            for (const otherKey of ['start', 'end'] as const) {
              const q = b[otherKey]
              const gap = Math.hypot(p[0] - q[0], p[1] - q[1])
              if (gap < 1e-9 || gap > SNAP_COLLINEAR_M) continue
              const lateral = Math.abs((q[0] - p[0]) * da[1] - (q[1] - p[1]) * da[0])
              if (lateral > 0.15) continue
              const forward = along(q, p, da)
              const intoOwn = along(q, a[endKey === 'start' ? 'end' : 'start'], da)
              const ownSpan = along(p, a[endKey === 'start' ? 'end' : 'start'], da)
              // only extend outward past this end, never fold back inside
              if (
                Math.sign(intoOwn) !== Math.sign(ownSpan) ||
                Math.abs(intoOwn) < Math.abs(ownSpan)
              )
                continue
              const target: Vec2 = [p[0] + da[0] * forward, p[1] + da[1] * forward]
              if (!bestTee || gap < bestTee.d) bestTee = { q: target, d: gap }
            }
            continue
          }
          for (const otherKey of ['start', 'end'] as const) {
            const q = b[otherKey]
            const d = Math.hypot(p[0] - q[0], p[1] - q[1])
            if (d < 1e-9 || d > SNAP_CORNER_M) continue
            const move = Math.hypot(p[0] - cross[0], p[1] - cross[1])
            const moveOther = Math.hypot(q[0] - cross[0], q[1] - cross[1])
            if (move > SNAP_MAX_MOVE_M || moveOther > SNAP_MAX_MOVE_M) continue
            if (!bestCorner || d < bestCorner.d) bestCorner = { q: cross, d }
          }
          if (!bestCorner) {
            const lat = distToSegment(p, b)
            if (lat <= b.th / 2 + SNAP_TEE_LATERAL_M) {
              const move = Math.hypot(p[0] - cross[0], p[1] - cross[1])
              const t = along(cross, b.start, segDir(b))
              if (move <= SNAP_MAX_MOVE_M && t >= -0.15 && t <= segLen(b) + 0.15) {
                if (!bestTee || move < bestTee.d) bestTee = { q: cross, d: move }
              }
            }
          }
        }
        const target = bestCorner ?? bestTee
        if (target && Math.hypot(p[0] - target.q[0], p[1] - target.q[1]) > 1e-6) {
          const otherEnd = a[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target.q[0] - otherEnd[0], target.q[1] - otherEnd[1]) >= 0.1) {
            a[endKey] = [target.q[0], target.q[1]]
          }
        }
      }
    }
  }
}

/**
 * Last-resort closure: endpoints that STILL touch nothing after the normal
 * snap get a bigger 1 m budget — first bridging a facing collinear end (an
 * undetected opening left a hole in one wall run), then extending onto a
 * crossing wall line. Ordinary endpoints are never moved, which keeps the
 * larger budget from welding across real narrow spaces.
 */
function weldDanglingEnds(segs: Seg[]): void {
  const touches = (point: Vec2, self: Seg) =>
    segs.some((other) => other !== self && distToSegment(point, other) <= other.th / 2 + 0.02)
  for (let pass = 0; pass < 2; pass++) {
    const dangling = new Set<string>()
    for (const seg of segs) {
      for (const endKey of ['start', 'end'] as const) {
        if (!touches(seg[endKey], seg)) dangling.add(endId(segs, seg, endKey))
      }
    }
    for (const seg of segs) {
      for (const endKey of ['start', 'end'] as const) {
        if (!dangling.has(endId(segs, seg, endKey))) continue
        const p = seg[endKey]
        if (touches(p, seg)) continue
        const dir = segDir(seg)
        const outward: Vec2 = endKey === 'start' ? [-dir[0], -dir[1]] : dir
        let target: Vec2 | null = null
        let bestMove = 1.0
        for (const other of segs) {
          if (other === seg) continue
          const cross = lineIntersection(seg, other)
          if (cross) {
            const t = along(cross, other.start, segDir(other))
            const otherLen = segLen(other)
            let reachable = t >= -0.15 && t <= otherLen + 0.15
            if (!reachable) {
              // a mutually-dangling L-corner: both short legs point at the
              // same line intersection — let each extend to it in turn
              const nearKey = t < 0 ? 'start' : 'end'
              const overrun = t < 0 ? -t : t - otherLen
              reachable = overrun <= 1.0 && dangling.has(endId(segs, other, nearKey))
            }
            if (!reachable) continue
            const move = (cross[0] - p[0]) * outward[0] + (cross[1] - p[1]) * outward[1]
            if (move > 0.01 && move <= bestMove) {
              bestMove = move
              target = cross
            }
          } else {
            for (const otherKey of ['start', 'end'] as const) {
              const q = other[otherKey]
              const lateral = Math.abs((q[0] - p[0]) * dir[1] - (q[1] - p[1]) * dir[0])
              const forward = (q[0] - p[0]) * outward[0] + (q[1] - p[1]) * outward[1]
              if (lateral > 0.15 || forward <= 0.01 || forward > bestMove) continue
              bestMove = forward
              target = [p[0] + outward[0] * forward, p[1] + outward[1] * forward]
            }
          }
        }
        if (target) {
          const otherEnd = seg[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target[0] - otherEnd[0], target[1] - otherEnd[1]) >= 0.1) {
            seg[endKey] = target
          }
        }
      }
    }
  }
}

function endId(segs: Seg[], seg: Seg, endKey: 'start' | 'end'): string {
  return `${segs.indexOf(seg)}:${endKey}`
}

function lineIntersection(a: Seg, b: Seg): Vec2 | null {
  const da = segDir(a)
  const db = segDir(b)
  const det = da[0] * db[1] - da[1] * db[0]
  if (Math.abs(det) < Math.sin((15 * Math.PI) / 180)) return null
  const dx = b.start[0] - a.start[0]
  const dz = b.start[1] - a.start[1]
  const t = (dx * db[1] - dz * db[0]) / det
  return [a.start[0] + da[0] * t, a.start[1] + da[1] * t]
}

function segDir(seg: Seg): Vec2 {
  const len = segLen(seg)
  return [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len]
}

function distToSegment(p: Vec2, seg: Seg): number {
  const dir = segDir(seg)
  const t = clamp(along(p, seg.start, dir), 0, segLen(seg))
  const q: Vec2 = [seg.start[0] + dir[0] * t, seg.start[1] + dir[1] * t]
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

function segLen(seg: Seg): number {
  return Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1])
}

function along(point: Vec2, anchor: Vec2, dir: Vec2): number {
  return (point[0] - anchor[0]) * dir[0] + (point[1] - anchor[1]) * dir[1]
}

function alongLo(seg: Seg, anchor: Vec2, dir: Vec2): number {
  return Math.min(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

function alongHi(seg: Seg, anchor: Vec2, dir: Vec2): number {
  return Math.max(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

/** Stretch a synthesized host wall's ends onto the nearest crossing wall
 * lines so its corners land exactly where the snap welds. Returns false when
 * either end has no crossing wall within 0.7 m — the caller must not create
 * a floating wall then. */
function extendToCrossingWalls(synth: Seg, segs: Seg[]): boolean {
  const dir = segDir(synth)
  for (const endKey of ['start', 'end'] as const) {
    const outward: Vec2 = endKey === 'start' ? [-dir[0], -dir[1]] : dir
    const p = synth[endKey]
    let best: { point: Vec2; move: number } | null = null
    for (const other of segs) {
      const cross = lineIntersection(synth, other)
      if (!cross) continue
      const t = along(cross, other.start, segDir(other))
      if (t < -0.15 || t > segLen(other) + 0.15) continue
      const move = (cross[0] - p[0]) * outward[0] + (cross[1] - p[1]) * outward[1]
      if (move < -0.05 || move > 0.7) continue
      if (!best || move < best.move) best = { point: cross, move }
    }
    if (!best) return false
    synth[endKey] = [best.point[0], best.point[1]]
  }
  return true
}

function isSameWallRun(a: Seg, b: Seg): boolean {
  if (Math.abs(a.th - b.th) > MERGE_THICKNESS_TOL_M) return false
  const da = segDir(a)
  const db = segDir(b)
  if (Math.abs(da[0] * db[0] + da[1] * db[1]) < Math.cos((10 * Math.PI) / 180)) return false
  const latTol = Math.max(a.th, b.th) / 2
  const lateral = (p: Vec2) => Math.abs((p[0] - a.start[0]) * da[1] - (p[1] - a.start[1]) * da[0])
  if (lateral(b.start) > latTol || lateral(b.end) > latTol) return false
  const t1a = along(a.start, a.start, da)
  const t1b = along(a.end, a.start, da)
  const t2a = along(b.start, a.start, da)
  const t2b = along(b.end, a.start, da)
  const gap =
    Math.max(Math.min(t1a, t1b), Math.min(t2a, t2b)) -
    Math.min(Math.max(t1a, t1b), Math.max(t2a, t2b))
  return gap <= MERGE_RUN_GAP_M
}

function isCollinearWith(seg: Seg, anchor: Vec2, dir: Vec2): boolean {
  const len = segLen(seg)
  if (len < 1e-6) return false
  const sdir: Vec2 = [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len]
  if (Math.abs(sdir[0] * dir[0] + sdir[1] * dir[1]) < Math.cos((10 * Math.PI) / 180)) return false
  const lateral = (a: Vec2) => Math.abs((a[0] - anchor[0]) * dir[1] - (a[1] - anchor[1]) * dir[0])
  return (
    lateral(seg.start) <= seg.th / 2 + FLANK_LATERAL_M &&
    lateral(seg.end) <= seg.th / 2 + FLANK_LATERAL_M
  )
}

function clampOpeningWidth(type: 'door' | 'window' | 'opening', width: number): number | null {
  const [min, max] =
    type === 'door'
      ? ([0.4, 1.6] as const)
      : type === 'window'
        ? ([0.3, 6] as const)
        : ([0.4, 4] as const)
  if (width < min / 2) return null
  return clamp(width, min, max)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
