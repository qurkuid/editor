import { getNodeSemanticRef } from '@pascal-app/core'
import type { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { loadOntologyPack } from './pack'
import type {
  OntologyCompetencyQuestion,
  OntologyEdge,
  OntologyEvidence,
  OntologyLimits,
  OntologyNode,
  OntologyPack,
  OntologyPackStatus,
  OntologySemanticRef,
} from './types'

export const queryDesignOntologyInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  classId: z.string().trim().min(1).max(200).optional(),
  nodeId: z.string().trim().min(1).max(200).optional(),
  questionId: z
    .string()
    .regex(/^CQ-\d{2}$/)
    .optional(),
  packVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
    .optional(),
  maxResults: z.number().int().min(1).max(100).optional().default(20),
  maxNodes: z.number().int().min(1).max(100).optional().default(20),
})

export type QueryDesignOntologyInput = z.infer<typeof queryDesignOntologyInputSchema>

export type OntologyNodeResult = OntologyNode & {
  readonly semanticRef: OntologySemanticRef | null
  readonly evidence: readonly OntologyEvidence[]
  readonly sceneNodeId: string | null
}

export type OntologyEdgeResult = OntologyEdge & {
  readonly evidence: readonly OntologyEvidence[]
}

export type QueryDesignOntologyAvailable = {
  readonly status: 'available'
  readonly pack: { readonly packId: string; readonly version: string }
  readonly results: readonly OntologyNodeResult[]
  readonly edges: readonly OntologyEdgeResult[]
  readonly scene: {
    readonly requestedNodeId: string | null
    readonly resolvedNodeType: string | null
    readonly hostWall: { readonly nodeId: string; readonly classId: string } | null
  }
  readonly truncated: boolean
  readonly competencyQuestion?: {
    readonly id: string
    readonly question: string
    readonly expectedIds: readonly string[]
    readonly expectedEvidenceIds: readonly string[]
    readonly resultIds: readonly string[]
    readonly resultEvidenceIds: readonly string[]
    readonly passed: boolean
  }
}

export type QueryDesignOntologyResult =
  | QueryDesignOntologyAvailable
  | Extract<OntologyPackStatus, { status: 'unavailable' | 'invalid' }>

function competencyResult(
  question: OntologyCompetencyQuestion,
  limited: ReturnType<typeof queryNodes>,
): NonNullable<QueryDesignOntologyAvailable['competencyQuestion']> {
  const resultIds = limited.results.map((result) => result.id)
  const resultEvidenceIds = [
    ...new Set(limited.results.flatMap((result) => result.evidence.map((item) => item.id))),
  ]
  const same = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  return {
    id: question.id,
    question: question.question,
    expectedIds: question.expectedIds,
    expectedEvidenceIds: question.expectedEvidenceIds,
    resultIds,
    resultEvidenceIds,
    passed:
      same(resultIds, question.expectedIds) &&
      same(resultEvidenceIds, question.expectedEvidenceIds),
  }
}

function limits(input: QueryDesignOntologyInput): OntologyLimits {
  return { maxResults: input.maxResults, maxNodes: input.maxNodes }
}

function evidenceFor(
  pack: OntologyPack,
  evidenceIds: readonly string[],
  maxNodes: number,
): OntologyEvidence[] {
  const wanted = new Set(evidenceIds)
  return pack.evidence.filter((item) => wanted.has(item.id)).slice(0, maxNodes)
}

function semanticRef(pack: OntologyPack, node: OntologyNode): OntologySemanticRef | null {
  if (node.kind !== 'class') return null
  return {
    packId: pack.manifest.packId,
    classId: node.id,
    version: pack.manifest.version,
  }
}

function nodeResult(
  pack: OntologyPack,
  node: OntologyNode,
  sceneNodeId: string | null,
  maxNodes: number,
): OntologyNodeResult {
  return {
    ...node,
    semanticRef: semanticRef(pack, node),
    evidence: evidenceFor(pack, node.evidenceIds, maxNodes),
    sceneNodeId,
  }
}

function findSceneNode(operations: SceneOperations, id: string): AnyNode | null {
  return Object.values(operations.getNodes()).find((node) => node.id === id) ?? null
}

function hostWall(operations: SceneOperations, node: AnyNode): AnyNode | null {
  if (node.type !== 'window') return null
  if (node.wallId) {
    const explicit = findSceneNode(operations, node.wallId)
    if (explicit?.type === 'wall') return explicit
  }
  return operations.getAncestry(node.id).find((ancestor) => ancestor.type === 'wall') ?? null
}

