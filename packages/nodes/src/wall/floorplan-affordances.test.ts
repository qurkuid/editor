import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  DoorNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { wallCurveAffordance, wallMoveEndpointAffordance } from './floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const modifiers = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
}

describe('wall center curve handle release', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useInteractionScope.getState().end()
  })

  test('weak endpoint inference releases freely, keeps connections, and honors Off and Shift', () => {
    const wall = WallNode.parse({ id: 'wall_weak', start: [0, 0], end: [4, 0.1] })
    const linked = WallNode.parse({ id: 'wall_linked', start: wall.end, end: [6, 3] })
    useScene.setState({ nodes: { [wall.id]: wall, [linked.id]: linked } })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    useEditor.setState({ gridSnapStep: 0.001 })
    useEditor.getState().setSnappingMode('wall', 'grid')
    useInteractionScope.getState().begin({
      kind: 'reshaping',
      nodeId: wall.id,
      reshape: 'endpoint',
      driver: 'tool',
    })
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'end' },
      initialPlanPoint: wall.end,
      gridSnapStep: 0.001,
    })
    session.apply({ planPoint: [4, 0.1], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([4, 0])
    expect(useLiveNodeOverrides.getState().get(linked.id)?.start).toEqual([4, 0])
    expect(useScene.getState().nodes[wall.id]).toEqual(wall)
    session.apply({ planPoint: [4, 0.2], modifiers: { ...modifiers, shiftKey: true } })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([4, 0])
    session.apply({ planPoint: [4, 0.2], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([4, 0.2])
    session.apply({ planPoint: [3.9, 4], modifiers })
    const diagonal = useLiveNodeOverrides.getState().get(wall.id)?.end as number[]
    expect(diagonal[0]).toBeCloseTo(diagonal[1]!, 12)
    useEditor.getState().setSnappingMode('wall', 'off')
    session.apply({ planPoint: [4, 0.1], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([4, 0.1])
    useEditor.getState().setSnappingMode('wall', 'grid')
    expect(session.keyDown?.('ArrowRight')).toBe(true)
    session.apply({ planPoint: [-4, 2], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
    expect(session.canCommit()).toBe(false)
    expect(session.keyDown?.('ArrowRight')).toBe(true)
    session.apply({ planPoint: [4, 0.1], modifiers })
    expect(session.canCommit()).toBe(true)
    session.commit?.()
    expect((useScene.getState().nodes[wall.id] as WallNode).end).toEqual([4, 0])
    expect((useScene.getState().nodes[linked.id] as WallNode).start).toEqual([4, 0])
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[wall.id]).toEqual(wall)
    expect(useScene.getState().nodes[linked.id]).toEqual(linked)
  })

  test('an existing endpoint wins over weak angle inference', () => {
    const wall = WallNode.parse({ id: 'wall_target', start: [0, 0], end: [2, 0.5] })
    const destination = WallNode.parse({ id: 'wall_dest', start: [4, 0.1], end: [5, 2] })
    useScene.setState({ nodes: { [wall.id]: wall, [destination.id]: destination } })
    useEditor.getState().setSnappingMode('wall', 'grid')
    useInteractionScope.getState().begin({
      kind: 'reshaping',
      nodeId: wall.id,
      reshape: 'endpoint',
      driver: 'tool',
    })
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'end' },
      initialPlanPoint: wall.end,
      gridSnapStep: 0.001,
    })
    session.apply({ planPoint: [4, 0.1], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual(destination.start)
  })

  test('uses same-level linked straight outer endpoints as a collinear junction datum', () => {
    const levelId = 'level_junction'
    const wall = WallNode.parse({
      id: 'wall_junction_main',
      parentId: levelId,
      start: [0, 4],
      end: [1.999, 4],
    })
    const lower = WallNode.parse({
      id: 'wall_junction_lower',
      parentId: levelId,
      start: wall.end,
      end: [2, 2],
    })
    const upper = WallNode.parse({
      id: 'wall_junction_upper',
      parentId: levelId,
      start: [2, 7],
      end: wall.end,
    })
    const otherLevel = WallNode.parse({
      id: 'wall_junction_other_level',
      parentId: 'level_other',
      start: wall.end,
      end: [2, 12],
    })
    useScene.setState({
      nodes: {
        [wall.id]: wall,
        [lower.id]: lower,
        [upper.id]: upper,
        [otherLevel.id]: otherLevel,
      },
    })
    useEditor.getState().setSnappingMode('wall', 'grid')
    useEditor.setState({ gridSnapStep: 0.001 })
    useInteractionScope.getState().begin({
      kind: 'reshaping',
      nodeId: wall.id,
      reshape: 'endpoint',
      driver: 'tool',
    })
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'end' },
      initialPlanPoint: wall.end,
      gridSnapStep: 0.001,
    })

    session.apply({ planPoint: [2.048, 4.421], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([2, 4.421])
    expect(useLiveNodeOverrides.getState().get(lower.id)?.start).toEqual([2, 4.421])
    expect(useLiveNodeOverrides.getState().get(upper.id)?.end).toEqual([2, 4.421])
    expect(useLiveNodeOverrides.getState().get(otherLevel.id)).toBeUndefined()

    session.apply({ planPoint: [2.048, 4.02], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([2, 4])

    session.apply({ planPoint: [2.12, 4.421], modifiers: { ...modifiers, altKey: true } })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([2.12, 4.421])
    expect(useLiveNodeOverrides.getState().get(lower.id)).toBeUndefined()
    expect(useLiveNodeOverrides.getState().get(upper.id)).toBeUndefined()
  })

  test('Shift preserves endpoint direction through preview, commit and undo', () => {
    const wall = WallNode.parse({ id: 'wall_shift', start: [2, 3], end: [2, 5] })
    useScene.setState({ nodes: { [wall.id]: wall } })
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    useEditor.setState({ gridSnapStep: 0.001 })
    useEditor.getState().setSnappingMode('wall', 'grid')
    useInteractionScope.getState().begin({
      kind: 'reshaping',
      nodeId: wall.id,
      reshape: 'endpoint',
      driver: 'tool',
    })
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'end' },
      initialPlanPoint: wall.end,
      gridSnapStep: 0.001,
    })
    session.apply({ planPoint: [8, 6.1234], modifiers: { ...modifiers, shiftKey: true } })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([2, 6.123])
    expect(useScene.getState().nodes[wall.id]).toEqual(wall)
    session.apply({ planPoint: [9, 4.2344], modifiers: { ...modifiers, shiftKey: true } })
    expect(session.canCommit()).toBe(true)
    session.commit?.()
    expect((useScene.getState().nodes[wall.id] as typeof wall).end).toEqual([2, 4.234])
    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[wall.id] as typeof wall).end).toEqual(wall.end)
    session.apply({ planPoint: [8, 7], modifiers })
    expect(useLiveNodeOverrides.getState().get(wall.id)?.end).toEqual([8, 7])
  })

  test('persists the previewed curve offset after commit clears the override', () => {
    const wall = WallNode.parse({
      id: 'wall_curve-release',
      parentId: null,
      start: [0, 0],
      end: [4, 0],
    })
    useScene.setState({ nodes: { [wall.id]: wall } as never })

    const session = wallCurveAffordance.start({
      node: wall,
      payload: { wallId: wall.id },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, 0],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 1], modifiers })

    expect((useScene.getState().nodes[wall.id] as typeof wall).curveOffset ?? 0).toBe(0)
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)?.curveOffset).not.toBe(0)

    expect(session.canCommit()).toBe(true)
    session.commit?.()

    expect((useScene.getState().nodes[wall.id] as typeof wall).curveOffset).not.toBe(0)
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)).toBeUndefined()
  })
})

