import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { activeSessionPayload } from './metadata'

export const getSessionContextInput = {}

export const getSessionContextOutput = {
  activeProjectId: z.string().nullable(),
  activeSceneId: z.string().nullable(),
  projectId: z.string().nullable(),
  sceneId: z.string().nullable(),
  name: z.string().nullable(),
  version: z.number().nullable(),
  editorUrl: z.string().nullable(),
  nextStep: z.string(),
}

export function registerGetSessionContext(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'get_session_context',
    {
      title: 'Get session context',
      description:
        'Return the project and scene explicitly bound to this MCP server session, or the exact create_project/open_project next step when none is active.',
      inputSchema: getSessionContextInput,
      outputSchema: getSessionContextOutput,
    },
    async () => {
      const payload = activeSessionPayload(
        operations,
        operations.getActiveScene()
          ? 'The active project is bound to this MCP session. Continue with scene tools.'
          : 'No project is active. Call create_project for a new project or open_project with a saved project id.',
      )
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
