import { beforeEach, describe, expect, test } from 'bun:test'
import { clearSceneHistory, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Ray, Vector3 } from 'three'
import { resolveWallRole, wallPaint } from './paint'

const baseWall: WallNode = {
  object: 'node',
  id: 'wall_test',
  type: 'wall',
  parentId: null,
  visible: true,
  metadata: {},
  children: [],
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  thickness: 0.1,
  faceBands: { enabled: true, count: 3, lowerHeight: 0.9, middleHeight: 0.12, upperHeight: 0.61 },
  frontSide: 'interior',
  backSide: 'exterior',
}

beforeEach(() => {
  useScene.setState({ nodes: {}, materials: {} } as never)
  clearSceneHistory()
})

describe('resolveWallRole', () => {
  test('maps one wall face to lower, middle, and upper band slots by hit height', () => {
    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('lowerInterior')

    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.95, 0.05],
      }),
    ).toBe('middleInterior')

    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.3, 0.05],
      }),
    ).toBe('upperInterior')
  })

  test('uses adjusted band heights from the wall config', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: true,
        count: 3,
        lowerHeight: 1.2,
        middleHeight: 0.2,
        upperHeight: 0.61,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 2,
        normal: [0, 0, -1],
        localPosition: [1, 1.1, -0.05],
      }),
    ).toBe('lowerExterior')

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 2,
        normal: [0, 0, -1],
        localPosition: [1, 1.3, -0.05],
      }),
    ).toBe('middleExterior')
  })

  test('falls back to whole-side roles when bands are disabled', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.9,
        middleHeight: 0.12,
        upperHeight: 0.61,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('interior')
  })

  test('maps four wall bands to lower, middle, upper, and top slots', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: true,
        count: 4,
        lowerHeight: 0.5,
        middleHeight: 0.5,
        upperHeight: 0.5,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('lowerInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.7, 0.05],
      }),
    ).toBe('middleInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.2, 0.05],
      }),
    ).toBe('upperInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.8, 0.05],
      }),
    ).toBe('topInterior')
  })

  test('falls back to whole-side roles by default', () => {
    const { faceBands, ...wall } = baseWall
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('interior')
  })

  test('uses direct trim slot hits and exposes trim default materials', () => {
    expect(
      resolveWallRole({
        node: baseWall,
        hitObject: { userData: { slotId: 'crownInterior' } },
        materialIndex: null,
        normal: undefined,
        localPosition: undefined,
      }),
    ).toBe('crownInterior')

    expect(
      wallPaint.getEffectiveMaterial?.({
        node: baseWall,
        role: 'crownInterior',
        nodes: { [baseWall.id]: baseWall },
      }),
    ).toEqual({ material: undefined, materialPreset: 'library:preset-white' })
  })

  test('prefers trim child ray hits over the broad wall face role', () => {
    const root = new Object3D()
    const trim = new Mesh(new BoxGeometry(1, 1, 0.08), new MeshBasicMaterial())
    trim.userData.slotId = 'crownInterior'
    root.add(trim)
    root.updateMatrixWorld(true)
    sceneRegistry.nodes.set(baseWall.id, root)

    try {
      expect(
        resolveWallRole({
          node: baseWall,
          hitObject: { userData: {} },
          materialIndex: 1,
          normal: [0, 0, 1],
          localPosition: [0, 1, 0.05],
          ray: new Ray(new Vector3(0, 0, 1), new Vector3(0, 0, -1)),
        }),
      ).toBe('crownInterior')
    } finally {
      sceneRegistry.nodes.delete(baseWall.id)
      trim.geometry.dispose()
      ;(trim.material as MeshBasicMaterial).dispose()
    }
  })

  test('resolves appended finish-region material indexes to their semantic band role', () => {
    const wall = {
      ...baseWall,
      finishRegions: [
        {
          id: 'region',
          side: 'interior' as const,
          start: 0.2,
          end: 0.4,
          slots: { upperInterior: 'library:region' },
        },
      ],
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 11,
        normal: [0, 0, 1],
        localPosition: [1, 1.3, 0.05],
      }),
    ).toBe('upperInterior')
  })
})

describe('wallPaint finish-region clearing', () => {
  test('updates the base role and removes only matching same-side region overrides in one undo', () => {
    const wall: WallNode = {
      ...baseWall,
      slots: {
        interior: 'library:old-interior',
        exterior: 'library:old-exterior',
        upperInterior: 'library:old-upper',
      },
      finishRegions: [
        {
          id: 'keep-other-role',
          side: 'interior',
          start: 0.1,
          end: 0.3,
          slots: {
            upperInterior: 'library:remove',
            middleInterior: 'library:keep',
          },
        },
        {
          id: 'remove-entire-region',
          side: 'interior',
          start: 0.4,
          end: 0.6,
          slots: { upperInterior: 'library:remove-too' },
        },
        {
          id: 'opposite-side',
          side: 'exterior',
          start: 0.1,
          end: 0.3,
          slots: { upperExterior: 'library:preserve' },
        },
      ],
    }
    useScene.setState({ nodes: { [wall.id]: wall }, materials: {} } as never)
    clearSceneHistory()

    wallPaint.commit?.({
      node: wall,
      role: 'upperInterior',
      material: { properties: { color: '#336699' } },
      materialPreset: undefined,
    })

    const stored = useScene.getState().nodes[wall.id] as WallNode
    const upperRef = stored.slots?.upperInterior
    expect(upperRef).toStartWith('scene:')
    expect(stored.slots).toMatchObject({
      exterior: 'library:old-exterior',
    })
    expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
    expect(stored.finishRegions).toEqual([
      {
        id: 'keep-other-role',
        side: 'interior',
        start: 0.1,
        end: 0.3,
        slots: { middleInterior: 'library:keep' },
      },
      {
        id: 'opposite-side',
        side: 'exterior',
        start: 0.1,
        end: 0.3,
        slots: { upperExterior: 'library:preserve' },
      },
    ])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[wall.id]).toEqual(wall)
  })

  test('previews the effective base and appended region slots before restoring the array', () => {
    const wall: WallNode = {
      ...baseWall,
      finishRegions: [
        {
          id: 'region',
          side: 'interior',
          start: 0.2,
          end: 0.4,
          slots: { upperInterior: 'library:region' },
        },
      ],
    }
    const materials = Array.from({ length: 12 }, () => new MeshBasicMaterial())
    const wallMesh = new Mesh(new BoxGeometry(1, 1, 0.1), materials)
    const root = new Object3D()
    root.add(wallMesh)
    sceneRegistry.nodes.set(wall.id, wallMesh)

    try {
      const restore = wallPaint.applyPreview?.({
        node: wall,
        role: 'upperInterior',
        material: { properties: { color: '#ff0000' } },
        materialPreset: undefined,
        root,
      })
      expect(restore).not.toBeNull()
      expect(wallMesh.material).toBeInstanceOf(Array)
      const preview = wallMesh.material as MeshBasicMaterial[]
      expect(preview[5]).not.toBe(materials[5])
      expect(preview[11]).not.toBe(materials[11])
      restore?.()
      expect(wallMesh.material).toBe(materials)
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      wallMesh.geometry.dispose()
      for (const material of materials) material.dispose()
    }
  })
})
