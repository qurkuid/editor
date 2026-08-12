import { describe, expect, test } from 'bun:test'
import { Box3 } from 'three/src/math/Box3.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import {
  compileImg3dSculpt,
  createImg3dObject,
  Img3dDegenerateBoundsError,
  normalizeImg3dObject,
} from './img3d-compiler'
import { Img3dSculptSchema } from './img3d-contract'

const sculpt = Img3dSculptSchema.parse({
  version: 1,
  name: 'Bench',
  materials: [{ name: 'wood', color: '#8b5e3c', roughness: 0.7, metalness: 0, slot: 'frame' }],
  parts: [
    {
      name: 'top',
      primitive: 'box',
      material: 0,
      position: [0.2, 1.1, -0.3],
      rotation: [0, 0, 0],
      size: [2, 0.2, 0.8],
    },
  ],
})

describe('img3d deterministic browser compiler', () => {
  test('grounds and centers primitive geometry with truthful bounds', () => {
    const object = createImg3dObject(sculpt, { width: 2, height: 0.2, depth: 0.8 })
    const bounds = new Box3().setFromObject(object)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())

    expect(bounds.min.y).toBeCloseTo(0)
    expect(center.x).toBeCloseTo(0)
    expect(center.z).toBeCloseTo(0)
    expect(size.x).toBeCloseTo(2)
    expect(size.y).toBeCloseTo(0.2)
    expect(size.z).toBeCloseTo(0.8)
    const mesh = object.children[0]
    expect(mesh).toBeInstanceOf(Mesh)
    expect(mesh instanceof Mesh ? mesh.material.name : '').toBe('slot_frame')
  })

  test('exports identical embedded binary GLB and exact AssetInput dimensions', async () => {
    const first = await compileImg3dSculpt(sculpt, {
      assetId: 'img3d-bench',
      thumbnail: '/img3d.png',
      dimensions: { width: 1.5, height: 0.9, depth: 0.45 },
    })
    const second = await compileImg3dSculpt(sculpt, {
      assetId: 'img3d-bench',
      thumbnail: '/img3d.png',
      dimensions: { width: 1.5, height: 0.9, depth: 0.45 },
    })

    expect(first.glb.type).toBe('model/gltf-binary')
    expect(new Uint8Array(await first.glb.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
    )
    expect(await first.glb.arrayBuffer()).toEqual(await second.glb.arrayBuffer())
    expect(first.asset.dimensions).toEqual([1.5, 0.9, 0.45])
    expect(first.asset.src).toBe('asset://img3d-bench')
    expect(first.metadata).toEqual({ version: 1, partCount: 1, slots: ['frame'] })
  })

  test('normalizes mismatched raw proportions to requested metre dimensions', () => {
    const object = createImg3dObject(sculpt, { width: 1.5, height: 0.9, depth: 0.45 })
    const bounds = new Box3().setFromObject(object)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())

    expect(bounds.min.y).toBeCloseTo(0)
    expect(center.x).toBeCloseTo(0)
    expect(center.z).toBeCloseTo(0)
    expect(size.x).toBeCloseTo(1.5)
    expect(size.y).toBeCloseTo(0.9)
    expect(size.z).toBeCloseTo(0.45)
  })

  test('rejects degenerate raw geometry through a typed compiler error', () => {
    expect(() =>
      normalizeImg3dObject(new Group(), { width: 1.5, height: 0.9, depth: 0.45 }),
    ).toThrow(Img3dDegenerateBoundsError)
  })

  test('creates only meshes under one compiler-owned group', () => {
    const object = createImg3dObject(sculpt, { width: 2, height: 0.2, depth: 0.8 })
    expect(object).toBeInstanceOf(Group)
    expect(object.children.every((child) => child instanceof Mesh)).toBe(true)
  })
})
