import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  calculateLevelMiters,
  DoorNode,
  LevelNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import {
  buildSketchupWallContract,
  buildSketchupWallContracts,
  type PascalNativeWallContract,
  type WallContractSupport,
} from './sketchup-wall-contract'

const IDENTITY = new THREE.Matrix4()

function wall(id = 'wall_fixture', overrides: Record<string, unknown> = {}) {
  return WallNode.parse({
    id,
    start: [0, 0],
    end: [4, 0],
    frontSide: 'interior',
    backSide: 'exterior',
    ...overrides,
  })
}

function windowNode(id: string, wallId: string, overrides: Record<string, unknown> = {}) {
  return WindowNode.parse({
    id,
    wallId,
    position: [2, 1, 0],
    width: 1,
    height: 1,
    ...overrides,
  })
}

function doorNode(id: string, wallId: string, overrides: Record<string, unknown> = {}) {
  return DoorNode.parse({
    id,
    wallId,
    position: [1, 1.05, 0],
    width: 0.9,
    height: 2.1,
    ...overrides,
  })
}

function contractFor(
  node: ReturnType<typeof wall>,
  children: AnyNode[] = [],
  support: WallContractSupport = {},
  matrixWorld = IDENTITY,
  miterData = calculateLevelMiters([node]),
) {
  return buildSketchupWallContract({
    wall: node,
    children,
    miterData,
    matrixWorld,
    support,
  })
}

function compatibleContract(contract: PascalNativeWallContract) {
  expect(contract.compatible).toBe(true)
  if (!contract.compatible) throw new Error('expected a compatible contract')
  return contract
}

function pointKey(point: readonly number[]) {
  return point.map((value) => Math.round(value * 1e8)).join(',')
}

function shellEdges(contract: Extract<PascalNativeWallContract, { compatible: true }>) {
  const edges = new Map<string, { count: number; balance: number }>()
  for (const face of contract.faces) {
    for (const ring of [face.outer, ...face.holes]) {
      for (let index = 0; index < ring.length; index += 1) {
        const current = ring[index]!
        const next = ring[(index + 1) % ring.length]!
        const currentKey = pointKey(current)
        const nextKey = pointKey(next)
        const key = [currentKey, nextKey].sort().join('|')
        const edge = edges.get(key) ?? { count: 0, balance: 0 }
        edge.count += 1
        edge.balance += currentKey < nextKey ? 1 : -1
        edges.set(key, edge)
      }
    }
  }
  return edges
}

function signedVolume(contract: Extract<PascalNativeWallContract, { compatible: true }>) {
  let volume = 0
  for (const face of contract.faces) {
    for (const ring of [face.outer, ...face.holes]) {
      const origin = ring[0]!
      for (let index = 1; index < ring.length - 1; index += 1) {
        const current = ring[index]!
        const next = ring[index + 1]!
        volume +=
          (origin[0] * (current[1] * next[2] - current[2] * next[1]) -
            origin[1] * (current[0] * next[2] - current[2] * next[0]) +
            origin[2] * (current[0] * next[1] - current[1] * next[0])) /
          6
      }
    }
  }
  return volume
}

