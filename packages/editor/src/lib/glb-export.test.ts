import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  GuideNode,
  registerNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { buildDoorPreviewMesh } from '@pascal-app/viewer'
import * as THREE from 'three'
import type { GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { prepareSceneForExport, writeTextureReferenceExtras } from './glb-export'

// The reference module reads the storage origin lazily on first use, so
// setting the env here (before any validation call) pins it for the file.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-storage.supabase.co'
const STORAGE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin

afterEach(() => {
  sceneRegistry.clear()
})

function nodeMaterial(overrides: Record<string, unknown> = {}) {
  // Duck-typed stand-in for the viewer's MeshStandard/LambertNodeMaterial:
  // the exporter keys off `isNodeMaterial` and reads plain PBR props.
  return {
    isNodeMaterial: true,
    name: 'painted',
    color: new THREE.Color('#cc3300'),
    roughness: 0.3,
    metalness: 0.7,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    alphaTest: 0,
    depthWrite: true,
    depthTest: true,
    vertexColors: false,
    toneMapped: true,
    ...overrides,
  } as unknown as THREE.Material
}

function meshWithNodeMaterial(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  return new THREE.Mesh(geometry, material)
}

function alternatingWallGeometry(indexed: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0],
      3,
    ),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)
  geometry.addGroup(6, 3, 0)
  geometry.addGroup(9, 3, 1)
  return indexed ? geometry : geometry.toNonIndexed()
}

function triangleMaterialMultiset(mesh: THREE.Mesh): string[] {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()
  const vertexIndexAt = (offset: number) => (index ? index.getX(offset) : offset)
  const records: string[] = []

  for (const group of mesh.geometry.groups) {
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const vertices = [0, 1, 2]
        .map((vertexOffset) => {
          const vertex = vertexIndexAt(offset + vertexOffset)
          return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)].join(',')
        })
        .join('|')
      records.push(`${group.materialIndex}:${vertices}`)
    }
  }

  return records.sort()
}

function worldVertexPositions(mesh: THREE.Mesh): number[][] {
  const position = mesh.geometry.getAttribute('position')
  const world = new THREE.Vector3()
  const positions: number[][] = []
  for (let i = 0; i < position.count; i++) {
    world.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld)
    positions.push(world.toArray())
  }
  return positions
}

