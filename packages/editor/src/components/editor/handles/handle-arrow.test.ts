import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'
import { hitAreaRaycast, prioritizedHitAreaRaycast } from './handle-arrow'

function boxAt(z: number) {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  mesh.position.z = z
  mesh.updateMatrixWorld(true)
  return mesh
}

function rayFromCamera() {
  return new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
}

describe('InvisibleHandleHitArea raycast priority', () => {
  test('puts a priority handle before a nearer wall while preserving the hit data', () => {
    const handle = boxAt(0)
    const wall = boxAt(2)
    const raycaster = rayFromCamera()
    const normalHits: Parameters<typeof hitAreaRaycast>[1] = []
    const priorityHits: Parameters<typeof prioritizedHitAreaRaycast>[1] = []

    try {
      hitAreaRaycast.call(handle, raycaster, normalHits)
      wall.raycast(raycaster, priorityHits)
      const existingWallHit = priorityHits[0]
      if (!existingWallHit) throw new Error('expected a wall raycast hit')
      const existingWallDistance = existingWallHit.distance
      prioritizedHitAreaRaycast.call(handle, raycaster, priorityHits)

      expect(normalHits).toHaveLength(2)
      expect(priorityHits).toHaveLength(4)
      const normalHit = normalHits[0]
      const priorityHit = priorityHits.find((hit) => hit.object === handle)
      if (!normalHit || !priorityHit) throw new Error('expected a handle raycast hit')
      expect(priorityHit.point).toEqual(normalHit.point)
      expect(priorityHit.object).toBe(normalHit.object)
      expect(priorityHit.uv).toEqual(normalHit.uv)
      expect(priorityHit.distance).toBe(0)
      expect(existingWallHit.distance).toBe(existingWallDistance)
      expect(
        priorityHits
          .slice()
          .sort((a, b) => a.distance - b.distance)
          .map((hit) => hit.object),
      ).toEqual([handle, handle, wall, wall])
    } finally {
      handle.geometry.dispose()
      handle.material.dispose()
      wall.geometry.dispose()
      wall.material.dispose()
    }
  })

  test('keeps normal hit distances by default', () => {
    const handle = boxAt(0)
    const hits: Parameters<typeof hitAreaRaycast>[1] = []

    try {
      hitAreaRaycast.call(handle, rayFromCamera(), hits)
      expect(hits).toHaveLength(2)
      const firstHit = hits[0]
      if (!firstHit) throw new Error('expected a handle raycast hit')
      expect(firstHit.distance).toBeGreaterThan(0)
    } finally {
      handle.geometry.dispose()
      handle.material.dispose()
    }
  })

  test('does not raycast while placement drag owns the pointer', () => {
    const handle = boxAt(0)
    const previous = useEditor.getState().placementDragMode
    useEditor.getState().setPlacementDragMode(true)

    try {
      for (const raycast of [hitAreaRaycast, prioritizedHitAreaRaycast]) {
        const hits: Parameters<typeof hitAreaRaycast>[1] = []
        raycast.call(handle, rayFromCamera(), hits)
        expect(hits).toHaveLength(0)
      }
    } finally {
      useEditor.getState().setPlacementDragMode(previous)
      handle.geometry.dispose()
      handle.material.dispose()
    }
  })
})
