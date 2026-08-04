import { describe, expect, test } from 'bun:test'
import { buildFurnitureAssembly, normalizeFurnitureAssembly } from '@pascal-app/core'
import { Box3, type Group, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
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

function frontCabinet(front: Record<string, unknown>, operationState = 0) {
  const furniture = normalizeFurnitureAssembly({
    schema_version: 0.5,
    type: 'wardrobe',
    W: 1200,
    H: 2400,
    D: 600,
    bays: [
      {
        width: 1200,
        base: { type: 'none' },
        kickplate: false,
        tiers: [{ height: 2400, front }],
      },
    ],
  })
  return CabinetNode.parse({
    ...cabinetDefinition.defaults(),
    id: 'cabinet_front_pose',
    furniture,
    operationState,
  })
}

function frontParts(node: ReturnType<typeof frontCabinet>) {
  return buildFurnitureAssembly(node.furniture!, {
    carcassThickness: node.boardThickness,
  }).parts.filter((part) => part.kind === 'front')
}

function findFrontMesh(root: Object3D, partId: string): Mesh {
  let found: Mesh | undefined
  root.traverse((obj) => {
    if (obj.userData.furniturePartId === partId) found = obj as Mesh
  })
  if (!found) throw new Error(`part "${partId}" not found`)
  return found
}

describe('FurnitureAssembly front open/close animation', () => {
  test('rest state (operationState 0) matches the declared position with no baked rotation', () => {
    const cases: Array<Record<string, unknown>> = [
      { kind: 'hinged', leaves: 1 },
      { kind: 'hinged', leaves: 2 },
      { kind: 'flap', direction: 'up' },
      { kind: 'flap', direction: 'down' },
      { kind: 'drawer', count: 2 },
      { kind: 'sliding', leaves: 3 },
      { kind: 'pull-out', style: 'standard' },
    ]

    for (const front of cases) {
      const node = frontCabinet(front, 0)
      const group = buildCabinetGeometry(node, undefined, 'rendered', false)
      for (const part of frontParts(node)) {
        const mesh = findFrontMesh(group, part.id)
        const worldPosition = new Vector3()
        mesh.getWorldPosition(worldPosition)
        expect(worldPosition.x).toBeCloseTo(part.position[0])
        expect(worldPosition.y).toBeCloseTo(part.position[1])
        expect(worldPosition.z).toBeCloseTo(part.position[2])

        const worldQuaternion = new Quaternion()
        mesh.getWorldQuaternion(worldQuaternion)
        expect(worldQuaternion.angleTo(new Quaternion())).toBeCloseTo(0)
      }
    }
  })

  test('a single hinged front swings open on Y at operationState 1, hinge on the left edge', () => {
    const node = frontCabinet({ kind: 'hinged', leaves: 1 }, 1)
    const [part] = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const mesh = findFrontMesh(group, part!.id)
    const hingeGroup = mesh.parent as Group

    expect(hingeGroup.userData.cabinetPose).toEqual({
      type: 'rotate',
      axis: 'y',
      angle: -(Math.PI / 2),
    })
    expect(hingeGroup.rotation.y).toBeCloseTo(-(Math.PI / 2))
    // The pivot sits on the left edge; the mesh's local offset carries it to
    // the right of that pivot so the panel still covers the opening at rest.
    expect(mesh.position.x).toBeCloseTo(part!.size[0] / 2)
  })

  test('a 2-leaf hinged front hinges left/right and opens symmetrically', () => {
    const node = frontCabinet({ kind: 'hinged', leaves: 2 }, 1)
    const [left, right] = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftMesh = findFrontMesh(group, left!.id)
    const rightMesh = findFrontMesh(group, right!.id)
    const leftHinge = leftMesh.parent as Group
    const rightHinge = rightMesh.parent as Group

    expect(leftHinge.rotation.y).toBeCloseTo(-(Math.PI / 2))
    expect(rightHinge.rotation.y).toBeCloseTo(Math.PI / 2)

    const leftWorld = new Vector3()
    leftMesh.getWorldPosition(leftWorld)
    const rightWorld = new Vector3()
    rightMesh.getWorldPosition(rightWorld)
    const leftOpenDistance = leftWorld.z - left!.position[2]
    const rightOpenDistance = rightWorld.z - right!.position[2]

    expect(leftOpenDistance).toBeGreaterThan(0)
    expect(rightOpenDistance).toBeGreaterThan(0)
    expect(leftOpenDistance).toBeCloseTo(rightOpenDistance)
  })

  test('a flap front rotates about the hinge edge per direction, at operationState 1', () => {
    const up = frontCabinet({ kind: 'flap', direction: 'up' }, 1)
    const [upPart] = frontParts(up)
    const upMesh = findFrontMesh(buildCabinetGeometry(up, undefined, 'rendered', false), upPart!.id)
    const upHinge = upMesh.parent as Group

    const down = frontCabinet({ kind: 'flap', direction: 'down' }, 1)
    const [downPart] = frontParts(down)
    const downMesh = findFrontMesh(
      buildCabinetGeometry(down, undefined, 'rendered', false),
      downPart!.id,
    )
    const downHinge = downMesh.parent as Group

    expect(upHinge.userData.cabinetPose).toMatchObject({ type: 'rotate', axis: 'x' })
    expect(downHinge.userData.cabinetPose).toMatchObject({ type: 'rotate', axis: 'x' })
    // 'up' hinges at the top and lifts the bottom edge open; 'down' hinges at
    // the bottom and drops the top edge open — opposite rotation signs.
    expect(upHinge.rotation.x).toBeLessThan(0)
    expect(downHinge.rotation.x).toBeGreaterThan(0)
  })

  test('drawer fronts slide out along +Z and cascade for stacked drawers', () => {
    const node = frontCabinet({ kind: 'drawer', count: 2 }, 1)
    const [bottom, top] = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const bottomMesh = findFrontMesh(group, bottom!.id)
    const topMesh = findFrontMesh(group, top!.id)

    // The pose rides a wrapping group, not the mesh: the animator assigns
    // `position[axis]` outright, so a posed object has to sit at 0 on it.
    expect((bottomMesh.parent as Group).userData.cabinetPose).toMatchObject({
      type: 'translate',
      axis: 'z',
    })
    const bottomOpenDistance = bottomMesh.getWorldPosition(new Vector3()).z - bottom!.position[2]
    const topOpenDistance = topMesh.getWorldPosition(new Vector3()).z - top!.position[2]

    expect(bottomOpenDistance).toBeGreaterThan(0)
    expect(topOpenDistance).toBeGreaterThan(0)
    // Bottom drawer (index 0) opens furthest.
    expect(bottomOpenDistance).toBeGreaterThan(topOpenDistance)
  })

  test('a pull-out front slides out along +Z like a drawer', () => {
    const node = frontCabinet({ kind: 'pull-out', style: 'standard' }, 1)
    const [part] = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const mesh = findFrontMesh(group, part!.id)

    expect((mesh.parent as Group).userData.cabinetPose).toMatchObject({
      type: 'translate',
      axis: 'z',
    })
    expect(mesh.getWorldPosition(new Vector3()).z - part!.position[2]).toBeGreaterThan(0)
  })

  test('sliding leaves translate sideways without overlapping their own depth track', () => {
    const node = frontCabinet({ kind: 'sliding', leaves: 4 }, 1)
    const parts = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const deltas = parts.map(
      (part) => findFrontMesh(group, part.id).getWorldPosition(new Vector3()).x - part.position[0],
    )

    expect(Math.sign(deltas[0]!)).toBe(-Math.sign(deltas[1]!))
    expect(deltas[0]).toBeCloseTo(deltas[2]!)
    expect(deltas[1]).toBeCloseTo(deltas[3]!)
  })

  test('cabinetPose is stamped even at operationState 0, for the live animation system', () => {
    const node = frontCabinet({ kind: 'hinged', leaves: 1 }, 0)
    const [part] = frontParts(node)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const mesh = findFrontMesh(group, part!.id)
    const hingeGroup = mesh.parent as Group

    expect(hingeGroup.userData.cabinetPose).toEqual({
      type: 'rotate',
      axis: 'y',
      angle: -(Math.PI / 2),
    })
    expect(hingeGroup.rotation.y).toBeCloseTo(0)
  })
})
