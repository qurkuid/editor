import { afterEach, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { prepareSceneForExport } from './glb-export'
import { exportSceneToStl } from './stl-export'

afterEach(() => sceneRegistry.clear())

test('STL keeps door/window holes without the hidden uncut collision wall', () => {
  const wall = WallNode.parse({
    id: 'wall_stl',
    start: [0, 0],
    end: [6, 0],
    height: 3,
    thickness: 0.2,
  })
  const openings = [
    DoorNode.parse({ wallId: wall.id, position: [1, 1, 0], width: 1, height: 2 }),
    WindowNode.parse({ wallId: wall.id, position: [4, 1.5, 0], width: 1, height: 1 }),
  ]
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    Array.from({ length: 8 }, () => new THREE.MeshStandardMaterial()),
  )
  sceneRegistry.nodes.set(wall.id, mesh)
  const miters = calculateLevelMiters([wall])
  mesh.geometry = generateExtrudedWall(wall, openings, miters)
  const collision = new THREE.Mesh(generateExtrudedWall(wall, [], miters))
  collision.name = 'collision-mesh'
  collision.visible = false
  mesh.add(collision)
  const hiddenParent = new THREE.Group()
  hiddenParent.visible = false
  hiddenParent.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  mesh.add(hiddenParent)
  const root = new THREE.Group()
  root.position.set(7, 2, -4)
  root.rotation.y = 0.3
  root.add(mesh)
  const original = mesh.geometry.toJSON()
  const prepared = prepareSceneForExport(root, { [wall.id]: wall }).scene
  const expected = (prepared.getObjectByName(wall.id) as THREE.Mesh).geometry
  const stl = exportSceneToStl(prepared)
  const loaded = new STLLoader().parse(stl.buffer as ArrayBuffer)
  const positions = loaded.getAttribute('position')
  expect(positions.count).toBe(expected.index?.count ?? expected.getAttribute('position').count)
  let volume = 0
  const edges = new Map<string, number[]>()
  for (let i = 0; i < positions.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(positions, i + j),
    ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
    volume += a.dot(b.clone().cross(c)) / 6
    const keys = [a, b, c].map((p) =>
      p
        .toArray()
        .map((x) => Math.round(x * 1e5))
        .join(','),
    )
    for (let j = 0; j < 3; j++) {
      const start = keys[j]!
      const end = keys[(j + 1) % 3]!
      const key = [start, end].sort().join('|')
      const uses = edges.get(key) ?? []
      uses.push(start < end ? 1 : -1)
      edges.set(key, uses)
    }
  }
  expect(volume).toBeCloseTo((6 * 3 - 1 * 2 - 1 * 1) * 0.2, 4)
  expect([...edges.values()].every((uses) => uses.length === 2 && uses[0]! + uses[1]! === 0)).toBe(
    true,
  )
  expect(mesh.geometry.toJSON()).toEqual(original)
  expect(collision.parent).toBe(mesh)
  expect(collision.visible).toBe(false)
})

test('STL handles empty hitbox containers while keeping their visible frame children', () => {
  const root = new THREE.Mesh(new THREE.BufferGeometry())
  root.position.set(3, 2, 1)
  root.add(new THREE.Mesh(new THREE.BoxGeometry()))
  expect(exportSceneToStl(root).getUint32(80, true)).toBe(12)
})
