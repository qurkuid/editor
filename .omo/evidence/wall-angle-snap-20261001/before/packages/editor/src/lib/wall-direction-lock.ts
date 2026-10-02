type Point = readonly [number, number]

export function createWallDirectionLock() {
  let ray: { origin: Point; direction: Point } | null = null
  return {
    get active() {
      return ray !== null
    },
    set(held: boolean, origin: Point, through: Point) {
      if (!held) {
        ray = null
        return
      }
      if (ray) return
      const dx = through[0] - origin[0]
      const dz = through[1] - origin[1]
      const length = Math.hypot(dx, dz)
      if (length > 1e-9) ray = { origin: [...origin], direction: [dx / length, dz / length] }
    },
    project(point: Point, step: number): [number, number] {
      if (!ray) return [...point]
      const { origin, direction } = ray
      const distance = Math.max(
        0,
        (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1],
      )
      const length = step > 0 ? Math.round(distance / step) * step : distance
      return [origin[0] + direction[0] * length, origin[1] + direction[1] * length]
    },
    reset() {
      ray = null
    },
  }
}
