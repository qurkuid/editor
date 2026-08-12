import { describe, expect, test } from 'bun:test'
import { Group, Mesh } from 'three'
import { resolveBodyFaceId } from './face-target'

describe('Body face targeting', () => {
  test('reads the logical face id from the clicked face mesh or its child', () => {
    const face = new Mesh()
    face.userData.faceId = 'face:side:2'
    const child = new Group()
    face.add(child)

    expect(resolveBodyFaceId(face)).toBe('face:side:2')
    expect(resolveBodyFaceId(child)).toBe('face:side:2')
    expect(resolveBodyFaceId(new Group())).toBeNull()
  })

  test('resolves the hit face from a merged imported mesh', () => {
    const mesh = new Mesh()
    mesh.userData.faceIdsByTriangle = ['face:first', 'face:second']

    expect(resolveBodyFaceId(mesh, 1)).toBe('face:second')
  })
})
