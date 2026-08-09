import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MODELING_AGENT_MANUAL } from '../modeling-agent-manual'
import type { SceneOperations } from '../operations'

export const AGENT_GUIDE = MODELING_AGENT_MANUAL

export function registerAgentGuide(server: McpServer, _bridge: SceneOperations): void {
  server.registerResource(
    'agent-guide',
    'pascal://agent-guide',
    {
      title: 'Pascal modeling agent manual',
      description:
        'Shared modeling contract for MCP agents and the in-editor structured-plan agent.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: AGENT_GUIDE,
        },
      ],
    }),
  )

  server.registerResource(
    'agent-guide-legacy',
    'pascal://agent/guide',
    {
      title: 'Pascal MCP agent guide',
      description: 'Legacy URI for the Pascal MCP agent guide. Prefer pascal://agent-guide.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: AGENT_GUIDE,
        },
      ],
    }),
  )
}
