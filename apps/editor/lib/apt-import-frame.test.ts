import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  clearSceneHistory,
  GuideNode,
  initSpaceDetectionSync,
  LevelNode,
  runAsSingleSceneHistoryStep,
  SlabNode,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import {
  aptImageTransform,
  findAptDerivedSurfaceIdsForLevel,
  findAptGuideForLevel,
  getAptGuideImportFrame,
  getAptGuideTransformError,
  isAptVectorNodeForLevel,
  matchesAptPlan,
} from './apt-import-frame'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const baseGuide = GuideNode.parse({
  id: 'guide_active',
  parentId: 'level_active',
  url: 'asset://plan',
  metadata: { apartmentId: 'apt-a', planId: 'plan-1' },
  position: [2, 0, 3],
  rotation: [0, 0.25, 0],
  scale: 1.5,
})

describe('apartment import frame', () => {
  test('matches legacy plan metadata and keeps vector replacement level-scoped', () => {
    const legacyGuide = GuideNode.parse({
      id: 'guide_legacy',
      parentId: 'level_active',
      url: 'asset://plan',
      metadata: { planId: 'plan-1' },
    })
    const otherLevel = ZoneNode.parse({
      id: 'zone_other',
      parentId: 'level_other',
      name: 'other',
      polygon: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      metadata: { apartmentId: 'apt-a', planId: 'plan-1', source: 'apt-vector' },
    })
    const activeRoot = ZoneNode.parse({
      id: 'zone_active',
      parentId: 'level_active',
      name: 'active',
      polygon: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      metadata: { apartmentId: 'apt-a', planId: 'plan-1', source: 'apt-vector' },
    })
    const nodes = Object.fromEntries(
      [baseGuide, legacyGuide, otherLevel, activeRoot].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    expect(findAptGuideForLevel(nodes, 'level_active', 'apt-a', 'plan-1')?.id).toBe(baseGuide.id)
    expect(isAptVectorNodeForLevel(activeRoot, 'level_active', 'apt-a', 'plan-1')).toBe(true)
    expect(isAptVectorNodeForLevel(otherLevel, 'level_active', 'apt-a', 'plan-1')).toBe(false)
    expect(matchesAptPlan(legacyGuide, 'different-apartment', 'plan-1')).toBe(true)
  })

  test('rejects unsupported transforms before an import and preserves planar frame', () => {
    expect(getAptGuideTransformError(baseGuide)).toBeNull()
    expect(getAptGuideImportFrame(baseGuide)).toEqual({
      position: [2, 0, 3],
      rotationY: 0.25,
      scale: 1.5,
    })
    expect(getAptGuideTransformError({ ...baseGuide, rotation: [0.01, 0, 0] })).toContain(
      'X/Z 기울기',
    )
    expect(
      getAptGuideTransformError({
        ...baseGuide,
        perspectiveCorners: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      }),
    ).toContain('원근')
    expect(aptImageTransform({ flipX: true, flipY: false })).toBe('scaleX(-1) scaleY(1)')
  })

  test('reimport removes only old derived surfaces and undoes in one step', () => {
    const levelId = 'level_import_history'
    const apartmentId = 'apt-a'
    const planId = 'plan-1'
    const source = { source: 'apt-vector', apartmentId, planId }
    const oldWalls = [
      WallNode.parse({
        id: 'wall_old_bottom',
        parentId: levelId,
        start: [0, 0],
        end: [4, 0],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_old_right',
        parentId: levelId,
        start: [4, 0],
        end: [4, 3],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_old_top',
        parentId: levelId,
        start: [4, 3],
        end: [0, 3],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_manual_connected',
        parentId: levelId,
        start: [0, 3],
        end: [0, 0],
        metadata: { source: 'manual' },
      }),
    ]
    const newWalls = [
      WallNode.parse({
        id: 'wall_new_left',
        parentId: levelId,
        start: [20, 10],
        end: [20, 13],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_new_top',
        parentId: levelId,
        start: [20, 13],
        end: [24, 13],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_new_right',
        parentId: levelId,
        start: [24, 13],
        end: [24, 10],
        metadata: source,
      }),
      WallNode.parse({
        id: 'wall_new_bottom',
        parentId: levelId,
        start: [24, 10],
        end: [20, 10],
        metadata: source,
      }),
    ]
    const manualConnectedWall = oldWalls[3]!
    const oldSlab = SlabNode.parse({
      id: 'slab_old_derived',
      parentId: levelId,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const oldCeiling = CeilingNode.parse({
      id: 'ceiling_old_derived',
      parentId: levelId,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const manualSlab = SlabNode.parse({
      id: 'slab_manual',
      parentId: levelId,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: false,
    })
    const manualCeiling = CeilingNode.parse({
      id: 'ceiling_manual',
      parentId: levelId,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: false,
    })
    const guide = GuideNode.parse({
      id: 'guide_import_history',
      parentId: levelId,
      url: 'asset://plan',
      metadata: { apartmentId, planId },
    })
    const level = LevelNode.parse({
      id: levelId,
      children: [...oldWalls, oldSlab, oldCeiling, manualSlab, manualCeiling, guide].map(
        (node) => node.id,
      ),
    })
    const building = BuildingNode.parse({ id: 'building_import_history', children: [levelId] })
    const initialNodes = Object.fromEntries(
      [building, level, ...oldWalls, oldSlab, oldCeiling, manualSlab, manualCeiling, guide].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>
    const manualConnectedWallBefore = initialNodes[manualConnectedWall.id]
    useScene.setState({
      nodes: initialNodes,
      rootNodeIds: [building.id],
      collections: {},
      materials: {},
      installedPlugins: [],
      readOnly: false,
    })
    clearSceneHistory()
    const editorState = {
      spaces: {} as Record<string, unknown>,
      setSpaces(next: Record<string, unknown>) {
        this.spaces = next
      },
    }
    const stopSpaceDetection = initSpaceDetectionSync(useScene, {
      getState: () => editorState,
    })

    try {
      const before = useScene.getState().nodes
      const stale = Object.values(before)
        .filter((node) => isAptVectorNodeForLevel(node, levelId, apartmentId, planId))
        .map((node) => node.id)
      const staleSurfaces = findAptDerivedSurfaceIdsForLevel(before, levelId, apartmentId, planId)
      expect(staleSurfaces).toEqual([oldSlab.id, oldCeiling.id])

      runAsSingleSceneHistoryStep(useScene, () => {
        useScene.getState().applyNodeChanges({
          delete: [...stale, ...staleSurfaces],
          update: [
            {
              id: guide.id,
              data: { flipX: true, flipY: false },
            },
          ],
          create: newWalls.map((wall) => ({ node: wall, parentId: levelId })),
        })
      })

      const current = useScene.getState().nodes
      expect(current[oldSlab.id]).toBeUndefined()
      expect(current[oldCeiling.id]).toBeUndefined()
      expect(current[manualSlab.id]).toEqual(manualSlab)
      expect(current[manualCeiling.id]).toEqual(manualCeiling)
      expect(current[manualConnectedWall.id]).toEqual(manualConnectedWallBefore)
      const autoSlabs = Object.values(current).filter(
        (node) => node.type === 'slab' && node.autoFromWalls === true,
      )
      const autoCeilings = Object.values(current).filter(
        (node) => node.type === 'ceiling' && node.autoFromWalls === true,
      )
      expect(autoSlabs).toHaveLength(1)
      expect(autoCeilings).toHaveLength(1)
      expect(autoSlabs[0]?.type === 'slab' && autoSlabs[0].polygon[0]?.[0]).toBeGreaterThan(10)
      expect(
        autoCeilings[0]?.type === 'ceiling' && autoCeilings[0].polygon[0]?.[0],
      ).toBeGreaterThan(10)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)

      const importedNodes = useScene.getState().nodes
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(initialNodes)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useScene.temporal.getState().futureStates).toHaveLength(1)

      useScene.temporal.getState().redo()
      expect(useScene.getState().nodes).toEqual(importedNodes)
      expect(useScene.temporal.getState().futureStates).toHaveLength(0)
    } finally {
      stopSpaceDetection()
      clearSceneHistory()
    }
  })
})
