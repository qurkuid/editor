import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BodyNode,
  BuildingNode,
  createRectangleBody,
  LevelNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  type WallNode as WallNodeType,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from './use-editor'
import useInteractionScope from './use-interaction-scope'
import usePivotRotate, { PIVOT_ROTATE_TOOL } from './use-pivot-rotate'

// Core's `updateNodes` schedules dirty-flush work on rAF; headless bun has none.
globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
  setTimeout(() => callback(0), 0) as unknown as number) as typeof requestAnimationFrame
globalThis.cancelAnimationFrame ??= ((id: number) =>
  clearTimeout(id)) as typeof cancelAnimationFrame

let level: ReturnType<typeof LevelNode.parse>
let wall: WallNodeType

beforeEach(() => {
  level = LevelNode.parse({ level: 0, children: [] })
  let building = BuildingNode.parse({ children: [level.id] })
  const site = SiteNode.parse({ children: [building.id] })
  level = LevelNode.parse({ ...level, parentId: building.id })
  building = BuildingNode.parse({ ...building, parentId: site.id })
  wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [2, 0] })
  level = LevelNode.parse({ ...level, children: [wall.id] })

  useScene.setState({
    nodes: {
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
      [wall.id]: wall,
    },
    rootNodeIds: [site.id],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useViewer.setState({
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [wall.id],
    },
  } as never)
})

afterEach(() => {
  usePivotRotate.getState().cancel()
})

describe('pivot rotate gesture', () => {
  test('walks pivot → reference → angle and commits the rotated wall', () => {
    const store = usePivotRotate.getState()
    expect(store.start([wall.id])).toBe(true)
    expect(usePivotRotate.getState().stage).toBe('pivot')
    expect(useEditor.getState().tool).toBe(PIVOT_ROTATE_TOOL)
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'drafting',
      tool: PIVOT_ROTATE_TOOL,
    })

    store.placePoint({ x: 0, z: 0 })
    expect(usePivotRotate.getState().stage).toBe('reference')
    store.placePoint({ x: 1, z: 0 })
    expect(usePivotRotate.getState().stage).toBe('angle')

    // Sweep 90° in the x→z sense (free: no snap rounding artifacts).
    store.updateCursor({ x: 0, z: 1 }, true)
    expect(usePivotRotate.getState().delta).toBeCloseTo(Math.PI / 2)

    store.commit()
    const rotated = useScene.getState().nodes[wall.id] as WallNodeType
    expect(rotated.start[0]).toBeCloseTo(0)
    expect(rotated.start[1]).toBeCloseTo(0)
    expect(rotated.end[0]).toBeCloseTo(0)
    expect(rotated.end[1]).toBeCloseTo(2)

    expect(usePivotRotate.getState().stage).toBe('idle')
    expect(useEditor.getState().mode).toBe('select')
    expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
    expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
    // The whole gesture is one undo step.
    expect(useScene.temporal.getState().pastStates.length).toBe(1)
  })

  test('cancel reverts the preview and restores the selection', () => {
    const store = usePivotRotate.getState()
    expect(store.start([wall.id])).toBe(true)
    store.placePoint({ x: 0, z: 0 })
    store.placePoint({ x: 1, z: 0 })
    store.updateCursor({ x: 0, z: 1 }, true)
    store.cancel()

    const unchanged = useScene.getState().nodes[wall.id] as WallNodeType
    expect(unchanged.end[0]).toBeCloseTo(2)
    expect(unchanged.end[1]).toBeCloseTo(0)
    expect(usePivotRotate.getState().stage).toBe('idle')
    expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
    expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates.length).toBe(0)
  })

  test('rotates only the selected Body feature and commits one undo step', () => {
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 1 }),
      id: 'body_pivot_feature',
      parentId: level.id,
    })
    useScene.setState(
      (state) =>
        ({
          nodes: {
            ...state.nodes,
            [body.id]: body,
            [level.id]: LevelNode.parse({ ...level, children: [...level.children, body.id] }),
          },
        }) as never,
    )
    useScene.temporal.getState().clear()
    const store = usePivotRotate.getState()
    expect(
      store.start([body.id], {
        [body.id]: { kind: 'edge', featureId: 'edge:0', autofold: false },
      }),
    ).toBe(true)
    store.placePoint({ x: 0, z: 0 })
    store.placePoint({ x: 1, z: 0 })
    store.updateCursor({ x: 0, z: 1 }, true)
    store.commit()

    const rotated = BodyNode.parse(useScene.getState().nodes[body.id])
    expect(rotated.vertices.find(({ id }) => id === 'vertex:1')?.position).toEqual([0, 0, 2])
    expect(rotated.vertices.find(({ id }) => id === 'vertex:2')?.position).toEqual([2, 0, 1])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('rejects a reference point on top of the pivot', () => {
    const store = usePivotRotate.getState()
    expect(store.start([wall.id])).toBe(true)
    store.placePoint({ x: 0, z: 0 })
    store.placePoint({ x: 0.001, z: 0 })
    expect(usePivotRotate.getState().stage).toBe('reference')
  })

  test('does not start with an empty selection', () => {
    expect(usePivotRotate.getState().start([])).toBe(false)
    expect(usePivotRotate.getState().stage).toBe('idle')
  })

  test('keeps the selection highlighted for the whole gesture', () => {
    expect(usePivotRotate.getState().start([wall.id])).toBe(true)
    expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
  })

  test('locks walls to the y axis but lets vec3 items use x/z', () => {
    const item = {
      id: 'item_pivot_test',
      type: 'item',
      parentId: level.id,
      position: [2, 0, 0],
      rotation: [0, 0, 0],
    }
    useScene.setState((state) => ({ nodes: { ...state.nodes, [item.id]: item } }) as never)

    const store = usePivotRotate.getState()
    expect(store.start([wall.id])).toBe(true)
    expect(usePivotRotate.getState().horizontalAxesAllowed).toBe(false)
    store.setAxis('x')
    expect(usePivotRotate.getState().axis).toBe('y')
    store.cancel()

    expect(store.start([item.id])).toBe(true)
    expect(usePivotRotate.getState().horizontalAxesAllowed).toBe(true)
    store.setAxis('z')
    expect(usePivotRotate.getState().axis).toBe('z')

    // Sweep -π/2 (screen-CCW +90°) about z: the item orbits the pivot up to y=2.
    store.placePoint({ x: 0, z: 0 })
    store.placePoint({ x: 1, z: 0 })
    store.updateCursor({ x: 0, z: -1 }, true)
    usePivotRotate.getState().commit()
    const rotated = useScene.getState().nodes[item.id as never] as unknown as {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    expect(rotated.position[1]).toBeCloseTo(2)
    expect(rotated.position[0]).toBeCloseTo(0)
  })
})
