import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { loadOntologyPack } from './pack'
import type { OntologyEdgeResult, OntologyNodeResult } from './query'
import type { OntologyPackStatus } from './types'

export const explainDesignRuleInputSchema = z.object({
  ruleId: z.string().trim().min(1).max(200),
  maxNodes: z.number().int().min(1).max(100).optional().default(20),
})

export type ExplainDesignRuleInput = z.infer<typeof explainDesignRuleInputSchema>

export type ExplainDesignRuleAvailable = {
  readonly status: 'available'
  readonly pack: { readonly packId: string; readonly version: string; readonly license: string }
  readonly ruleId: string
  readonly sourceId: string
  readonly sourceVersion: string
  readonly license: string
  readonly evidenceLocators: readonly string[]
  readonly rule: OntologyNodeResult
  readonly relatedNodes: readonly OntologyNodeResult[]
  readonly edges: readonly OntologyEdgeResult[]
  readonly truncated: boolean
}

export type ExplainDesignRuleResult =
  | ExplainDesignRuleAvailable
  | Extract<OntologyPackStatus, { status: 'unavailable' | 'invalid' }>

export async function explainDesignRule(
  _operations: SceneOperations,
  input: ExplainDesignRuleInput,
  packRoot?: string,
): Promise<ExplainDesignRuleResult> {
  const loaded = await loadOntologyPack(packRoot)
  if (loaded.status !== 'available') return loaded
  const rule = loaded.pack.nodes.find((node) => node.id === input.ruleId && node.kind === 'rule')
  if (!rule) {
    return {
      status: 'invalid',
      code: 'integrity',
      message: `Design rule not found: ${input.ruleId}`,
      details: [`unknown rule id: ${input.ruleId}`],
    }
  }
  const evidence = loaded.pack.evidence.filter((item) => rule.evidenceIds.includes(item.id))
  const ruleResult: OntologyNodeResult = {
    ...rule,
    semanticRef: null,
    evidence: evidence.slice(0, input.maxNodes),
    sceneNodeId: null,
  }
  const relatedEdges = loaded.pack.edges.filter(
    (edge) => edge.sourceId === rule.id || edge.targetId === rule.id,
  )
  const relatedIds = new Set<string>()
  for (const edge of relatedEdges) {
    relatedIds.add(edge.sourceId)
    relatedIds.add(edge.targetId)
  }
  relatedIds.delete(rule.id)
  const relatedNodes = loaded.pack.nodes
    .filter((node) => relatedIds.has(node.id))
    .slice(0, input.maxNodes)
    .map(
      (node): OntologyNodeResult => ({
        ...node,
        semanticRef:
          node.kind === 'class'
            ? {
                packId: loaded.pack.manifest.packId,
                classId: node.id,
                version: loaded.pack.manifest.version,
              }
            : null,
        evidence: loaded.pack.evidence
          .filter((item) => node.evidenceIds.includes(item.id))
          .slice(0, input.maxNodes),
        sceneNodeId: null,
      }),
    )
  const edges = relatedEdges.slice(0, input.maxNodes).map(
    (edge): OntologyEdgeResult => ({
      ...edge,
      evidence: loaded.pack.evidence
        .filter((item) => edge.evidenceIds.includes(item.id))
        .slice(0, input.maxNodes),
    }),
  )
  const sourceId = evidence[0]?.sourceId ?? rule.id
  const evidenceLocators = evidence.map((item) => item.locator).slice(0, input.maxNodes)
  return {
    status: 'available',
    pack: {
      packId: loaded.pack.manifest.packId,
      version: loaded.pack.manifest.version,
      license: loaded.pack.manifest.license.spdxId,
    },
    ruleId: rule.id,
    sourceId,
    sourceVersion: loaded.pack.manifest.version,
    license: loaded.pack.manifest.license.spdxId,
    evidenceLocators,
    rule: ruleResult,
    relatedNodes,
    edges,
    truncated: relatedEdges.length > edges.length || relatedIds.size > relatedNodes.length,
  }
}
