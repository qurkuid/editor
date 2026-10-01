import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  buildAxisGuideStretchPlan,
  ConstructionGuideNode,
  initSpaceDetectionSync,
  LevelNode,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import useEditor from '../../store/use-editor'
import {
  applyConstructionGuideStretchPlan,
  constructionGuideAxis,
} from './construction-guide-stretch-controls'

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

function squareScene() {
  const level = LevelNode.parse({ id: 'level_stretch_runtime', children: [] })
  const guide = ConstructionGuideNode.parse({
    id: 'cguide_stretch_runtime',
    parentId: level.id,
    origin: [0, 0],
    direction: [0, 1],
  })
  const walls = [
    WallNode.parse({
      id: 'wall_stretch_bottom',
      parentId: level.id,
      start: [-2, -2],
      end: [2, -2],
    }),
    WallNode.parse({
      id: 'wall_stretch_right',
      parentId: level.id,
      start: [2, -2],
      end: [2, 2],
    }),
    WallNode.parse({
      id: 'wall_stretch_top',
      parentId: level.id,
      start: [2, 2],
      end: [-2, 2],
    }),
    WallNode.parse({
      id: 'wall_stretch_left',
      parentId: level.id,
      start: [-2, 2],
      end: [-2, -2],
    }),
  ]
  const zone = ZoneNode.parse({
    id: 'zone_stretch_manual',
    parentId: level.id,
    name: 'Manual room',
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
    autoFromWalls: false,
    spaceRole: 'room',
    metadata: { source: 'manual', boundaryNeedsReview: false },
  })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [level.id]: LevelNode.parse({
      ...level,
      children: [guide.id, zone.id, ...walls.map((wall) => wall.id)],
    }),
    [guide.id]: guide,
    [zone.id]: zone,
    ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
  }
  return { nodes, level, guide, walls, zone }
}

beforeEach(() => {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0)) as unknown as typeof requestAnimationFrame
  }
  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = ((handle: number) =>
      clearTimeout(handle)) as unknown as typeof cancelAnimationFrame
  }
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useEditor.setState({ spaces: {} })
})

afterEach(() => {
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
  } as never)
  useEditor.setState({ spaces: {} })
  if (!originalRequestAnimationFrame) Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (!originalCancelAnimationFrame) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

describe('construction-guide-stretch-controls', () => {
  test('classifies axis-aligned directions after normalization', () => {
    expect(constructionGuideAxis([1e9, 1])).toBe('z')
    expect(constructionGuideAxis([1, 1e9])).toBe('x')
    expect(constructionGuideAxis([1, 1])).toBeNull()
  })

  test('pauses reactive room sync and keeps one undoable scene update', () => {
    const scene = squareScene()
    useScene.setState({ nodes: scene.nodes, rootNodeIds: [scene.level.id] } as never)
    const stopDetection = initSpaceDetectionSync(useScene, useEditor)
    const beforeNodes = useScene.getState().nodes
    const beforeZone = beforeNodes[scene.zone.id]!
    const plan = buildAxisGuideStretchPlan(beforeNodes, {
      guideId: scene.guide.id,
      side: 1,
      distance: 1,
    })
    const beforePastCount = useScene.temporal.getState().pastStates.length

    try {
      applyConstructionGuideStretchPlan(plan, scene.level.id)

      const afterNodes = useScene.getState().nodes
      expect(Object.keys(afterNodes)).toHaveLength(Object.keys(beforeNodes).length)
      expect(afterNodes[scene.zone.id]).toMatchObject({
        polygon: [
          [-2, -2],
          [3, -2],
          [3, 2],
          [-2, 2],
        ],
        metadata: beforeZone.metadata,
      })
      expect(
        Object.values(useEditor.getState().spaces).some(
          (space) => space.levelId === scene.level.id,
        ),
      ).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(beforePastCount + 1)

      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[scene.zone.id]).toEqual(beforeZone)
      expect(Object.keys(useScene.getState().nodes)).toHaveLength(Object.keys(beforeNodes).length)

      useScene.temporal.getState().redo()
      expect(useScene.getState().nodes[scene.zone.id]).toMatchObject({
        polygon: [
          [-2, -2],
          [3, -2],
          [3, 2],
          [-2, 2],
        ],
        metadata: beforeZone.metadata,
      })
      expect(Object.keys(useScene.getState().nodes)).toHaveLength(Object.keys(beforeNodes).length)
    } finally {
      stopDetection()
    }
  })
})
