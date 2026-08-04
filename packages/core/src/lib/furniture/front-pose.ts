/**
 * Pure open/close pose math for furniture-assembly front parts. Mirrors the
 * `userData.cabinetPose` convention the cabinet stack system already
 * consumes (`packages/nodes/src/cabinet/animation.ts`): a `hinge` pose
 * rotates about an edge offset from the part's center, a `slide` pose
 * translates the part along one axis. Callers scale `angle`/`distance` by
 * `operationState` (0 closed .. 1 open).
 */

export type FurnitureFrontPose =
  | { kind: 'hinge'; axis: 'x' | 'y'; hingeOffset: number; angle: number }
  | { kind: 'slide'; axis: 'x' | 'z'; distance: number }

const DOOR_HINGE_ANGLE = Math.PI / 2
const FLAP_HINGE_ANGLE = (70 * Math.PI) / 180
const SLIDING_LEAF_OPEN_FRACTION = 0.8
const MAX_DRAWER_SLIDE = 0.35
const DRAWER_SLIDE_DEPTH_FRACTION = 0.7
const DRAWER_MIN_OPEN_SCALE = 0.32

/**
 * Vertical hinge for a `hinged` front leaf, swinging open toward the face's
 * own outward Z direction (`dirSign`: +1 for front-face bays, -1 for
 * back-face bays — see `emitFaceBays` in `assembly.ts`). A single leaf
 * defaults to a left hinge; a pair hinges left/right and opens symmetrically.
 */
export function hingedFrontPose(
  hinge: 'left' | 'right',
  width: number,
  dirSign = 1,
): FurnitureFrontPose {
  return {
    kind: 'hinge',
    axis: 'y',
    hingeOffset: hinge === 'left' ? -width / 2 : width / 2,
    angle: dirSign * (hinge === 'left' ? -1 : 1) * DOOR_HINGE_ANGLE,
  }
}

/**
 * Horizontal hinge for a `flap` front. `direction: 'up'` hinges at the top
 * edge and lifts the bottom edge open (a lift-up flap); `direction: 'down'`
 * hinges at the bottom edge and drops the top edge open, matching the
 * cabinet stack's oven/dishwasher drop-down door.
 */
export function flapFrontPose(
  direction: 'up' | 'down',
  height: number,
  dirSign = 1,
): FurnitureFrontPose {
  const hingeAtTop = direction === 'up'
  return {
    kind: 'hinge',
    axis: 'x',
    hingeOffset: hingeAtTop ? height / 2 : -height / 2,
    angle: dirSign * (hingeAtTop ? -1 : 1) * FLAP_HINGE_ANGLE,
  }
}

/**
 * One leaf of a `sliding` front. Leaves alternate between two depth tracks
 * (see `emitFaceBays`'s `frontZ - dirSign * (index % 2) * frontThickness`);
 * leaves on the near track (even index) slide one way and leaves on the
 * recessed track (odd index) slide the other, so same-track leaves keep
 * their relative spacing and never pass through each other.
 */
export function slidingFrontPose(leafWidth: number, leafIndex: number): FurnitureFrontPose {
  const distance = leafWidth * SLIDING_LEAF_OPEN_FRACTION
  return { kind: 'slide', axis: 'x', distance: leafIndex % 2 === 0 ? -distance : distance }
}

/**
 * A `drawer` or `pull-out` front — slides out along the face's own outward Z
 * direction. Stacked drawers cascade like the cabinet stack system's doors
 * (`drawerOpenScale` in `geometry/fronts.ts`): the bottom drawer (index 0)
 * opens furthest, higher ones progressively less.
 */
export function drawerFrontPose(
  compartmentDepth: number,
  dirSign = 1,
  drawerIndex = 0,
  drawerCount = 1,
): FurnitureFrontPose {
  const openDistance = Math.min(MAX_DRAWER_SLIDE, compartmentDepth * DRAWER_SLIDE_DEPTH_FRACTION)
  const scale =
    drawerCount <= 1 ? 1 : 1 - (drawerIndex / (drawerCount - 1)) * (1 - DRAWER_MIN_OPEN_SCALE)
  return { kind: 'slide', axis: 'z', distance: dirSign * openDistance * scale }
}
