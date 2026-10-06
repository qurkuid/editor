import { afterEach, expect, test } from 'bun:test'
import { calculateLevelMiters, sceneRegistry, WallNode, WindowNode } from '@pascal-app/core'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { conformWallGeometry } from './conform-wall-geometry'
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

function signedArea(geometry: THREE.BufferGeometry, start = 0, count?: number) {
  const position = geometry.getAttribute('position')
  const end = Math.min(start + (count ?? position.count - start), position.count)
  let area = 0
  for (let offset = start; offset + 2 < end; offset += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, offset)
    const b = new THREE.Vector3().fromBufferAttribute(position, offset + 1)
    const c = new THREE.Vector3().fromBufferAttribute(position, offset + 2)
    area += (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  }
  return area / 2
}

function hasReversePair(geometry: THREE.BufferGeometry, start: number, count: number) {
  const position = geometry.getAttribute('position')
  const triangles: THREE.Vector3[][] = []
  for (let offset = start; offset + 2 < start + count; offset += 3) {
    triangles.push(
      [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(position, offset + corner)),
    )
  }
  const same = (a: THREE.Vector3, b: THREE.Vector3) => a.equals(b)
  for (let first = 0; first < triangles.length; first++) {
    for (let second = first + 1; second < triangles.length; second++) {
      for (let shift = 0; shift < 3; shift++) {
        if (
          same(triangles[first]![0]!, triangles[second]![shift]!) &&
          same(triangles[first]![1]!, triangles[second]![(shift + 2) % 3]!) &&
          same(triangles[first]![2]!, triangles[second]![(shift + 1) % 3]!)
        ) {
          return true
        }
      }
    }
  }
  return false
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

test('conforms unregistered wall construction meshes without taking over nested node owners', () => {
  const { wall, root, mesh, geometry } = fixture(true)
  const constructionGeometry = geometry.clone()
  const construction = new THREE.Mesh(
    constructionGeometry,
    Array.from({ length: 8 }, () => new THREE.MeshStandardMaterial()),
  )
  construction.name = 'wall-construction-part'
  mesh.add(construction)

  const nestedGeometry = geometry.clone()
  const nested = new THREE.Mesh(
    nestedGeometry,
    Array.from({ length: 8 }, () => new THREE.MeshStandardMaterial()),
  )
  nested.name = 'hosted-door-part'
  const nestedOwner = new THREE.Group()
  nestedOwner.name = 'hosted-door-owner'
  nestedOwner.add(nested)
  mesh.add(nestedOwner)
  sceneRegistry.nodes.set('door_export', nestedOwner)

  const constructionBefore = inspect([constructionGeometry])
  const nestedBefore = inspect([nestedGeometry])
  const constructionSource = constructionGeometry.toJSON()
  const nestedSource = nestedGeometry.toJSON()
  expect(constructionBefore.badEdges).toBeGreaterThan(0)
  expect(nestedBefore.badEdges).toBeGreaterThan(0)

  const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
  const exportedConstruction = scene.getObjectByName(construction.name) as THREE.Mesh
  const exportedNested = scene.getObjectByName(nested.name) as THREE.Mesh

  expect(inspect([exportedConstruction.geometry]).badEdges).toBe(0)
  expect(exportedNested.geometry).toBe(nestedGeometry)
  expect(inspect([exportedNested.geometry]).badEdges).toBe(nestedBefore.badEdges)
  expect(constructionGeometry.toJSON()).toEqual(constructionSource)
  expect(nestedGeometry.toJSON()).toEqual(nestedSource)
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

test('cancels only a reverse pair retraced by one source triangle fan', () => {
  const source = new THREE.BufferGeometry()
  source.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0, 1, 0, 0, 0, 0.000003, 0, 0.999998, 0.000001, 0, 10, 0, 0, 10, 1, 0, 20, 0, 0, 21,
        0, 0, 20, 1, 0, 20, 1, 0, 21, 0, 0, 20, 0, 0,
      ],
      3,
    ),
  )
  source.setAttribute(
    'uv1',
    new THREE.Float32BufferAttribute(
      Array.from({ length: 12 }, (_, index) => [index, index + 0.5]).flat(),
      2,
    ),
  )
  source.addGroup(0, 3, 7)
  source.addGroup(3, 3, 9)
  source.addGroup(6, 3, 11)
  source.addGroup(9, 3, 13)
  const original = source.toJSON()
  const beforeArea = signedArea(source)
  const result = conformWallGeometry(source)
  const firstGroup = result.groups.find((group) => group.materialIndex === 7)!

  expect(firstGroup.count).toBe(9)
  expect(hasReversePair(result, firstGroup.start, firstGroup.count)).toBe(false)
  expect(signedArea(result)).toBeCloseTo(beforeArea, 5)
  expect(result.groups).toEqual([
    { start: 0, count: 9, materialIndex: 7 },
    { start: 9, count: 12, materialIndex: 9 },
    { start: 21, count: 3, materialIndex: 11 },
    { start: 24, count: 3, materialIndex: 13 },
  ])
  const resultUv = result.getAttribute('uv1')
  expect(resultUv.getX(0)).toBeCloseTo(1, 6)
  expect(resultUv.getY(0)).toBeCloseTo(1.5, 6)
  expect(source.toJSON()).toEqual(original)
})

test('repairs a reversed CSG face only when all source normals agree', () => {
  const makeFace = (normals?: number[]) => {
    const source = new THREE.BufferGeometry()
    source.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    )
    source.setAttribute('uv1', new THREE.Float32BufferAttribute([10, 11, 20, 21, 30, 31], 2))
    source.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([100, 101, 102, 200, 201, 202, 300, 301, 302], 3),
    )
    if (normals) source.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return source
  }

  const reversed = makeFace([0, 0, -1, 0, 0, -1, 0, 0, -1])
  const original = reversed.toJSON()
  const corrected = conformWallGeometry(reversed)
  const position = corrected.getAttribute('position')
  const a = new THREE.Vector3().fromBufferAttribute(position, 0)
  const b = new THREE.Vector3().fromBufferAttribute(position, 1)
  const c = new THREE.Vector3().fromBufferAttribute(position, 2)
  expect(b.clone().sub(a).cross(c.clone().sub(a)).z).toBeLessThan(0)
  expect(Array.from(corrected.getAttribute('uv1').array)).toEqual([10, 11, 30, 31, 20, 21])
  expect(Array.from(corrected.getAttribute('color').array)).toEqual([
    100, 101, 102, 300, 301, 302, 200, 201, 202,
  ])
  expect(reversed.toJSON()).toEqual(original)

  for (const normals of [undefined, [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, -1, 0, 0, 1, 0, 0, -1]]) {
    const source = makeFace(normals)
    expect(conformWallGeometry(source)).toBe(source)
  }
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
