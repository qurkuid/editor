import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'

export async function buildDebugState(operations: SceneOperations) {
  const activeScene = operations.getActiveScene()
  const recentSceneEvents =
    activeScene && operations.canListSceneEvents
      ? await operations.listSceneEvents(activeScene.id, { limit: 20 })
      : []

  return {
    format: 'pascal.scene-debug.v1' as const,
    coordinateSystem: { groundPlane: 'XZ' as const, upAxis: 'Y' as const, unit: 'm' as const },
    activeScene,
    scene: {
      nodeCount: Object.keys(operations.getNodes()).length,
      rootNodeCount: operations.getRootNodeIds().length,
      history: operations.getHistory(),
      validation: operations.validateScene(),
    },
    store: {
      backend: operations.storeBackend,
      canAppendSceneEvents: operations.canAppendSceneEvents,
      canListSceneEvents: operations.canListSceneEvents,
    },
    execution: {
      recentSceneEvents: recentSceneEvents.map((event) => ({
        eventId: event.eventId,
        sceneId: event.sceneId,
        version: event.version,
        kind: event.kind,
        createdAt: event.createdAt,
        nodeCount: Object.keys(event.graph.nodes).length,
      })),
    },
  }
}

export function registerDebugState(server: McpServer, operations: SceneOperations): void {
  server.registerResource(
    'debug-state',
    'pascal://debug/state',
    {
      title: 'Pascal scene debug state',
      description:
        'Structured diagnostics for CLI and in-app agents: scene identity, history depth, schema validation, storage capabilities, and recent mutations.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await buildDebugState(operations)),
        },
      ],
    }),
  )
}
