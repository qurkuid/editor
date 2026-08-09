import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerCreateProject } from './create-project'
import { registerGetProjectStatus } from './get-project-status'
import { registerOpenProject } from './open-project'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

describe('project lifecycle tools', () => {
  let client: Client
  let store: InMemorySceneStore
  let bridge: SceneBridge

  beforeEach(async () => {
    store = new InMemorySceneStore()
    bridge = new SceneBridge()
    const { operations } = createTestSceneOperations({ bridge, store })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateProject(server, operations)
    registerGetProjectStatus(server, operations)
    registerOpenProject(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a project and returns an editor URL', async () => {
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'Dogfood house' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('Dogfood house')
    expect(typeof parsed.projectId).toBe('string')
    expect(parsed.editorUrl).toBe(`/editor/${parsed.projectId}`)
    expect(parsed.nodeCount).toBe(0)
    expect(parsed.nextStep).toContain('save_scene')
  })

  test('reports status for an existing project', async () => {
    const project = await store.createProject({ name: 'Status house' })
    const result = await client.callTool({
      name: 'get_project_status',
      arguments: { id: project.projectId },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.projectId).toBe(project.projectId)
    expect(parsed.editorUrl).toBe(`/editor/${project.projectId}`)
    expect(parsed.nodeCount).toBe(0)
  })

  test('create_project clears the previous graph and history before binding the new project', async () => {
    bridge.loadDefault()
    const oldRootIds = bridge.getRootNodeIds()
    expect(oldRootIds.length).toBeGreaterThan(0)
    const oldLevel = bridge.findNodes({ type: 'level' })[0]
    if (!oldLevel) throw new Error('test fixture missing level')
    bridge.updateNode(oldLevel.id, { label: 'Previous project edit' })
    expect(bridge.getHistory().pastCount).toBeGreaterThan(0)

    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'Fresh project' },
    })

    expect(result.isError).toBeFalsy()
    expect(bridge.getRootNodeIds()).toEqual([])
    expect(Object.keys(bridge.getNodes())).toHaveLength(0)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(bridge.getActiveScene()?.id).toBe(parsed.id)
  })

  test('open_project loads a saved graph and binds it as active', async () => {
    bridge.loadDefault()
    const oldLevel = bridge.findNodes({ type: 'level' })[0]
    if (!oldLevel) throw new Error('test fixture missing level')
    bridge.updateNode(oldLevel.id, { label: 'Previous project edit' })
    expect(bridge.getHistory().pastCount).toBeGreaterThan(0)
    const storedGraph = {
      nodes: {
        site_opened: { id: 'site_opened', type: 'site', parentId: null, children: [] },
      },
      rootNodeIds: ['site_opened'],
    }
    await store.save({ id: 'opened-project', name: 'Opened project', graph: storedGraph as never })

    const result = await client.callTool({
      name: 'open_project',
      arguments: { id: 'opened-project' },
    })

    expect(result.isError).toBeFalsy()
    expect(bridge.getRootNodeIds()).toEqual(['site_opened'])
    expect(bridge.getActiveScene()?.id).toBe('opened-project')
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
  })

  test('open_project binds an empty project without retaining the previous graph', async () => {
    bridge.loadDefault()
    await store.createProject({ id: 'empty-project', name: 'Empty project' })

    const result = await client.callTool({
      name: 'open_project',
      arguments: { id: 'empty-project' },
    })

    expect(result.isError).toBeFalsy()
    expect(bridge.getRootNodeIds()).toEqual([])
    expect(Object.keys(bridge.getNodes())).toHaveLength(0)
    expect(bridge.getActiveScene()?.id).toBe('empty-project')
  })

  test('get_project_status does not switch the active graph when asked about another project', async () => {
    const firstGraph = {
      nodes: {
        site_first: { id: 'site_first', type: 'site', parentId: null, children: [] },
      },
      rootNodeIds: ['site_first'],
    }
    const secondGraph = {
      nodes: {
        site_second: { id: 'site_second', type: 'site', parentId: null, children: [] },
      },
      rootNodeIds: ['site_second'],
    }
    await store.save({ id: 'first-project', name: 'First', graph: firstGraph as never })
    await store.save({ id: 'second-project', name: 'Second', graph: secondGraph as never })
    await client.callTool({ name: 'open_project', arguments: { id: 'first-project' } })

    const result = await client.callTool({
      name: 'get_project_status',
      arguments: { id: 'second-project' },
    })

    expect(result.isError).toBeFalsy()
    expect(bridge.getActiveScene()?.id).toBe('first-project')
    expect(bridge.getRootNodeIds()).toEqual(['site_first'])
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.activeProjectId).toBe('first-project')
    expect(parsed.isActive).toBe(false)
  })
})
