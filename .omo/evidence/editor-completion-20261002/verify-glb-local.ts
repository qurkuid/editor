import assert from 'node:assert/strict'
import { calculateLevelMiters, sceneRegistry, WallNode, WindowNode } from '../../../packages/core/dist/index.js'
import * as THREE from '../../../packages/editor/node_modules/three/build/three.module.js'
import { GLTFLoader } from '../../../packages/editor/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { exportSceneToGlb } from '../../../packages/editor/src/lib/glb-export'
import { generateExtrudedWall } from '../../../packages/viewer/src/systems/wall/wall-system'

// Bun needs the same browser FileReader adapter used by the existing GLB test.
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

const results = []
for (const hasWindow of [false, true]) {
  sceneRegistry.clear()
  const wall = WallNode.parse({
    id: 'wall_synthetic-export', start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.15,
  })
  const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.3, 0], width: 1, height: 1 })
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), Array.from({ length: 8 }, () => new THREE.MeshStandardMaterial()))
  sceneRegistry.nodes.set(wall.id, mesh)
  const geometry = generateExtrudedWall(wall, hasWindow ? [window] : [], calculateLevelMiters([wall]), 0, 0)
  mesh.geometry = geometry
  root.add(mesh)
  sceneRegistry.nodes.set(wall.id, mesh)
  const sourceBefore = JSON.stringify(geometry.toJSON())
  const buffer = await exportSceneToGlb(root, { [wall.id]: wall })
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'glTF')
  assert.equal(view.getUint32(4, true), 2)
  assert.equal(view.getUint32(8, true), bytes.length)
  assert(bytes.length > 20)
  const jsonLength = view.getUint32(12, true)
  assert.equal(view.getUint32(16, true), 0x4e4f534a)
  assert.equal(jsonLength % 4, 0)
  const document = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)))
  assert.equal(document.asset.version, '2.0')
  assert(document.meshes.length > 0)
  const binaryOffset = 20 + jsonLength
  assert.equal(view.getUint32(binaryOffset + 4, true), 0x004e4942)
  assert.equal(binaryOffset + 8 + view.getUint32(binaryOffset, true), bytes.length)
  const loaded = await new GLTFLoader().parseAsync(buffer, '')
  assert(loaded.scene.getObjectByName(wall.id), 'Wall identity must survive export')
  let parsedMeshes = 0
  let vertices = 0
  loaded.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      parsedMeshes++
      vertices += object.geometry.getAttribute('position').count
    }
  })
  assert(parsedMeshes > 0 && vertices > 0)
  assert.equal(JSON.stringify(geometry.toJSON()), sourceBefore)
  const path = `${import.meta.dir}/synthetic-${hasWindow ? 'window' : 'plain'}.glb`
  await Bun.write(path, buffer)
  const saved = await Bun.file(path).arrayBuffer()
  assert.deepEqual(new Uint8Array(saved), bytes)
  results.push({ case: hasWindow ? 'window-cutout-wall' : 'plain-wall', path, bytes: bytes.length,
    magic: 'glTF', version: 2, declaredLengthMatches: true, jsonParsed: true, binaryChunkValid: true,
    threeLoaderParsed: true, parsedMeshes, vertices, originalGeometryUnchanged: true,
    scope: 'Synthetic untextured wall using production exportSceneToGlb; browser/GPU textures/download not covered' })
}
sceneRegistry.clear()
await Bun.write(`${import.meta.dir}/local-glb-proof.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
