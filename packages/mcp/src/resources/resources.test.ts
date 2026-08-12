// Side-effect import MUST come first: installs RAF polyfill before core loads.
import '../bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MODELING_OPERATION_ID_VALUES } from '@pascal-app/core/modeling-operations'
import { WallNode, ZoneNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { MODELING_AGENT_MANUAL } from '../modeling-agent-manual'
import { createSceneOperations } from '../operations'
import { registerAgentGuide } from './agent-guide'
import { registerCatalogItems } from './catalog-items'
import { registerConstraints } from './constraints'
import { registerDebugState } from './debug-state'
import { registerSceneCurrent } from './scene-current'
import { registerSceneSummary } from './scene-summary'

type ClientServerPair = {
  client: Client
  server: McpServer
  bridge: SceneBridge
  close: () => Promise<void>
}

async function spinUp(
  register: (server: McpServer, bridge: SceneBridge) => void,
): Promise<ClientServerPair> {
  const bridge = new SceneBridge()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  register(server, bridge)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    server,
    bridge,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

/** Reset the store between tests so temporal history and nodes don't leak. */
function resetScene(): void {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

describe('pascal://scene/current', () => {
  beforeEach(() => resetScene())

  test('returns the full scene JSON', async () => {
    const pair = await spinUp(registerSceneCurrent)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({ uri: 'pascal://scene/current' })
      expect(res.contents).toHaveLength(1)
      const content = res.contents[0]
      expect(content).toBeDefined()
      const c = content as { uri: string; mimeType?: string; text?: string }
      expect(c.mimeType).toBe('application/json')
      expect(c.uri).toBe('pascal://scene/current')
      const parsed = JSON.parse(c.text ?? '{}')
      expect(parsed).toHaveProperty('nodes')
      expect(parsed).toHaveProperty('rootNodeIds')
      expect(parsed).toHaveProperty('collections')
      expect(Array.isArray(parsed.rootNodeIds)).toBe(true)
      expect(parsed.rootNodeIds.length).toBeGreaterThan(0)
    } finally {
      await pair.close()
    }
  })

  test('reflects mutations to the store', async () => {
    const pair = await spinUp(registerSceneCurrent)
    try {
      pair.bridge.loadDefault()
      const beforeRes = await pair.client.readResource({
        uri: 'pascal://scene/current',
      })
      const beforeText = (beforeRes.contents[0] as { text: string }).text
      const before = JSON.parse(beforeText)
      const beforeCount = Object.keys(before.nodes).length

      // Add a zone.
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      const zone = ZoneNode.parse({
        name: 'Living',
        parentId: level.id,
        polygon: [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
        ],
      })
      pair.bridge.createNode(zone, level.id as never)

      const afterRes = await pair.client.readResource({
        uri: 'pascal://scene/current',
      })
      const afterText = (afterRes.contents[0] as { text: string }).text
      const after = JSON.parse(afterText)
      expect(Object.keys(after.nodes).length).toBe(beforeCount + 1)
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://scene/current/summary', () => {
  beforeEach(() => resetScene())

  test('returns markdown with counts and bbox', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('text/markdown')
      const text = content.text ?? ''
      expect(text.startsWith('# Scene summary')).toBe(true)
      expect(text).toContain('Sites:')
      expect(text).toContain('Buildings:')
      expect(text).toContain('Levels:')
      expect(text).toContain('Scene bbox')
    } finally {
      await pair.close()
    }
  })

  test('estimated floor area sums zone polygon areas', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      pair.bridge.loadDefault()
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      const zone = ZoneNode.parse({
        name: 'Big',
        parentId: level.id,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      })
      pair.bridge.createNode(zone, level.id as never)

      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const text = (res.contents[0] as { text: string }).text
      expect(text).toContain('12.00 m^2')
    } finally {
      await pair.close()
    }
  })

  test('empty scene returns a markdown skeleton without crashing', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      // deliberately do NOT call loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const text = (res.contents[0] as { text: string }).text
      expect(text.startsWith('# Scene summary')).toBe(true)
      expect(text).toContain('Total nodes: 0')
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://catalog/items', () => {
  beforeEach(() => resetScene())

  test('returns built-in catalog subset', async () => {
    const pair = await spinUp(registerCatalogItems)
    try {
      const res = await pair.client.readResource({ uri: 'pascal://catalog/items' })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('application/json')
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.status).toBe('ok')
      expect(parsed.items.length).toBeGreaterThan(0)
      expect(parsed.items.map((item: { id: string }) => item.id)).toContain('sofa')
      expect(typeof parsed.note).toBe('string')
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://agent-guide', () => {
  beforeEach(() => resetScene())

  test('agent guide returns MCP-first project guidance', async () => {
    const pair = await spinUp(registerAgentGuide)
    try {
      const res = await pair.client.readResource({ uri: 'pascal://agent-guide' })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('text/markdown')
      const text = content.text ?? ''
      expect(text).toBe(MODELING_AGENT_MANUAL)
      expect(text).toContain('# Pascal Modeling Agent Manual')
      expect(text).toContain('Read this manual before every modeling task')
      expect(text).toContain('create_project')
      expect(text).toContain('save_scene')
      expect(text).toContain('get_project_status')
      expect(text).toContain('editorUrl')
      expect(text).toContain('0 to 1 along the wall')
      expect(text).toContain('two-click point-to-point workflow')
      expect(text).toContain('unit face normal')
      expect(text).toContain("other elements' faces, edges, and points")
      expect(text).toContain('Shift (tap) cycles')
      expect(text).toContain('rejected preview')
      expect(text).toContain('preserve the live cursor sign')
      expect(text).toContain('The canonical Body operation ids are `pushPullBodyFace`')
      expect(text).toContain('preflight_modeling_operation')
      expect(text).toContain('commit_modeling_operation')
      for (const operationId of MODELING_OPERATION_ID_VALUES) {
        expect(text).toContain(`\`${operationId}\``)
      }
      const offsetConcepts = [
        'offsetBodyFace',
        'signed distance in metres',
        'distance > 0',
        'distance < 0',
        'deterministic miter',
        'preserves the source ring',
        'preserves the host outer region',
        'annular face',
        'source-region materials and UV frames',
        'stable existing ids',
        'topology remap',
        'closed planar line-edged Body face',
        'zero or non-finite distance',
        'missing face',
        'invalid Body topology',
        'open topology',
        'non-closed solid',
        'invalid outer loop',
        'non-planarity',
        'source inner loops',
        'referenced non-line curves',
        'reciprocal coplanar enclosing host',
        'missing or ambiguous hosts',
        'host boundary',
        'sibling hole',
        'exterior outward offsets',
        'parallel or collinear degenerate joins',
        'collapse',
        'reversed winding',
        'self-intersection',
        'explicit 3D face operation',
        'intentionally omitted from the floor-plan action menu',
        'select the Body, click Offset',
        'move perpendicular',
        'click or press Enter to commit',
        'ephemeral preview equals the committed result',
        'one topology update and one undo step',
        'Escape or cancel',
        'do not simulate pointer gestures',
      ]
      for (const concept of offsetConcepts) {
        expect(text).toContain(concept)
      }
    } finally {
      await pair.close()
    }
  })

  test('keeps the legacy agent guide URI as an alias', async () => {
    const pair = await spinUp(registerAgentGuide)
    try {
      const res = await pair.client.readResource({ uri: 'pascal://agent/guide' })
      const text = (res.contents[0] as { text?: string }).text ?? ''
      expect(text).toContain('Pascal Modeling Agent Manual')
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://constraints/{levelId}', () => {
  beforeEach(() => resetScene())

  test('returns slabs + wall footprints for a known level', async () => {
    const pair = await spinUp(registerConstraints)
    try {
      pair.bridge.loadDefault()
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      // Add a wall so wallPolygons is non-empty.
      const wall = WallNode.parse({
        parentId: level.id,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
      })
      pair.bridge.createNode(wall, level.id as never)

      const res = await pair.client.readResource({
        uri: `pascal://constraints/${level.id}`,
      })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('application/json')
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.levelId).toBe(level.id)
      expect(Array.isArray(parsed.slabs)).toBe(true)
      expect(Array.isArray(parsed.wallPolygons)).toBe(true)
      expect(parsed.wallPolygons.length).toBe(1)
      expect(parsed.wallPolygons[0].wallId).toBe(wall.id)
      expect(Array.isArray(parsed.wallPolygons[0].footprint)).toBe(true)
      expect(parsed.wallPolygons[0].footprint.length).toBeGreaterThan(0)
      // Each footprint point should be [x, y].
      for (const pt of parsed.wallPolygons[0].footprint) {
        expect(pt).toHaveLength(2)
      }
    } finally {
      await pair.close()
    }
  })

  test('returns {error:"level_not_found"} for unknown levelId', async () => {
    const pair = await spinUp(registerConstraints)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://constraints/level_nope',
      })
      const content = res.contents[0] as { text?: string }
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.error).toBe('level_not_found')
      expect(parsed.slabs).toEqual([])
      expect(parsed.wallPolygons).toEqual([])
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://debug/state', () => {
  beforeEach(() => resetScene())

  test('returns structural diagnostics without viewport data', async () => {
    const pair = await spinUp((server, bridge) =>
      registerDebugState(server, createSceneOperations({ bridge })),
    )
    try {
      pair.bridge.loadDefault()
      const response = await pair.client.readResource({ uri: 'pascal://debug/state' })
      const content = response.contents[0] as { mimeType?: string; text?: string }
      const payload = JSON.parse(content.text ?? '{}')

      expect(content.mimeType).toBe('application/json')
      expect(payload.scene.nodeCount).toBeGreaterThan(0)
      expect(payload.scene.history).toEqual({ pastCount: 1, futureCount: 0 })
      expect(payload.scene.validation.valid).toBe(true)
      expect(payload.store.backend).toBeNull()
      expect(payload.execution.recentSceneEvents).toEqual([])
      expect(payload).not.toHaveProperty('screenshot')
    } finally {
      await pair.close()
    }
  })
})
