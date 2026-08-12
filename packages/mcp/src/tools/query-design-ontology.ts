import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { queryDesignOntology, queryDesignOntologyInputSchema } from '../ontology/query'
import type { SceneOperations } from '../operations'
import { toolResult } from './modeling-operation-contract'

export function registerQueryDesignOntology(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'query_design_ontology',
    {
      title: 'Query design ontology',
      description:
        'Read-only bounded lookup of Pascal semantic classes, allowed operations, relationships, and evidence.',
      inputSchema: queryDesignOntologyInputSchema.shape,
    },
    async (input) => toolResult(await queryDesignOntology(operations, input)),
  )
}
