import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type BodyNode,
  createRectangleBody,
  getBodyLoopVertices,
  getBodySemanticHash,
  pushPullBodyFace,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { executeOffsetBodyFace } from '@pascal-app/core/modeling-operations'
import { ConstructionDimensionNode, MeasurementNode } from '@pascal-app/core/schema'
import { useInteractionScope } from '@pascal-app/editor'
import { createBodyOffsetSession } from './offset-session'
import { bodyActionToolChanged } from './options'

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  }
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = () => {}
}

function storedBody(id: BodyNode['id']): BodyNode {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'body') throw new TypeError(`Expected stored body ${id}`)
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

describe('Body Offset session transaction', () => {
  beforeEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useInteractionScope.getState().end()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
    useScene.temporal.getState().clear()
  })

  test('previews into a live override and Escape or unmount cancel without scene history', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    seedScene(body)
    const session = createBodyOffsetSession({ body, faceId: 'face:0', handle: 'body:offset' })

    expect(session.preview(-0.12)).toBe(true)
    expect(session.createdFaceId()).toBe('face:0:offset:2')
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useLiveNodeOverrides.getState().get(body.id)?.faces).toBeDefined()
    const canonical = executeOffsetBodyFace(body, { faceId: 'face:0', distance: -0.12 })
    const previewBody = { ...body, ...useLiveNodeOverrides.getState().get(body.id) } as BodyNode
    expect(previewBody).toMatchObject(canonical.body)
    expect(getBodySemanticHash(previewBody)).toBe(getBodySemanticHash(canonical.body))

    session.cancel()
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(session.previewFaceLoopPoints()).toBeNull()
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('commits the exact retained preview once and undo restores the original body', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    seedScene(body)
    const session = createBodyOffsetSession({ body, faceId: 'face:0', handle: 'body:offset' })

    expect(session.preview(-0.12)).toBe(true)
    const previewBody = {
      ...body,
      ...useLiveNodeOverrides.getState().get(body.id),
    } as BodyNode
    const previewHash = getBodySemanticHash(previewBody)
    const createdFaceId = session.createdFaceId()
    expect(session.commit()).toBe(true)
    const updated = storedBody(body.id)
    expect(getBodySemanticHash(updated)).toBe(previewHash)
    expect(createdFaceId).toBe('face:0:offset:2')
    expect(updated.revision).toBe(body.revision + 1)
    expect(getBodyLoopVertices(updated, 'loop:0')).toHaveLength(4)
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(session.previewFaceLoopPoints()).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(storedBody(body.id)).toEqual(body)
  })

  test('keeps MeasurementNode and ConstructionDimension anchors associative through offset', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const anchor = {
      kind: 'feature' as const,
      reference: { nodeId: body.id, featureId: 'face:0:center' },
      fallback: [0, 0, 0] as [number, number, number],
    }
    const measurement = MeasurementNode.parse({
      id: 'measurement_offset_session',
      measurement: { kind: 'distance', points: [anchor, [1, 0, 0]] },
    })
    const dimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_offset_session',
      anchors: [anchor, [1, 0, 0]],
    })
    seedScene(body)
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [measurement.id]: measurement,
        [dimension.id]: dimension,
      },
    }))
    useScene.temporal.getState().clear()
    const session = createBodyOffsetSession({ body, faceId: 'face:0', handle: 'body:offset' })

    expect(session.preview(-0.12)).toBe(true)
    expect(session.commit()).toBe(true)
    const updatedMeasurement = useScene.getState().nodes[measurement.id]
    const updatedDimension = useScene.getState().nodes[dimension.id]
    if (updatedMeasurement?.type !== 'measurement') throw new Error('Expected measurement update')
    if (updatedDimension?.type !== 'construction-dimension') {
      throw new Error('Expected construction dimension update')
    }
    const measurementAnchor = updatedMeasurement.measurement.points[0]
    const dimensionAnchor = updatedDimension.anchors[0]
    expect(Array.isArray(measurementAnchor) ? null : measurementAnchor.reference.featureId).toBe(
      'face:0:center',
    )
    expect(Array.isArray(dimensionAnchor) ? null : dimensionAnchor.reference.featureId).toBe(
      'face:0:center',
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[measurement.id]).toEqual(measurement)
    expect(useScene.getState().nodes[dimension.id]).toEqual(dimension)
  })

  test('rejects an invalid preview, keeps the session armed, and recovers with a later valid preview', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    seedScene(body)
    const session = createBodyOffsetSession({ body, faceId: 'face:0', handle: 'body:offset' })

    expect(session.preview(-0.12)).toBe(true)
    expect(session.preview(-1)).toBe(false)
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(session.canCommit()).toBe(false)
    expect(session.commit()).toBe(false)
    expect(storedBody(body.id)).toEqual(body)
    expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')

    expect(session.preview(-0.08)).toBe(true)
    const recoveredPreview = {
      ...body,
      ...useLiveNodeOverrides.getState().get(body.id),
    } as BodyNode
    expect(session.commit()).toBe(true)
    expect(getBodySemanticHash(storedBody(body.id))).toBe(getBodySemanticHash(recoveredPreview))
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('cancel clears only its exact handle-drag scope owner', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    seedScene(body)
    const session = createBodyOffsetSession({ body, faceId: 'face:0', handle: 'body:offset' })
    expect(session.preview(-0.12)).toBe(true)
    useInteractionScope.getState().begin({
      kind: 'handle-drag',
      nodeId: body.id,
      handle: 'body:scale',
    })

    session.cancel()

    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: body.id,
      handle: 'body:scale',
    })
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('tool switch cleanup guard distinguishes the tool that armed the action', () => {
    expect(bodyActionToolChanged(null, null)).toBe(false)
    expect(bodyActionToolChanged('body', 'body')).toBe(false)
    expect(bodyActionToolChanged(null, 'wall')).toBe(true)
    expect(bodyActionToolChanged('body', null)).toBe(true)
  })
})
