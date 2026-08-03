import type { GuideNode } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'

const SURFACE_OFFSET = 0.002

export class InvalidGuideSurfaceNormalError extends RangeError {
  constructor() {
    super('Guide surface normal must have a positive length')
    this.name = 'InvalidGuideSurfaceNormalError'
  }
}

export function resolveGuideSurfacePlacement(
  position: GuideNode['position'],
  normal: readonly [number, number, number],
): Pick<GuideNode, 'position' | 'rotation'> {
  const targetNormal = new Vector3(normal[0], normal[1], normal[2])
  if (targetNormal.lengthSq() === 0) throw new InvalidGuideSurfaceNormalError()
  targetNormal.normalize()
  const rotation = new Euler().setFromQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), targetNormal),
    'XYZ',
  )
  const clean = (value: number) => (Math.abs(value) < Number.EPSILON ? 0 : value)
  return {
    position: [
      position[0] + targetNormal.x * SURFACE_OFFSET,
      position[1] + targetNormal.y * SURFACE_OFFSET,
      position[2] + targetNormal.z * SURFACE_OFFSET,
    ],
    rotation: [clean(rotation.x), clean(rotation.y), clean(rotation.z)],
  }
}
