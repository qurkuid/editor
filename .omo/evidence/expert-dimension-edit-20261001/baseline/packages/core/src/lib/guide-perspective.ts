import type { GuidePerspectiveCorners } from '../schema/nodes/guide'

export type GuideImagePoint = readonly [number, number]

/** Reorders displayed calibration clicks into the guide's canonical image order. */
export function canonicalizeGuidePerspectiveCorners(
  corners: GuidePerspectiveCorners,
  flipX = false,
  flipY = false,
): GuidePerspectiveCorners {
  const order = flipX
    ? flipY
      ? ([2, 3, 0, 1] as const)
      : ([1, 0, 3, 2] as const)
    : flipY
      ? ([3, 2, 1, 0] as const)
      : ([0, 1, 2, 3] as const)
  return order.map((index) => corners[index]) as GuidePerspectiveCorners
}

export function projectGuidePerspectivePoint(
  corners: GuidePerspectiveCorners,
  point: GuideImagePoint,
): GuideImagePoint {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  const dx1 = topRight[0] - bottomRight[0]
  const dx2 = bottomLeft[0] - bottomRight[0]
  const dy1 = topRight[1] - bottomRight[1]
  const dy2 = bottomLeft[1] - bottomRight[1]
  const sx = topLeft[0] - topRight[0] + bottomRight[0] - bottomLeft[0]
  const sy = topLeft[1] - topRight[1] + bottomRight[1] - bottomLeft[1]
  const determinant = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(determinant) > Number.EPSILON ? (sx * dy2 - dx2 * sy) / determinant : 0
  const h = Math.abs(determinant) > Number.EPSILON ? (dx1 * sy - sx * dy1) / determinant : 0
  const a = topRight[0] - topLeft[0] + g * topRight[0]
  const b = bottomLeft[0] - topLeft[0] + h * bottomLeft[0]
  const d = topRight[1] - topLeft[1] + g * topRight[1]
  const e = bottomLeft[1] - topLeft[1] + h * bottomLeft[1]
  const denominator = g * point[0] + h * point[1] + 1

  return [
    (a * point[0] + b * point[1] + topLeft[0]) / denominator,
    (d * point[0] + e * point[1] + topLeft[1]) / denominator,
  ]
}
