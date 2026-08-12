import '../../../packages/mcp/src/bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createRectangleBody,
  getBodySemanticHash,
  type ModelingOperationId,
  type ModelingOperationResult,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  executeImprintBodyFace,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  executeTransformBody,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { type AnyNodeId, BodyNode, type SceneMaterial } from '@pascal-app/core/schema'
import { useInteractionScope } from '@pascal-app/editor'
import { SceneBridge } from '../../../packages/mcp/src/bridge/scene-bridge'
import { createSceneOperations } from '../../../packages/mcp/src/operations'
import {
  commitModelingResult,
  evaluateModelingOperation,
  parseModelingOperationInput,
} from '../../../packages/mcp/src/tools/modeling-operation-shared'
import { createBodyMoveSession } from '../../../packages/nodes/src/body/move-session'
import { createBodyPushPullSession } from '../../../packages/nodes/src/body/push-pull-session'
import { createBodySweepSession } from '../../../packages/nodes/src/body/sweep-session'
import { applyAiModelingPlan } from './ai-control'

const bodyId = 'body_modeling_cross_surface' as AnyNodeId
const faceId = 'face:0'
const material: SceneMaterial = {
  id: 'mat_cross_surface',
  name: 'Cross-surface red',
  material: { preset: 'custom', properties: { color: '#b91c1c', roughness: 0.85 } },
}

function sourceBody(kind: 'open' | 'solid' = 'open'): BodyNode {
  const body = createRectangleBody({ width: 2, depth: 2 })
  return BodyNode.parse({
    ...(kind === 'solid' ? executePushPullBodyFace(body, { faceId, distance: 1 }).body : body),
    id: bodyId,
  })
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

function mcpParity(
  source: BodyNode,
  operationId: ModelingOperationId,
  input: Record<string, unknown>,
  expected: ModelingOperationResult,
): void {
  const bridge = new SceneBridge()
  bridge.setScene({ [source.id]: source }, [source.id])
  bridge.clearHistory()
  const operations = createSceneOperations({ bridge })
  const parsed = parseModelingOperationInput(operationId, input)
  if (!parsed.success) throw new Error(parsed.message)
  const before = getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))
  const preview = evaluateModelingOperation(
    BodyNode.parse(operations.getNode(source.id)),
    parsed.data,
  )
  expect(getBodySemanticHash(preview.body)).toBe(getBodySemanticHash(expected.body))
  expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(before)
  commitModelingResult(operations, source.id, preview)
  expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(
    getBodySemanticHash(expected.body),
  )
  expect(bridge.getHistory().pastCount).toBe(1)
  expect(bridge.undo()).toBe(1)
  expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(source.id)))).toBe(before)
}

describe('Body semantic operation cross-surface parity', () => {
  beforeEach(() => resetScene(sourceBody()))

  test('keeps Push/Pull topology hash equal across direct, AI, and MCP', () => {
    const source = sourceBody()
    const input = { faceId, distance: 1 }
    const expected = executePushPullBodyFace(source, input)

    resetScene(source)
    const session = createBodyPushPullSession({ body: source, faceId, handle: 'body:push-pull' })
    expect(session.preview(input.distance)).toBe(true)
    expect(
      getBodySemanticHash(
        BodyNode.parse({ ...source, ...useLiveNodeOverrides.getState().get(source.id) }),
      ),
    ).toBe(getBodySemanticHash(expected.body))
    expect(session.commit()).toBe(true)
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    resetScene(source)
    expect(
      applyAiModelingPlan({
        message: 'Push the selected face.',
        patches: [{ op: 'pushPullBodyFace', id: source.id, ...input }],
      }),
    ).toMatchObject({ appliedOps: 1 })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    mcpParity(source, MODELING_OPERATION_IDS.pushPullBodyFace, input, expected)
  })

  test('keeps Imprint topology hash equal across direct, AI, and MCP', () => {
    const source = sourceBody('solid')
    const input = {
      faceId,
      profilePoints: [
        [0.5, 1, 0.5],
        [1.5, 1, 0.5],
        [1.5, 1, 1.5],
        [0.5, 1, 1.5],
      ],
      distance: 0.25,
    } as const
    const expected = executeImprintBodyFace(source, input)

    resetScene(source)
    useScene.getState().updateNode(source.id, { ...expected.body })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    resetScene(source)
    expect(
      applyAiModelingPlan({
        message: 'Imprint the selected face.',
        patches: [{ op: 'imprintBodyFace', id: source.id, ...input }],
      }),
    ).toMatchObject({ appliedOps: 1 })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    mcpParity(source, MODELING_OPERATION_IDS.imprintBodyFace, input, expected)
  })

  test('keeps Transform topology hash equal across direct, AI, and MCP', () => {
    const source = sourceBody()
    const input = {
      translation: [0.2, 0.3, -0.1],
      rotationAxis: [0, 1, 0],
      rotationAngle: 0,
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
    } as const
    const expected = executeTransformBody(source, input)

    resetScene(source)
    const session = createBodyMoveSession({ body: source, preview: 'override' })
    expect(session.preview(input.translation)).toBe(true)
    expect(session.commit()).toBe(true)
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    resetScene(source)
    expect(
      applyAiModelingPlan({
        message: 'Transform the selected Body.',
        patches: [{ op: 'transformBody', id: source.id, ...input }],
      }),
    ).toMatchObject({ appliedOps: 1 })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    mcpParity(source, MODELING_OPERATION_IDS.transformBody, input, expected)
  })

  test('keeps Paint face semantic hash equal across direct, AI, and MCP', () => {
    const source = sourceBody()
    const input = { faceId, material }
    const expected = executePaintBodyFace(source, input)

    resetScene(source)
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().updateNode(source.id, { ...expected.body })
      useScene.getState().addSceneMaterial(material)
    })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    resetScene(source)
    expect(
      applyAiModelingPlan({
        message: 'Paint the selected face.',
        patches: [{ op: 'paintBodyFace', id: source.id, ...input }],
      }),
    ).toMatchObject({ appliedOps: 1 })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    mcpParity(source, MODELING_OPERATION_IDS.paintBodyFace, input, expected)
  })

  test('keeps Follow Path sweep semantic hash equal across direct, AI, and MCP', () => {
    const source = sourceBody()
    const input = {
      faceId,
      pathPoints: [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
      ],
    } as const
    const expected = executeSweepBodyFace(source, input)

    resetScene(source)
    const session = createBodySweepSession({ body: source, faceId })
    expect(session.preview(input.pathPoints)).toBe(true)
    expect(
      getBodySemanticHash(
        BodyNode.parse({ ...source, ...useLiveNodeOverrides.getState().get(source.id) }),
      ),
    ).toBe(getBodySemanticHash(expected.body))
    expect(session.commit()).toBe(true)
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    resetScene(source)
    expect(
      applyAiModelingPlan({
        message: 'Follow the selected Body face along an L path.',
        patches: [{ op: 'sweepBodyFace', id: source.id, ...input }],
      }),
    ).toMatchObject({ appliedOps: 1 })
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(
      getBodySemanticHash(expected.body),
    )

    mcpParity(source, MODELING_OPERATION_IDS.sweepBodyFace, input, expected)
  })
})
