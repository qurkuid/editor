import { afterEach, expect, test } from 'bun:test'
import { calculateLevelMiters, sceneRegistry, WallNode, WindowNode } from '@pascal-app/core'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { prepareSceneForExport } from './glb-export'

afterEach(() => sceneRegistry.clear())

function inspect(geometries: THREE.BufferGeometry[]) {
  const edges = new Map<string, number[]>()
  let volume = 0
  let degenerate = 0
  let triangles = 0
  const bounds = new THREE.Box3()
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position')
    const index = geometry.index
    for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
      const points = [0, 1, 2].map((corner) =>
        new THREE.Vector3().fromBufferAttribute(
          position,
          index?.getX(offset + corner) ?? offset + corner,
        ),
      )
      const [a, b, c] = points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
      triangles++
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) degenerate++
      volume += a.dot(b.clone().cross(c)) / 6
      for (const point of points) bounds.expandByPoint(point)
      const keys = points.map((p) =>
        p
          .toArray()
          .map((v) => Math.round(v * 1e6))
          .join(','),
      )
      for (let i = 0; i < 3; i++) {
        const start = keys[i]!
        const end = keys[(i + 1) % 3]!
        const key = [start, end].sort().join('|')
        const uses = edges.get(key) ?? []
        uses.push(start < end ? 1 : -1)
        edges.set(key, uses)
      }
    }
  }
  return {
    triangles,
    volume,
    bounds,
    degenerate,
    badEdges: [...edges.values()].filter((uses) => uses.length !== 2 || uses[0]! + uses[1]! !== 0)
      .length,
  }
}

function fixture(opening: boolean, stepped = false) {
  const wall = WallNode.parse({
    id: 'wall_export-topology',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    thickness: 0.1,
  })
  const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.3, 0], width: 1, height: 1 })
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    Array.from({ length: 8 }, () => new THREE.MeshStandardMaterial()),
  )
  sceneRegistry.nodes.set(wall.id, mesh)
  const geometry = generateExtrudedWall(
    wall,
    opening ? [window] : [],
    calculateLevelMiters([wall]),
    stepped ? 0.2 : 0,
    0,
    stepped
      ? [
          { start: 0, end: 0.5, elevation: 0 },
          { start: 0.5, end: 1, elevation: 0.05 },
        ]
      : undefined,
  )
  const position = geometry.getAttribute('position')
  geometry.setAttribute(
    'uv1',
    new THREE.Float32BufferAttribute(
      Array.from({ length: position.count }, (_, i) => [
        position.getX(i) * 0.5,
        position.getY(i) * 0.25,
      ]).flat(),
      2,
    ),
  )
  mesh.geometry = geometry
  const root = new THREE.Group()
  root.add(mesh)
  sceneRegistry.nodes.set(wall.id, mesh)
  return { wall, geometry, mesh, root }
}

test.each([
  [true, false],
  [false, true],
  [true, true],
])('conforming wall preserves cutout and support geometry (%s, %s)', (opening, stepped) => {
  const { wall, geometry, root } = fixture(opening, stepped)
  const original = geometry.toJSON()
  const before = inspect([geometry])
  expect(before.badEdges).toBeGreaterThan(0)
  const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
  const exported = scene.getObjectByName(wall.id) as THREE.Mesh
  const after = inspect([exported.geometry])
  expect(after.badEdges).toBe(0)
  expect(after.degenerate).toBe(0)
  expect(after.volume).toBeCloseTo(before.volume, 6)
  expect(after.bounds.min.distanceTo(before.bounds.min)).toBeLessThan(1e-6)
  expect(after.bounds.max.distanceTo(before.bounds.max)).toBeLessThan(1e-6)
  expect(geometry.toJSON()).toEqual(original)
  const positions = exported.geometry.getAttribute('position')
  const uv = exported.geometry.getAttribute('uv1')
  for (let i = 0; i < positions.count; i++) {
    expect(uv.getX(i)).toBeCloseTo(positions.getX(i) * 0.5, 5)
    expect(uv.getY(i)).toBeCloseTo(positions.getY(i) * 0.25, 5)
  }
})

test('plain wall stays twelve triangles', () => {
  const { wall, root } = fixture(false)
  const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
  const result = inspect([(scene.getObjectByName(wall.id) as THREE.Mesh).geometry])
  expect(result.triangles).toBe(12)
  expect(result.badEdges).toBe(0)
})

test('removes collapsed CSG triangles without changing the wall shell', () => {
  const { wall, root, mesh } = fixture(false)
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  const count = geometry.getAttribute('position').count
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = Array.from(attribute.array)
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values.push(attribute.getComponent(0, component))
      }
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize))
  }
  geometry.addGroup(count, 3, 0)
  mesh.geometry = geometry
  const before = inspect([geometry])
  expect(before.degenerate).toBe(1)
  const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
  const after = inspect([(scene.getObjectByName(wall.id) as THREE.Mesh).geometry])
  expect(after.degenerate).toBe(0)
  expect(after.badEdges).toBe(0)
  expect(after.triangles).toBe(12)
  expect(after.volume).toBeCloseTo(before.volume, 6)
})

test('serialized GLB wall is closed without native extras under nested transforms', async () => {
  const { wall, root, mesh } = fixture(true)
  root.position.set(4, 2, -7)
  root.rotation.y = 0.3
  mesh.position.set(2, 0, 1)
  mesh.scale.set(-2, 1.5, 0.75)
  const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
  scene.traverse((object) => {
    object.userData = {}
  })
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  class BlobReader {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: BlobReader })
  try {
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true })
    expect(glb).toBeInstanceOf(ArrayBuffer)
    const loaded = await new GLTFLoader().parseAsync(glb as ArrayBuffer, '')
    const parts: THREE.BufferGeometry[] = []
    loaded.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) parts.push(object.geometry)
    })
    expect(parts.length).toBeGreaterThan(1)
    const result = inspect(parts)
    expect(result.badEdges).toBe(0)
    expect(result.degenerate).toBe(0)
    expect(result.volume).toBeGreaterThan(0)
    const loadedWall = loaded.scene.getObjectByName(wall.id)!
    scene.updateMatrixWorld(true)
    loaded.scene.updateMatrixWorld(true)
    expect(loadedWall.matrixWorld.elements).toEqual(
      scene.getObjectByName(wall.id)!.matrixWorld.elements,
    )
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'FileReader', descriptor)
    else Reflect.deleteProperty(globalThis, 'FileReader')
  }
})
