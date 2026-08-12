type Point3 = readonly [number, number, number]

export function resolvePushPullRayCandidate(args: {
  readonly rayOrigin: Point3
  readonly rayDirection: Point3
  readonly anchor: Point3
  readonly normal: Point3
}): Point3 | null {
  const normalLength = Math.hypot(args.normal[0], args.normal[1], args.normal[2])
  const directionLength = Math.hypot(
    args.rayDirection[0],
    args.rayDirection[1],
    args.rayDirection[2],
  )
  if (!Number.isFinite(normalLength) || !Number.isFinite(directionLength)) return null
  if (normalLength === 0 || directionLength === 0) return null

  const normal: Point3 = [
    args.normal[0] / normalLength,
    args.normal[1] / normalLength,
    args.normal[2] / normalLength,
  ]
  const direction: Point3 = [
    args.rayDirection[0] / directionLength,
    args.rayDirection[1] / directionLength,
    args.rayDirection[2] / directionLength,
  ]
  const alignment = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2]
  const denominator = 1 - alignment * alignment
  if (denominator <= 0.00000001) return null

  const offset: Point3 = [
    args.rayOrigin[0] - args.anchor[0],
    args.rayOrigin[1] - args.anchor[1],
    args.rayOrigin[2] - args.anchor[2],
  ]
  const rayOffset = offset[0] * direction[0] + offset[1] * direction[1] + offset[2] * direction[2]
  const axisOffset = offset[0] * normal[0] + offset[1] * normal[1] + offset[2] * normal[2]
  const axisDistance = (axisOffset - alignment * rayOffset) / denominator
  const rayDistance = alignment * axisDistance - rayOffset
  if (!Number.isFinite(axisDistance) || !Number.isFinite(rayDistance) || rayDistance < 0) {
    return null
  }

  return [
    args.anchor[0] + normal[0] * axisDistance,
    args.anchor[1] + normal[1] * axisDistance,
    args.anchor[2] + normal[2] * axisDistance,
  ]
}

export function projectPushPullDistance(args: {
  readonly anchor: Point3
  readonly normal: Point3
  readonly point: Point3
}): number {
  const normalLength = Math.hypot(args.normal[0], args.normal[1], args.normal[2])
  if (normalLength === 0) return 0
  return (
    ((args.point[0] - args.anchor[0]) * args.normal[0] +
      (args.point[1] - args.anchor[1]) * args.normal[1] +
      (args.point[2] - args.anchor[2]) * args.normal[2]) /
    normalLength
  )
}

export function snapPushPullDistanceToGrid(distance: number, step: number): number {
  return step > 0 ? Math.round(distance / step) * step : distance
}
