import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../../bridge/scene-bridge'
import { createPascalMcpServer } from '../../server'
import { InMemorySceneStore, parseToolText, type StoredTextContent } from './test-utils'

describe('project-scoped MCP workflow', () => {
  let client: Client
  let store: InMemorySceneStore

  beforeEach(async () => {
    store = new InMemorySceneStore()
    const server = createPascalMcpServer({
      bridge: new SceneBridge(),
      store,
      name: 'project-session-test',
      version: '0.0.0',
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'project-session-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  afterEach(async () => {
    await client.close()
  })

  test('isolates projects and restores the explicitly opened project', async () => {
    const inactive = await client.callTool({ name: 'get_session_context', arguments: {} })
    expect(parseToolText(inactive.content as StoredTextContent[]).activeProjectId).toBeNull()

    const site = SiteNode.parse({ children: [] })
    const blockedMutation = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: site }] },
    })
    expect(blockedMutation.isError).toBe(true)
    expect((blockedMutation.content[0] as StoredTextContent).text).toContain(
      'active project is required',
    )

    const createdA = await client.callTool({
      name: 'create_project',
      arguments: { id: 'project-a', name: 'Project A' },
    })
    expect(createdA.isError).toBeFalsy()

    const applied = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: site }] },
    })
    expect(applied.isError).toBeFalsy()

    const savedA = await client.callTool({
      name: 'save_scene',
      arguments: {
        id: 'project-a',
        projectId: 'project-a',
        name: 'Project A',
        saveMode: 'draft',
      },
    })
    expect(savedA.isError).toBeFalsy()

    const createdB = await client.callTool({
      name: 'create_project',
      arguments: { id: 'project-b', name: 'Project B' },
    })
    expect(createdB.isError).toBeFalsy()
    const emptyB = await client.callTool({ name: 'get_scene', arguments: {} })
    expect(
      Object.keys(parseToolText(emptyB.content as StoredTextContent[]).nodes as object),
    ).toEqual([])

    const inspectedA = await client.callTool({
      name: 'get_project_status',
      arguments: { id: 'project-a' },
    })
    const inspectedPayload = parseToolText(inspectedA.content as StoredTextContent[])
    expect(inspectedPayload.activeProjectId).toBe('project-b')
    expect(inspectedPayload.isActive).toBe(false)

    const openedA = await client.callTool({
      name: 'open_project',
      arguments: { id: 'project-a' },
    })
    expect(openedA.isError).toBeFalsy()
    const restoredA = await client.callTool({ name: 'get_scene', arguments: {} })
    const restoredPayload = parseToolText(restoredA.content as StoredTextContent[])
    expect(Object.keys(restoredPayload.nodes as object)).toEqual([site.id])

    const scenes = await client.callTool({ name: 'list_scenes', arguments: {} })
    const scenesPayload = parseToolText(scenes.content as StoredTextContent[])
    expect(scenesPayload.activeSceneId).toBe('project-a')
    expect(
      (scenesPayload.scenes as { id: string; isActive: boolean }[]).find(
        (scene) => scene.id === 'project-a',
      )?.isActive,
    ).toBe(true)
  })
})
