import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type BodyNode,
  createRectangleBody,
  getBodyLoopVertices,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useInteractionScope } from '@pascal-app/editor'
import { bodyDefinition } from './definition'
import { createBodyFloorplanMoveTarget } from './floorplan-move'
import {
  bodyMinimumVertexY,
  createBodyMoveEffectState,
  createBodyMoveSession,
  resolveBodyMoveTranslation,
  resolveBodyPointMoveTranslation,
} from './move-session'

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  }
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = () => {}
}

if (!nodeRegistry.get('body')) registerNode(bodyDefinition as never)

function expectLoopCloseTo(
  actual: ReadonlyArray<readonly [number, number, number]>,
  expected: Array<[number, number, number]>,
): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]?.[0]).toBeCloseTo(expected[index]![0])
    expect(actual[index]?.[1]).toBeCloseTo(expected[index]![1])
    expect(actual[index]?.[2]).toBeCloseTo(expected[index]![2])
  }
}

function storedBody(id: BodyNode['id']): BodyNode {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'body') {
    throw new TypeError(`Expected stored body ${id}`)
  }
  return node
}

function seedScene(body: BodyNode): void {
  useScene.setState({
    nodes: { [body.id]: body },
    rootNodeIds: [body.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    installedPlugins: [],
  })
  useScene.temporal.getState().clear()
}

function rectangleBody(): BodyNode {
  return {
    ...createRectangleBody({ width: 1.2, depth: 0.8 }),
    id: 'body_move_test',
  }
}

describe('Body move session', () => {
  beforeEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
    useScene.temporal.getState().clear()
  })

  test('previews and cancels through live transforms without mutating topology', () => {
    const body = rectangleBody()
    seedScene(body)
    const session = createBodyMoveSession({ body, preview: 'transform' })
    const pastBefore = useScene.temporal.getState().pastStates.length

    expect(session.preview([1.25, 0, -0.5])).toBe(true)

    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(useLiveTransforms.getState().get(body.id)).toEqual({
      position: [1.25, 0, -0.5],
      rotation: 0,
    })
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()

    useScene.getState().clearDirty(body.id)
    session.cancel()

    expect(useLiveTransforms.getState().get(body.id)).toBeUndefined()
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
  })

  test('commits one transformBody update and undo restores the original body', () => {
    const body = rectangleBody()
    seedScene(body)
    const session = createBodyMoveSession({ body, preview: 'transform' })
    const pastBefore = useScene.temporal.getState().pastStates.length

    expect(session.preview([0.4, 0, 0.6])).toBe(true)
    useScene.getState().clearDirty(body.id)
    expect(session.commit()).toBe(true)

    expect(useLiveTransforms.getState().get(body.id)).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore + 1)

    const moved = storedBody(body.id)
    expect(moved.revision).toBe(body.revision + 1)
    expectLoopCloseTo(getBodyLoopVertices(moved, 'loop:0'), [
      [0.4, 0, 0.6],
      [1.6, 0, 0.6],
      [1.6, 0, 1.4],
      [0.4, 0, 1.4],
    ])

    useScene.temporal.getState().undo()
    expect(storedBody(body.id)).toEqual(body)
  })

  test('resolves 3D surface stacking translation from surface point, body center, and minimum Y', () => {
    const body: BodyNode = {
      ...rectangleBody(),
      vertices: rectangleBody().vertices.map((vertex, index) => ({
        ...vertex,
        position: [vertex.position[0], index === 0 ? -0.2 : 0.6, vertex.position[2]],
      })),
    }

    expect(bodyMinimumVertexY(body)).toBeCloseTo(-0.2)
    expect(
      resolveBodyMoveTranslation({
        body,
        planTranslation: [1.25, -0.5],
        surfacePoint: [3, 0.8, 4],
      }),
    ).toEqual([2.4, 1, 3.6])
  })

  test('resolves empty-grid/free-overlap 3D move without vertical translation', () => {
    const body = rectangleBody()

    expect(
      resolveBodyMoveTranslation({
        body,
        planTranslation: [0.4, 0.6],
        surfacePoint: null,
      }),
    ).toEqual([0.4, 0, 0.6])
  })

  test('keeps the chosen base point attached to the destination inference point', () => {
    const translation = resolveBodyPointMoveTranslation({
      basePoint: [1.2, 0.35, -0.4],
      targetPoint: [2.75, 1.1, 3.2],
    })

    expect(translation[0]).toBeCloseTo(1.55)
    expect(translation[1]).toBeCloseTo(0.75)
    expect(translation[2]).toBeCloseTo(3.6)
  })

  test('creates a fresh effect-owned session after StrictMode cleanup', () => {
    const body = rectangleBody()
    seedScene(body)

    const firstMount = createBodyMoveEffectState({
      body,
      preview: 'override',
    })
    firstMount.session.cancel()

    const secondMount = createBodyMoveEffectState({
      body,
      preview: 'override',
    })

    expect(secondMount.session.preview([0.4, 0, 0.6])).toBe(true)
    expect(secondMount.session.canCommit()).toBe(true)
  })

  test('floorplan target previews through live overrides and commits the same transform once', () => {
    const body = rectangleBody()
    seedScene(body)
    const session = createBodyFloorplanMoveTarget({
      node: body,
      nodes: useScene.getState().nodes,
    })
    const pastBefore = useScene.temporal.getState().pastStates.length

    session.apply({
      planPoint: [1.6, 1.4],
      modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false },
    })

    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(useLiveTransforms.getState().get(body.id)).toBeUndefined()
    const override = useLiveNodeOverrides.getState().get(body.id)
    expect(override?.vertices).toBeDefined()
    expectLoopCloseTo(getBodyLoopVertices({ ...body, ...override }, 'loop:0'), [
      [1, 0, 1],
      [2.2, 0, 1],
      [2.2, 0, 1.8],
      [1, 0, 1.8],
    ])

    expect(session.canCommit()).toBe(true)
    useScene.getState().clearDirty(body.id)
    session.commit?.()

    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore + 1)
    expectLoopCloseTo(getBodyLoopVertices(storedBody(body.id), 'loop:0'), [
      [1, 0, 1],
      [2.2, 0, 1],
      [2.2, 0, 1.8],
      [1, 0, 1.8],
    ])
  })

  test('floorplan body move keeps polygon grid snapping active when Shift is held', () => {
    const body = rectangleBody()
    seedScene(body)
    const scope = useInteractionScope.getState()
    scope.begin({ kind: 'moving', node: body, nodeId: body.id, nodeType: 'body', view: '2d' })

    const session = createBodyFloorplanMoveTarget({
      node: body,
      nodes: useScene.getState().nodes,
    })

    session.apply({
      planPoint: [1.6, 1.4],
      modifiers: { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false },
    })

    const override = useLiveNodeOverrides.getState().get(body.id)
    expect(override?.vertices).toBeDefined()
    expectLoopCloseTo(getBodyLoopVertices({ ...body, ...override }, 'loop:0'), [
      [0.9, 0, 1.1],
      [2.1, 0, 1.1],
      [2.1, 0, 1.9],
      [0.9, 0, 1.9],
    ])

    session.commit?.()
    scope.end()
  })
})
