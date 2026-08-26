import { createDefaultWallFaceBands, DoorNode, WallNode, WindowNode } from '@pascal-app/core'

/** JSON document produced by the floorplan-vectorizer CLI (`--stdout`). */
export type AptVectorDoc = {
  unit: 'mm' | 'px'
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
    hinge?: [number, number]
    radius?: number
  }[]
  rooms: { id: string; name: string | null; cls: string; areaM2: number | null }[]
  metrics?: { style?: string; wallIoU?: number }
}

export type VectorSceneNodes = {
  /** Parsed wall nodes; children/parentId linking is the caller's job. */
  walls: WallNode[]
  /** Wall-hosted doors/windows/openings; `wallId` names the host wall. */
  openings: (DoorNode | WindowNode)[]
  /** guide.scale that makes the 10 m guide plane match the plan's real size. */
  guideScale: number
}

const MIN_WALL_LENGTH_M = 0.25
const FLANK_LATERAL_M = 0.25
const FLANK_ALONG_M = 0.45
const DOOR_HEIGHT_M = 2.1
const WINDOW_HEIGHT_M = 1.5
const WINDOW_SILL_M = 0.9

type Seg = { start: [number, number]; end: [number, number]; th: number }
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
  const toLevel = ([x, y]: [number, number]): [number, number] => [(x - cx) / 1000, (y - cy) / 1000]

  const segs: Seg[] = []
  for (const wall of doc.walls) {
    const start = toLevel(wall.start)
    const end = toLevel(wall.end)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) continue
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
  // Extra coverage points a group must span (far gap ends of single-flank
  // openings), keyed by any member index.
  const extraPoints: { member: number; point: [number, number] }[] = []

  const placements: OpeningPlacement[] = []
  for (const opening of doc.openings) {
    const a = toLevel(opening.a)
    const b = toLevel(opening.b)
    const gapLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (gapLen < 0.05) continue
    const dir: [number, number] = [(b[0] - a[0]) / gapLen, (b[1] - a[1]) / gapLen]
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
    } else if (left !== null || right !== null) {
      const member = (left ?? right)!
      extraPoints.push({ member, point: left !== null ? b : a })
      placements.push({ doc: opening, group: member, width })
    }
  }

  // Build one merged wall per group: project member endpoints (plus coverage
  // points) onto the longest member's line and keep the extremes.
  const groupMembers = new Map<number, number[]>()
  segs.forEach((_, i) => {
    const root = find(i)
    const members = groupMembers.get(root) ?? []
    members.push(i)
    groupMembers.set(root, members)
  })

  const walls: WallNode[] = []
  const wallByGroup = new Map<
    number,
    { node: WallNode; anchor: [number, number]; dir: [number, number]; len: number }
  >()
  for (const [root, members] of groupMembers) {
    const longest = members.reduce((best, i) => (segLen(segs[i]!) > segLen(segs[best]!) ? i : best))
    const ref = segs[longest]!
    const len0 = segLen(ref)
    const dir: [number, number] = [
      (ref.end[0] - ref.start[0]) / len0,
      (ref.end[1] - ref.start[1]) / len0,
    ]
    const anchor = ref.start
    const points: [number, number][] = members.flatMap((i) => [segs[i]!.start, segs[i]!.end])
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
    const start: [number, number] = [anchor[0] + dir[0] * lo, anchor[1] + dir[1] * lo]
    const end: [number, number] = [anchor[0] + dir[0] * hi, anchor[1] + dir[1] * hi]
    const node = WallNode.parse({
      start,
      end,
      thickness,
      faceBands: createDefaultWallFaceBands(thickness),
    })
    walls.push(node)
    wallByGroup.set(root, { node, anchor: start, dir, len: hi - lo })
  }

  const openings: (DoorNode | WindowNode)[] = []
  for (const placement of placements) {
    const host = wallByGroup.get(find(placement.group))
    if (!host || host.len < placement.width) continue
    const a = toLevel(placement.doc.a)
    const b = toLevel(placement.doc.b)
    const center: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const at = clamp(
      along(center, host.anchor, host.dir),
      placement.width / 2,
      host.len - placement.width / 2,
    )
    if (placement.doc.type === 'door') {
      openings.push(
        DoorNode.parse({
          wallId: host.node.id,
          width: placement.width,
          height: DOOR_HEIGHT_M,
          position: [at, DOOR_HEIGHT_M / 2, 0],
        }),
      )
    } else {
      const isOpening = placement.doc.type === 'opening'
      const height = isOpening ? DOOR_HEIGHT_M : WINDOW_HEIGHT_M
      const sill = isOpening ? 0 : WINDOW_SILL_M
      openings.push(
        WindowNode.parse({
          wallId: host.node.id,
          width: placement.width,
          height,
          ...(isOpening ? { openingKind: 'opening' } : {}),
          position: [at, sill + height / 2, 0],
        }),
      )
    }
  }

  return { walls, openings, guideScale: (imageW * doc.mmPerPx) / 10000 }
}

function segLen(seg: Seg): number {
  return Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1])
}

function along(point: [number, number], anchor: [number, number], dir: [number, number]): number {
  return (point[0] - anchor[0]) * dir[0] + (point[1] - anchor[1]) * dir[1]
}

function alongLo(seg: Seg, anchor: [number, number], dir: [number, number]): number {
  return Math.min(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

function alongHi(seg: Seg, anchor: [number, number], dir: [number, number]): number {
  return Math.max(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

function isCollinearWith(seg: Seg, anchor: [number, number], dir: [number, number]): boolean {
  const len = segLen(seg)
  if (len < 1e-6) return false
  const sdir: [number, number] = [
    (seg.end[0] - seg.start[0]) / len,
    (seg.end[1] - seg.start[1]) / len,
  ]
  if (Math.abs(sdir[0] * dir[0] + sdir[1] * dir[1]) < Math.cos((10 * Math.PI) / 180)) return false
  const lateral = (a: [number, number]) =>
    Math.abs((a[0] - anchor[0]) * dir[1] - (a[1] - anchor[1]) * dir[0])
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
