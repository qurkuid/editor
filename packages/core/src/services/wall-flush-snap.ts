import { collectLevelWallSegments } from '../lib/wall-distance'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { getWallThickness } from '../systems/wall/wall-footprint'

/**
 * Pure wall-flush snap for floor-placed footprints (furniture and the like):
 * when the moving footprint's nearest edge comes within `threshold` of a
 * wall's face — or overlaps the wall — translate the footprint along the
 * wall's normal so that edge sits exactly on the face. The cabinet wall
 * attach has this feel via its own run-aware solver; this is the generic,
 * kind-agnostic equivalent for centred-box footprints.
 *
 * Translation only — the footprint's rotation is respected, never changed.
 * A footprint parallel to the wall lands flush; a rotated one touches by its
 * nearest corner, which is the correct flush position for that pose.
 *
 * Which side of the wall to snap onto follows the footprint's CENTRE: the
 * face on the centre's side of the centerline is the target. Dragging deeper
 * into a wall keeps pushing the footprint back out until the centre crosses
 * the centerline, at which point it pops flush to the other face — the same
 * magnetic crossing behaviour as the cabinet snap.
 *
 * Corners are resolved against up to TWO walls: after the closest engaged
 * wall snaps, a second engaged wall with a near-orthogonal normal also
 * applies (its delta is unaffected by the first shift precisely because the
 * normals are orthogonal). That is what lets a wardrobe land flush against
 * both walls of a corner in one drag.
 *
 * Frame: everything is level-local plan XZ — wall `start`/`end` and the
 * proposed centre must share the frame. Curved walls are excluded (the
 * shared segment collector drops them); wall miters are ignored — the face
 * is the straight `thickness / 2` offset, which matches everywhere except
 * inside a miter flare.
 */

/** Max edge-to-face gap (metres) at which the flush snap engages. */
export const WALL_FLUSH_SNAP_THRESHOLD_M = 0.12

/** Two engaged walls only combine when their normals are this orthogonal —
 *  cos of the angle between them. Keeps the second delta exact (an
 *  orthogonal first shift cannot change the second wall's gap). */
const CORNER_NORMAL_DOT_MAX = 0.3

export type WallFlushSnapInput = {
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  levelId: AnyNodeId | null
  /** Proposed plan centre of the moving footprint. */
  x: number
  z: number
  /** Centred-box footprint dimensions ([w, h, d] — Y is ignored). */
  dimensions: readonly [number, number, number]
  rotationY: number
  threshold?: number
}

type EngagedWall = {
  /** |edge-to-face gap| — the ranking key. */
  gap: number
  /** Wall front normal (unit). */
  nx: number
  nz: number
  /** Signed shift along (nx, nz) that lands the near edge on the face. */
  delta: number
}

export function resolveWallFlushSnap(input: WallFlushSnapInput): { x: number; z: number } | null {
  const { nodes, levelId, x, z, dimensions, rotationY } = input
  const threshold = input.threshold ?? WALL_FLUSH_SNAP_THRESHOLD_M
  const segments = collectLevelWallSegments(nodes as Record<AnyNodeId, AnyNode>, levelId)
  if (segments.length === 0) return null

  // Rotated footprint corners — same rotation convention as
  // `footprintAABBFrom` so the snapped pose matches the collision footprint.
  const halfW = dimensions[0] / 2
  const halfD = dimensions[2] / 2
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const localCorners: ReadonlyArray<readonly [number, number]> = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ]
  const corners = localCorners.map(
    ([lx, lz]) => [x + (lx * cos - lz * sin), z + (lx * sin + lz * cos)] as const,
  )

  const engaged: EngagedWall[] = []
  for (const segment of segments) {
    const nx = -segment.dirY
    const nz = segment.dirX
    const centerPerp = (x - segment.start[0]) * nx + (z - segment.start[1]) * nz
    const side = centerPerp >= 0 ? 1 : -1

    // Corner extents along the wall axis (span-overlap guard) and along the
    // side-flipped normal (nearest-edge distance from the centerline).
    let minAlong = Number.POSITIVE_INFINITY
    let maxAlong = Number.NEGATIVE_INFINITY
    let nearEdge = Number.POSITIVE_INFINITY
    for (const [cx, cz] of corners) {
      const dx = cx - segment.start[0]
      const dz = cz - segment.start[1]
      const along = dx * segment.dirX + dz * segment.dirY
      const perp = (dx * nx + dz * nz) * side
      if (along < minAlong) minAlong = along
      if (along > maxAlong) maxAlong = along
      if (perp < nearEdge) nearEdge = perp
    }
    // Snap to the wall's face line only where the wall actually is.
    if (maxAlong <= 0 || minAlong >= segment.length) continue

    const face = getWallThickness(segment.wall) / 2
    const gap = nearEdge - face
    if (gap > threshold) continue

    engaged.push({ gap: Math.abs(gap), nx, nz, delta: side * (face - nearEdge) })
  }
  if (engaged.length === 0) return null

  engaged.sort((a, b) => a.gap - b.gap)
  const first = engaged[0]!
  let outX = x + first.nx * first.delta
  let outZ = z + first.nz * first.delta

  const second = engaged.find(
    (e) => Math.abs(e.nx * first.nx + e.nz * first.nz) < CORNER_NORMAL_DOT_MAX,
  )
  if (second) {
    outX += second.nx * second.delta
    outZ += second.nz * second.delta
  }

  return { x: outX, z: outZ }
}