describe('validated endpoint session', () => {
  afterEach(() => {
    useScene.setState({ readOnly: false })
    useLiveNodeOverrides.getState().clearAll()
  })
  function setup() {
    const wall = WallNode.parse({ id: 'wall_child_preview', start: [0, 0], end: [4, 0] })
    const door = DoorNode.parse({
      id: 'door_child_preview',
      parentId: wall.id,
      wallId: wall.id,
      width: 0.6,
      position: [2, 1, 0],
    })
    wall.children = [door.id]
    useScene.setState({ nodes: { [wall.id]: wall, [door.id]: door }, readOnly: false })
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    useEditor.getState().setSnappingMode('wall', 'off')
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'start' },
      initialPlanPoint: wall.start,
      gridSnapStep: 0.001,
    })
    return { wall, door, session }
  }
  test('rebases hosted preview ephemerally, commits once and exactly undoes', () => {
    const { wall, door, session } = setup()
    const baseline = structuredClone(useScene.getState().nodes)
    session.apply({ planPoint: [-1, 0], modifiers })
    expect(useLiveNodeOverrides.getState().get(door.id)?.position).toEqual([3, 1, 0])
    expect(useScene.getState().nodes).toEqual(baseline)
    expect(session.canCommit()).toBe(true)
    session.commit?.()
    expect((useScene.getState().nodes[wall.id] as WallNode).start).toEqual([-1, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(baseline)
  })
  test('rejects final host clipping without writing the graph', () => {
    const { session } = setup()
    const baseline = structuredClone(useScene.getState().nodes)
    session.apply({ planPoint: [1.9, 0], modifiers })
    expect(session.canCommit()).toBe(false)
    session.commit?.()
    expect(useScene.getState().nodes).toEqual(baseline)
  })
  test('rejects stale 0.1mm edits and preserves the external change', () => {
    const { wall, session } = setup()
    session.apply({ planPoint: [-1, 0], modifiers })
    useScene.getState().updateNode(wall.id, { end: [4.0001, 0] })
    const external = structuredClone(useScene.getState().nodes)
    expect(session.canCommit()).toBe(false)
    session.commit?.()
    expect(useScene.getState().nodes).toEqual(external)
    expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
  })
  test('rejects read-only toggled during a valid preview', () => {
    const { session } = setup()
    const baseline = structuredClone(useScene.getState().nodes)
    session.apply({ planPoint: [-1, 0], modifiers })
    useScene.setState({ readOnly: true })
    expect(session.canCommit()).toBe(false)
    session.commit?.()
    expect(useScene.getState().nodes).toEqual(baseline)
  })
})

