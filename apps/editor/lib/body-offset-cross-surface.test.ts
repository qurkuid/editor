import '../../../packages/mcp/src/bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, getBodySemanticHash, useLiveNodeOverrides } from '@pascal-app/core'
import {
  executeOffsetBodyFace,
  executePushPullBodyFace,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { type AnyNodeId, BodyNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { useInteractionScope } from '@pascal-app/editor'
import { SceneBridge } from '../../../packages/mcp/src/bridge/scene-bridge'
import { createSceneOperations } from '../../../packages/mcp/src/operations'
import {
  commitModelingResult,
  evaluateModelingOperation,
  parseModelingOperationInput,
  toModelingPreview,
} from '../../../packages/mcp/src/tools/modeling-operation-shared'
import { createBodyOffsetSession } from '../../../packages/nodes/src/body/offset-session'
import { applyAiModelingPlan } from './ai-control'

const bodyId = 'body_offset_cross_surface' as AnyNodeId
const faceId = 'face:0'
const distance = -0.2
const offsetSurface = {
  materialRef: 'scene:offset-cross-surface',
  uvOrigin: [0.25, 1, 0.75],
  uvU: [2, 0, 0],
  uvV: [0, 0, 3],
} as const

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  }
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = () => {}
}

function sourceBody(): BodyNode {
  const solid = executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
    faceId,
    distance: 1,
  }).body
  return BodyNode.parse({
    ...solid,
    id: bodyId,
    faces: solid.faces.map((face) =>
      face.id === faceId ? { ...face, surface: offsetSurface } : face,
    ),
  })
}

function expectCanonicalOffsetBody(
  actual: BodyNode,
  expected: BodyNode,
  createdFaceId: string,
): void {
  expect(getBodySemanticHash(actual)).toBe(getBodySemanticHash(expected))
  expect(actual.vertices.map(({ id }) => id)).toEqual(expected.vertices.map(({ id }) => id))
  expect(actual.halfEdges.map(({ id }) => id)).toEqual(expected.halfEdges.map(({ id }) => id))
  expect(actual.loops.map(({ id }) => id)).toEqual(expected.loops.map(({ id }) => id))
  expect(actual.faces.map(({ id }) => id)).toEqual(expected.faces.map(({ id }) => id))
  expect(actual.faces.map(({ id, surface }) => ({ id, surface }))).toEqual(
    expected.faces.map(({ id, surface }) => ({ id, surface })),
  )
  expect(actual.faces.find(({ id }) => id === faceId)?.surface).toEqual(offsetSurface)
  expect(actual.faces.find(({ id }) => id === createdFaceId)?.surface).toEqual(offsetSurface)
}

function captureErrorMessage(action: () => void): string {
  try {
    action()
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error('Expected Offset to reject the request')
}

function curvedBody(body: BodyNode): BodyNode {
  const targetEdge = body.halfEdges.find((edge) => edge.loopId === 'loop:0')
  if (!targetEdge) throw new Error('Expected the source face to have an edge')
  return BodyNode.parse({
    ...body,
    curves: [
      {
        id: 'curve:arc',
        kind: 'circular-arc',
        center: [0, 1, 0],
        normal: [0, 1, 0],
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI,
      },
    ],
    halfEdges: body.halfEdges.map((edge) =>
      edge.id === targetEdge.id ? { ...edge, curveId: 'curve:arc' } : edge,
    ),
  })
}

function sourceHoleBody(body: BodyNode): BodyNode {
  return BodyNode.parse(executeOffsetBodyFace(body, { faceId, distance: -0.2 }).body)
}

function expectAtomicRejectionAcrossSurfaces(
  body: BodyNode,
  distance: number,
  expectedMessage: string,
): void {
  const sourceHash = getBodySemanticHash(body)
  const coreMessage = captureErrorMessage(() => executeOffsetBodyFace(body, { faceId, distance }))
  expect(coreMessage).toBe(expectedMessage)

  resetScene(body)
  const session = createBodyOffsetSession({ body, faceId, handle: 'body:offset' })
  expect(session.preview(distance)).toBe(false)
  expect(session.canCommit()).toBe(false)
  expect(session.createdFaceId()).toBeNull()
  expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
  expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[body.id]))).toBe(sourceHash)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  session.cancel()

  resetScene(body)
  const aiMessage = captureErrorMessage(() =>
    applyAiModelingPlan({
      message: `Reject unsupported ${expectedMessage}.`,
      patches: [{ op: 'offsetBodyFace', id: body.id, faceId, distance }],
    }),
  )
  expect(aiMessage).toBe(coreMessage)
  expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[body.id]))).toBe(sourceHash)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)

  const bridge = new SceneBridge()
  bridge.setScene({ [body.id]: body }, [body.id])
  bridge.clearHistory()
  const operations = createSceneOperations({ bridge })
  const parsed = parseModelingOperationInput(MODELING_OPERATION_IDS.offsetBodyFace, {
    faceId,
    distance,
  })
  if (!parsed.success) throw new Error(parsed.message)
  const mcpMessage = captureErrorMessage(() =>
    evaluateModelingOperation(BodyNode.parse(operations.getNode(body.id)), parsed.data),
  )
  expect(mcpMessage).toBe(coreMessage)
  expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(body.id)))).toBe(sourceHash)
  expect(bridge.getHistory().pastCount).toBe(0)
}

