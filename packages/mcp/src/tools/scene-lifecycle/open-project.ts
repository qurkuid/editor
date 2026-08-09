import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { ErrorCode, McpError, throwMcpError } from '../errors'
import { currentLevelContext, projectStatusPayload } from './metadata'

export const openProjectInput = {
  id: z.string().min(1).max(64),
}

export const openProjectOutput = {
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  editorUrl: z.string(),
  url: z.string(),
  ownerId: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  publishedVersion: z.number().nullable(),
  latestVersion: z.number().nullable(),
  draftVersion: z.number().nullable(),
  browserVisibleVersion: z.number().nullable(),
  version: z.number(),
  isEmpty: z.boolean(),
  sizeBytes: z.number(),
  nodeCount: z.number(),
  graphHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  levelIds: z.array(z.string()),
  defaultLevelId: z.string().nullable(),
  nextStep: z.string(),
}

export function registerOpenProject(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'open_project',
    {
      title: 'Open project',
      description:
        'Open a saved Pascal project into this MCP session. Empty projects bind to a cleared graph; saved projects load their graph. This is the explicit project activation boundary.',
      inputSchema: openProjectInput,
      outputSchema: openProjectOutput,
    },
    async ({ id }) => {
      try {
        const status = await operations.openProject(id)
        if (!status) {
          throwMcpError(ErrorCode.InvalidParams, 'project_not_found', { id })
        }
        const nextStep = status.isEmpty
          ? 'The empty project is now active. Build with semantic tools, then save_scene when a meaningful checkpoint is ready.'
          : 'The project is now active. Continue editing, then save_scene with saveMode: "checkpoint" for a meaningful version.'
        const payload = {
          ...projectStatusPayload(status, nextStep),
          ...currentLevelContext(operations),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof McpError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidRequest, msg)
      }
    },
  )
}
