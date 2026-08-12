import { DEFAULT_ANGLE_STEP } from '@pascal-app/core'
import { executeTransformBody } from '@pascal-app/core/modeling-operations'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  type BodyTransformFeature,
  bodyTransformPatch,
  type GroupPatch,
  type ParticipantStart,
} from '../components/editor/group-transform-shared'

// Pure math for the pivot-rotate gesture (bottom-menu Rotate): first click
// sets the pivot, second click sets the zero-angle reference arm, then the
// cursor bearing (or a typed angle) sweeps the rotation delta applied through
// `rotateGroupPatches` (y axis) or `rotateVec3PatchesAboutAxis` (x / z).
// All points are level-frame XZ plan coordinates.

export type PivotPlanPoint = { x: number; z: number }

export type PivotRotateAxis = 'x' | 'y' | 'z'

// Editor-wide axis convention (three.js): X red, Y green, Z blue — matches
// the 2D measurement guides' X/Z colors.
export const PIVOT_ROTATE_AXIS_COLORS: Record<PivotRotateAxis, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}

// A reference point this close to the pivot gives a meaningless bearing.
export const MIN_REFERENCE_DISTANCE = 0.01

export function planBearing(pivot: PivotPlanPoint, point: PivotPlanPoint): number {
  return Math.atan2(point.z - pivot.z, point.x - pivot.x)
}

/** Wrap into (-π, π] so sweeps read as the short way around. */
export function normalizeAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

/**
 * Swept rotation from the reference arm to the cursor bearing around the
 * pivot, snapped to the canonical angle step unless `free` (Alt held).
 */
export function resolveRotateDelta(
  pivot: PivotPlanPoint,
  reference: PivotPlanPoint,
  cursor: PivotPlanPoint,
  free: boolean,
  step: number = DEFAULT_ANGLE_STEP,
): number {
  const delta = normalizeAngle(planBearing(pivot, cursor) - planBearing(pivot, reference))
  return free ? delta : Math.round(delta / step) * step
}

/** Parse the typed digits buffer as degrees; null while incomplete/invalid. */
export function parseTypedAngle(digits: string): number | null {
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(digits)) return null
  const value = Number.parseFloat(digits)
  return Number.isFinite(value) ? value : null
}

/**
 * Typed degrees → internal rotation delta. Positive typed input rotates
 * counter-clockwise as seen in the plan view; the internal x→z atan2 sense is
 * clockwise on screen, hence the negation.
 */
export function typedAngleToDelta(degrees: number): number {
  return (-degrees * Math.PI) / 180
}

/**
 * Rigid rotation of vec3 participants about a horizontal level axis (x or z)
 * through the pivot at ground height. Positions orbit the axis line and
 * orientations premultiply the same rotation (quaternion compose, so an
 * already-rotated item tilts correctly). The -delta sign matches the y-axis
 * path, where `rotateGroupPatches`' orbit equals R_y(-delta) about the pivot.
 * Body topology is also supported here through the canonical transform kernel;
 * walls, ordinary polygons, and scalar rotations remain plan-only.
 */
export function rotateVec3PatchesAboutAxis(
  starts: ParticipantStart[],
  pivot: PivotPlanPoint,
  axis: 'x' | 'z',
  delta: number,
): GroupPatch[] {
  const axisVec = axis === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)
  const q = new Quaternion().setFromAxisAngle(axisVec, -delta)
  const patches: GroupPatch[] = []
  for (const s of starts) {
    if (s.kind === 'polygon' && s.body) {
      const body = executeTransformBody(s.body, {
        translation: [0, 0, 0],
        rotationAxis: axis === 'x' ? [1, 0, 0] : [0, 0, 1],
        rotationAngle: -delta,
        scale: [1, 1, 1],
        pivot: [pivot.x, 0, pivot.z],
        feature: s.feature as BodyTransformFeature | null | undefined,
      }).body
      patches.push([s.id, bodyTransformPatch(body)])
      continue
    }
    if (s.kind !== 'vec3') continue
    const position = new Vector3(
      s.position[0] - pivot.x,
      s.position[1],
      s.position[2] - pivot.z,
    ).applyQuaternion(q)
    const orientation = new Quaternion()
      .setFromEuler(new Euler(s.rotation[0], s.rotation[1], s.rotation[2]))
      .premultiply(q)
    const euler = new Euler().setFromQuaternion(orientation)
    patches.push([
      s.id,
      {
        position: [position.x + pivot.x, position.y, position.z + pivot.z],
        rotation: [euler.x, euler.y, euler.z],
      },
    ])
  }
  return patches
}
