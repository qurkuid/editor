import '../bridge/node-shims'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createRectangleBody, getBodySemanticHash, inspectBodySolid } from '@pascal-app/core'
import {
  executeOffsetBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { BodyNode, SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from '../operations'
import {
  invalidOffsetFixtures,
  makeNestedOffsetSource,
  makeOffsetSolid,
} from './modeling-operation-offset-test-fixtures'
import {
  PreflightModelingOperationPayloadSchema,
  registerPreflightModelingOperation,
} from './preflight-modeling-operation'

function parsePayload(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new TypeError('Expected text tool content')
  const decoded: unknown = JSON.parse(content.text)
  return PreflightModelingOperationPayloadSchema.parse(decoded)
}

describe('preflight_modeling_operation', () => {
  let bridge: SceneBridge
  let client: Client
  let operations: SceneOperations
  let server: McpServer

  beforeEach(async () => {
    bridge = new SceneBridge()
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_preflight',
    })
    bridge.setScene({ [body.id]: body }, [body.id])
    operations = createSceneOperations({ bridge })
    operations.setActiveScene({
      id: 'preflight-scene',
      name: 'Preflight scene',
      projectId: null,
      thumbnailUrl: null,
      version: 7,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      ownerId: null,
      sizeBytes: 0,
      nodeCount: 1,
    })
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerPreflightModelingOperation(server, operations)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  test('returns a Push/Pull preview without mutating scene or history', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()

    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: 'body_preflight',
        input: { faceId: 'face:0', distance: 1.2 },
      },
    })
    const payload = parsePayload(result)

    expect(result.isError).toBeFalsy()
    expect(payload.valid).toBe(true)
    expect(payload.operationId).toBe('pushPullBodyFace')
    expect(payload.operationVersion).toBe(1)
    expect(payload.affectedNodeIds).toEqual(['body_preflight'])
    expect(payload.preview.movedFaceId).toBe('face:0')
    expect(payload.preview.body.revision).toBe(1)
    const canonical = executePushPullBodyFace(
      BodyNode.parse({
        ...createRectangleBody({ width: 1.2, depth: 0.8 }),
        id: 'body_preflight',
      }),
      { faceId: 'face:0', distance: 1.2 },
    )
    expect(JSON.parse(JSON.stringify(payload.preview.body))).toEqual(
      JSON.parse(JSON.stringify(canonical.body)),
    )
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('preflights an open Body face split without mutating scene or history', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()
    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.splitBodyFace,
        nodeId: 'body_preflight',
        input: {
          faceId: 'face:0',
          pathPoints: [
            [0, 0, 0.4],
            [0.6, 0, 0.4],
            [1.2, 0, 0.4],
          ],
        },
      },
    })
    const payload = parsePayload(result)
    expect(payload.valid).toBe(true)
    expect(payload.preview.operation).toBe(MODELING_OPERATION_IDS.splitBodyFace)
    expect(payload.preview.splitFaceId).toBe('face:0:split:1')
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('returns a circular Body array preview without mutating scene or history', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()
    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.arrayBodyCircular,
        nodeId: 'body_preflight',
        input: { count: 4, center: [0, 0, 0], axis: [0, 1, 0], fullCircle: true },
      },
    })
    const payload = parsePayload(result)

    expect(payload.valid).toBe(true)
    expect(payload.operationId).toBe(MODELING_OPERATION_IDS.arrayBodyCircular)
    expect(payload.affectedNodeIds).toHaveLength(4)
    expect(payload.preview?.operation).toBe(MODELING_OPERATION_IDS.arrayBodyCircular)
    expect(payload.preview?.clones).toHaveLength(3)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('returns a Body intersection preview without mutating either Body or history', async () => {
    const target = BodyNode.parse({
      ...executePushPullBodyFace(
        BodyNode.parse({
          ...createRectangleBody({ width: 2, depth: 2 }),
          id: 'body_preflight_target',
        }),
        { faceId: 'face:0', distance: 2 },
      ).body,
      id: 'body_preflight_target',
    })
    const tool = BodyNode.parse({
      ...executePushPullBodyFace(
        BodyNode.parse({
          ...createRectangleBody({ width: 2, depth: 2, origin: [1, 0, 1] }),
          id: 'body_preflight_tool',
        }),
        { faceId: 'face:0', distance: 2 },
      ).body,
      id: 'body_preflight_tool',
    })
    bridge.setScene({ [target.id]: target, [tool.id]: tool }, [target.id, tool.id])
    bridge.clearHistory()
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()

    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.intersectBodies,
        nodeId: target.id,
        input: { toolBodyId: tool.id },
      },
    })
    const payload = parsePayload(result)

    expect(payload.valid).toBe(true)
    expect(payload.affectedNodeIds).toEqual([target.id, tool.id])
    expect(payload.preview?.operation).toBe(MODELING_OPERATION_IDS.intersectBodies)
    expect(inspectBodySolid(BodyNode.parse(payload.preview?.body)).validSolid).toBe(true)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('returns union and subtraction previews without mutating either Body or history', async () => {
    for (const operation of [
      MODELING_OPERATION_IDS.unionBodies,
      MODELING_OPERATION_IDS.subtractBodies,
    ]) {
      const target = BodyNode.parse({
        ...executePushPullBodyFace(
          BodyNode.parse({
            ...createRectangleBody({ width: 2, depth: 2 }),
            id: `body_preflight_${operation}_target`,
          }),
          { faceId: 'face:0', distance: 2 },
        ).body,
        id: `body_preflight_${operation}_target`,
      })
      const tool = BodyNode.parse({
        ...executePushPullBodyFace(
          BodyNode.parse({
            ...createRectangleBody({ width: 2, depth: 2, origin: [1, 0, 1] }),
            id: `body_preflight_${operation}_tool`,
          }),
          { faceId: 'face:0', distance: 2 },
        ).body,
        id: `body_preflight_${operation}_tool`,
      })
      bridge.setScene({ [target.id]: target, [tool.id]: tool }, [target.id, tool.id])
      operations.setActiveScene({
        id: `preflight-${operation}`,
        name: 'Preflight boolean scene',
        projectId: null,
        thumbnailUrl: null,
        version: 7,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        ownerId: null,
        sizeBytes: 0,
        nodeCount: 2,
      })
      bridge.clearHistory()
      const before = JSON.stringify(bridge.exportJSON())
      const beforeHistory = bridge.getHistory()

      const result = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: operation,
          nodeId: target.id,
          input: { toolBodyId: tool.id },
        },
      })
      const payload = parsePayload(result)

      expect(payload.valid).toBe(true)
      expect(payload.operationId).toBe(operation)
      expect(payload.affectedNodeIds).toEqual([target.id, tool.id])
      expect(payload.preview?.operation).toBe(operation)
      expect(inspectBodySolid(BodyNode.parse(payload.preview?.body)).validSolid).toBe(true)
      expect(JSON.stringify(bridge.exportJSON())).toBe(before)
      expect(bridge.getHistory()).toEqual(beforeHistory)
    }
  })

  test('returns diagnostics for an unsupported target without mutating scene', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: 'body_preflight',
        input: { faceId: 'face:not-found', distance: 1.2 },
      },
    })
    const payload = parsePayload(result)

    expect(result.isError).toBeFalsy()
    expect(payload.valid).toBe(false)
    expect(payload.preview).toBeNull()
    expect(payload.diagnostics[0].code).toBe('operation.invalid')
    expect(payload.diagnostics[0].featureIds).toEqual(['face:not-found'])
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
  })

  test('rejects paint without a full SceneMaterial and does not mutate', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()

    for (const input of [{ faceId: 'face:0' }, { faceId: 'face:0', material: 'scene:invented' }]) {
      const result = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.paintBodyFace,
          nodeId: 'body_preflight',
          input,
        },
      })
      const payload = parsePayload(result)

      expect(result.isError).toBeFalsy()
      expect(payload.valid).toBe(false)
      expect(payload.preview).toBeNull()
      expect(payload.diagnostics[0]?.code).toBe('input.invalid')
    }

    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('preflights imprint, transform, and paint without mutation', async () => {
    const solid = executePushPullBodyFace(
      BodyNode.parse({
        ...createRectangleBody({ width: 2, depth: 2 }),
        id: 'body_preflight',
      }),
      { faceId: 'face:0', distance: 1 },
    ).body
    const featureBody = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 2 }),
      id: 'body_preflight_feature',
    })
    bridge.setScene({ [solid.id]: solid, [featureBody.id]: featureBody }, [
      solid.id,
      featureBody.id,
    ])
    bridge.clearHistory()
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()

    const offset = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: 'body_preflight',
        input: { faceId: 'face:0', distance: -0.25 },
      },
    })
    const offsetPayload = parsePayload(offset)
    expect(offsetPayload.valid).toBe(true)
    expect(offsetPayload.preview.operation).toBe(MODELING_OPERATION_IDS.offsetBodyFace)
    expect(offsetPayload.preview.sourceFaceId).toBe('face:0')
    expect(offsetPayload.preview.createdFaceId).toBe('face:0:offset:2')
    const canonical = executeOffsetBodyFace(
      BodyNode.parse({
        ...solid,
        id: 'body_preflight',
      }),
      { faceId: 'face:0', distance: -0.25 },
    )
    expect(JSON.stringify(offsetPayload.preview.body)).toBe(JSON.stringify(canonical.body))

    const imprint = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        nodeId: 'body_preflight',
        input: {
          faceId: 'face:0',
          profilePoints: [
            [0.5, 1, 0.5],
            [1.5, 1, 0.5],
            [1.5, 1, 1.5],
            [0.5, 1, 1.5],
          ],
          distance: 0.25,
        },
      },
    })
    const imprintPayload = parsePayload(imprint)
    expect(imprintPayload.valid).toBe(true)
    expect(imprintPayload.preview.operation).toBe(MODELING_OPERATION_IDS.imprintBodyFace)
    expect(imprintPayload.preview.insetFaceId).toBe('face:0:imprint:2')
    expect(imprintPayload.preview.extrusion?.movedFaceId).toBe('face:0:imprint:2')

    const throughCut = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        nodeId: 'body_preflight',
        input: {
          faceId: 'face:0',
          profilePoints: [
            [0.5, 1, 0.5],
            [1.5, 1, 0.5],
            [1.5, 1, 1.5],
            [0.5, 1, 1.5],
          ],
          distance: -1,
        },
      },
    })
    const throughCutPayload = parsePayload(throughCut)
    expect(throughCutPayload.valid).toBe(true)
    expect(throughCutPayload.preview.extrusion?.movedFaceId).toBeNull()
    expect(throughCutPayload.preview.extrusion?.throughCut).toBe(true)
    expect(throughCutPayload.preview.extrusion?.blockingDistance).toBe(1)
    expect(throughCutPayload.preview.body).toBeDefined()

    const transform = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.transformBody,
        nodeId: 'body_preflight',
        input: {
          translation: [0.2, 0.3, -0.1],
          rotationAxis: [0, 1, 0],
          rotationAngle: 0.25,
          scale: [1.1, 1.1, 1.1],
          pivot: [0, 0, 0],
        },
      },
    })
    const transformPayload = parsePayload(transform)
    expect(transformPayload.valid).toBe(true)
    expect(transformPayload.preview.operation).toBe(MODELING_OPERATION_IDS.transformBody)

    const featureTransform = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.transformBody,
        nodeId: featureBody.id,
        input: {
          translation: [0, 0, 0],
          rotationAxis: [0, 1, 0],
          rotationAngle: 0,
          scale: [2, 1, 1],
          pivot: [0, 0, 0],
          feature: { kind: 'edge', featureId: 'edge:0' },
        },
      },
    })
    const featureTransformPayload = parsePayload(featureTransform)
    expect(featureTransformPayload.valid).toBe(true)
    expect(featureTransformPayload.preview.operation).toBe(MODELING_OPERATION_IDS.transformBody)

    const paint = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.paintBodyFace,
        nodeId: 'body_preflight',
        input: {
          faceId: 'face:0',
          material: {
            id: 'mat_mcp_preflight',
            name: 'Preflight red',
            material: { preset: 'custom', properties: { color: '#b91c1c' } },
          },
        },
      },
    })
    const paintPayload = parsePayload(paint)
    expect(paintPayload.valid).toBe(true)
    expect(paintPayload.preview.operation).toBe(MODELING_OPERATION_IDS.paintBodyFace)
    expect(paintPayload.preview.materialRef).toBe('scene:mat_mcp_preflight')

    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  test('preflights a Follow Path sweep without mutating scene or history', async () => {
    const before = JSON.stringify(bridge.exportJSON())
    const beforeHistory = bridge.getHistory()
    const input = {
      faceId: 'face:0',
      pathPoints: [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
      ],
    }

    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.sweepBodyFace,
        nodeId: 'body_preflight',
        input,
      },
    })
    const payload = parsePayload(result)
    const canonical = executeSweepBodyFace(
      BodyNode.parse({
        ...createRectangleBody({ width: 1.2, depth: 0.8 }),
        id: 'body_preflight',
      }),
      input,
    )

    expect(payload.valid).toBe(true)
    expect(payload.preview.operation).toBe(MODELING_OPERATION_IDS.sweepBodyFace)
    expect(payload.preview.closed).toBe(false)
    expect(payload.preview.movedFaceId).toBe('face:0')
    expect(JSON.stringify(payload.preview.body)).toBe(JSON.stringify(canonical.body))
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(beforeHistory)
  })

  for (const scenario of [
    {
      name: 'inward',
      fixture: () => ({
        body: makeOffsetSolid('body_preflight'),
        faceId: 'face:0',
        distance: -0.2,
      }),
    },
    { name: 'nested outward', fixture: () => makeNestedOffsetSource('body_preflight') },
  ]) {
    test(`offsetBodyFace preview returns the canonical ${scenario.name} result without mutation`, async () => {
      const fixture = scenario.fixture()
      bridge.setScene({ [fixture.body.id]: fixture.body }, [fixture.body.id])
      bridge.clearHistory()
      const beforeHash = getBodySemanticHash(fixture.body)
      const beforeRevision = fixture.body.revision
      const beforeHistory = bridge.getHistory()
      const canonical = executeOffsetBodyFace(fixture.body, {
        faceId: fixture.faceId,
        distance: fixture.distance,
      })

      const result = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: fixture.body.id,
          input: { faceId: fixture.faceId, distance: fixture.distance },
        },
      })
      const payload = parsePayload(result)

      expect(payload.valid).toBe(true)
      expect(payload.preview).toEqual(JSON.parse(JSON.stringify(canonical)))
      expect(payload.preview?.createdFaceId).toBe(canonical.createdFaceId)
      expect(payload.preview?.topologyRemap).toEqual(canonical.topologyRemap)
      const current = BodyNode.parse(bridge.getNode(fixture.body.id))
      expect(getBodySemanticHash(current)).toBe(beforeHash)
      expect(current.revision).toBe(beforeRevision)
      expect(bridge.getHistory()).toEqual(beforeHistory)
    })
  }

  test('offsetBodyFace invalid requests return operation.invalid without scene or history mutation', async () => {
    const wrongNode = SiteNode.parse({ id: 'site_preflight_wrong' })
    for (const fixture of invalidOffsetFixtures('body_preflight')) {
      bridge.setScene({ [fixture.body.id]: fixture.body }, [fixture.body.id])
      bridge.clearHistory()
      const beforeHash = getBodySemanticHash(fixture.body)
      const beforeRevision = fixture.body.revision

      const result = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: fixture.body.id,
          input: { faceId: fixture.faceId, distance: fixture.distance },
        },
      })
      const payload = parsePayload(result)

      expect(payload.valid).toBe(false)
      expect(payload.preview).toBeNull()
      expect(payload.diagnostics).toHaveLength(1)
      expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
      const current = BodyNode.parse(bridge.getNode(fixture.body.id))
      expect(getBodySemanticHash(current)).toBe(beforeHash)
      expect(current.revision).toBe(beforeRevision)
      expect(bridge.getHistory().pastCount).toBe(0)
      expect(operations.getActiveScene()?.version).toBe(7)
    }

    bridge.setScene({ [wrongNode.id]: wrongNode }, [wrongNode.id])
    bridge.clearHistory()
    const before = JSON.stringify(bridge.exportJSON())
    const result = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: wrongNode.id,
        input: { faceId: 'face:0', distance: -0.1 },
      },
    })
    const payload = parsePayload(result)
    expect(payload.valid).toBe(false)
    expect(payload.preview).toBeNull()
    expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory().pastCount).toBe(0)
    expect(operations.getActiveScene()?.version).toBe(7)
  })
})