function bounds(contract: Extract<PascalNativeWallContract, { compatible: true }>) {
  const points = contract.faces.flatMap((face) => [face.outer, ...face.holes]).flat()
  return [
    Math.min(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
    Math.max(...points.map((point) => point[2])),
  ]
}

function expectClosed(contract: PascalNativeWallContract) {
  const compatible = compatibleContract(contract)
  expect(compatible.faces.length).toBeGreaterThan(0)
  expect(shellEdges(compatible).size).toBeGreaterThan(0)
  for (const edge of shellEdges(compatible).values()) {
    expect(edge).toEqual({ count: 2, balance: 0 })
  }
  for (const face of compatible.faces) {
    for (const point of [...face.outer, ...face.holes.flat()]) {
      expect(point.every(Number.isFinite)).toBe(true)
    }
  }
  expect(signedVolume(compatible)).toBeGreaterThan(0)
  return compatible
}

describe('buildSketchupWallContract', () => {
  test('emits a finite closed four-point wall with side material roles', () => {
    const contract = expectClosed(contractFor(wall()))

    expect(contract.version).toBe(1)
    expect(contract.coordinates).toBe('three-world-m')
    expect(contract.sketchUpMap).toBe('x,-z,y')
    expect(bounds(contract)).toEqual([0, 4, 0, 2.5, -0.05, 0.05])
    expect(new Set(contract.faces.map((face) => face.materialRole))).toEqual(
      new Set(['interior', 'exterior', 'wall-edge']),
    )
  })

  test('preserves one and two rectangular openings, including a floor door notch', () => {
    const node = wall()
    const window = windowNode('window_one', node.id)
    const door = doorNode('door_floor', node.id)

    const oneOpening = expectClosed(contractFor(node, [window]))
    const twoOpenings = expectClosed(contractFor(node, [window, door]))
    expect(twoOpenings.faces.length).toBeGreaterThan(oneOpening.faces.length)
    expect(twoOpenings.faces.some((face) => face.role === 'reveal')).toBe(true)

    const floorY = twoOpenings.faces
      .flatMap((face) => face.outer.map((point) => point[1]))
      .filter((value) => value < 0.001)
    expect(floorY.length).toBeGreaterThan(0)
  })

  test('handles five and six point miter footprints without dropping junction vertices', () => {
    const oneJunction = [
      wall('wall_one_junction'),
      WallNode.parse({
        id: 'wall_one_junction_peer',
        start: [4, 0],
        end: [4, 4],
        frontSide: 'interior',
        backSide: 'exterior',
      }),
    ]
    const oneMiter = calculateLevelMiters(oneJunction)
    const oneContract = expectClosed(contractFor(oneJunction[0]!, [], {}, IDENTITY, oneMiter))
    expect(oneContract.faces.some((face) => face.outer.length >= 5)).toBe(true)

    const sixPointWalls = [
      ...oneJunction,
      WallNode.parse({
        id: 'wall_six_point_peer',
        start: [0, 4],
        end: [0, 0],
        frontSide: 'interior',
        backSide: 'exterior',
      }),
    ]
    const sixMiter = calculateLevelMiters(sixPointWalls)
    const sixContract = expectClosed(contractFor(sixPointWalls[0]!, [], {}, IDENTITY, sixMiter))
    expect(sixContract.faces.some((face) => face.outer.length >= 6)).toBe(true)
  })

  test('supports each recovered stepped-base profile', () => {
    const profiles = [
      [
        { start: 0, end: 0.25, elevation: 0 },
        { start: 0.25, end: 0.5, elevation: 0.05 },
        { start: 0.5, end: 0.75, elevation: 0 },
        { start: 0.75, end: 1, elevation: 0.05 },
      ],
      [
        { start: 0, end: 0.5, elevation: 0 },
        { start: 0.5, end: 1, elevation: 0.05 },
      ],
      [
        { start: 0, end: 0.5, elevation: 0 },
        { start: 0.5, end: 1, elevation: 0.05 },
      ],
      [
        { start: 0, end: 0.34, elevation: 0.05 },
        { start: 0.34, end: 0.67, elevation: 0 },
        { start: 0.67, end: 1, elevation: 0.05 },
      ],
      [
        { start: 0, end: 0.5, elevation: 0 },
        { start: 0.5, end: 1, elevation: 0.05 },
      ],
    ]

    for (const baseSegments of profiles) {
      const contract = expectClosed(
        contractFor(wall(), [], {
          slabElevation: 0.2,
          baseElevation: 0,
          baseSegments,
          storeyHeight: 2.7,
        }),
      )
      expect(contract.faces.some((face) => face.role === 'support-step')).toBe(true)
    }
  })

  test('accepts a miter-cap crossing and exact boundary opening', () => {
    const walls = [
      wall('wall_cap_crossing'),
      WallNode.parse({
        id: 'wall_cap_peer',
        start: [4, 0],
        end: [4, 4],
        frontSide: 'interior',
        backSide: 'exterior',
      }),
    ]
    const miterData = calculateLevelMiters(walls)
    const crossing = windowNode('window_cap_crossing', walls[0]!.id, {
      position: [3.9, 1, 0],
      width: 0.8,
    })
    const boundary = windowNode('window_boundary', walls[0]!.id, {
      position: [2, 1, 0],
      width: 4,
    })

    expectClosed(contractFor(walls[0]!, [crossing], {}, IDENTITY, miterData))
    expectClosed(contractFor(walls[0]!, [boundary], {}, IDENTITY, miterData))
  })

  test('serializes the full wall matrix and keeps output deterministic', () => {
    const node = wall('wall_transformed')
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(10, 3, -4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.1)),
      new THREE.Vector3(1.2, 0.9, 0.8),
    )
    const first = compatibleContract(contractFor(node, [], {}, matrix))
    const second = compatibleContract(contractFor(node, [], {}, matrix))
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(bounds(first)).not.toEqual([0, 4, 0, 2.5, -0.05, 0.05])
    expect(first.faces.flatMap((face) => face.outer).some((point) => point[0] > 9)).toBe(true)
  })

  test('returns stable incompatibility reasons for unsupported wall inputs', () => {
    const curved = contractFor(wall('wall_curved', { curveOffset: 0.25 }))
    expect(curved).toMatchObject({ compatible: false, reasons: ['curved-wall'] })

    const terrain = contractFor(wall('wall_terrain', { fillToTerrain: true }))
    expect(terrain).toMatchObject({ compatible: false, reasons: ['terrain-support'] })

    const shaped = contractFor(wall(), [
      windowNode('window_arch', 'wall_fixture', { openingShape: 'arch' }),
    ])
    expect(shaped).toMatchObject({ compatible: false, reasons: ['shaped-opening'] })

    const item = {
      object: 'node',
      id: 'item_cutout',
      type: 'item',
    } as unknown as AnyNode
    expect(contractFor(wall(), [item])).toMatchObject({
      compatible: false,
      reasons: ['item-cutout'],
    })

    expect(
      contractFor(wall('wall_invalid_base'), [], {
        slabElevation: 0.2,
        baseElevation: 0,
        baseSegments: [{ start: 0.5, end: 0.5, elevation: 0.1 }],
      }),
    ).toMatchObject({ compatible: false, reasons: ['stepped-base'] })
  })

  test('groups walls by level and stamps a compatible contract for every renderer', () => {
    const first = wall('wall_group_first')
    const second = wall('wall_group_second', { start: [0, 4], end: [4, 4] })
    const objects = new Map<string, THREE.Object3D>([
      [first.id, new THREE.Group()],
      [second.id, new THREE.Group()],
    ])
    const contracts = buildSketchupWallContracts(
      { [first.id]: first, [second.id]: second },
      objects,
    )
    expect(contracts.size).toBe(2)
    for (const contract of contracts.values()) expectClosed(contract)
  })

  test('keeps stacked level contracts in their absolute world elevations', () => {
    const lower = wall('wall_lower', { parentId: 'level_lower' })
    const upper = wall('wall_upper', { parentId: 'level_upper' })
    const lowerLevel = LevelNode.parse({ id: 'level_lower', children: [lower.id], height: 2.5 })
    const upperLevel = LevelNode.parse({ id: 'level_upper', children: [upper.id], height: 2.5 })
    const lowerObject = new THREE.Group()
    const upperObject = new THREE.Group()
    upperObject.position.y = 2.5
    lowerObject.updateMatrixWorld(true)
    upperObject.updateMatrixWorld(true)

    const contracts = buildSketchupWallContracts(
      {
        [lower.id]: lower,
        [upper.id]: upper,
        [lowerLevel.id]: lowerLevel,
        [upperLevel.id]: upperLevel,
      },
      new Map([
        [lower.id, lowerObject],
        [upper.id, upperObject],
      ]),
    )
    const lowerContract = expectClosed(contracts.get(lower.id)!)
    const upperContract = expectClosed(contracts.get(upper.id)!)

    expect(bounds(lowerContract)[2]).toBe(0)
    expect(bounds(lowerContract)[3]).toBe(2.5)
    expect(bounds(upperContract)[2]).toBe(2.5)
    expect(bounds(upperContract)[3]).toBe(5)
  })
})
