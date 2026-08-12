import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getModelingOperationManifestEntry,
  MODELING_OPERATION_MANIFEST,
} from '@pascal-app/core/modeling-operations'
import useScene from '@pascal-app/core/store'
import type { SceneOperations } from '../operations'
import { publishLiveSceneSnapshot } from './live-sync'
import {
  CommitModelingOperationPayloadSchema,
  type CommitPayload,
  modelingOperationToolInput,
  toModelingPreview,
} from './modeling-operation-contract'
import {
  commitModelingResult,
  evaluateModelingOperation,
  inputFeatureIds,
  invalidCommitPayload,
  isAnyNodeId,
  modelingOperationDiagnosticCode,
  parseModelingOperationInput,
  toolResult,
} from './modeling-operation-shared'

export {
  CommitModelingOperationPayloadSchema,
  ModelingDiagnosticSchema,
  ModelingPreviewSchema,
  TopologyRemapSchema,
} from './modeling-operation-contract'

export const commitModelingOperationInput = modelingOperationToolInput
export const commitModelingOperationOutput = CommitModelingOperationPayloadSchema.shape

function diagnostic(code: string, message: string, featureIds?: string[]) {
  return {
    severity: 'error' as const,
    code,
    message,
    ...(featureIds === undefined ? {} : { featureIds }),
  }
}

export function registerCommitModelingOperation(
  server: McpServer,
  operations: SceneOperations,
): void {
  server.registerTool(
    'commit_modeling_operation',
    {
      title: 'Commit modeling operation',
      description:
        'Validate and commit one canonical Body operation, including face offset and Follow Path sweep, as one scene update and one undo step.',
      inputSchema: commitModelingOperationInput,
      outputSchema: commitModelingOperationOutput,
    },
    async ({ operationId, nodeId, input }) => {
      const operation = getModelingOperationManifestEntry(operationId)
      const parsed = parseModelingOperationInput(operationId, input)
      if (!parsed.success) {
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic(
              modelingOperationDiagnosticCode(operationId, 'input.invalid'),
              parsed.message,
              inputFeatureIds(input),
            ),
          ),
        )
      }
      if (!isAnyNodeId(nodeId)) {
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic(
              modelingOperationDiagnosticCode(operationId, 'node.invalid_id'),
              `Invalid node id: ${nodeId}`,
              [nodeId],
            ),
          ),
        )
      }

      const node = operations.getNode(nodeId)
      if (!node) {
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic(
              modelingOperationDiagnosticCode(operationId, 'node.not_found'),
              `Node not found: ${nodeId}`,
              [nodeId],
            ),
          ),
        )
      }
      if (node.type !== 'body') {
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic(
              modelingOperationDiagnosticCode(operationId, 'node.invalid_type'),
              `Body operation requires a Body node, received ${node.type}`,
              [nodeId],
            ),
          ),
        )
      }

      try {
        const result = evaluateModelingOperation(node, parsed.data)
        const graphBeforeCommit = operations.exportSceneGraph()
        const activeSceneBeforeCommit = operations.getActiveScene()
        const temporalBeforeCommit = useScene.temporal.getState()
        const pastStatesBeforeCommit = temporalBeforeCommit.pastStates
        const futureStatesBeforeCommit = temporalBeforeCommit.futureStates
        try {
          commitModelingResult(operations, nodeId, result)
          await publishLiveSceneSnapshot(operations, 'commit_modeling_operation')
        } catch (error) {
          operations.loadJSON(graphBeforeCommit)
          useScene.temporal.setState({
            pastStates: pastStatesBeforeCommit,
            futureStates: futureStatesBeforeCommit,
          })
          if (activeSceneBeforeCommit) operations.setActiveScene(activeSceneBeforeCommit)
          else operations.clearActiveScene()
          throw error
        }
        const payload: CommitPayload = {
          success: true,
          operationId,
          operationVersion: operation.version,
          manifestVersion: MODELING_OPERATION_MANIFEST.version,
          nodeId,
          affectedNodeIds: [nodeId],
          diagnostics: [],
          result: toModelingPreview(result),
          historySteps: 1,
        }
        return toolResult(payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic('operation.invalid', message, inputFeatureIds(input)),
          ),
        )
      }
    },
  )
}
