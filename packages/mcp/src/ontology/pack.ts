import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod'
import {
  OntologyEdgeSchema,
  OntologyEvidenceSchema,
  OntologyManifestSchema,
  OntologyNodeSchema,
  type OntologyPackStatus,
  OntologyQualityReportSchema,
  OntologySampleQueriesSchema,
} from './types'

export const ONTOLOGY_PACK_ID = 'pascal-architecture-core'
export const ONTOLOGY_PACK_VERSION = '1.0.0'
export const ONTOLOGY_PACK_ROOT = 'pascal-architecture-core'

const REQUIRED_FILES: readonly [string, string, string, string, string, string, string] = [
  'graph/nodes.jsonl',
  'graph/edges.jsonl',
  'evidence/index.jsonl',
  'quality/report.json',
  'README.md',
  'sample_queries.json',
  'community_reports.json',
]

type ReadFileResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ok'; readonly bytes: Buffer }
  | { readonly kind: 'error'; readonly message: string }

async function readOptionalFile(path: string): Promise<ReadFileResult> {
  try {
    return { kind: 'ok', bytes: await readFile(path) }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'missing' }
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safePackPath(root: string, relativePath: string): string | null {
  if (isAbsolute(relativePath) || normalize(relativePath) !== relativePath) return null
  if (relativePath.startsWith('../') || relativePath.includes('/../')) return null
  return join(root, relativePath)
}

function parseJsonl<T>(bytes: Buffer, schema: z.ZodType<T>): T[] {
  const values: T[] = []
  for (const line of bytes.toString('utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    values.push(schema.parse(JSON.parse(trimmed)))
  }
  return values
}

function parseJson(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString('utf8'))
}

function integrityErrors(
  nodes: readonly z.infer<typeof OntologyNodeSchema>[],
  edges: readonly z.infer<typeof OntologyEdgeSchema>[],
  evidence: readonly z.infer<typeof OntologyEvidenceSchema>[],
): string[] {
  const errors: string[] = []
  const nodeIds = new Set<string>()
  const evidenceIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) errors.push(`duplicate node id: ${node.id}`)
    nodeIds.add(node.id)
  }
  for (const item of evidence) {
    if (evidenceIds.has(item.id)) errors.push(`duplicate evidence id: ${item.id}`)
    evidenceIds.add(item.id)
    if (!nodeIds.has(item.sourceId)) errors.push(`evidence source missing: ${item.sourceId}`)
  }
  for (const node of nodes) {
    for (const evidenceId of node.evidenceIds) {
      if (!evidenceIds.has(evidenceId))
        errors.push(`node evidence missing: ${node.id}/${evidenceId}`)
    }
  }
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) errors.push(`duplicate edge id: ${edge.id}`)
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.sourceId)) errors.push(`edge source missing: ${edge.sourceId}`)
    if (!nodeIds.has(edge.targetId)) errors.push(`edge target missing: ${edge.targetId}`)
    for (const evidenceId of edge.evidenceIds) {
      if (!evidenceIds.has(evidenceId))
        errors.push(`edge evidence missing: ${edge.id}/${evidenceId}`)
    }
  }
  return errors
}

