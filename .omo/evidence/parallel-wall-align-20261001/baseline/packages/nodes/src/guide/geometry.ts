import { type GuidePerspectiveCorners, projectGuidePerspectivePoint } from '@pascal-app/core'
import { PlaneGeometry } from 'three'

export function createGuidePlaneGeometry({
  flipX = false,
  flipY = false,
  height,
  perspectiveCorners,
  segments = 24,
  width,
}: {
  readonly flipX?: boolean
  readonly flipY?: boolean
  readonly height: number
  readonly perspectiveCorners: GuidePerspectiveCorners | null
  readonly segments?: number
  readonly width: number
}): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height, segments, segments)
  const uv = geometry.getAttribute('uv')
  if (!perspectiveCorners && !flipX && !flipY) return geometry

  for (let index = 0; index < uv.count; index += 1) {
    if (perspectiveCorners) {
      const q = [uv.getX(index), 1 - uv.getY(index)] as const
      const corrected: [number, number] = [flipX ? 1 - q[0] : q[0], flipY ? 1 - q[1] : q[1]]
      const projected = projectGuidePerspectivePoint(perspectiveCorners, corrected)
      uv.setXY(index, projected[0], projected[1])
      continue
    }
    uv.setXY(
      index,
      flipX ? 1 - uv.getX(index) : uv.getX(index),
      flipY ? 1 - uv.getY(index) : uv.getY(index),
    )
  }
  uv.needsUpdate = true
  return geometry
}
