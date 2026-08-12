import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { registerAgentGuide } from './agent-guide'
import { registerCatalogItems } from './catalog-items'
import { registerConstraints } from './constraints'
import { registerDebugState } from './debug-state'
import { registerModelingOperations } from './modeling-operations'
import { registerOntologyManifest } from './ontology-manifest'
import { registerSceneCurrent } from './scene-current'
import { registerSceneSummary } from './scene-summary'

/**
 * Registers all MCP resources exposed by `@pascal-app/mcp`.
 *
 * Resources:
 * - `pascal://scene/current`          — application/json, full snapshot
 * - `pascal://scene/current/summary`  — text/markdown, human summary
 * - `pascal://catalog/items`          — application/json, host-supplied catalog
 * - `pascal://constraints/{levelId}`  — application/json, per-level constraints
 * - `pascal://agent-guide`            — text/markdown, MCP-first agent guide
 * - `pascal://agent/guide`            — text/markdown, legacy alias
 * - `pascal://modeling/operations`    — application/json, canonical semantic operations
 * - `pascal://debug/state`            — application/json, execution diagnostics
 */
export function registerResources(server: McpServer, operations: SceneOperations): void {
  registerAgentGuide(server, operations)
  registerOntologyManifest(server, operations)
  registerModelingOperations(server, operations)
  registerSceneCurrent(server, operations)
  registerSceneSummary(server, operations)
  registerCatalogItems(server, operations)
  registerConstraints(server, operations)
  registerDebugState(server, operations)
}
