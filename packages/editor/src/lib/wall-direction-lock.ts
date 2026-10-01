import { snapAngleToList, snapScalar } from '@pascal-app/core'

type Point = readonly [number, number]
const AXIS_ANGLES = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4)
// This editor's capture window; SketchUp does not document a degree tolerance.
export const INFERENCE_TOLERANCE = (2 * Math.PI) / 180

export function inferWallDirection(
  origin: Point,
  point: Point,
  step: number,
  references: readonly { start: Point; end: Point; curveOffset?: number }[] = [],
): [number, number] | null {
  const dx = point[0] - origin[0]
  const dz = point[1] - origin[1]
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length < 1e-9) return null
  const angles = [...AXIS_ANGLES]
  for (const wall of references) {
    if (wall.curveOffset) continue
    if (![wall.start, wall.end].some((p) => Math.hypot(p[0] - origin[0], p[1] - origin[1]) < 1e-6))
      continue
    const wx = wall.end[0] - wall.start[0]
    const wz = wall.end[1] - wall.start[1]
    if (!Number.isFinite(Math.hypot(wx, wz)) || Math.hypot(wx, wz) < 1e-9) continue
    const angle = Math.atan2(wz, wx)
    for (let index = 0; index < 4; index++) angles.push(angle + (index * Math.PI) / 2)
  }
  const angle = Math.atan2(dz, dx)
  const target = snapAngleToList(angle, angles, Number.POSITIVE_INFINITY)
  const delta = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)))
  if (delta > INFERENCE_TOLERANCE + 1e-12) return null
  const x = Math.cos(target)
  const z = Math.sin(target)
  const distance = snapScalar(dx * x + dz * z, step)
  return [origin[0] + x * distance, origin[1] + z * distance]
}

export function createWallDirectionLock() {
  let ray: { origin: Point; direction: Point; key?: string } | null = null
  return {
    infer: inferWallDirection,
    get active() {
      return ray !== null
    },
    toggleAxis(
      key: string,
      origin: Point,
      through: Point,
      references: readonly { start: Point; end: Point; curveOffset?: number }[] = [],
    ) {
      let angle: number
      if (key === 'ArrowRight') angle = 0
      else if (key === 'ArrowLeft') angle = Math.PI / 2
      else if (key === 'ArrowDown') {
        const angles = references
          .filter(
            (w) =>
              !w.curveOffset &&
              [w.start, w.end].some((p) => Math.hypot(p[0] - origin[0], p[1] - origin[1]) < 1e-6) &&
              Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) > 1e-9,
          )
          .flatMap((w) =>
            Array.from(
              { length: 4 },
              (_, i) =>
                Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) + (i * Math.PI) / 2,
            ),
          )
        if (!angles.length) return false
        angle = snapAngleToList(
          Math.atan2(through[1] - origin[1], through[0] - origin[0]),
          angles,
          Infinity,
        )
      } else return false
      ray =
        ray?.key === key
          ? null
          : {
              origin: [...origin],
              direction:
                key === 'ArrowRight'
                  ? [1, 0]
                  : key === 'ArrowLeft'
                    ? [0, 1]
                    : [Math.cos(angle), Math.sin(angle)],
              key,
            }
      return true
    },
    set(held: boolean, origin: Point, through: Point) {
      if (!held) {
        if (!ray?.key) ray = null
        return
      }
      if (ray) return
      const dx = through[0] - origin[0]
      const dz = through[1] - origin[1]
      const length = Math.hypot(dx, dz)
      if (Number.isFinite(length) && length > 1e-9)
        ray = { origin: [...origin], direction: [dx / length, dz / length] }
    },
    project(point: Point, step: number): [number, number] {
      if (!ray) return [...point]
      const { origin, direction } = ray
      const projected =
        (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]
      const distance = ray.key ? projected : Math.max(0, projected)
      const length = step > 0 ? Math.round(distance / step) * step : distance
      return [origin[0] + direction[0] * length, origin[1] + direction[1] * length]
    },
    reset() {
      ray = null
    },
  }
}
