import { z } from 'zod'

export const OntologyManifestFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const OntologyManifestSchema = z
  .object({
    packId: z.string().min(1),
    name: z.string().min(1),
    version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    semanticVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    license: z.object({ spdxId: z.string().min(1), url: z.string().url() }).strict(),
    externalMappingsPolicy: z.literal('mapping-only'),
    files: z.array(OntologyManifestFileSchema).min(1),
  })
  .strict()

export const OntologyNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['class', 'affordance', 'rule']),
    label: z.string().min(1),
    description: z.string().min(1),
    allowedOperations: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    mappings: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict()

export const OntologyEdgeSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    predicate: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict()

export const OntologyEvidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1),
    uri: z.string().min(1),
    locator: z.string().min(1),
  })
  .strict()

export const OntologyQualityReportSchema = z
  .object({
    status: z.enum(['pass', 'warn', 'fail']),
    packId: z.string().min(1),
    version: z.string().min(1),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          status: z.enum(['pass', 'warn', 'fail']),
          detail: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()

export const OntologyQuestionQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    classId: z.string().trim().min(1).max(200).optional(),
    nodeId: z.string().trim().min(1).max(200).optional(),
    ruleId: z.string().trim().min(1).max(200).optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    maxNodes: z.number().int().min(1).max(100).optional(),
  })
  .strict()

export const OntologyCompetencyQuestionSchema = z
  .object({
    id: z.string().regex(/^CQ-\d{2}$/),
    question: z.string().trim().min(1),
    query: OntologyQuestionQuerySchema,
    expectedIds: z.array(z.string().min(1)).min(1),
    expectedEvidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict()

export const OntologySampleQueriesSchema = z
  .object({
    queries: z.array(OntologyQuestionQuerySchema),
    competencyQuestions: z.array(OntologyCompetencyQuestionSchema).length(12),
  })
  .strict()

export type OntologyManifest = z.infer<typeof OntologyManifestSchema>
export type OntologyNode = z.infer<typeof OntologyNodeSchema>
export type OntologyEdge = z.infer<typeof OntologyEdgeSchema>
export type OntologyEvidence = z.infer<typeof OntologyEvidenceSchema>
export type OntologyQualityReport = z.infer<typeof OntologyQualityReportSchema>
export type OntologyCompetencyQuestion = z.infer<typeof OntologyCompetencyQuestionSchema>

export type OntologyPack = {
  readonly root: string
  readonly manifest: OntologyManifest
  readonly nodes: readonly OntologyNode[]
  readonly edges: readonly OntologyEdge[]
  readonly evidence: readonly OntologyEvidence[]
  readonly quality: OntologyQualityReport
  readonly samples: unknown
  readonly competencyQuestions: readonly OntologyCompetencyQuestion[]
  readonly communityReports: unknown
}

export type OntologyPackStatus =
  | { readonly status: 'available'; readonly pack: OntologyPack }
  | {
      readonly status: 'unavailable'
      readonly code: 'not_found' | 'unreadable'
      readonly message: string
    }
  | {
      readonly status: 'invalid'
      readonly code: 'schema' | 'hash' | 'integrity' | 'version' | 'license'
      readonly message: string
      readonly details: readonly string[]
    }

export type OntologyLimits = {
  readonly maxResults: number
  readonly maxNodes: number
}

export type OntologySemanticRef = {
  readonly packId: string
  readonly classId: string
  readonly version: string
}
