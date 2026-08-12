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
        'Validate and commit one canonical Body operation, including face offset, Follow Path sweep, arrays, and Body booleans, as one scene update and one undo step.',
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
      if (!operation.targetNodeTypes.includes(node.type)) {
        return toolResult(
          invalidCommitPayload(
            operationId,
            nodeId,
            diagnostic(
              modelingOperationDiagnosticCode(operationId, 'node.invalid_type'),
              `Operation ${operationId} requires one of ${operation.targetNodeTypes.join(', ')}, received ${node.type}`,
              [nodeId],
            ),
          ),
        )
      }

      try {
        const result = evaluateModelingOperation(
          node,
          parsed.data,
          operationId === 'groupBodies' ||
            operationId === 'createComponent' ||
            operationId === 'intersectBodies' ||
            operationId === 'unionBodies' ||
            operationId === 'subtractBodies' ||
            operationId === 'outerShellBodies' ||
            operationId === 'trimBodies' ||
            operationId === 'splitBodies'
            ? (id) => {
                const candidate = operations.getNode(id as typeof node.id)
                return candidate ?? null
              }
            : undefined,
        )
        const graphBeforeCommit = operations.exportSceneGraph()
        const activeSceneBeforeCommit = operations.getActiveScene()
        const temporalBeforeCommit = useScene.temporal.getState()
        const pastStatesBeforeCommit = temporalBeforeCommit.pastStates
        const futureStatesBeforeCommit = temporalBeforeCommit.futureStates
        try {
          const createdIds = commitModelingResult(operations, nodeId, result)
          await publishLiveSceneSnapshot(operations, 'commit_modeling_operation')
          const affectedNodeIds = [nodeId, ...createdIds]
          const payload: CommitPayload = {
            success: true,
            operationId,
            operationVersion: operation.version,
            manifestVersion: MODELING_OPERATION_MANIFEST.version,
            nodeId,
            affectedNodeIds,
            diagnostics: [],
            result: toModelingPreview(result),
            historySteps: 1,
          }
          return toolResult(payload)
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
