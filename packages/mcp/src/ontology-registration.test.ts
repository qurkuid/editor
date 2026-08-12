import './bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createRectangleBody } from '@pascal-app/core'
import { MODELING_OPERATION_IDS } from '@pascal-app/core/modeling-operations'
import { BodyNode, WallNode, WindowNode } from '@pascal-app/core/schema'
import { SceneBridge } from './bridge/scene-bridge'
import { createSceneOperations } from './operations'
import { registerResources } from './resources'
import { registerTools } from './tools'

describe('Phase 2 ontology MCP registration', () => {
  test('exposes the manifest resource and ontology tools', async () => {
    const bridge = new SceneBridge()
    const wall = WallNode.parse({ id: 'wall_mcp_ontology', start: [0, 0], end: [3, 0] })
    const window = WindowNode.parse({
      id: 'window_mcp_ontology',
      wallId: wall.id,
      parentId: wall.id,
    })
    bridge.setScene({ [wall.id]: wall, [window.id]: window }, [wall.id])
    bridge.clearHistory()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerResources(server, createSceneOperations({ bridge }))
    registerTools(server, createSceneOperations({ bridge }))
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const resources = await client.listResources()
      const tools = await client.listTools()

      expect(resources.resources.map((resource) => resource.uri)).toContain(
        'pascal://ontology/manifest',
      )
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['query_design_ontology', 'explain_design_rule']),
      )

      const manifest = await client.readResource({ uri: 'pascal://ontology/manifest' })
      const manifestText = manifest.contents[0]
      if (!manifestText || !('text' in manifestText)) throw new Error('Expected manifest text')
      const manifestPayload = JSON.parse(manifestText.text)
      expect(manifestPayload.status).toBe('available')
      expect(manifestPayload.manifest.packId).toBe('pascal-architecture-core')
      expect(manifestPayload.manifest.version).toBe('1.0.0')

      const wallResult = await client.callTool({
        name: 'query_design_ontology',
        arguments: { query: 'wall', maxResults: 1, maxNodes: 2 },
      })
      const wallContent = wallResult.content[0]
      if (wallContent?.type !== 'text') throw new Error('Expected wall text')
      const wallPayload = JSON.parse(wallContent.text)
      expect(wallPayload.status).toBe('available')
      expect(wallPayload.results[0].id).toBe('pascal:architecture/wall')
      expect(wallPayload.results[0].evidence.length).toBeGreaterThan(0)

      const windowResult = await client.callTool({
        name: 'query_design_ontology',
        arguments: { nodeId: window.id, maxNodes: 5 },
      })
      const windowContent = windowResult.content[0]
      if (windowContent?.type !== 'text') throw new Error('Expected window text')
      const windowPayload = JSON.parse(windowContent.text)
      expect(windowPayload.scene.hostWall.nodeId).toBe(wall.id)
      expect(windowPayload.results[0].semanticRef.version).toBe('1.0.0')

      const ruleResult = await client.callTool({
        name: 'explain_design_rule',
        arguments: { ruleId: 'pascal:rule/window-hosted-by-wall', maxNodes: 2 },
      })
      const ruleContent = ruleResult.content[0]
      if (ruleContent?.type !== 'text') throw new Error('Expected rule text')
      const rulePayload = JSON.parse(ruleContent.text)
      expect(rulePayload.status).toBe('available')
      expect(rulePayload.rule.id).toBe('pascal:rule/window-hosted-by-wall')
      expect(rulePayload.rule.evidence[0].id).toBe('evidence:window-rule')
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('keeps the existing modeling operation usable after an invalid pack response', async () => {
    const bridge = new SceneBridge()
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_after_invalid_pack',
    })
    bridge.setScene({ [body.id]: body }, [body.id])
    bridge.clearHistory()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerTools(server, createSceneOperations({ bridge }))
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const root = await mkdtemp(join(tmpdir(), 'pascal-invalid-pack-mcp-'))
    const previousPackPath = process.env.PASCAL_ONTOLOGY_PACK_PATH

    try {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ packId: 'wrong' }))
      process.env.PASCAL_ONTOLOGY_PACK_PATH = root
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

      const invalid = await client.callTool({
        name: 'query_design_ontology',
        arguments: { query: 'wall' },
      })
      const invalidContent = invalid.content[0]
      if (invalidContent?.type !== 'text') throw new Error('Expected invalid text')
      expect(JSON.parse(invalidContent.text).status).toBe('invalid')

      const preflight = await client.callTool({
        name: 'preflight_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
          nodeId: body.id,
          input: { faceId: 'face:0', distance: 0.2 },
        },
      })
      const preflightContent = preflight.content[0]
      if (preflightContent?.type !== 'text') {
        throw new Error('Expected preflight text')
      }
      expect(JSON.parse(preflightContent.text).valid).toBe(true)

      const commit = await client.callTool({
        name: 'commit_modeling_operation',
        arguments: {
          operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
          nodeId: body.id,
          input: { faceId: 'face:0', distance: 0.2 },
        },
      })
      const commitContent = commit.content[0]
      if (commitContent?.type !== 'text') throw new Error('Expected commit text')
      expect(JSON.parse(commitContent.text).success).toBe(true)
    } finally {
      if (previousPackPath === undefined) delete process.env.PASCAL_ONTOLOGY_PACK_PATH
      else process.env.PASCAL_ONTOLOGY_PACK_PATH = previousPackPath
      await client.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