describe('prepareSceneForExport', () => {
  test('includes textured floorplan guides only for explicit local downloads', () => {
    registerNode({
      kind: 'guide',
      bake: 'strip',
      schemaVersion: 1,
      category: 'site',
      defaults: () => ({}),
      capabilities: {},
    } as never)
    const guide = GuideNode.parse({ id: 'guide_export', url: 'asset://plan' })
    const root = new THREE.Group()
    const group = new THREE.Group()
    group.position.set(2, 0.01, 3)
    const map = new THREE.Texture()
    group.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(10, 6),
        nodeMaterial({ colorNode: { value: map }, opacityNode: { value: 0.5 } }),
      ),
    )
    root.add(group)
    sceneRegistry.nodes.set(guide.id, group)
    const nodes = { [guide.id]: guide }
    expect(prepareSceneForExport(root, nodes).scene.children).toHaveLength(0)
    const result = prepareSceneForExport(root, nodes, { includeGuides: true }).scene
    const exported = result.getObjectByName(guide.id)!
    const material = (exported.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial
    expect(exported.position.toArray()).toEqual([2, 0.01, 3])
    expect(material.map).toBe(map)
    expect(material.opacity).toBe(0.5)
    expect(group.children[0]!.parent).toBe(group)
  })
  test('converts NodeMaterials to classic glTF-standard materials', () => {
    const root = new THREE.Group()
    root.name = 'scene-renderer'
    const mesh = meshWithNodeMaterial(nodeMaterial())
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})

    const exported = scene.children[0] as THREE.Mesh
    const material = exported.material as THREE.MeshStandardMaterial
    expect(material.isMeshStandardMaterial).toBe(true)
    expect(material.roughness).toBeCloseTo(0.3)
    expect(material.metalness).toBeCloseTo(0.7)
    expect(material.color.getHexString()).toBe('cc3300')
  })

  test('shared NodeMaterial instances convert to a single shared material', () => {
    const root = new THREE.Group()
    const shared = nodeMaterial()
    root.add(meshWithNodeMaterial(shared), meshWithNodeMaterial(shared))

    const { scene } = prepareSceneForExport(root, {})

    const meshes = scene.children as THREE.Mesh[]
    expect(meshes[0]!.material).toBe(meshes[1]!.material)
  })

  test('reference mode swaps stamped compressed textures and leaves unstamped textures embedded', () => {
    const root = new THREE.Group()
    const stamped = new THREE.CompressedTexture([], 4, 4)
    stamped.wrapS = THREE.MirroredRepeatWrapping
    stamped.wrapT = THREE.ClampToEdgeWrapping
    stamped.repeat.set(2, 3)
    stamped.offset.set(0.25, 0.5)
    stamped.center.set(0.5, 0.5)
    stamped.rotation = 0.75
    stamped.flipY = false
    stamped.colorSpace = THREE.SRGBColorSpace
    stamped.updateMatrix()
    stamped.userData.pascalTextureRef = {
      v: 1,
      kind: 'library-material',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/materials/user/material/oak_basecolor_512.ktx2`,
      map: 'basecolor',
      colorSpace: 'srgb',
    }
    const unstamped = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
    root.add(
      meshWithNodeMaterial(nodeMaterial({ map: stamped, normalMap: unstamped })),
      meshWithNodeMaterial(nodeMaterial({ map: stamped })),
    )

    const { scene } = prepareSceneForExport(root, {}, { textures: 'reference' })

    const material = (scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    const placeholder = material.map as THREE.DataTexture
    expect(placeholder).not.toBe(stamped)
    expect(placeholder.isDataTexture).toBe(true)
    expect(
      (placeholder as THREE.DataTexture & { isCompressedTexture?: boolean }).isCompressedTexture,
    ).toBeUndefined()
    expect(placeholder.image.width).toBe(1)
    expect(placeholder.image.height).toBe(1)
    expect(Array.from(placeholder.image.data!)).toEqual([255, 255, 255, 255])
    expect(placeholder.wrapS).toBe(stamped.wrapS)
    expect(placeholder.wrapT).toBe(stamped.wrapT)
    expect(placeholder.repeat.toArray()).toEqual(stamped.repeat.toArray())
    expect(placeholder.offset.toArray()).toEqual(stamped.offset.toArray())
    expect(placeholder.center.toArray()).toEqual(stamped.center.toArray())
    expect(placeholder.rotation).toBe(stamped.rotation)
    expect(placeholder.flipY).toBe(stamped.flipY)
    expect(placeholder.colorSpace).toBe(stamped.colorSpace)
    expect(placeholder.userData.pascalTextureRef).toEqual(stamped.userData.pascalTextureRef)
    expect(material.normalMap).toBe(unstamped)
    const sharedMaterial = (scene.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(sharedMaterial.map).toBe(placeholder)
  })

  test('compacts alternating non-indexed wall groups without mutating the source geometry', () => {
    const root = new THREE.Group()
    const geometry = alternatingWallGeometry(false)
    const sourcePositions = Array.from(geometry.getAttribute('position').array)
    const sourceGroups = geometry.groups.map((group) => ({ ...group }))
    const mesh = new THREE.Mesh(geometry, [nodeMaterial(), nodeMaterial()])
    mesh.name = 'alternating-wall-non-indexed'
    root.add(mesh)

    const before = triangleMaterialMultiset(mesh)
    const { scene } = prepareSceneForExport(root, {})
    const exported = scene.getObjectByName(mesh.name) as THREE.Mesh

    expect(exported.geometry).not.toBe(geometry)
    expect(exported.geometry.getIndex()).toBeDefined()
    expect(exported.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
    ])
    expect(triangleMaterialMultiset(exported)).toEqual(before)
    expect(geometry.getIndex()).toBeNull()
    expect(geometry.groups).toEqual(sourceGroups)
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(sourcePositions)
  })

  test('compacts indexed wall groups while retaining every triangle and material assignment', () => {
    const root = new THREE.Group()
    const geometry = alternatingWallGeometry(true)
    const sourceIndex = geometry.getIndex()!
    const sourceIndexValues = Array.from(sourceIndex.array)
    const mesh = new THREE.Mesh(geometry, [nodeMaterial(), nodeMaterial()])
    mesh.name = 'alternating-wall-indexed'
    root.add(mesh)

    const before = triangleMaterialMultiset(mesh)
    const { scene } = prepareSceneForExport(root, {})
    const exported = scene.getObjectByName(mesh.name) as THREE.Mesh
    const exportedIndex = exported.geometry.getIndex()!

    expect(exported.geometry).not.toBe(geometry)
    expect(exportedIndex).not.toBe(sourceIndex)
    expect(exported.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
    ])
    expect(exportedIndex.count).toBe(sourceIndex.count)
    expect(triangleMaterialMultiset(exported)).toEqual(before)
    expect(Array.from(sourceIndex.array)).toEqual(sourceIndexValues)
  })

  test('repairs invalid groups before compacting the surviving wall groups', () => {
    const root = new THREE.Group()
    const geometry = alternatingWallGeometry(true)
    const sourceGroups = geometry.groups.map((group) => ({ ...group }))
    geometry.addGroup(12, 3, 2)
    const mesh = new THREE.Mesh(geometry, [nodeMaterial(), nodeMaterial()])
    mesh.name = 'invalid-wall-group'
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})
    const exported = scene.getObjectByName(mesh.name) as THREE.Mesh

    expect(exported.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
    ])
    expect(exported.geometry.getIndex()?.count).toBe(12)
    expect(geometry.groups).toEqual([...sourceGroups, { start: 12, count: 3, materialIndex: 2 }])
  })

  test('preserves local and world transforms when compacting wall geometry', () => {
    const root = new THREE.Group()
    const parent = new THREE.Group()
    parent.name = 'transformed-wall-parent'
    parent.position.set(3, 1, -2)
    parent.rotation.set(0.2, -0.4, 0.1)
    parent.scale.set(1.25, 0.9, 0.75)
    const mesh = new THREE.Mesh(alternatingWallGeometry(true), [nodeMaterial(), nodeMaterial()])
    mesh.name = 'transformed-wall'
    mesh.position.set(-1, 0.4, 0.6)
    mesh.rotation.set(-0.15, 0.35, 0.25)
    mesh.scale.set(0.8, 1.1, 1.3)
    parent.add(mesh)
    root.add(parent)
    root.updateMatrixWorld(true)
    const sourceWorldPositions = worldVertexPositions(mesh)
    const sourceParentPosition = parent.position.toArray()
    const sourceParentQuaternion = parent.quaternion.toArray()
    const sourceParentScale = parent.scale.toArray()
    const sourceMeshPosition = mesh.position.toArray()
    const sourceMeshQuaternion = mesh.quaternion.toArray()
    const sourceMeshScale = mesh.scale.toArray()

    const { scene } = prepareSceneForExport(root, {})
    scene.updateMatrixWorld(true)
    const exportedParent = scene.getObjectByName(parent.name)!
    const exported = scene.getObjectByName(mesh.name) as THREE.Mesh

    expect(exportedParent.position.toArray()).toEqual(sourceParentPosition)
    expect(exportedParent.quaternion.toArray()).toEqual(sourceParentQuaternion)
    expect(exportedParent.scale.toArray()).toEqual(sourceParentScale)
    expect(exported.position.toArray()).toEqual(sourceMeshPosition)
    expect(exported.quaternion.toArray()).toEqual(sourceMeshQuaternion)
    expect(exported.scale.toArray()).toEqual(sourceMeshScale)
    expect(worldVertexPositions(exported)).toEqual(sourceWorldPositions)
  })

  test('leaves a partial draw range un-compacted', () => {
    const root = new THREE.Group()
    const geometry = alternatingWallGeometry(false)
    geometry.setDrawRange(3, 6)
    const mesh = new THREE.Mesh(geometry, [nodeMaterial(), nodeMaterial()])
    mesh.name = 'partial-wall'
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})
    const exported = scene.getObjectByName(mesh.name) as THREE.Mesh

    expect(exported.geometry).toBe(geometry)
    expect(exported.geometry.getIndex()).toBeNull()
    expect(exported.geometry.drawRange).toEqual({ start: 3, count: 6 })
    expect(exported.geometry.groups).toEqual(geometry.groups)
  })

  test('writes identical texture-reference extras to the texture and image definitions', () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    const ref = {
      v: 1,
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/models/chair.glb`,
      imageIndex: 3,
      map: 'normal',
      colorSpace: 'linear',
    }
    texture.userData.pascalTextureRef = ref
    const imageDef: { extras?: Record<string, unknown> } = {}
    const textureDef: { source: number; extras?: Record<string, unknown> } = { source: 0 }
    const writer = { json: { images: [imageDef] } } as unknown as GLTFWriter

    writeTextureReferenceExtras(writer, texture, textureDef)

    expect(textureDef.extras?.pascalTextureRef).toEqual(ref)
    expect(imageDef.extras?.pascalTextureRef).toEqual(ref)
    expect(textureDef.extras?.pascalTextureRef).toEqual(imageDef.extras?.pascalTextureRef)
  })

  test('strips editor overlays that live off the scene layer', () => {
    const root = new THREE.Group()
    const realMesh = meshWithNodeMaterial(nodeMaterial())
    const overlay = meshWithNodeMaterial(nodeMaterial())
    overlay.layers.set(1) // OVERLAY_LAYER / EDITOR_LAYER — off scene layer 0
    root.add(realMesh, overlay)

    const { scene } = prepareSceneForExport(root, {})

    const meshes: THREE.Mesh[] = []
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    })
    expect(meshes).toHaveLength(1)
  })

  test('strips presentation-only geometry marked by its renderer', () => {
    const root = new THREE.Group()
    const siteGround = meshWithNodeMaterial(nodeMaterial())
    const horizonDisc = meshWithNodeMaterial(nodeMaterial())
    horizonDisc.userData.pascalExport = 'strip'
    root.add(siteGround, horizonDisc)

    const { scene } = prepareSceneForExport(root, {})

    const meshes: THREE.Mesh[] = []
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
    })
    expect(meshes).toHaveLength(1)
  })

  test('neutralises an invisible hitbox root but keeps its visible children', () => {
    // Door/window roots are selection hitboxes: a box geometry with an invisible
    // material (object stays visible). Left intact it would plug the wall opening.
    const root = new THREE.Group()
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 0.2),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    const leaf = meshWithNodeMaterial(nodeMaterial())
    hitbox.add(leaf)
    root.add(hitbox)

    const doorId = 'door_hitbox'
    sceneRegistry.nodes.set(doorId, hitbox)
    const nodes: Record<string, AnyNode> = {
      [doorId]: { object: 'node', id: doorId, type: 'door' } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exported = scene.getObjectByProperty('name', doorId) as THREE.Mesh
    expect(exported).toBeDefined()
    // Geometry emptied -> GLTFExporter emits a plain node, no solid block.
    expect(exported.geometry.getAttribute('position')).toBeUndefined()
    // The visible leaf survives as a child.
    const visibleChildren = exported.children.filter((c) => (c as THREE.Mesh).isMesh)
    expect(visibleChildren).toHaveLength(1)
  })

  test('fills undefined slots in an array material so no undefined survives the prune', () => {
    // Multi-material / group geometry where one slot was never assigned:
    // `mesh.material = [validMat, undefined]`. The scalar-null guard doesn't
    // catch this (an array is never `== null`), so the undefined slot used to
    // reach GLTFExporter and crash on `material.isShaderMaterial`.
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.material = [nodeMaterial(), undefined as unknown as THREE.Material]
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})

    const exported = scene.children[0] as THREE.Mesh
    const materials = exported.material as THREE.Material[]
    expect(Array.isArray(materials)).toBe(true)
    expect(materials).toHaveLength(2)
    // No undefined/null slot survives; every slot is a real material.
    expect(materials.every((m) => m != null)).toBe(true)
  })

  test('stamps identity from the scene registry and strips other userData', () => {
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const leaf = new THREE.Group()
    leaf.userData.pascalSwingLeaf = { axis: 'y', openRotationY: Math.PI / 2 }
    leaf.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(leaf)
    root.add(doorGroup)

    const doorId = 'door_test'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Front door',
      } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exportedDoor = scene.getObjectByProperty('name', doorId)
    expect(exportedDoor).toBeDefined()
    expect(exportedDoor?.userData).toEqual({
      pascalId: doorId,
      kind: 'door',
      label: 'Front door',
      openable: true,
      clips: ['door_test: open'],
    })

    // The swing-leaf marker must not survive into glTF extras.
    let leafMarkerSurvived = false
    scene.traverse((object) => {
      if (object.userData.pascalSwingLeaf) leafMarkerSurvived = true
    })
    expect(leafMarkerSurvived).toBe(false)
  })

  test('stamps a semantic wall contract with absolute coordinates and opening data', () => {
    const root = new THREE.Group()
    const wallGroup = new THREE.Group()
    wallGroup.position.set(10, 3, -2)
    wallGroup.add(meshWithNodeMaterial(nodeMaterial()))
    root.add(wallGroup)

    const wall = WallNode.parse({
      id: 'wall_export_contract',
      start: [0, 0],
      end: [4, 0],
      children: ['window_export_contract'],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const window = WindowNode.parse({
      id: 'window_export_contract',
      wallId: wall.id,
      position: [2, 1, 0],
      width: 1,
      height: 1,
    })
    sceneRegistry.nodes.set(wall.id, wallGroup)

    const { scene } = prepareSceneForExport(root, {
      [wall.id]: wall,
      [window.id]: window,
    })
    const exported = scene.getObjectByName(wall.id)
    const contract = exported?.userData.pascalNativeWall

    expect(contract).toMatchObject({
      version: 1,
      compatible: true,
      coordinates: 'three-world-m',
      sketchUpMap: 'x,-z,y',
      wallId: wall.id,
    })
    expect(contract.faces.length).toBeGreaterThan(6)
    expect(
      contract.faces
        .flatMap((face: { outer: number[][]; holes: number[][][] }) => [
          ...face.outer,
          ...face.holes.flat(),
        ])
        .every((point: number[]) => point.every(Number.isFinite)),
    ).toBe(true)
    expect(
      contract.faces
        .flatMap((face: { outer: number[][] }) => face.outer)
        .some((point: number[]) => point[0]! > 9),
    ).toBe(true)
  })

  test('stamps an incompatible wall contract while keeping normal export available', () => {
    const root = new THREE.Group()
    const wallGroup = new THREE.Group()
    wallGroup.add(meshWithNodeMaterial(nodeMaterial()))
    root.add(wallGroup)

    const wall = WallNode.parse({
      id: 'wall_export_incompatible',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 0.25,
    })
    sceneRegistry.nodes.set(wall.id, wallGroup)

    const { scene } = prepareSceneForExport(root, { [wall.id]: wall })
    const exported = scene.getObjectByName(wall.id)
    expect(exported?.userData.pascalNativeWall).toEqual({
      version: 1,
      compatible: false,
      wallId: wall.id,
      reasons: ['curved-wall'],
    })
  })

  test('does not flag a door/window openable when no open clip bakes', () => {
    // A cased opening (no swing leaf) / fixed window (no operable sash) builds
    // no movable part, so no clip bakes and the node must not claim openable.
    const root = new THREE.Group()
    const openingGroup = new THREE.Group()
    openingGroup.add(meshWithNodeMaterial(nodeMaterial()))
    root.add(openingGroup)

    const openingId = 'door_opening'
    sceneRegistry.nodes.set(openingId, openingGroup)
    const nodes: Record<string, AnyNode> = {
      [openingId]: {
        object: 'node',
        id: openingId,
        type: 'door',
        name: 'Cased opening',
      } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(0)
    const exported = scene.getObjectByProperty('name', openingId)
    expect(exported?.userData).toEqual({
      pascalId: openingId,
      kind: 'door',
      label: 'Cased opening',
    })
    expect(exported?.userData.openable).toBeUndefined()
    expect(exported?.userData.clips).toBeUndefined()
  })

  test('keeps the zone identity node with its polygon and strips the fill mesh', () => {
    const root = new THREE.Group()
    const zoneGroup = new THREE.Group()
    const fill = meshWithNodeMaterial(nodeMaterial())
    fill.layers.set(2) // ZONE_LAYER
    zoneGroup.add(fill)
    zoneGroup.visible = false // the editor often hides zones at export time
    root.add(zoneGroup)

    const zoneId = 'zone_living'
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    sceneRegistry.nodes.set(zoneId, zoneGroup)
    const nodes: Record<string, AnyNode> = {
      [zoneId]: {
        object: 'node',
        id: zoneId,
        type: 'zone',
        name: 'Living Room',
        polygon,
        color: '#ff0000',
      } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exported = scene.getObjectByProperty('name', zoneId)
    expect(exported).toBeDefined()
    // Forced visible so GLTFExporter's onlyVisible keeps the metadata node.
    expect(exported?.visible).toBe(true)
    expect(exported?.userData).toEqual({
      pascalId: zoneId,
      kind: 'zone',
      label: 'Living Room',
      polygon,
      color: '#ff0000',
    })
    // The ZONE_LAYER fill mesh must not survive (rebuilt in /viewer instead).
    let hasMesh = false
    exported?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) hasMesh = true
    })
    expect(hasMesh).toBe(false)
  })

  test('bakes a swing door into an open quaternion clip', () => {
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const leaf = new THREE.Group()
    leaf.userData.pascalSwingLeaf = { axis: 'y', openRotationY: Math.PI / 2 }
    leaf.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(leaf)
    root.add(doorGroup)

    const doorId = 'door_swing'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: { object: 'node', id: doorId, type: 'door', name: 'Door' } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const clip = animations[0]!
    expect(clip.name).toBe('door_swing: open')
    expect(clip.duration).toBe(1)
    // Playback intent carried in extras so consumers can play once and hold.
    expect(clip.userData).toEqual({ loop: false })

    const track = clip.tracks[0]!
    expect(track).toBeInstanceOf(THREE.QuaternionKeyframeTrack)
    expect(track.name.endsWith('.quaternion')).toBe(true)
    expect(Array.from(track.times)).toEqual([0, 1])

    // The track must target an object that exists in the exported tree.
    const targetUuid = track.name.replace('.quaternion', '')
    const target = scene.getObjectByProperty('uuid', targetUuid)
    expect(target).toBeDefined()

    // Rest pose is closed: the first keyframe is the identity rotation.
    const closed = new THREE.Quaternion().fromArray(Array.from(track.values).slice(0, 4))
    expect(closed.angleTo(new THREE.Quaternion())).toBeCloseTo(0)
  })

  test('bakes registry-owned open clips and stamps the node openable', () => {
    const root = new THREE.Group()
    const nodeGroup = new THREE.Group()
    const movingPart = new THREE.Group()
    movingPart.add(meshWithNodeMaterial(nodeMaterial()))
    nodeGroup.add(movingPart)
    root.add(nodeGroup)

    const kind = `test-openable-${crypto.randomUUID()}`
    const nodeId = 'registry_openable'
    registerNode({
      kind,
      schemaVersion: 1,
      category: 'fixtures',
      defaults: () => ({}),
      capabilities: {},
      exportAnimation: ({ node, object }: { node: AnyNode; object: THREE.Object3D }) => {
        const target = object.children[0]!
        const clip = new THREE.AnimationClip(`${node.id}: open`, 1, [
          new THREE.VectorKeyframeTrack(`${target.uuid}.position`, [0, 1], [0, 0, 0, 0, 0, 1]),
        ])
        clip.userData = { loop: false }
        return clip
      },
    } as never)
    sceneRegistry.nodes.set(nodeId, nodeGroup)

    const { scene, animations } = prepareSceneForExport(root, {
      [nodeId]: {
        object: 'node',
        id: nodeId,
        type: kind,
        name: 'Custom openable',
      } as unknown as AnyNode,
    })

    expect(animations).toHaveLength(1)
    expect(animations[0]!.name).toBe('registry_openable: open')
    const exported = scene.getObjectByProperty('name', nodeId)
    expect(exported?.userData).toMatchObject({
      pascalId: nodeId,
      kind,
      label: 'Custom openable',
      openable: true,
      clips: ['registry_openable: open'],
    })
  })

  test('bakes a sliding door into a sampled position clip', () => {
    // Operation doors build their moving parts in a named group posed by
    // `poseDoorMovingParts`; the exporter samples it into keyframes. The active
    // panel group slides along x.
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const activePanel = new THREE.Group()
    activePanel.name = 'door-sliding-active'
    activePanel.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(activePanel)
    root.add(doorGroup)

    const doorId = 'door_sliding'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Slider',
        doorType: 'sliding',
        slideDirection: 'left',
        width: 1,
        height: 2.1,
        frameThickness: 0.05,
      } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const clip = animations[0]!
    expect(clip.name).toBe('door_sliding: open')
    expect(clip.duration).toBe(1)
    expect(clip.userData).toEqual({ loop: false })

    const track = clip.tracks[0]!
    expect(track).toBeInstanceOf(THREE.VectorKeyframeTrack)
    expect(track.name.endsWith('.position')).toBe(true)
    // 16 segments -> 17 keyframes, evenly spaced over the 1s clip.
    expect(track.times.length).toBe(17)
    expect(track.times[0]).toBeCloseTo(0)
    expect(track.times[track.times.length - 1]!).toBeCloseTo(1)

    // Rest pose is closed (first keyframe centred); the panel slides off-centre.
    expect(track.values[0]!).toBeCloseTo(0)
    expect(track.values[1]!).toBeCloseTo(0)
    expect(track.values[2]!).toBeCloseTo(0)
    const lastX = track.values[track.values.length - 3]!
    expect(Math.abs(lastX)).toBeGreaterThan(0.1)

    const target = scene.getObjectByProperty('uuid', track.name.replace('.position', ''))
    expect(target).toBeDefined()

    const exported = scene.getObjectByProperty('name', doorId)
    expect(exported?.userData.openable).toBe(true)
    expect(exported?.userData.clips).toEqual(['door_sliding: open'])
  })

  test('bakes a roll-up curtain into a sampled scale clip', () => {
    // Roll-up geometry can't vanish in a glTF clip, so the bake scales the
    // curtain group up into the lintel instead.
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const curtain = new THREE.Group()
    curtain.name = 'door-rollup-curtain'
    curtain.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(curtain)
    root.add(doorGroup)

    const doorId = 'door_rollup'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Roll-up',
        doorType: 'garage-rollup',
        width: 2.4,
        height: 2.2,
        frameThickness: 0.05,
      } as unknown as AnyNode,
    }

    const { animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const scaleTrack = animations[0]!.tracks.find((t) => t.name.endsWith('.scale'))
    expect(scaleTrack).toBeInstanceOf(THREE.VectorKeyframeTrack)
    // Rest pose is closed (full curtain, scale 1); it shrinks toward the header.
    expect(Array.from(scaleTrack!.values).slice(0, 3)).toEqual([1, 1, 1])
    const lastScaleY = scaleTrack!.values[scaleTrack!.values.length - 2]!
    expect(lastScaleY).toBeLessThan(0.1)
  })

  // Regression: a folding door saved in an open state (|fold angle| > π/2) used
  // to bake a 180°-flipped rest pose. The export clones + decomposes the door
  // matrix, which re-derives a gimbal-flipped euler (x=z=π) for the wide Y
  // rotation; the pose reset must zero the full euler triple, not just `.y`.
  test('bakes an identity rest pose for an open folding door', () => {
    const node = DoorNode.parse({
      id: 'door_folding',
      doorType: 'folding',
      leafCount: 4,
      operationState: 0.65,
    })
    const mesh = buildDoorPreviewMesh(node)
    const root = new THREE.Group()
    root.add(mesh)
    sceneRegistry.nodes.set(node.id, mesh)

    const { scene, animations } = prepareSceneForExport(root, {
      [node.id]: node as unknown as AnyNode,
    })

    expect(animations).toHaveLength(1)
    for (let index = 0; index < 4; index++) {
      const panel = scene.getObjectByName(`door-fold-${index}`)
      expect(panel).toBeDefined()
      // Rest quaternion must be identity — no residual π on any axis.
      expect(panel!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-4)
    }
  })
})
