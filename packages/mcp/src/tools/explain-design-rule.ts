import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { explainDesignRule, explainDesignRuleInputSchema } from '../ontology/rule'
import type { SceneOperations } from '../operations'
import { toolResult } from './modeling-operation-contract'

export function registerExplainDesignRule(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'explain_design_rule',
    {
      title: 'Explain design rule',
      description: 'Read-only bounded explanation of an evidence-backed ontology rule.',
      inputSchema: explainDesignRuleInputSchema.shape,
    },
    async (input) => toolResult(await explainDesignRule(operations, input)),
  )
}
