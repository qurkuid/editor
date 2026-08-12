const EPSILON = 1e-8

type Point3 = readonly [number, number, number]
type Point2 = readonly [number, number]

type Axis = readonly [number, number, number]

export type PlanarPointProjection = {
  readonly toPlane: (point: Point3) => Point2
  readonly fromPlane: (point: Point2) => [number, number, number]
}

const dot3 = (first: Point3, second: Point3) =>
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2]

const cross3 = (first: Point3, second: Point3): [number, number, number] => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0],
]

const length3 = (point: Point3) => Math.hypot(point[0], point[1], point[2])

function normalize3(point: Point3): [number, number, number] {
  const length = length3(point)
  if (length <= EPSILON) throw new RangeError('Planar projection requires a valid normal')
  return [point[0] / length, point[1] / length, point[2] / length]
}

function subtractProjection(axis: Axis, normal: Point3): [number, number, number] {
  const projection = dot3(axis, normal)
  return normalize3([
    axis[0] - normal[0] * projection,
    axis[1] - normal[1] * projection,
    axis[2] - normal[2] * projection,
  ])
}

function dominantAxis(normal: Point3): 0 | 1 | 2 {
  let axis: 0 | 1 | 2 = 0
  for (const candidate of [0, 1, 2] as const) {
    if (Math.abs(normal[candidate]) > Math.abs(normal[axis])) axis = candidate
  }
  return axis
}

export function createPlanarPointProjection(origin: Point3, normal: Point3): PlanarPointProjection {
  const unitNormal = normalize3(normal)
  const droppedAxis = dominantAxis(unitNormal)
  const firstAxis = droppedAxis === 0 ? 1 : 0
  const secondAxis = droppedAxis === 2 ? 1 : 2
  const firstVector: Axis = firstAxis === 0 ? [1, 0, 0] : [0, 1, 0]
  const secondVector: Axis = secondAxis === 1 ? [0, 1, 0] : [0, 0, 1]
  const u = subtractProjection(firstVector, unitNormal)
  const crossNormal = cross3(unitNormal, u)
  const sign = dot3(crossNormal, secondVector) < 0 ? -1 : 1
  const v: [number, number, number] = [
    crossNormal[0] * sign,
    crossNormal[1] * sign,
    crossNormal[2] * sign,
  ]

  const toPlane = (point: Point3): Point2 => {
    const delta: Point3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]
    return [dot3(delta, u), dot3(delta, v)]
  }
  const fromPlane = (point: Point2): [number, number, number] => [
    origin[0] + u[0] * point[0] + v[0] * point[1],
    origin[1] + u[1] * point[0] + v[1] * point[1],
    origin[2] + u[2] * point[0] + v[2] * point[1],
  ]
  return { toPlane, fromPlane }
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

export function segmentsIntersect(
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

export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
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

export function polygonArea(polygon: readonly Point2[]): number {
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
  const projection = createPlanarPointProjection(hostOrigin, normal)
  const host2d = host.map(projection.toPlane)
  const profile2d = profile.map(projection.toPlane)
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