function resetScene(body: BodyNode): void {
  useLiveNodeOverrides.getState().clearAll()
  useInteractionScope.getState().end()
  useScene.setState({
    nodes: { [body.id]: body },
    rootNodeIds: [body.id],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
}

describe('Body offset cross-surface parity', () => {
  beforeEach(() => resetScene(sourceBody()))

  test('matches the core result across direct, AI, and MCP preview/commit', async () => {
    const source = sourceBody()
    const expected = executeOffsetBodyFace(source, { faceId, distance })
    expect(expected.topologyRemap.split).toEqual({
      [faceId]: [faceId, expected.createdFaceId],
    })

    resetScene(source)
    const session = createBodyOffsetSession({ body: source, faceId, handle: 'body:offset' })
    expect(session.preview(distance)).toBe(true)
    const directPreview = BodyNode.parse({
      ...source,
      ...useLiveNodeOverrides.getState().get(source.id),
    })
    expectCanonicalOffsetBody(directPreview, expected.body, expected.createdFaceId)
    expect(session.createdFaceId()).toBe(expected.createdFaceId)
    expect(session.commit()).toBe(true)
    expectCanonicalOffsetBody(
      BodyNode.parse(useScene.getState().nodes[source.id]),
      expected.body,
      expected.createdFaceId,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(source),
    )

    resetScene(source)
    const aiResult = applyAiModelingPlan({
      message: 'Inset the selected face by 200 mm.',
      patches: [{ op: 'offsetBodyFace', id: source.id, faceId, distance }],
    })
    expect(aiResult.appliedOps).toBe(1)
    expectCanonicalOffsetBody(
      BodyNode.parse(useScene.getState().nodes[source.id]),
      expected.body,
      expected.createdFaceId,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(source),
    )

    const bridge = new SceneBridge()
    bridge.setScene({ [source.id]: source }, [source.id])
    bridge.clearHistory()
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()
    const operations = createSceneOperations({ bridge })
    const parsed = parseModelingOperationInput(MODELING_OPERATION_IDS.offsetBodyFace, {
      faceId,
      distance,
    })
    if (!parsed.success) throw new Error(parsed.message)
    const preflight = toModelingPreview(
      evaluateModelingOperation(BodyNode.parse(operations.getNode(source.id)), parsed.data),
    )
    expect(preflight.operation).toBe(MODELING_OPERATION_IDS.offsetBodyFace)
    expectCanonicalOffsetBody(BodyNode.parse(preflight.body), expected.body, expected.createdFaceId)
    expect(preflight.createdFaceId).toBe(expected.createdFaceId)
    expect(preflight.topologyRemap).toEqual(expected.topologyRemap)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)

    const committed = evaluateModelingOperation(
      BodyNode.parse(operations.getNode(source.id)),
      parsed.data,
    )
    commitModelingResult(operations, source.id, committed)
    const commit = toModelingPreview(committed)
    expectCanonicalOffsetBody(BodyNode.parse(commit.body), expected.body, expected.createdFaceId)
    expect(commit.createdFaceId).toBe(expected.createdFaceId)
    expect(commit.topologyRemap).toEqual(expected.topologyRemap)
    expect(bridge.getHistory().pastCount).toBe(1)
    expect(bridge.undo()).toBe(1)
    expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(
      getBodySemanticHash(source),
    )
  })

  test('matches curve and source-hole rejection classes atomically across every surface', () => {
    expectAtomicRejectionAcrossSurfaces(
      curvedBody(sourceBody()),
      -0.2,
      'Offset requires line edges: edge:0, curve:arc',
    )
    expectAtomicRejectionAcrossSurfaces(
      sourceHoleBody(sourceBody()),
      -0.1,
      'Offset rejects source faces with inner loops: face:0, face:0:offset:2:inner',
    )
  })

  test('keeps zero distance atomic across direct, AI, and MCP', () => {
    const source = sourceBody()
    const sourceHash = getBodySemanticHash(source)

    expect(() => executeOffsetBodyFace(source, { faceId, distance: 0 })).toThrow(RangeError)

    resetScene(source)
    const session = createBodyOffsetSession({ body: source, faceId, handle: 'body:offset' })
    expect(session.preview(0)).toBe(false)
    expect(useLiveNodeOverrides.getState().get(source.id)).toBeUndefined()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      sourceHash,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    session.cancel()

    resetScene(source)
    expect(() =>
      applyAiModelingPlan({
        message: 'Invalid zero offset.',
        patches: [{ op: 'offsetBodyFace', id: source.id, faceId, distance: 0 }],
      }),
    ).toThrow()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      sourceHash,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)

    const bridge = new SceneBridge()
    bridge.setScene({ [source.id]: source }, [source.id])
    bridge.clearHistory()
    const operations = createSceneOperations({ bridge })
    const parsed = parseModelingOperationInput(MODELING_OPERATION_IDS.offsetBodyFace, {
      faceId,
      distance: 0,
    })
    expect(parsed.success).toBe(false)
    expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(sourceHash)
    expect(bridge.getHistory().pastCount).toBe(0)
    expect(operations.getNode(source.id)).toEqual(source)
  })

  test('keeps exterior outward diagnostics and atomicity aligned across every adapter', () => {
    const source = sourceBody()
    const sourceHash = getBodySemanticHash(source)
    const outwardDistance = 0.2
    const canonicalMessage = captureErrorMessage(() =>
      executeOffsetBodyFace(source, { faceId, distance: outwardDistance }),
    )

    resetScene(source)
    const session = createBodyOffsetSession({ body: source, faceId, handle: 'body:offset' })
    expect(session.preview(outwardDistance)).toBe(false)
    expect(session.canCommit()).toBe(false)
    expect(useLiveNodeOverrides.getState().get(source.id)).toBeUndefined()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      sourceHash,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    session.cancel()

    resetScene(source)
    const aiMessage = captureErrorMessage(() =>
      applyAiModelingPlan({
        message: 'Invalid exterior outward Offset.',
        patches: [{ op: 'offsetBodyFace', id: source.id, faceId, distance: outwardDistance }],
      }),
    )
    expect(aiMessage).toContain(canonicalMessage)
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      sourceHash,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)

    const bridge = new SceneBridge()
    bridge.setScene({ [source.id]: source }, [source.id])
    bridge.clearHistory()
    const operations = createSceneOperations({ bridge })
    const parsed = parseModelingOperationInput(MODELING_OPERATION_IDS.offsetBodyFace, {
      faceId,
      distance: outwardDistance,
    })
    if (!parsed.success) throw new Error(parsed.message)
    const mcpMessage = captureErrorMessage(() =>
      evaluateModelingOperation(BodyNode.parse(operations.getNode(source.id)), parsed.data),
    )
    expect(mcpMessage).toBe(canonicalMessage)
    expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(sourceHash)
    expect(bridge.getHistory().pastCount).toBe(0)
  })
})
