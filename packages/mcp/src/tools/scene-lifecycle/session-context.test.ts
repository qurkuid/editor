import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerGetSessionContext } from './get-session-context'
import { createTestSceneOperations, parseToolText, type StoredTextContent } from './test-utils'

describe('get_session_context', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    const { operations } = createTestSceneOperations({ bridge })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerGetSessionContext(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns a precise create-project next step before a project is active', async () => {
    const result = await client.callTool({ name: 'get_session_context', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.activeProjectId).toBeNull()
    expect(parsed.nextStep).toContain('create_project')
  })

  test('returns active project identity after binding', async () => {
    bridge.setActiveScene({
      id: 'project-1',
      projectId: 'project-1',
      name: 'Project one',
      ownerId: null,
      thumbnailUrl: null,
      version: 3,
    })

    const result = await client.callTool({ name: 'get_session_context', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.activeProjectId).toBe('project-1')
    expect(parsed.activeSceneId).toBe('project-1')
    expect(parsed.version).toBe(3)
    expect(parsed.editorUrl).toBe('/editor/project-1')
  })
})
