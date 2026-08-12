import type { Object3D } from 'three'

export function resolveBodyFaceId(object: Object3D, faceIndex?: number): string | null {
  let current: Object3D | null = object
  while (current) {
    const faceId = current.userData.faceId
    if (typeof faceId === 'string' && faceId.length > 0) return faceId
    const faceIds = current.userData.faceIdsByTriangle
    if (typeof faceIndex === 'number' && Array.isArray(faceIds)) {
      const mergedFaceId = faceIds[faceIndex]
      if (typeof mergedFaceId === 'string' && mergedFaceId.length > 0) return mergedFaceId
    }
    current = current.parent
  }
  return null
}
