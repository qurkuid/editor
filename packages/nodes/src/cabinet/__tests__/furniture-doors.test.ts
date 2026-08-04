import { describe, expect, test } from 'bun:test'
import { normalizeFurnitureAssembly } from '@pascal-app/core'
import { type Object3D, Vector3 } from 'three'
import { poseCabinetMovingParts } from '../animation'
import { cabinetDefinition } from '../definition'
import { buildCabinetGeometry } from '../geometry'
import { CabinetNode } from '../schema'

function frontedFurniture() {
  return normalizeFurnitureAssembly({
    schema_version: 0.5,
    type: 'wardrobe',
    W: 3600,
    H: 2400,
    D: 600,
    bays: [
      {
        width: 900,
        base: { type: 'plinth', height: 50 },
        tiers: [{ height: 2200, door: 'hinged1' }],
      },
      {
        width: 900,
        base: { type: 'plinth', height: 50 },
        tiers: [{ height: 2200, door: 'hinged2' }],
      },
      {
        width: 900,
        base: { type: 'plinth', height: 50 },
        tiers: [{ height: 2200, door: 'drawer', drawerCount: 3 }],
      },
      {
        width: 900,
        base: { type: 'plinth', height: 50 },
        tiers: [{ height: 2200, door: 'sliding2' }],
      },
    ],
  })
}

function furnitureCabinet(operationState = 0) {
  return CabinetNode.parse({
    ...cabinetDefinition.defaults(),
    id: 'cabinet_furniture_doors',
    furniture: frontedFurniture(),
    operationState,
  })
}

function worldPositions(root: Object3D): Map<string, Vector3> {
  const positions = new Map<string, Vector3>()
  root.updateMatrixWorld(true)
  root.traverse((child) => {
    if (typeof child.userData.furniturePartId !== 'string') return
    positions.set(child.userData.furniturePartId, child.getWorldPosition(new Vector3()))
  })
  return positions
}

describe('furniture assembly door animation', () => {
  test('fronts carry a pose so the shared cabinet animator can drive them', () => {
    const group = buildCabinetGeometry(furnitureCabinet())
    expect(poseCabinetMovingParts(group, 0)).toBe(true)
  })

  // The animator *assigns* `position[axis]`/`rotation[axis]` rather than adding
  // to it, so anything it poses must sit at 0 on that axis. Stamping the pose
  // straight onto a front mesh silently teleports it to the carcass centre the
  // first time the animator runs — closed geometry looks right until then.
  test('posing to the closed state leaves every part exactly where it was built', () => {
    const group = buildCabinetGeometry(furnitureCabinet(0))
    const built = worldPositions(group)

    poseCabinetMovingParts(group, 0)
    const posed = worldPositions(group)

    expect(posed.size).toBe(built.size)
    for (const [id, position] of built) {
      expect(posed.get(id)?.distanceTo(position) ?? Number.NaN).toBeLessThan(1e-9)
    }
  })

  test('opening moves every front and leaves the carcass untouched', () => {
    const group = buildCabinetGeometry(furnitureCabinet(0))
    const closed = worldPositions(group)

    poseCabinetMovingParts(group, 1)
    group.updateMatrixWorld(true)
    const open = worldPositions(group)

    const moved: string[] = []
    const still: string[] = []
    for (const [id, position] of closed) {
      const delta = open.get(id)?.distanceTo(position) ?? 0
      ;(delta > 1e-4 ? moved : still).push(id)
    }

    expect(moved.length).toBeGreaterThan(0)
    expect(moved.every((id) => id.includes(':front:'))).toBe(true)
    expect(still.some((id) => id.includes(':shelf:') || id.startsWith('side:'))).toBe(true)
  })

  test('sliding leaves travel apart instead of through each other', () => {
    const group = buildCabinetGeometry(furnitureCabinet(0))
    const closed = worldPositions(group)
    poseCabinetMovingParts(group, 1)
    group.updateMatrixWorld(true)
    const open = worldPositions(group)

    const leafIds = [...closed.keys()].filter(
      (id) => id.includes('bay-3') && id.includes(':front:'),
    )
    expect(leafIds).toHaveLength(2)

    const [first, second] = leafIds.map((id) => ({
      closed: closed.get(id)!.x,
      open: open.get(id)!.x,
    }))
    expect(Math.abs(second!.open - first!.open)).toBeGreaterThan(
      Math.abs(second!.closed - first!.closed),
    )
  })
})
