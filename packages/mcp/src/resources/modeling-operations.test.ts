import '../bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MODELING_OPERATION_MANIFEST } from '@pascal-app/core/modeling-operations'
import { SceneBridge } from '../bridge/scene-bridge'
import { MODELING_OPERATIONS_RESOURCE_URI, registerModelingOperations } from './modeling-operations'

describe('pascal://modeling/operations', () => {
  test('serves the canonical machine-readable manifest', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerModelingOperations(server, new SceneBridge())
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const response = await client.readResource({ uri: MODELING_OPERATIONS_RESOURCE_URI })
      const content = response.contents[0]
      if (!content || !('text' in content)) throw new TypeError('Expected text resource content')
      expect(content.mimeType).toBe('application/json')
      const decoded: unknown = JSON.parse(content.text)
      expect(decoded).toEqual(MODELING_OPERATION_MANIFEST)
      const offset = MODELING_OPERATION_MANIFEST.operations.find(
        (operation) => operation.id === 'offsetBodyFace',
      )
      expect(offset).toEqual({
        id: 'offsetBodyFace',
        version: 1,
        targetNodeTypes: ['body'],
        targetFeatures: ['face'],
        inputSchema: 'offsetBodyFace',
        input: {
          fields: {
            faceId: { type: 'feature-id', required: true },
            distance: { type: 'length', required: true, canonicalUnit: 'm', nonZero: true },
          },
        },
        preview: { available: true, mutatesScene: false },
        commit: { available: true, undo: 'single' },
        surfaces: { direct: ['3d'], internalAi: true, mcp: true },
        interaction: {
          snap: {
            tiers: ['endpoint', 'midpoint', 'edge', 'face'],
            markerTokenPrefix: 'manipulation-snap:',
          },
          modifiers: { shift: 'cycle-context', alt: 'raw-bypass' },
          typedInput: true,
          commit: ['click', 'enter'],
          cancel: 'escape',
          previewEqualsCommit: true,
          cancelImmutable: true,
          history: 'single-undo',
          serialization: 'round-trip',
        },
      })
      expect(MODELING_OPERATION_MANIFEST.operations.map((operation) => operation.id)).toContain(
        'sweepBodyFace',
      )
    } finally {
      await client.close()
      await server.close()
    }
  })
})
