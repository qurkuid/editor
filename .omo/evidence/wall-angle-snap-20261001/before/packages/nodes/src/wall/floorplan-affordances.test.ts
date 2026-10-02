import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useLiveNodeOverrides, useScene, WallNode } from '@pascal-app/core'
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