async function loadFromRoot(rootInput: string): Promise<OntologyPackStatus> {
  const root = resolve(rootInput)
  const manifestResult = await readOptionalFile(join(root, 'manifest.json'))
  if (manifestResult.kind === 'missing') {
    return { status: 'unavailable', code: 'not_found', message: `Ontology pack not found: ${root}` }
  }
  if (manifestResult.kind === 'error') {
    return { status: 'unavailable', code: 'unreadable', message: manifestResult.message }
  }

  try {
    const manifest = OntologyManifestSchema.parse(parseJson(manifestResult.bytes))
    const details: string[] = []
    if (manifest.packId !== ONTOLOGY_PACK_ID) details.push(`pack id must be ${ONTOLOGY_PACK_ID}`)
    if (
      manifest.version !== ONTOLOGY_PACK_VERSION ||
      manifest.semanticVersion !== manifest.version
    ) {
      details.push(`version must be ${ONTOLOGY_PACK_VERSION}`)
    }
    if (manifest.license.spdxId !== 'MIT') details.push('license must be MIT')
    const manifestPaths = manifest.files.map((file) => file.path).sort()
    if (JSON.stringify(manifestPaths) !== JSON.stringify([...REQUIRED_FILES].sort())) {
      details.push('manifest file list does not match the Pack v1 artifact')
    }
    if (details.length > 0) {
      return {
        status: 'invalid',
        code: manifest.license.spdxId !== 'MIT' ? 'license' : 'version',
        message: 'Ontology manifest rejected',
        details,
      }
    }

    const fileBytes = new Map<string, Buffer>()
    for (const file of manifest.files) {
      const path = safePackPath(root, file.path)
      if (!path) {
        details.push(`unsafe manifest path: ${file.path}`)
        continue
      }
      const result = await readOptionalFile(path)
      if (result.kind !== 'ok') {
        details.push(`missing artifact: ${file.path}`)
        continue
      }
      fileBytes.set(file.path, result.bytes)
      if (sha256(result.bytes) !== file.sha256) details.push(`hash mismatch: ${file.path}`)
    }
    if (details.length > 0) {
      return { status: 'invalid', code: 'hash', message: 'Ontology artifact rejected', details }
    }

    const nodes = parseJsonl(
      fileBytes.get(REQUIRED_FILES[0]) ?? Buffer.from(''),
      OntologyNodeSchema,
    )
    const edges = parseJsonl(
      fileBytes.get(REQUIRED_FILES[1]) ?? Buffer.from(''),
      OntologyEdgeSchema,
    )
    const evidence = parseJsonl(
      fileBytes.get(REQUIRED_FILES[2]) ?? Buffer.from(''),
      OntologyEvidenceSchema,
    )
    const quality = OntologyQualityReportSchema.parse(
      parseJson(fileBytes.get(REQUIRED_FILES[3]) ?? Buffer.from('{}')),
    )
    const samples = parseJson(fileBytes.get(REQUIRED_FILES[5]) ?? Buffer.from('null'))
    const parsedSamples = OntologySampleQueriesSchema.parse(samples)
    const communityReports = parseJson(fileBytes.get(REQUIRED_FILES[6]) ?? Buffer.from('null'))
    const integrity = integrityErrors(nodes, edges, evidence)
    if (quality.packId !== manifest.packId || quality.version !== manifest.version) {
      integrity.push('quality report does not match manifest identity')
    }
    if (integrity.length > 0) {
      return {
        status: 'invalid',
        code: 'integrity',
        message: 'Ontology referential integrity failed',
        details: integrity,
      }
    }
    return {
      status: 'available',
      pack: {
        root,
        manifest,
        nodes,
        edges,
        evidence,
        quality,
        samples,
        competencyQuestions: parsedSamples.competencyQuestions,
        communityReports,
      },
    }
  } catch (error) {
    return {
      status: 'invalid',
      code: 'schema',
      message: 'Ontology pack schema validation failed',
      details: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function candidateRoots(): string[] {
  const moduleRoot = dirnameFromModule()
  const cwd = typeof process === 'undefined' ? null : process.cwd()
  const configured =
    typeof process === 'undefined' ? undefined : process.env.PASCAL_ONTOLOGY_PACK_PATH
  const roots = [
    configured,
    join(moduleRoot, ONTOLOGY_PACK_ROOT),
    join(moduleRoot, '../../../ontology', ONTOLOGY_PACK_ROOT),
    join(moduleRoot, '../../../../ontology', ONTOLOGY_PACK_ROOT),
    cwd ? join(cwd, 'ontology', ONTOLOGY_PACK_ROOT) : undefined,
    cwd ? join(cwd, 'packages/mcp/ontology', ONTOLOGY_PACK_ROOT) : undefined,
  ]
  return [...new Set(roots.filter((root): root is string => typeof root === 'string'))]
}

function dirnameFromModule(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)))
}

export async function loadOntologyPack(root?: string): Promise<OntologyPackStatus> {
  const configured =
    typeof process === 'undefined' ? undefined : process.env.PASCAL_ONTOLOGY_PACK_PATH
  const roots = root === undefined ? (configured ? [configured] : candidateRoots()) : [root]
  let sawUnavailable: OntologyPackStatus | null = null
  for (const candidate of roots) {
    const result = await loadFromRoot(candidate)
    if (result.status === 'available' || result.status === 'invalid') return result
    sawUnavailable = result
  }
  return (
    sawUnavailable ?? {
      status: 'unavailable',
      code: 'not_found',
      message: 'Ontology pack root was not configured',
    }
  )
}
