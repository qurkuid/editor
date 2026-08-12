import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getModelingOperationManifestEntry,
  MODELING_OPERATION_MANIFEST,
} from '@pascal-app/core/modeling-operations'
import type { SceneOperations } from '../operations'
import {
  modelingOperationToolInput,
  PreflightModelingOperationPayloadSchema,
  type PreflightPayload,
  toModelingPreview,
} from './modeling-operation-contract'
import {
  evaluateModelingOperation,
  inputFeatureIds,
  invalidPreflightPayload,
  isAnyNodeId,
  modelingOperationDiagnosticCode,
  parseModelingOperationInput,
  toolResult,
} from './modeling-operation-shared'

export {
  ModelingDiagnosticSchema,
  ModelingPreviewSchema,
  PreflightModelingOperationPayloadSchema,
  TopologyRemapSchema,
} from './modeling-operation-contract'

export const preflightModelingOperationInput = modelingOperationToolInput
export const preflightModelingOperationOutput = PreflightModelingOperationPayloadSchema.shape

function diagnostic(code: string, message: string, featureIds?: string[]) {
  return {
    severity: 'error' as const,
    code,
    message,
    ...(featureIds === undefined ? {} : { featureIds }),
  }
}

export function registerPreflightModelingOperation(
  server: McpServer,
  operations: SceneOperations,
): void {
  server.registerTool(
    'preflight_modeling_operation',
    {
      title: 'Preflight modeling operation',
      description:
        'Validate one canonical Body operation and return a read-only preview for Push/Pull, imprint, transform, paint, face offset, or Follow Path sweep.',
      inputSchema: preflightModelingOperationInput,
      outputSchema: preflightModelingOperationOutput,
    },
    async ({ operationId, nodeId, input }) => {
      const operation = getModelingOperationManifestEntry(operationId)
      const parsed = parseModelingOperationInput(operationId, input)
      if (!parsed.success) {
        return toolResult(
          invalidPreflightPayload(
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
          invalidPreflightPayload(
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
          invalidPreflightPayload(
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
          invalidPreflightPayload(
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
        const payload: PreflightPayload = {
          valid: true,
          operationId,
          operationVersion: operation.version,
          manifestVersion: MODELING_OPERATION_MANIFEST.version,
          nodeId,
          affectedNodeIds: [nodeId],
          diagnostics: [],
          preview: toModelingPreview(result),
        }
        return toolResult(payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return toolResult(
          invalidPreflightPayload(
            operationId,
            nodeId,
            diagnostic('operation.invalid', message, inputFeatureIds(input)),
          ),
        )
      }
    },
  )
}
