// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, spyOn, test } from 'bun:test'
import type { MaterialSchema } from '@pascal-app/core'
import {
  calculateLevelMiters,
  DoorNode,
  type SceneMaterial,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { MeshStandardMaterial } from 'three'
import { ensureKtx2Support, ktx2Loader } from '../../lib/ktx2-loader'
import { clearMaterialCache, createMaterialFromPresetRef } from '../../lib/materials'
import {
  getMaterialsForWall,
  getWallRegionMaterialIndex,
  getWallRegionMaterialPlan,
  hasWallMaterialOverride,
  markWallMaterialOverride,
} from './wall-materials'
import { applyWorldPlanarWallUVs, generateExtrudedWall } from './wall-system'

function finishRegionWall() {
  return WallNode.parse({
    id: 'wall_finish-region-geometry',
    start: [0, 0],
    end: [4, 0],
    height: 2.4,
    thickness: 0.2,
    frontSide: 'interior',
    backSide: 'exterior',
    faceBands: {
      enabled: true,
      count: 4,
      lowerHeight: 0.6,
      middleHeight: 0.6,
      upperHeight: 0.6,
    },
    finishRegions: [
      {
        id: 'finish-left',
        side: 'interior',
        start: 0,
        end: 0.35,
        slots: {
          lowerInterior: 'library:finish-left-lower',
          middleInterior: 'library:finish-left-middle',
          upperInterior: 'library:finish-left-upper',
          topInterior: 'library:finish-left-top',
        },
      },
      {
        id: 'finish-right',
        side: 'interior',
        start: 0.35,
        end: 1,
        slots: {
          lowerInterior: 'library:finish-right-lower',
          middleInterior: 'library:finish-right-middle',
          upperInterior: 'library:finish-right-upper',
          topInterior: 'library:finish-right-top',
        },
      },
    ],
  })
}

function triangleRecords(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  return Array.from({ length: Math.floor(position.count / 3) }, (_, triangleIndex) => {
    const offset = triangleIndex * 3
    const vertices = [0, 1, 2].map((corner) => {
      const vertexIndex = index ? index.getX(offset + corner) : offset + corner
      return new THREE.Vector3(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
      )
    })
    const normal = new THREE.Vector3()
      .crossVectors(vertices[1]!.clone().sub(vertices[0]!), vertices[2]!.clone().sub(vertices[0]!))
      .normalize()
    const centroid = vertices
      .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
      .multiplyScalar(1 / 3)
    const group = geometry.groups.find(
      (candidate) => offset >= candidate.start && offset < candidate.start + candidate.count,
    )
    return {
      vertices,
      normal,
      centroid,
      materialIndex: group?.materialIndex ?? 0,
      minX: Math.min(...vertices.map((vertex) => vertex.x)),
      maxX: Math.max(...vertices.map((vertex) => vertex.x)),
    }
  })
}

function pointInTriangle2D(point: readonly [number, number], vertices: THREE.Vector3[]) {
  const sign = (a: THREE.Vector3, b: THREE.Vector3, c: readonly [number, number]) =>
    (a.x - c[0]) * (b.y - c[1]) - (b.x - c[0]) * (a.y - c[1])
  const first = sign(vertices[0]!, vertices[1]!, point)
  const second = sign(vertices[1]!, vertices[2]!, point)
  const third = sign(vertices[2]!, vertices[0]!, point)
  return !(
    (first < -1e-7 || second < -1e-7 || third < -1e-7) &&
    (first > 1e-7 || second > 1e-7 || third > 1e-7)
  )
}

function wallBandRole(height: number) {
  if (height < 0.6) return 'lowerInterior' as const
  if (height < 1.2) return 'middleInterior' as const
  if (height < 1.8) return 'upperInterior' as const
  return 'topInterior' as const
}

function expectCompleteGroups(geometry: THREE.BufferGeometry) {
  let cursor = 0
  for (const group of [...geometry.groups].sort((left, right) => left.start - right.start)) {
    expect(group.start).toBe(cursor)
    cursor += group.count
  }
  expect(cursor).toBe(geometry.getAttribute('position').count)
}

function makeCompressedTexture(): THREE.CompressedTexture {
  return new THREE.CompressedTexture(
    [{ data: new Uint8Array(16), width: 4, height: 4 }],
    4,
    4,
    THREE.RGBA_S3TC_DXT1_Format,
  )
}

function sceneKtx2Material(url: string): MaterialSchema {
  return {
    properties: {
      color: '#d8d8d8',
      roughness: 0.6,
      metalness: 0,
      opacity: 1,
      transparent: false,
      side: 'front',
    },
    texture: {
      url,
      repeat: [2, 3],
      offset: [0.25, 0.5],
      rotationDeg: 30,
    },
  } as unknown as MaterialSchema
}

async function flushTextureLoad() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function ensureKtx2LoaderReady() {
  const detectSupport = spyOn(
    ktx2Loader as unknown as { detectSupport: (renderer: object) => void },
    'detectSupport',
  ).mockImplementation(() => {})
  ensureKtx2Support({})
  detectSupport.mockRestore()
}

describe('wall material override claim', () => {
  test('only a claimed material array reports an override', () => {
    const cached = [new MeshStandardMaterial(), new MeshStandardMaterial()]
    expect(hasWallMaterialOverride(cached)).toBe(false)

    const ghosted = cached.map((material) => markWallMaterialOverride(material.clone()))
    expect(hasWallMaterialOverride(ghosted)).toBe(true)
    // The claim must not leak back into the shared cached array.
    expect(hasWallMaterialOverride(cached)).toBe(false)

    // Paint preview swaps a single slot of the current array; the claim survives.
    const painted = ghosted.slice()
    painted[0] = new MeshStandardMaterial()
    expect(hasWallMaterialOverride(painted)).toBe(true)
  })
})

describe('wall finish region material plan', () => {
  test('orders side ranges deterministically and resolves the region index', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      finishRegions: [
        {
          id: 'late',
          side: 'interior',
          start: 0.5,
          end: 0.75,
          slots: { upperInterior: 'library:late' },
        },
        {
          id: 'early',
          side: 'interior',
          start: 0.25,
          end: 0.5,
          slots: { upperInterior: 'library:early' },
        },
      ],
    })
    const plan = getWallRegionMaterialPlan(wall)
    expect(plan.map((entry) => entry.regionId)).toEqual(['early', 'late'])
    expect(getWallRegionMaterialIndex(plan, 'upperInterior', 0.4)).toBe(plan[0]!.index)
    expect(getWallRegionMaterialIndex(plan, 'upperInterior', 0.8)).toBe(5)
  })

  test('splits straight wall geometry at finish stations while preserving UV and UV2 arrays', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      finishRegions: [
        {
          id: 'band',
          side: 'interior',
          start: 0.25,
          end: 0.5,
          slots: { interior: 'library:band' },
        },
      ],
    })
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
    try {
      expect(geometry.getAttribute('uv')?.count).toBe(geometry.getAttribute('position')?.count)
      expect(geometry.getAttribute('uv2')?.count).toBe(geometry.getAttribute('position')?.count)
      expect(geometry.groups.some((group) => group.materialIndex === 11)).toBe(true)
    } finally {
      geometry.dispose()
    }
  })

  test('maps four bands across two finish ranges and preserves opposite material groups', () => {
    const wall = finishRegionWall()
    const plan = getWallRegionMaterialPlan(wall)
    expect(plan).toHaveLength(8)
    expect(plan.map((entry) => entry.index)).toEqual([11, 12, 13, 14, 15, 16, 17, 18])
    expect(plan.map((entry) => entry.regionId)).toEqual([
      'finish-left',
      'finish-left',
      'finish-left',
      'finish-left',
      'finish-right',
      'finish-right',
      'finish-right',
      'finish-right',
    ])

    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
    try {
      const position = geometry.getAttribute('position')
      expect(geometry.getAttribute('uv')?.count).toBe(position.count)
      expect(geometry.getAttribute('uv2')?.count).toBe(position.count)
      expectCompleteGroups(geometry)

      const records = triangleRecords(geometry)
      expect(records.some((record) => record.minX < 1.4 - 1e-5 && record.maxX > 1.4 + 1e-5)).toBe(
        false,
      )

      const expectedFrontIndices = new Set<number>()
      for (const record of records) {
        const isInteriorFace =
          record.normal.z > 0.9 && record.vertices.every((vertex) => vertex.z > 0.09)
        if (!isInteriorFace) continue
        const role = wallBandRole(record.centroid.y)
        const expected = getWallRegionMaterialIndex(plan, role, record.centroid.x / 4)
        expect(record.materialIndex).toBe(expected)
        expectedFrontIndices.add(expected)
      }
      expect([...expectedFrontIndices].sort((left, right) => left - right)).toEqual([
        11, 12, 13, 14, 15, 16, 17, 18,
      ])

      const exteriorIndices = new Set(
        records
          .filter(
            (record) =>
              record.normal.z < -0.9 && record.vertices.every((vertex) => vertex.z < -0.09),
          )
          .map((record) => record.materialIndex),
      )
      expect([...exteriorIndices].sort((left, right) => left - right)).toEqual([7, 8, 9, 10])
      expect(new Set(records.map((record) => record.materialIndex))).toContain(0)
    } finally {
      geometry.dispose()
    }
  })

  test('keeps door and window holes through a finish boundary while preserving split groups', () => {
    const wall = finishRegionWall()
    const door = DoorNode.parse({
      id: 'door_finish-region-boundary',
      wallId: wall.id,
      position: [1.4, 1.05, 0],
      width: 0.8,
      height: 2.1,
    })
    const window = WindowNode.parse({
      id: 'window_finish-region-boundary',
      wallId: wall.id,
      position: [1.4, 2.05, 0],
      width: 1.2,
      height: 0.4,
      sill: false,
    })
    const wallMesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, wallMesh)
    let geometry: THREE.BufferGeometry | undefined
    try {
      geometry = generateExtrudedWall(wall, [door, window], calculateLevelMiters([wall]))
      expectCompleteGroups(geometry)
      expect(geometry.getAttribute('uv')?.count).toBe(geometry.getAttribute('position')?.count)
      expect(geometry.getAttribute('uv2')?.count).toBe(geometry.getAttribute('position')?.count)

      const records = triangleRecords(geometry)
      expect(records.some((record) => record.minX < 1.4 - 1e-5 && record.maxX > 1.4 + 1e-5)).toBe(
        false,
      )
      const interiorRecords = records.filter(
        (record) => record.normal.z > 0.9 && record.vertices.every((vertex) => vertex.z > 0.09),
      )
      const regionIndices = new Set(
        interiorRecords
          .map((record) => record.materialIndex)
          .filter((materialIndex) => materialIndex >= 11 && materialIndex <= 18),
      )
      expect([...regionIndices].sort((left, right) => left - right)).toEqual([
        11, 12, 13, 14, 15, 16, 17, 18,
      ])

      for (const point of [
        [1.4, 0.4],
        [1.4, 1.05],
        [1.4, 1.7],
        [1.4, 1.9],
        [1.4, 2.05],
        [1.4, 2.2],
      ] as const) {
        expect(interiorRecords.some((record) => pointInTriangle2D(point, record.vertices))).toBe(
          false,
        )
      }
    } finally {
      geometry?.dispose()
      sceneRegistry.nodes.delete(wall.id)
      wallMesh.geometry.dispose()
    }
  })

  test('projects generated rotated finish regions with metre-stable world UVs', () => {
    const wall = WallNode.parse({
      id: 'wall_uv-world-metric',
      start: [10, 20],
      end: [14, 23],
      height: 2,
      thickness: 0.2,
      frontSide: 'interior',
      backSide: 'exterior',
      faceBands: { enabled: true, count: 2, lowerHeight: 1 },
      finishRegions: [
        {
          id: 'uv-left',
          side: 'interior',
          start: 0,
          end: 0.5,
          slots: { interior: 'library:uv-left' },
        },
        {
          id: 'uv-right',
          side: 'interior',
          start: 0.5,
          end: 1,
          slots: { interior: 'library:uv-right' },
        },
      ],
    })
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
    const wallWorldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(10, 1.25, 20),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(3, 4)),
      new THREE.Vector3(1, 1, 1),
    )
    const projected = applyWorldPlanarWallUVs(geometry, wallWorldMatrix)

    try {
      const position = projected.getAttribute('position')
      const normal = projected.getAttribute('normal')
      const uv = projected.getAttribute('uv')
      const uv2 = projected.getAttribute('uv2')
      expect(position).toBeDefined()
      expect(normal).toBeDefined()
      expect(uv).toBeDefined()
      expect(uv2).toBeDefined()
      if (!position || !normal || !uv || !uv2) return

      const localPoint = (index: number) => new THREE.Vector3().fromBufferAttribute(position, index)
      const worldPoint = (index: number) => localPoint(index).applyMatrix4(wallWorldMatrix)
      const groupMaterialAt = (index: number) =>
        projected.groups.find((group) => index >= group.start && index < group.start + group.count)
          ?.materialIndex ?? 0
      const sideIndices = (side: -1 | 1) =>
        Array.from({ length: position.count }, (_, index) => index).filter((index) => {
          const vertexNormal = new THREE.Vector3().fromBufferAttribute(normal, index)
          return (
            Math.abs(vertexNormal.x) < 1e-5 &&
            Math.abs(vertexNormal.y) < 1e-5 &&
            vertexNormal.z * side > 0.99
          )
        })
      const verticalPair = (indices: number[]) => {
        for (const lowIndex of indices) {
          const low = localPoint(lowIndex)
          if (Math.abs(low.y) > 1e-5) continue
          const highIndex = indices.find((candidate) => {
            const high = localPoint(candidate)
            return (
              Math.abs(high.x - low.x) < 1e-5 &&
              Math.abs(high.z - low.z) < 1e-5 &&
              Math.abs(high.y - low.y - 1) < 1e-5
            )
          })
          if (highIndex !== undefined) return [lowIndex, highIndex] as const
        }
        return undefined
      }

      const sideVerticalDeltas = ([-1, 1] as const).map((side) => {
        const indices = sideIndices(side)
        expect(indices.length).toBeGreaterThan(0)
        const pair = verticalPair(indices)
        expect(pair).toBeDefined()
        if (!pair) return Number.NaN
        const [lowIndex, highIndex] = pair
        for (const index of pair) {
          const world = worldPoint(index)
          expect(uv.getX(index)).toBeCloseTo(side * world.x, 5)
          expect(uv.getY(index)).toBeCloseTo(1 - world.y, 5)
        }
        return uv.getY(highIndex) - uv.getY(lowIndex)
      })
      expect(Math.abs(sideVerticalDeltas[0]!)).toBeCloseTo(1, 5)
      expect(Math.abs(sideVerticalDeltas[1]!)).toBeCloseTo(1, 5)
      expect(Math.abs(sideVerticalDeltas[0]!)).toBeCloseTo(Math.abs(sideVerticalDeltas[1]!), 5)

      for (const side of [-1, 1] as const) {
        const seamGroups = new Map<string, number[]>()
        for (const index of sideIndices(side)) {
          const local = localPoint(index)
          if (Math.abs(local.x - 2.5) > 1e-5) continue
          const key = [local.x, local.y, local.z].map((value) => value.toFixed(5)).join(':')
          const existing = seamGroups.get(key) ?? []
          existing.push(index)
          seamGroups.set(key, existing)
        }
        const seam = [...seamGroups.values()].find(
          (indices) => new Set(indices.map(groupMaterialAt)).size > 1,
        )
        expect(seam).toBeDefined()
        if (!seam) continue
        const first = seam[0]!
        for (const index of seam) {
          expect(uv.getX(index)).toBeCloseTo(uv.getX(first), 5)
          expect(uv.getY(index)).toBeCloseTo(uv.getY(first), 5)
          expect(uv2.getX(index)).toBeCloseTo(uv.getX(index), 5)
          expect(uv2.getY(index)).toBeCloseTo(uv.getY(index), 5)
        }
      }

      const topIndex = Array.from({ length: position.count }, (_, index) => index).find((index) => {
        const vertexNormal = new THREE.Vector3().fromBufferAttribute(normal, index)
        return vertexNormal.y > 0.99
      })
      expect(topIndex).toBeDefined()
      if (topIndex === undefined) return
      const topWorld = worldPoint(topIndex)
      expect(uv.getX(topIndex)).toBeCloseTo(topWorld.x, 5)
      expect(uv.getY(topIndex)).toBeCloseTo(topWorld.z, 5)
      expect(Array.from(uv2.array)).toEqual(Array.from(uv.array))
    } finally {
      projected.dispose()
    }
  })
})

