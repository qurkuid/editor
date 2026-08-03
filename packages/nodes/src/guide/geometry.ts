import { type GuidePerspectiveCorners, projectGuidePerspectivePoint } from '@pascal-app/core'
import { PlaneGeometry } from 'three'

export function createGuidePlaneGeometry({
  height,
  perspectiveCorners,
  segments = 24,
  width,
}: {
  readonly height: number
  readonly perspectiveCorners: GuidePerspectiveCorners | null
  readonly segments?: number
  readonly width: number
}): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height, segments, segments)
  if (!perspectiveCorners) return geometry

  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index += 1) {
    const projected = projectGuidePerspectivePoint(perspectiveCorners, [
      uv.getX(index),
      1 - uv.getY(index),
    ])
    uv.setXY(index, projected[0], projected[1])
  }
  uv.needsUpdate = true
  return geometry
}
