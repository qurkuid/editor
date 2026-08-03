import type { Object3D } from 'three'

export function resolveBodyFaceId(object: Object3D): string | null {
  let current: Object3D | null = object
  while (current) {
    const faceId = current.userData.faceId
    if (typeof faceId === 'string' && faceId.length > 0) return faceId
    current = current.parent
  }
  return null
}