function matchNode(node: OntologyNode, input: QueryDesignOntologyInput): boolean {
  if (input.classId && node.id !== input.classId) return false
  if (!input.query) return true
  const needle = input.query.toLocaleLowerCase()
  return [node.id, node.label, node.description].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  )
}

function edgeResult(pack: OntologyPack, edge: OntologyEdge, maxNodes: number): OntologyEdgeResult {
  return { ...edge, evidence: evidenceFor(pack, edge.evidenceIds, maxNodes) }
}

function capResults(
  pack: OntologyPack,
  nodes: readonly OntologyNode[],
  sceneNodeId: string | null,
  limitsValue: OntologyLimits,
): { results: OntologyNodeResult[]; truncated: boolean } {
  const selected = nodes.slice(0, limitsValue.maxResults)
  const capped = selected.slice(0, limitsValue.maxNodes)
  return {
    results: capped.map((node) => nodeResult(pack, node, sceneNodeId, limitsValue.maxNodes)),
    truncated: nodes.length > capped.length,
  }
}

function queryNodes(
  pack: OntologyPack,
  operations: SceneOperations,
  input: QueryDesignOntologyInput,
  limitsValue: OntologyLimits,
): {
  results: OntologyNodeResult[]
  edges: OntologyEdgeResult[]
  truncated: boolean
  scene: QueryDesignOntologyAvailable['scene']
} {
  const sceneNode = input.nodeId ? findSceneNode(operations, input.nodeId) : null
  const sceneClassId = sceneNode ? getNodeSemanticRef(sceneNode.type)?.classId : undefined
  const candidates = pack.nodes.filter((node) => {
    if (input.nodeId && !sceneNode) return false
    if (sceneClassId) return node.id === sceneClassId
    return matchNode(node, input)
  })
  const capped = capResults(pack, candidates, sceneNode?.id ?? null, limitsValue)
  const resultIds = new Set(capped.results.map((result) => result.id))
  const relatedEdges = pack.edges.filter(
    (edge) => resultIds.has(edge.sourceId) || resultIds.has(edge.targetId),
  )
  const edges = relatedEdges
    .slice(0, limitsValue.maxNodes)
    .map((edge) => edgeResult(pack, edge, limitsValue.maxNodes))
  const host = sceneNode ? hostWall(operations, sceneNode) : null
  const hostWallResult = host
    ? {
        nodeId: host.id,
        classId:
          getNodeSemanticRef(host.type)?.classId ?? getNodeSemanticRef('wall')?.classId ?? '',
      }
    : null
  return {
    results: capped.results,
    edges,
    truncated: capped.truncated || relatedEdges.length > edges.length,
    scene: {
      requestedNodeId: input.nodeId ?? null,
      resolvedNodeType: sceneNode?.type ?? null,
      hostWall: hostWallResult,
    },
  }
}

export async function queryDesignOntology(
  operations: SceneOperations,
  input: QueryDesignOntologyInput,
  packRoot?: string,
): Promise<QueryDesignOntologyResult> {
  const loaded = await loadOntologyPack(packRoot)
  if (loaded.status !== 'available') return loaded
  if (input.packVersion && input.packVersion !== loaded.pack.manifest.version) {
    return {
      status: 'invalid',
      code: 'version',
      message: 'Ontology pack version mismatch',
      details: [`requested ${input.packVersion}`, `available ${loaded.pack.manifest.version}`],
    }
  }
  const question = input.questionId
    ? loaded.pack.competencyQuestions.find((candidate) => candidate.id === input.questionId)
    : undefined
  if (input.questionId && !question) {
    return {
      status: 'invalid',
      code: 'schema',
      message: 'Ontology competency question not found',
      details: [input.questionId],
    }
  }
  const queryInput = question
    ? {
        ...question.query,
        maxResults: input.maxResults,
        maxNodes: input.maxNodes,
      }
    : input
  const limited = queryNodes(loaded.pack, operations, queryInput, limits(queryInput))
  return {
    status: 'available',
    pack: {
      packId: loaded.pack.manifest.packId,
      version: loaded.pack.manifest.version,
    },
    ...limited,
    ...(question ? { competencyQuestion: competencyResult(question, limited) } : {}),
  }
}
