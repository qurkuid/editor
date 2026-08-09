const EPSILON = 1e-8

type Point3 = readonly [number, number, number]
type Point2 = readonly [number, number]

function projectPoint(point: Point3, normal: Point3): Point2 {
  const axis = normal.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(normal[best] ?? 0) ? index : best),
    0,
  )
  if (axis === 0) return [point[1], point[2]]
  if (axis === 1) return [point[0], point[2]]
  return [point[0], point[1]]
}

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  if (Math.abs(cross(start, end, point)) > EPSILON) return false
  return (
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  )
}

function segmentsIntersect(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): boolean {
  const first = cross(firstStart, firstEnd, secondStart)
  const second = cross(firstStart, firstEnd, secondEnd)
  const third = cross(secondStart, secondEnd, firstStart)
  const fourth = cross(secondStart, secondEnd, firstEnd)
  const opposite =
    ((first > EPSILON && second < -EPSILON) || (first < -EPSILON && second > EPSILON)) &&
    ((third > EPSILON && fourth < -EPSILON) || (third < -EPSILON && fourth > EPSILON))
  if (opposite) return true
  return (
    (Math.abs(first) <= EPSILON && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(second) <= EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(third) <= EPSILON && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(fourth) <= EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd))
  )
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!current || !next) return false
    if (pointOnSegment(point, current, next)) return false
    const intersects =
      current[1] > point[1] !== next[1] > point[1] &&
      point[0] <
        ((next[0] - current[0]) * (point[1] - current[1])) / (next[1] - current[1]) + current[0]
    if (intersects) inside = !inside
  }
  return inside
}

function polygonArea(polygon: readonly Point2[]): number {
  return (
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point[0] * next[1] - next[0] * point[1] : sum
    }, 0) * 0.5
  )
}

export function validateImprintProfile(
  profile: readonly Point3[],
  host: readonly Point3[],
  normal: Point3,
): void {
  if (profile.length < 3) throw new RangeError('Imprint profile requires at least three points')
  if (profile.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
    throw new RangeError('Imprint profile requires finite points')
  }
  const hostOrigin = host[0]
  if (!hostOrigin) throw new RangeError('Imprint host face has no points')
  if (
    host.some(
      (point) =>
        Math.abs(
          (point[0] - hostOrigin[0]) * normal[0] +
            (point[1] - hostOrigin[1]) * normal[1] +
            (point[2] - hostOrigin[2]) * normal[2],
        ) > EPSILON,
    )
  ) {
    throw new RangeError('Imprint host face must be planar')
  }
  if (
    profile.some(
      (point) =>
        Math.abs(
          (point[0] - hostOrigin[0]) * normal[0] +
            (point[1] - hostOrigin[1]) * normal[1] +
            (point[2] - hostOrigin[2]) * normal[2],
        ) > EPSILON,
    )
  ) {
    throw new RangeError('Imprint profile must be coplanar with the host face')
  }
  const host2d = host.map((point) => projectPoint(point, normal))
  const profile2d = profile.map((point) => projectPoint(point, normal))
  if (Math.abs(polygonArea(profile2d)) <= EPSILON) {
    throw new RangeError('Imprint profile must enclose a non-zero area')
  }
  for (let index = 0; index < profile2d.length; index += 1) {
    const point = profile2d[index]
    const next = profile2d[(index + 1) % profile2d.length]
    if (!point || !next) throw new RangeError('Imprint profile has an invalid edge')
    if (Math.hypot(next[0] - point[0], next[1] - point[1]) <= EPSILON) {
      throw new RangeError('Imprint profile has a collapsed edge')
    }
    if (!pointInPolygon(point, host2d)) {
      throw new RangeError('Imprint profile must be strictly inside the host face')
    }
    for (let hostIndex = 0; hostIndex < host2d.length; hostIndex += 1) {
      const hostStart = host2d[hostIndex]
      const hostEnd = host2d[(hostIndex + 1) % host2d.length]
      if (hostStart && hostEnd && segmentsIntersect(point, next, hostStart, hostEnd)) {
        throw new RangeError('Imprint profile must not touch the host boundary')
      }
    }
    const midpoint: Point2 = [(point[0] + next[0]) * 0.5, (point[1] + next[1]) * 0.5]
    if (!pointInPolygon(midpoint, host2d)) {
      throw new RangeError('Imprint profile must remain inside the host face')
    }
    for (let other = index + 1; other < profile2d.length; other += 1) {
      const otherPoint = profile2d[other]
      const otherNext = profile2d[(other + 1) % profile2d.length]
      if (!otherPoint || !otherNext) continue
      const adjacent = other === index + 1 || (index === 0 && other === profile2d.length - 1)
      if (!adjacent && segmentsIntersect(point, next, otherPoint, otherNext)) {
        throw new RangeError('Imprint profile must not self-intersect')
      }
    }
  }
}
