import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MODELING_OPERATION_MANIFEST } from '@pascal-app/core/modeling-operations'
import type { SceneOperations } from '../operations'

export const MODELING_OPERATIONS_RESOURCE_URI = 'pascal://modeling/operations' as const

export function registerModelingOperations(server: McpServer, _operations: SceneOperations): void {
  server.registerResource(
    'modeling-operations',
    MODELING_OPERATIONS_RESOURCE_URI,
    {
      title: 'Pascal modeling operation manifest',
      description:
        'Canonical typed operation ids, inputs, units, targets, preview, undo, and exposed surfaces.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(MODELING_OPERATION_MANIFEST),
        },
      ],
    }),
  )
}