describe('wall material cache transitions', () => {
  test('keeps old region geometry material indices valid when a finish is removed', () => {
    clearMaterialCache()

    const regionWall = WallNode.parse({
      id: 'wall_material-cardinality-transition',
      start: [0, 0],
      end: [4, 0],
      finishRegions: [
        {
          id: 'transition-region',
          side: 'interior',
          start: 0,
          end: 1,
          slots: { interior: 'library:transition-region' },
        },
      ],
    })
    const baseWall = WallNode.parse({
      ...regionWall,
      finishRegions: [],
      slots: { interior: 'library:transition-whole' },
    })
    const oldGeometry = generateExtrudedWall(regionWall, [], calculateLevelMiters([regionWall]))
    const newGeometry = generateExtrudedWall(baseWall, [], calculateLevelMiters([baseWall]))

    try {
      const oldMaterials = getMaterialsForWall(regionWall)
      const newMaterials = getMaterialsForWall(baseWall)
      expect(oldMaterials.visible.length).toBe(12)
      expect(newMaterials.visible.length).toBeGreaterThanOrEqual(oldMaterials.visible.length)

      for (const group of oldGeometry.groups) {
        expect(newMaterials.visible[group.materialIndex ?? 0]).toBeDefined()
      }
      for (const group of newGeometry.groups) {
        expect(newMaterials.visible[group.materialIndex ?? 0]).toBeDefined()
      }

      const mesh = new THREE.Mesh(oldGeometry, newMaterials.visible)
      mesh.updateMatrixWorld(true)
      const raycaster = new THREE.Raycaster(new THREE.Vector3(2, 1, 2), new THREE.Vector3(0, 0, -1))
      let intersections: THREE.Intersection[] = []
      expect(() => {
        intersections = raycaster.intersectObject(mesh)
      }).not.toThrow()
      expect(intersections.length).toBeGreaterThan(0)

      mesh.geometry = newGeometry
      mesh.updateMatrixWorld(true)
      intersections = []
      expect(() => {
        intersections = raycaster.intersectObject(mesh)
      }).not.toThrow()
      expect(intersections.length).toBeGreaterThan(0)
    } finally {
      oldGeometry.dispose()
      newGeometry.dispose()
      clearMaterialCache()
    }
  })

  test('changes textures-off hashes and preserves cardinality across add/remove', () => {
    clearMaterialCache()

    const wallWithoutRegion = WallNode.parse({
      id: 'wall_material-cardinality-textures-off',
      start: [0, 0],
      end: [4, 0],
    })
    const wallWithRegion = WallNode.parse({
      ...wallWithoutRegion,
      finishRegions: [
        {
          id: 'textures-off-region',
          side: 'interior',
          start: 0,
          end: 1,
          slots: { interior: 'library:textures-off-region' },
        },
      ],
    })

    try {
      const first = getMaterialsForWall(wallWithoutRegion, 'rendered', false)
      const withRegion = getMaterialsForWall(wallWithRegion, 'rendered', false)
      const removedAgain = getMaterialsForWall(wallWithoutRegion, 'rendered', false)

      expect(withRegion.materialHash).not.toBe(first.materialHash)
      expect(first.visible.length).toBe(11)
      expect(withRegion.visible.length).toBe(12)
      expect(removedAgain.visible.length).toBe(12)
      expect(removedAgain.invisible.length).toBe(withRegion.invisible.length)
      expect(removedAgain.translucent.length).toBe(withRegion.translucent.length)
    } finally {
      clearMaterialCache()
    }
  })
})

