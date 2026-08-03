import {
  type AlignmentAnchor,
  type AlignmentGuide,
  bboxCornerAnchors,
  footprintAABBFrom,
  resolveAlignment,
} from '@pascal-app/core'

/** Figma-style alignment-snap threshold (meters), matching the other placement tools. */
export const FURNITURE_ALIGNMENT_THRESHOLD_M = 0.08

export type FurnitureAlignmentResult = {
  position: [number, number, number]
  guides: AlignmentGuide[]
}

/**
 * Snap a furniture placement position onto nearby reference-element anchors
 * (a wall's face/corner, another cabinet) — Figma-style alignment, mirroring
 * wall / column / cabinet floor placement. Pure — no store or DOM access —
 * so it's testable without React.
 *
 * Aligns by the piece's FOOTPRINT corners (not its origin) so a wardrobe can
 * snap flush to a wall face or line up with another cabinet's edge, matching
 * how placed cabinets already contribute footprint-corner anchors as
 * candidates (`nodeAlignmentAnchors`). The footprint is built directly from
 * the piece's own width/depth/rotation rather than routed through the node
 * registry, because the cabinet kind's `floorPlaced` capability only
 * declares composite `footprints` (runs), not the single `footprint` the
 * registry-driven `movingFootprintAnchors` helper reads.
 *
 * `showGuides` gates whether guides are even computed (mirrors
 * `isAlignmentGuideActive()`). `applySnap` additionally gates whether the
 * matched delta is applied to the returned position (mirrors
 * `isMagneticSnapActive()` — guides are shown passively otherwise).
 */
export function resolveFurnitureAlignedPosition(
  position: readonly [number, number, number],
  footprint: { width: number; depth: number },
  rotationY: number,
  candidates: readonly AlignmentAnchor[],
  options: { showGuides: boolean; applySnap: boolean; threshold?: number },
): FurnitureAlignmentResult {
  if (!options.showGuides || candidates.length === 0) {
    return { position: [position[0], position[1], position[2]], guides: [] }
  }
  const aabb = footprintAABBFrom(position, [footprint.width, 0, footprint.depth], rotationY)
  const moving = bboxCornerAnchors('__furniture-draft__', aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ)
  const result = resolveAlignment({
    moving,
    candidates,
    threshold: options.threshold ?? FURNITURE_ALIGNMENT_THRESHOLD_M,
  })
  if (!result.snap || !options.applySnap) {
    return { position: [position[0], position[1], position[2]], guides: result.guides }
  }
  return {
    position: [position[0] + result.snap.dx, position[1], position[2] + result.snap.dz],
    guides: result.guides,
  }
}
