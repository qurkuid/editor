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
        'Validate one canonical Body operation and return a read-only preview for Push/Pull, imprint, transform, paint, face offset, Follow Path sweep, arrays, or Body booleans.',
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
      if (!operation.targetNodeTypes.includes(node.type)) {
        return toolResult(
          invalidPreflightPayload(
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
        const affectedNodeIds =
          result.operation === 'groupBodies'
            ? [nodeId, ...result.bodyUpdates.map((update) => update.id)]
            : result.operation === 'createComponent'
              ? [
                  nodeId,
                  result.container.id,
                  ...(result.createdNodes ?? []).map((created) => created.id),
                ]
              : result.operation === 'makeComponentUnique'
                ? [result.id]
                : result.operation === 'explodeComponent'
                  ? [result.componentId, ...result.bodyUpdates.map((update) => update.id)]
                  : result.operation === 'intersectBodies' ||
                      result.operation === 'unionBodies' ||
                      result.operation === 'subtractBodies' ||
                      result.operation === 'outerShellBodies'
                    ? [nodeId, result.toolBodyId]
                    : result.operation === 'trimBodies'
                      ? [nodeId]
                      : result.operation === 'splitBodies'
                        ? result.pieces.map(({ body }) => body.id)
                        : 'clones' in result
                          ? [nodeId, ...result.clones.map((clone) => clone.id)]
                          : [nodeId]
        const payload: PreflightPayload = {
          valid: true,
          operationId,
          operationVersion: operation.version,
          manifestVersion: MODELING_OPERATION_MANIFEST.version,
          nodeId,
          affectedNodeIds,
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