test('endpoint drag rejects a new collinear overlap and preserves unrelated baseline overlaps', () => {
  const wall = WallNode.parse({ id: 'wall_drag_overlap', start: [0, 0], end: [1, 0] })
  const third = WallNode.parse({ id: 'wall_drag_third', start: [1.5, 0], end: [2.5, 0] })
  const run = (other: WallNode) => {
    useScene.setState({ nodes: { [wall.id]: wall, [other.id]: other }, readOnly: false })
    useEditor.getState().setSnappingMode('wall', 'off')
    const baseline = structuredClone(useScene.getState().nodes)
    const session = wallMoveEndpointAffordance.start({
      node: wall,
      nodes: useScene.getState().nodes,
      payload: { wallId: wall.id, endpoint: 'end' },
      initialPlanPoint: wall.end,
      gridSnapStep: 0.001,
    })
    session.apply({ planPoint: [3, 0], modifiers })
    return { session, baseline }
  }
  const rejected = run(third)
  expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
  expect(rejected.session.canCommit()).toBe(false)
  rejected.session.commit?.()
  expect(useScene.getState().nodes).toEqual(rejected.baseline)
  const accepted = run({ ...third, start: [0, 0], end: [0.5, 0] })
  expect(accepted.session.canCommit()).toBe(true)
  accepted.session.commit?.()
  expect((useScene.getState().nodes[wall.id] as WallNode).end).toEqual([3, 0])
})
