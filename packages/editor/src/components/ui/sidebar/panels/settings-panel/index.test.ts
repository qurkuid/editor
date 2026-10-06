import {
  BuildingNode,
  clearSceneHistory,
  initSpaceDetectionSync,
  isSpaceDetectionPaused,
  LevelNode,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import useEditor from '../../../../../store/use-editor'
import { applyBuildImport, resetEditorAfterSceneImport } from './index'

let requestAnimationFrameDescriptor: PropertyDescriptor | undefined
let cancelAnimationFrameDescriptor: PropertyDescriptor | undefined

beforeAll(() => {
  requestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'requestAnimationFrame',
  )
  cancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'cancelAnimationFrame',
  )
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: () => 0,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => undefined,
  })
})

afterAll(() => {
  if (requestAnimationFrameDescriptor) {
    Object.defineProperty(globalThis, 'requestAnimationFrame', requestAnimationFrameDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  }
  if (cancelAnimationFrameDescriptor) {
    Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelAnimationFrameDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  }
})

const importedSquare: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function importedScene() {
  const levelId = 'level_import_guard'
  const building = BuildingNode.parse({
    id: 'building_import_guard',
    children: [levelId],
  })
  const walls = [
    WallNode.parse({
      id: 'wall_import_guard_bottom',
      parentId: levelId,
      start: [0, 0],
      end: [4, 0],
    }),
    WallNode.parse({
      id: 'wall_import_guard_right',
      parentId: levelId,
      start: [4, 0],
      end: [4, 3],
    }),
    WallNode.parse({
      id: 'wall_import_guard_top',
      parentId: levelId,
      start: [4, 3],
      end: [0, 3],
    }),
    WallNode.parse({
      id: 'wall_import_guard_left',
      parentId: levelId,
      start: [0, 3],
      end: [0, 0],
    }),
  ]
  const zone = ZoneNode.parse({
    id: 'zone_import_guard',
    parentId: levelId,
    name: 'Imported Room',
    polygon: importedSquare,
    spaceRole: 'room',
    enclosureStatus: 'enclosed',
  })
  const level = LevelNode.parse({
    id: levelId,
    parentId: building.id,
    level: 0,
    height: 2.5,
    children: [...walls, zone].map((node) => node.id),
  })
  return {
    nodes: Object.fromEntries(
      [building, level, ...walls, zone].map((node) => [node.id, node]),
    ),
    rootNodeIds: [building.id],
    walls,
  }
}

describe('resetEditorAfterSceneImport', () => {
  test('returns the editor to selection mode after replacing the scene', () => {
    useEditor.getState().setPhase('structure')
    useEditor.getState().setMode('build')

    resetEditorAfterSceneImport()

    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })
})

describe('same-level build import', () => {
  test('keeps the validated graph intact while paused, then resumes wall detection', () => {
    const saved = useScene.getState()
    const imported = importedScene()
    const openSceneNodes = Object.fromEntries(
      Object.values(imported.nodes)
        .filter((node) => node.type !== 'zone' && node.id !== imported.walls[3]?.id)
        .map((node) => [node.id, node]),
    )
    const editorStore = {
      spaces: {} as Record<string, unknown>,
      setSpaces(next: Record<string, unknown>) {
        editorStore.spaces = next
      },
    }

    useScene.setState({
      nodes: openSceneNodes,
      rootNodeIds: [imported.nodes.building_import_guard!.id],
      collections: {},
      materials: {},
      installedPlugins: [],
      hasExplicitPluginInstallState: false,
      dirtyNodes: new Set(),
    } as never)
    clearSceneHistory()
    const stopDetection = initSpaceDetectionSync(useScene, {
      getState: () => editorStore,
    })

    try {
      applyBuildImport({
        nodes: imported.nodes,
        rootNodeIds: imported.rootNodeIds,
        collections: {},
        materials: {},
        installedPlugins: [],
      })

      expect(isSpaceDetectionPaused()).toBe(false)
      expect(useScene.getState().nodes).toEqual(imported.nodes)
      expect(
        Object.values(useScene.getState().nodes).filter(
          (node) => node.type === 'slab' || node.type === 'ceiling',
        ),
      ).toHaveLength(0)
      expect(useScene.getState().nodes.zone_import_guard).toEqual(imported.nodes.zone_import_guard)

      useScene.getState().updateNodes(
        imported.walls.map((wall) => ({ id: wall.id, data: { height: 2.4 } })),
      )

      expect(
        Object.values(useScene.getState().nodes).some(
          (node) => node.type === 'slab' && node.autoFromWalls,
        ),
      ).toBe(true)
    } finally {
      stopDetection()
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        installedPlugins: saved.installedPlugins,
        hasExplicitPluginInstallState: saved.hasExplicitPluginInstallState,
        dirtyNodes: saved.dirtyNodes,
      } as never)
      clearSceneHistory()
    }
  })
})
