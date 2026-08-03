import { describe, expect, test } from 'bun:test'
import { normalizeFurnitureAssembly } from '@pascal-app/core'
import { Box3, type Mesh } from 'three'
import { cabinetDefinition } from '../definition'
import { buildCabinetGeometry } from '../geometry'
import { CabinetNode } from '../schema'

function wardrobeFurniture() {
  return normalizeFurnitureAssembly({
    schema_version: 0.5,
    type: 'wardrobe',
    W: 2400,
    H: 2400,
    D: 600,
    bays: [
      {
        width: 1200,
        base: { type: 'plinth', height: 50 },
        ep: { left: true, right: false },
        tiers: [
          {
            height: 2200,
            door: 'open',
            hanger: true,
            shelves: { count: 2, heights: [700, 1500] },
          },
        ],
      },
      {
        width: 1200,
        base: { type: 'plinth', height: 50 },
        ep: { left: false, right: true },
        tiers: [{ height: 2200, door: 'open', shelves: { count: 3, heights: [500, 1100, 1700] } }],
      },
    ],
  })
}

function furnitureCabinet() {
  return CabinetNode.parse({
    ...cabinetDefinition.defaults(),
    id: 'cabinet_furniture_geometry',
    furniture: wardrobeFurniture(),
  })
}

describe('FurnitureAssembly cabinet geometry adapter', () => {
  test('renders every semantic assembly part with exact declared bounds', () => {
    const group = buildCabinetGeometry(furnitureCabinet(), undefined, 'rendered', false)
    const bounds = new Box3().setFromObject(group)

    expect(group.children).toHaveLength(21)
    expect(bounds.min.x).toBeCloseTo(-1.2)
    expect(bounds.min.y).toBeCloseTo(0)
    expect(bounds.min.z).toBeCloseTo(-0.3)
    expect(bounds.max.x).toBeCloseTo(1.2)
    expect(bounds.max.y).toBeCloseTo(2.4)
    expect(bounds.max.z).toBeCloseTo(0.3)
    expect(group.userData.furnitureAssemblyWarnings).toEqual([])
  })

  test('stamps stable semantic IDs and furniture ownership onto every mesh', () => {
    const group = buildCabinetGeometry(furnitureCabinet(), undefined, 'rendered', false)
    const meshes = group.children as Mesh[]
    const ids = meshes.map((mesh) => mesh.userData.furniturePartId as string)

    expect(new Set(ids).size).toBe(21)
    expect(ids).toContain('bay:bay-0:tier:bay-0-tier-0:hanger')
    expect(
      meshes.find((mesh) => mesh.userData.furniturePartKind === 'hanger')?.rotation.z,
    ).toBeCloseTo(Math.PI / 2)
    expect(
      meshes.every(
        (mesh) =>
          typeof mesh.userData.furniturePartId === 'string' &&
          typeof mesh.userData.furniturePartKind === 'string',
      ),
    ).toBe(true)
    const hanger = meshes.find((mesh) => mesh.userData.furniturePartKind === 'hanger')
    expect(hanger?.userData.slotId).toBe('hardware')
    expect(hanger?.geometry.parameters.height).toBeCloseTo(1.104)
    expect(hanger?.geometry.parameters.radiusTop).toBeCloseTo(0.0125)
  })

  test('keeps mesh names stable across dimension-only updates', () => {
    const node = furnitureCabinet()
    const resized = CabinetNode.parse({
      ...node,
      furniture: {
        ...node.furniture,
        dimensions: { width: 2.8, height: 2.6, depth: 0.7 },
      },
    })

    expect(buildCabinetGeometry(resized).children.map((child) => child.name)).toEqual(
      buildCabinetGeometry(node).children.map((child) => child.name),
    )
  })
})
