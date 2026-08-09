type Point3 = readonly [number, number, number]

export function projectPushPullSnapDistance(args: {
  readonly anchor: Point3
  readonly normal: Point3
  readonly point: Point3
}): number {
  return (
    (args.point[0] - args.anchor[0]) * args.normal[0] +
    (args.point[1] - args.anchor[1]) * args.normal[1] +
    (args.point[2] - args.anchor[2]) * args.normal[2]
  )
}

export function snapPushPullDistanceToGrid(distance: number, step: number): number {
  return step > 0 ? Math.round(distance / step) * step : distance
}
