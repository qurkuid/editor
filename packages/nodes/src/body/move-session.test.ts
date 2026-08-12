import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type BodyNode,
  ConstructionDimensionNode,
  createRectangleBody,
  getBodyLoopVertices,
  MeasurementNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
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
    useInteractionScope.getState().end()
    useEditor.getState().setSnappingMode('polygon', 'grid')
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

  test('previews a selected persistent vertex through a live geometry override', () => {
    const body = rectangleBody()
    seedScene(body)
    const vertex = body.vertices[0]!
    const session = createBodyMoveSession({
      body,
      preview: 'override',
      feature: { bodyId: body.id, kind: 'vertex', featureId: vertex.id },
    })

    expect(session.preview([0.1, 0, 0.1])).toBe(true)
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useLiveTransforms.getState().get(body.id)).toBeUndefined()

    const override = useLiveNodeOverrides.getState().get(body.id)
    expect(override?.vertices?.find(({ id }) => id === vertex.id)?.position).toEqual([
      vertex.position[0] + 0.1,
      vertex.position[1],
      vertex.position[2] + 0.1,
    ])
  })

  test('previews, commits, cancels, and undoes an autofold feature move', () => {
    const body = rectangleBody()
    seedScene(body)
    const feature = { bodyId: body.id, kind: 'vertex' as const, featureId: body.vertices[0]!.id }
    const previewSession = createBodyMoveSession({
      body,
      preview: 'override',
      autofold: true,
      feature,
    })

    expect(previewSession.preview([0, 1, 0])).toBe(true)
    const preview = useLiveNodeOverrides.getState().get(body.id)
    expect(preview?.faces).toHaveLength(2)
    previewSession.cancel()
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()

    const commitSession = createBodyMoveSession({
      body,
      preview: 'override',
      autofold: true,
      feature,
    })
    expect(commitSession.preview([0, 1, 0])).toBe(true)
    expect(commitSession.commit()).toBe(true)
    expect(storedBody(body.id).faces).toHaveLength(2)
    useScene.temporal.getState().undo()
    expect(storedBody(body.id)).toEqual(body)
  })

  test('remaps attached feature annotations and undoes the whole feature move atomically', () => {
    const body = rectangleBody()
    const vertexId = body.vertices[0]!.id
    const featureAnchor = (featureId: string) => ({
      kind: 'feature' as const,
      reference: { nodeId: body.id, featureId },
      fallback: [0, 0, 0] as [number, number, number],
    })
    const measurement = MeasurementNode.parse({
      id: 'measurement_move_annotation_test',
      measurement: {
        kind: 'distance',
        points: [featureAnchor(vertexId), featureAnchor(vertexId)],
      },
    })
    const dimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_move_annotation_test',
      anchors: [featureAnchor(vertexId), featureAnchor(vertexId)],
    })
    useScene.setState({
      nodes: {
        [body.id]: body,
        [measurement.id]: measurement,
        [dimension.id]: dimension,
      },
      rootNodeIds: [body.id, measurement.id, dimension.id],
      dirtyNodes: new Set(),
    })
    useScene.temporal.getState().clear()

    const session = createBodyMoveSession({
      body,
      preview: 'override',
      autofold: true,
      feature: { bodyId: body.id, kind: 'vertex', featureId: vertexId },
    })
    expect(session.preview([0, 1, 0])).toBe(true)
    expect(session.commit()).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.getState().nodes[measurement.id]).toEqual(measurement)
    expect(useScene.getState().nodes[dimension.id]).toEqual(dimension)

    useScene.temporal.getState().undo()
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.getState().nodes[measurement.id]).toEqual(measurement)
    expect(useScene.getState().nodes[dimension.id]).toEqual(dimension)
  })

  test('rejects an invalid feature preview without mutating scene state', () => {
    const body = rectangleBody()
    seedScene(body)
    const session = createBodyMoveSession({
      body,
      preview: 'override',
      feature: { bodyId: body.id, kind: 'vertex', featureId: 'vertex:missing' },
    })

    expect(session.preview([0.1, 0.5, 0])).toBe(false)
    expect(session.canCommit()).toBe(false)
    expect(storedBody(body.id)).toEqual(body)
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('commits one selected edge update and undo restores the original body', () => {
    const body = rectangleBody()
    seedScene(body)
    const edge = body.halfEdges[0]!
    const session = createBodyMoveSession({
      body,
      preview: 'override',
      feature: { bodyId: body.id, kind: 'edge', featureId: edge.id },
    })

    expect(session.preview([0.2, 0, 0.3])).toBe(true)
    expect(session.commit()).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(storedBody(body.id).revision).toBe(body.revision + 1)
    expect(storedBody(body.id).vertices[0]?.position).toEqual([
      body.vertices[0]!.position[0] + 0.2,
      body.vertices[0]!.position[1],
      body.vertices[0]!.position[2] + 0.3,
    ])

    useScene.temporal.getState().undo()
    expect(storedBody(body.id)).toEqual(body)
  })

  test('cancels a selected face preview without changing topology or history', () => {
    const body = rectangleBody()
    seedScene(body)
    const session = createBodyMoveSession({
      body,
      preview: 'override',
      feature: { bodyId: body.id, kind: 'face', featureId: body.faces[0]!.id },
    })

    expect(session.preview([0, 0.5, 0])).toBe(true)
    session.cancel()

    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
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
