import '../bridge/node-shims'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createRectangleBody, getBodySemanticHash } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  executeOffsetBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { BodyNode, SiteNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from '../operations'
import type { SceneMeta, SceneSaveOptions, SceneStore } from '../storage/types'
import { CommitModelingOperationPayloadSchema } from './commit-modeling-operation'
import { registerTools } from './index'
import {
  invalidOffsetFixtures,
  makeNestedOffsetSource,
  makeOffsetSolid,
} from './modeling-operation-offset-test-fixtures'
import { PreflightModelingOperationPayloadSchema } from './preflight-modeling-operation'
import { InMemorySceneStore } from './scene-lifecycle/test-utils'

class PublishFailureSceneStore extends InMemorySceneStore {
  override async save(options: SceneSaveOptions): Promise<SceneMeta> {
    return {
      id: options.id ?? 'offset-conflict',
      name: options.name,
      projectId: options.projectId ?? null,
      thumbnailUrl: options.thumbnailUrl ?? null,
      version: (options.expectedVersion ?? 0) + 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:01.000Z',
      ownerId: options.ownerId ?? null,
      sizeBytes: JSON.stringify(options.graph).length,
      nodeCount: Object.keys(options.graph.nodes).length,
    }
  }

  async appendSceneEvent(): Promise<never> {
    throw new Error('Task 6 event publication failure')
  }
}

function parsePayload(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new TypeError('Expected text tool content')
  const decoded: unknown = JSON.parse(content.text)
  return CommitModelingOperationPayloadSchema.parse(decoded)
}

function parsePreflightPayload(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new TypeError('Expected text tool content')
  const decoded: unknown = JSON.parse(content.text)
  return PreflightModelingOperationPayloadSchema.parse(decoded)
}

describe('commit_modeling_operation', () => {
  let bridge: SceneBridge
  let client: Client
  let operations: SceneOperations
  let server: McpServer

  beforeEach(async () => {
    bridge = new SceneBridge()
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_commit',
    })
    bridge.setScene({ [body.id]: body }, [body.id])
    bridge.clearHistory()
    operations = createSceneOperations({ bridge })
    operations.setActiveScene({
      id: 'commit-scene',
      name: 'Commit scene',
      projectId: null,
      thumbnailUrl: null,
      version: 11,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      ownerId: null,
      sizeBytes: 0,
      nodeCount: 1,
    })
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerTools(server, operations)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  test('registers the canonical commit tool', async () => {
    // Given
    const tools = await client.listTools()

    // When
    const names = tools.tools.map((tool) => tool.name)

    // Then
    expect(names).toContain('commit_modeling_operation')
  })

  test('commits once and exposes one undo step for a valid Push/Pull request', async () => {
    // Given
    const before = bridge.exportJSON()
    const historyBefore = bridge.getHistory()

    // When
    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: 'body_commit',
        input: { faceId: 'face:0', distance: 1.2 },
      },
    })

    // Then
    const payload = parsePayload(result)
    expect(result.isError).toBeFalsy()
    expect(payload.success).toBe(true)
    expect(payload.result?.operation).toBe(MODELING_OPERATION_IDS.pushPullBodyFace)
    expect(payload.result?.version).toBe(1)
    expect(payload.historySteps).toBe(1)
    expect(payload.affectedNodeIds).toEqual(['body_commit'])
    expect(bridge.getHistory().pastCount).toBe(historyBefore.pastCount + 1)
    expect(bridge.getNode('body_commit')).not.toEqual(before.nodes.body_commit)
    expect(bridge.undo()).toBe(1)
    expect(bridge.getNode('body_commit')).toEqual(before.nodes.body_commit)
  })

  test('does not mutate scene or history for an invalid request', async () => {
    // Given
    const before = JSON.stringify(bridge.exportJSON())
    const historyBefore = bridge.getHistory()

    // When
    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: 'body_commit',
        input: { faceId: 'face:not-found', distance: 1.2 },
      },
    })

    // Then
    const payload = parsePayload(result)
    expect(result.isError).toBeFalsy()
    expect(payload.success).toBe(false)
    expect(payload.result).toBeNull()
    expect(payload.historySteps).toBe(0)
    expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(historyBefore)
  })

  test('offsetBodyFace commit publishes the committed scene snapshot to live subscribers', async () => {
    const solid = makeOffsetSolid('body_commit')
    bridge.setScene({ [solid.id]: solid }, [solid.id])
    bridge.clearHistory()
    const expected = executeOffsetBodyFace(solid, { faceId: 'face:0', distance: -0.2 })
    const now = new Date().toISOString()
    const savedMeta: SceneMeta = {
      id: 'live-commit',
      name: 'Live Commit',
      projectId: null,
      thumbnailUrl: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ownerId: null,
      sizeBytes: 0,
      nodeCount: Object.keys(bridge.getNodes()).length,
    }
    const savedGraphs: SceneGraph[] = []
    const eventKinds: string[] = []
    const store: SceneStore = {
      backend: 'sqlite',
      async save(options) {
        savedGraphs.push(options.graph)
        return {
          ...savedMeta,
          version: 2,
          updatedAt: new Date().toISOString(),
          sizeBytes: JSON.stringify(options.graph).length,
          nodeCount: Object.keys(options.graph.nodes).length,
        }
      },
      async load() {
        return null
      },
      async list() {
        return []
      },
      async delete() {
        return false
      },
      async rename() {
        return savedMeta
      },
      async appendSceneEvent(options) {
        eventKinds.push(options.kind)
        return {
          eventId: 1,
          sceneId: options.sceneId,
          version: options.version,
          kind: options.kind,
          createdAt: new Date().toISOString(),
          graph: options.graph,
        }
      },
    }
    const liveOperations = createSceneOperations({ bridge, store })
    liveOperations.setActiveScene(savedMeta)
    const liveServer = new McpServer({ name: 'test-live', version: '0.0.0' })
    const liveClient = new Client({ name: 'test-live-client', version: '0.0.0' })
    registerTools(liveServer, liveOperations)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([liveServer.connect(serverTransport), liveClient.connect(clientTransport)])

    try {
      const result = await liveClient.callTool({
        name: 'commit_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: 'body_commit',
          input: { faceId: 'face:0', distance: -0.2 },
        },
      })
      const payload = parsePayload(result)

      expect(result.isError).toBeFalsy()
      expect(payload.success).toBe(true)
      expect(savedGraphs).toHaveLength(1)
      expect(getBodySemanticHash(BodyNode.parse(savedGraphs[0]?.nodes.body_commit))).toBe(
        getBodySemanticHash(expected.body),
      )
      expect(eventKinds).toEqual(['commit_modeling_operation'])
      expect(bridge.getActiveScene()?.version).toBe(2)
    } finally {
      await liveClient.close()
      await liveServer.close()
    }
  })

  test('offsetBodyFace publish failure restores scene, history branches, and active version', async () => {
    const solid = makeOffsetSolid('body_commit')
    bridge.setScene({ [solid.id]: solid }, [solid.id])
    const collectionId = useScene.getState().createCollection('Rollback proof', [solid.id])
    useScene.getState().setInstalledPlugins(['pascal:rollback-proof'], { explicit: true })
    bridge.clearHistory()
    bridge.updateNode(solid.id, { visible: false })
    bridge.updateNode(solid.id, { visible: true })
    expect(bridge.undo()).toBe(1)
    const beforeGraph = bridge.exportJSON()
    const beforeBody = BodyNode.parse(beforeGraph.nodes[solid.id])
    const beforeHistory = bridge.getHistory()
    const beforeVersion = 23
    const conflictOperations = createSceneOperations({
      bridge,
      store: new PublishFailureSceneStore(),
    })
    conflictOperations.setActiveScene({
      id: 'offset-conflict',
      name: 'Offset conflict',
      projectId: null,
      thumbnailUrl: null,
      version: beforeVersion,
      ownerId: null,
    })
    const conflictServer = new McpServer({ name: 'test-conflict', version: '0.0.0' })
    const conflictClient = new Client({ name: 'test-conflict-client', version: '0.0.0' })
    registerTools(conflictServer, conflictOperations)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([
      conflictServer.connect(serverTransport),
      conflictClient.connect(clientTransport),
    ])

    try {
      const result = await conflictClient.callTool({
        name: 'commit_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: solid.id,
          input: { faceId: 'face:0', distance: -0.2 },
        },
      })
      const payload = parsePayload(result)

      expect(payload.success).toBe(false)
      expect(payload.result).toBeNull()
      expect(payload.historySteps).toBe(0)
      expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
      expect(payload.diagnostics[0]?.message).toContain('live_sync_failed')
      expect(bridge.exportJSON()).toEqual(beforeGraph)
      const restoredBody = BodyNode.parse(bridge.getNode(solid.id))
      expect(getBodySemanticHash(restoredBody)).toBe(getBodySemanticHash(beforeBody))
      expect(restoredBody.revision).toBe(beforeBody.revision)
      expect(useScene.getState().collections).toEqual(beforeGraph.collections)
      expect(useScene.getState().collections[collectionId]?.nodeIds).toEqual([solid.id])
      expect(useScene.getState().installedPlugins).toEqual(['pascal:rollback-proof'])
      expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)
      expect(bridge.getHistory()).toEqual(beforeHistory)
      expect(conflictOperations.getActiveScene()).toEqual({
        id: 'offset-conflict',
        name: 'Offset conflict',
        projectId: null,
        thumbnailUrl: null,
        version: beforeVersion,
        ownerId: null,
      })
      expect(bridge.redo()).toBe(1)
      expect(bridge.getNode(solid.id)?.visible).toBe(true)
    } finally {
      await conflictClient.close()
      await conflictServer.close()
    }
  })

  test('commits imprint and transform through the canonical dispatcher', async () => {
    const solid = executePushPullBodyFace(
      BodyNode.parse({
        ...createRectangleBody({ width: 2, depth: 2 }),
        id: 'body_commit',
      }),
      { faceId: 'face:0', distance: 1 },
    ).body
    bridge.setScene({ [solid.id]: solid }, [solid.id])
    bridge.clearHistory()
    const before = bridge.exportJSON().nodes.body_commit
    const historyBefore = bridge.getHistory()

    const imprint = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        nodeId: 'body_commit',
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
    expect(imprintPayload.success).toBe(true)
    expect(imprintPayload.result?.operation).toBe(MODELING_OPERATION_IDS.imprintBodyFace)
    expect(imprintPayload.result?.insetFaceId).toBe('face:0:imprint:2')
    expect(imprintPayload.historySteps).toBe(1)
    expect(bridge.getHistory().pastCount).toBe(historyBefore.pastCount + 1)

    expect(bridge.undo()).toBe(1)
    expect(JSON.stringify(bridge.getNode('body_commit'))).toBe(JSON.stringify(before))

    const transform = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.transformBody,
        nodeId: 'body_commit',
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
    expect(transformPayload.success).toBe(true)
    expect(transformPayload.result?.operation).toBe(MODELING_OPERATION_IDS.transformBody)
    expect(transformPayload.historySteps).toBe(1)
  })

  test('commits offset through the canonical dispatcher in one undo step', async () => {
    const solid = executePushPullBodyFace(
      BodyNode.parse({
        ...createRectangleBody({ width: 2, depth: 2 }),
        id: 'body_commit',
      }),
      { faceId: 'face:0', distance: 1 },
    ).body
    bridge.setScene({ [solid.id]: solid }, [solid.id])
    bridge.clearHistory()
    const before = bridge.exportJSON().nodes.body_commit
    const expected = executeOffsetBodyFace(solid, { faceId: 'face:0', distance: -0.25 })
    const historyBefore = bridge.getHistory()

    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: 'body_commit',
        input: { faceId: 'face:0', distance: -0.25 },
      },
    })
    const payload = parsePayload(result)

    expect(result.isError).toBeFalsy()
    expect(payload.success).toBe(true)
    expect(payload.result?.operation).toBe(MODELING_OPERATION_IDS.offsetBodyFace)
    expect(payload.result?.sourceFaceId).toBe('face:0')
    expect(payload.result?.createdFaceId).toBe('face:0:offset:2')
    expect(payload.historySteps).toBe(1)
    expect(getBodySemanticHash(BodyNode.parse(payload.result?.body))).toBe(
      getBodySemanticHash(expected.body),
    )
    expect(bridge.getHistory().pastCount).toBe(historyBefore.pastCount + 1)
    expect(bridge.undo()).toBe(1)
    expect(getBodySemanticHash(BodyNode.parse(bridge.getNode('body_commit')))).toBe(
      getBodySemanticHash(BodyNode.parse(before)),
    )
  })

  for (const scenario of [
    {
      name: 'inward',
      fixture: () => ({ body: makeOffsetSolid('body_commit'), faceId: 'face:0', distance: -0.2 }),
    },
    { name: 'nested outward', fixture: () => makeNestedOffsetSource('body_commit') },
  ]) {
    test(`offsetBodyFace commit equals ${scenario.name} preview and supports undo`, async () => {
      const fixture = scenario.fixture()
      bridge.setScene({ [fixture.body.id]: fixture.body }, [fixture.body.id])
      bridge.clearHistory()
      const beforeHash = getBodySemanticHash(fixture.body)
      const beforeRevision = fixture.body.revision
      const input = { faceId: fixture.faceId, distance: fixture.distance }

      const previewResult = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: fixture.body.id,
          input,
        },
      })
      const preview = parsePreflightPayload(previewResult)
      expect(preview.valid).toBe(true)
      expect(getBodySemanticHash(BodyNode.parse(bridge.getNode(fixture.body.id)))).toBe(beforeHash)
      expect(BodyNode.parse(bridge.getNode(fixture.body.id)).revision).toBe(beforeRevision)
      expect(bridge.getHistory().pastCount).toBe(0)

      const commitResult = await client.callTool({
        name: 'commit_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: fixture.body.id,
          input,
        },
      })
      const commit = parsePayload(commitResult)

      expect(commit.success).toBe(true)
      expect(commit.result).toEqual(preview.preview)
      expect(commit.result?.createdFaceId).toBe(preview.preview?.createdFaceId)
      expect(commit.result?.topologyRemap).toEqual(preview.preview?.topologyRemap)
      expect(commit.historySteps).toBe(1)
      expect(bridge.getHistory().pastCount).toBe(1)
      expect(bridge.undo()).toBe(1)
      const restored = BodyNode.parse(bridge.getNode(fixture.body.id))
      expect(getBodySemanticHash(restored)).toBe(beforeHash)
      expect(restored.revision).toBe(beforeRevision)
    })
  }

  test('offsetBodyFace invalid requests return operation.invalid with zero history steps', async () => {
    const wrongNode = SiteNode.parse({ id: 'site_commit_wrong' })
    for (const fixture of invalidOffsetFixtures('body_commit')) {
      bridge.setScene({ [fixture.body.id]: fixture.body }, [fixture.body.id])
      bridge.clearHistory()
      const beforeHash = getBodySemanticHash(fixture.body)
      const beforeRevision = fixture.body.revision

      const result = await client.callTool({
        name: 'commit_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.offsetBodyFace,
          nodeId: fixture.body.id,
          input: { faceId: fixture.faceId, distance: fixture.distance },
        },
      })
      const payload = parsePayload(result)

      expect(payload.success).toBe(false)
      expect(payload.result).toBeNull()
      expect(payload.historySteps).toBe(0)
      expect(payload.diagnostics).toHaveLength(1)
      expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
      const current = BodyNode.parse(bridge.getNode(fixture.body.id))
      expect(getBodySemanticHash(current)).toBe(beforeHash)
      expect(current.revision).toBe(beforeRevision)
      expect(bridge.getHistory().pastCount).toBe(0)
      expect(operations.getActiveScene()?.version).toBe(11)
    }

    bridge.setScene({ [wrongNode.id]: wrongNode }, [wrongNode.id])
    bridge.clearHistory()
    const before = JSON.stringify(bridge.exportJSON())
    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: wrongNode.id,
        input: { faceId: 'face:0', distance: -0.1 },
      },
    })
    const payload = parsePayload(result)
    expect(payload.success).toBe(false)
    expect(payload.result).toBeNull()
    expect(payload.historySteps).toBe(0)
    expect(payload.diagnostics[0]?.code).toBe('operation.invalid')
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory().pastCount).toBe(0)
    expect(operations.getActiveScene()?.version).toBe(11)
  })

  test('commits Follow Path sweep through the canonical dispatcher in one undo step', async () => {
    const before = bridge.exportJSON().nodes.body_commit
    const source = BodyNode.parse(before)
    const input = {
      faceId: 'face:0',
      pathPoints: [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
      ],
    }
    const expected = executeSweepBodyFace(source, input)
    const historyBefore = bridge.getHistory()

    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.sweepBodyFace,
        nodeId: 'body_commit',
        input,
      },
    })
    const payload = parsePayload(result)

    expect(result.isError).toBeFalsy()
    expect(payload.success).toBe(true)
    expect(payload.result?.operation).toBe(MODELING_OPERATION_IDS.sweepBodyFace)
    expect(payload.result?.movedFaceId).toBe('face:0')
    expect(payload.result?.closed).toBe(false)
    expect(payload.historySteps).toBe(1)
    expect(getBodySemanticHash(BodyNode.parse(payload.result?.body))).toBe(
      getBodySemanticHash(expected.body),
    )
    expect(bridge.getHistory().pastCount).toBe(historyBefore.pastCount + 1)
    expect(bridge.undo()).toBe(1)
    expect(getBodySemanticHash(BodyNode.parse(bridge.getNode('body_commit')))).toBe(
      getBodySemanticHash(source),
    )
  })

  test('commits paint material and Body ref in one undo step', async () => {
    const before = bridge.exportJSON().nodes.body_commit
    useScene.getState().removeSceneMaterial('mat_mcp_commit')
    useScene.temporal.getState().clear()
    const historyBefore = bridge.getHistory()

    const result = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.paintBodyFace,
        nodeId: 'body_commit',
        input: {
          faceId: 'face:0',
          material: {
            id: 'mat_mcp_commit',
            name: 'Commit red',
            material: { preset: 'custom', properties: { color: '#b91c1c' } },
          },
        },
      },
    })
    const payload = parsePayload(result)

    expect(payload.success).toBe(true)
    expect(payload.result?.operation).toBe(MODELING_OPERATION_IDS.paintBodyFace)
    expect(payload.result?.materialRef).toBe('scene:mat_mcp_commit')
    expect(payload.historySteps).toBe(1)
    expect(useScene.getState().materials.mat_mcp_commit).toBeDefined()
    expect(BodyNode.parse(bridge.getNode('body_commit')).faces[0]?.surface.materialRef).toBe(
      'scene:mat_mcp_commit',
    )
    expect(bridge.getHistory().pastCount).toBe(historyBefore.pastCount + 1)

    expect(bridge.undo()).toBe(1)
    expect(bridge.getNode('body_commit')).toEqual(before)
    expect(useScene.getState().materials.mat_mcp_commit).toBeUndefined()
  })
})