describe('wall region material texture propagation', () => {
  test('attaches a cold scene KTX2 texture to the shared region material', async () => {
    clearMaterialCache()
    ensureKtx2LoaderReady()
    const compressedTexture = makeCompressedTexture()
    const loadAsync = spyOn(ktx2Loader, 'loadAsync').mockImplementation(() =>
      Promise.resolve(compressedTexture),
    )

    const sceneId = 'mat_wall-region-scene'
    const sceneUrl = 'https://assets.example.com/wall-region-scene.ktx2'
    const sceneMaterials = {
      [sceneId]: {
        id: sceneId,
        name: 'Wall region scene material',
        material: sceneKtx2Material(sceneUrl),
      },
    } as Record<`mat_${string}`, SceneMaterial>
    const wall = WallNode.parse({
      id: 'wall_material-scene-cold-region',
      start: [0, 0],
      end: [4, 0],
      finishRegions: [
        {
          id: 'scene-cold-region',
          side: 'interior',
          start: 0,
          end: 1,
          slots: { interior: `scene:${sceneId}` },
        },
      ],
    })

    try {
      const plan = getWallRegionMaterialPlan(wall)
      const materials = getMaterialsForWall(
        wall,
        'rendered',
        true,
        'clay',
        undefined,
        sceneMaterials,
      )
      const regionMaterial = materials.visible[plan[0]!.index] as THREE.Material & {
        map?: THREE.Texture | null
      }
      expect(regionMaterial).toBeDefined()
      expect(regionMaterial.map).toBeNull()

      await flushTextureLoad()

      expect(
        loadAsync.mock.calls.some((call: unknown[]) =>
          String(call[0]).includes('wall-region-scene.ktx2'),
        ),
      ).toBe(true)
      expect(regionMaterial.map).toBe(compressedTexture)
      expect(getMaterialsForWall(wall, 'rendered', true, 'clay', undefined, sceneMaterials)).toBe(
        materials,
      )
      expect(materials.visible[plan[0]!.index]).toBe(regionMaterial)
    } finally {
      clearMaterialCache()
      loadAsync.mockRestore()
    }
  })

  test('attaches a cold library KTX2 texture to the shared region material', async () => {
    clearMaterialCache()
    ensureKtx2LoaderReady()
    const compressedTexture = makeCompressedTexture()
    const loadAsync = spyOn(ktx2Loader, 'loadAsync').mockImplementation(() =>
      Promise.resolve(compressedTexture),
    )
    const wall = WallNode.parse({
      id: 'wall_material-library-cold-region',
      start: [0, 0],
      end: [4, 0],
      finishRegions: [
        {
          id: 'library-cold-region',
          side: 'interior',
          start: 0,
          end: 1,
          slots: { interior: 'library:concrete-polished' },
        },
      ],
    })

    try {
      const plan = getWallRegionMaterialPlan(wall)
      const materials = getMaterialsForWall(wall)
      const regionMaterial = materials.visible[plan[0]!.index] as THREE.Material & {
        map?: THREE.Texture | null
      }
      expect(regionMaterial).toBeDefined()
      expect(regionMaterial.map).toBeNull()

      await flushTextureLoad()

      expect(
        loadAsync.mock.calls.some((call: unknown[]) =>
          String(call[0]).includes('concrete_polished_basecolor_512.ktx2'),
        ),
      ).toBe(true)
      expect(regionMaterial.map).toBeInstanceOf(THREE.CompressedTexture)
      const sharedPresetMaterial = createMaterialFromPresetRef('library:concrete-polished') as
        | (THREE.Material & { map?: THREE.Texture | null })
        | null
      expect(sharedPresetMaterial).toBe(regionMaterial)
      const actualMap = regionMaterial.map as THREE.CompressedTexture | null | undefined
      expect(actualMap?.mipmaps[0]?.data).toBe(compressedTexture.mipmaps[0]?.data)
      expect(materials.visible[plan[0]!.index]).toBe(regionMaterial)
      expect(getMaterialsForWall(wall)).toBe(materials)
    } finally {
      clearMaterialCache()
      loadAsync.mockRestore()
    }
  })
})
