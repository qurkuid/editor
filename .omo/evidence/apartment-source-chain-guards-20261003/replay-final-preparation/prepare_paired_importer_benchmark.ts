#!/usr/bin/env bun

/**
 * Prepare, and only after an explicit source freeze execute, the paired Lane B
 * importer benchmark.  The default invocation writes a contract and exits
 * without importing product code.  The paired execution path is deliberately
 * explicit because this evidence lane must never turn preparation into a
 * candidate run accidentally.
 *
 * The eventual paired run keeps both source-copy importers in one Bun process,
 * uses the same 44 raw V15 documents, completes both warm-up sets before any
 * measured round, alternates A->B/B->A by case and round, and keeps cloning and
 * canonical geometry checks outside the timed buildVectorNodes call.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type AnyRecord = Record<string, any>
type Importer = (doc: any, frame?: any, surfaceContext?: any) => any
type Detector = (levelId: string, walls: any[]) => any

const REPO = resolve(import.meta.dir, '../../../..')
const ROOT = join(REPO, '.omo/evidence/apartment-source-chain-guards-20261003/replay-final-preparation')
const PERFORMANCE_ROOT = join(ROOT, 'performance')
const INPUT_MANIFEST = join(ROOT, 'performance-input-manifest-lane-a.json')
const DIRECT_ATTRIBUTION = join(ROOT, 'source-contact-attribution-lane-a.json')
const BASELINE_CORE = join(
  REPO,
  '.omo/evidence/apartment-next-residual-20261003/lane-a-source/packages/core/src/lib/space-detection.ts',
)
const BASELINE_IMPORTER = join(
  REPO,
  '.omo/evidence/apartment-next-residual-20261003/lane-a-source/apps/editor/lib/apt-vector-scene.ts',
)
const BASELINE_FRAME = join(
  REPO,
  '.omo/evidence/apartment-next-residual-20261003/lane-a-source/apps/editor/lib/apt-import-frame.ts',
)
const BASELINE_CORE_SHA = 'eba42adce60d84cfe2943cd5bcdc5132754453df6a1925576bfe06f93f79c570'
const BASELINE_IMPORTER_SHA = 'eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89'
const BASELINE_FRAME_SHA = 'b275cfb3490651314e24cfaf81e888412ddc81b40832f1f472915cd11b29a271'
const WARMUPS = 2
const ROUNDS = 12

const args = Bun.argv.slice(2)
const hasArg = (name: string) => args.includes(name)
const arg = (name: string, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback
}
const relativePath = (value: string) => relative(REPO, resolve(value)) || '.'
const sha256Bytes = (bytes: Uint8Array | ArrayBuffer) => {
  const digest = createHash('sha256')
  digest.update(bytes)
  return digest.digest('hex')
}
const sha256File = async (path: string) => sha256Bytes(await Bun.file(path).bytes())
const sha256Json = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)))
const round = (value: number) => Number(value.toFixed(6))
const numberKey = (value: any) => (value == null || !Number.isFinite(Number(value)) ? '' : Number(value).toFixed(8))

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}
const pointKey = (point: any) =>
  Array.isArray(point) && point.length >= 2 ? `${numberKey(point[0])},${numberKey(point[1])}` : ''
const canonicalPolygon = (polygon: any): string => {
  if (!Array.isArray(polygon)) return ''
  const points = polygon.map(pointKey).filter(Boolean)
  if (!points.length) return ''
  const rotations = (values: string[]) =>
    values.map((_, index) => [...values.slice(index), ...values.slice(0, index)].join(';'))
  return [...rotations(points), ...rotations([...points].reverse())].sort()[0] ?? ''
}
const wallKey = (wall: any) =>
  stableValue({
    start: pointKey(wall.start),
    end: pointKey(wall.end),
    thickness: numberKey(wall.thickness),
    frontSide: wall.frontSide ?? '',
    backSide: wall.backSide ?? '',
    faceBands: wall.faceBands ?? null,
  })
const openingKey = (opening: any) =>
  stableValue({
    type: opening.type ?? '',
    position: Array.isArray(opening.position) ? opening.position.map((value: any) => numberKey(value)) : [],
    rotation: Array.isArray(opening.rotation) ? opening.rotation.map((value: any) => numberKey(value)) : [],
    width: numberKey(opening.width),
    height: numberKey(opening.height),
    openingKind: opening.openingKind ?? '',
    constructionType: opening.constructionType ?? '',
    metadata: opening.metadata ?? {},
  })
const zoneKey = (zone: any) =>
  stableValue({
    name: zone.name ?? '',
    polygon: canonicalPolygon(zone.polygon),
    spaceRole: zone.spaceRole ?? '',
    enclosureStatus: zone.enclosureStatus ?? '',
    color: zone.color ?? '',
    metadata: zone.metadata ?? {},
  })
const spaceKey = (space: any) =>
  stableValue({
    polygon: canonicalPolygon(space.polygon),
    isExterior: Boolean(space.isExterior),
    boundaryFaces: (space.boundaryFaces ?? [])
      .map((face: any) => ({ face: face.face ?? '', points: canonicalPolygon(face.points) }))
      .sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
const surfaceKey = (surface: any) =>
  stableValue({
    polygon: canonicalPolygon(surface.polygon),
    holes: (surface.holes ?? []).map(canonicalPolygon).sort(),
    holeMetadata: surface.holeMetadata ?? [],
    elevation: numberKey(surface.elevation),
    thickness: numberKey(surface.thickness),
    recessed: Boolean(surface.recessed),
    autoFromWalls: Boolean(surface.autoFromWalls),
  })
const canonicalModel = (model: any): AnyRecord | null => {
  if (!model) return null
  const spaces = Array.isArray(model.spaces) ? model.spaces : model.spaces?.spaces ?? []
  return {
    walls: (model.walls ?? []).map(wallKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    openings: (model.openings ?? []).map(openingKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    zones: (model.zones ?? []).map(zoneKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    spaces: spaces.map(spaceKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    slabs: (model.slabs ?? []).map(surfaceKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ceilings: (model.ceilings ?? []).map(surfaceKey).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }
}
const withDerivedSpaces = (model: any, detector: Detector) => {
  if (!model || Array.isArray(model.spaces) || model.spaces?.spaces) return model
  return { ...model, spaces: detector('apt-vector-import', model.walls ?? []).spaces }
}
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

const writeJson = async (path: string, value: unknown) => {
  mkdirSync(resolve(path, '..'), { recursive: true })
  await Bun.write(path, JSON.stringify(value, null, 2) + '\n')
}

const outputPath = resolve(arg('--output', join(PERFORMANCE_ROOT, 'paired-importer-protocol-preparation.json')))
const runId = arg('--run-id', `paired-preparation-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const executePaired = hasArg('--execute-paired')
const sourceFreezePath = arg('--source-freeze')
const candidateCorePath = resolve(arg('--candidate-core', ''))
const candidateImporterPath = resolve(arg('--candidate-importer', ''))
const candidateFramePath = resolve(arg('--candidate-frame', ''))

if (!executePaired) {
  const contract = {
    schemaVersion: 'apartment-source-chain-guards-paired-importer-protocol-v1',
    recordedAtUtc: new Date().toISOString(),
    resolvedRoute: { model: 'gpt-5.6-luna', reasoningEffort: 'max' },
    status: 'BLOCKED_PREPARATION_ONLY',
    candidateRunExecuted: false,
    candidateExecutionAllowed: false,
    scope: {
      evidenceOnly: true,
      productSourceMutation: false,
      testBuildRuntimeBrowserMutation: false,
      rawRasterRerun: false,
      manualGuideInjection: false,
      oldV15FloorBaselineForbidden: true,
      sameRawDocuments: true,
      sameAcceptedCases: 44,
      sameRawPlans: 50,
      rejectedCases: 6,
      sameSourceProbes: '298/330 Lane A baseline; candidate must use the same frozen probe set',
      writesAllowedOnlyUnder: relativePath(ROOT),
    },
    baseline: {
      identity: 'lane-a-eba42adc-core-eb96fcb-imported-evaluation',
      importer: { path: relativePath(BASELINE_IMPORTER), sha256: BASELINE_IMPORTER_SHA },
      core: { path: relativePath(BASELINE_CORE), sha256: BASELINE_CORE_SHA },
      frame: { path: relativePath(BASELINE_FRAME), sha256: BASELINE_FRAME_SHA },
      comparisonMetric: 'fresh paired Lane A importer p95; do not use historical 9.530709ms or 12.468375ms as the final paired denominator',
    },
    protocol: {
      oneBunProcess: true,
      sharedDependencyBridgeRuntime: true,
      variantBridgesAreSeparateSourceCopies: true,
      sameTransitiveDependencyResolutionRoot: relativePath(REPO),
      dependencyBinding: {
        baselineDirectAttribution: relativePath(DIRECT_ATTRIBUTION),
        sameResolvedDependencyPathsRequired: true,
        sameResolvedDependencyHashesRequired: true,
        transitiveClosureStatus: 'direct attribution only until an explicit source freeze supplies the complete dependency set',
      },
      sharedLoadPathContract: 'baseline and candidate generated source-copy bridges record all generated module paths and direct dependency bindings in one process',
      exactAcceptedInputManifest: relativePath(INPUT_MANIFEST),
      warmupRoundsPerVariantAndCase: WARMUPS,
      timedRoundsPerVariantAndCase: ROUNDS,
      bothWarmupSetsFinishBeforeMeasuredRounds: true,
      measuredOrder: 'case/round parity: (caseIndex + roundIndex) even => before→after, odd => after→before',
      timingScope: 'buildVectorNodes(cloned raw V15 document) only',
      cloneOutsideTiming: true,
      canonicalGeometryOutsideTiming: true,
      canonicalIdFieldsExcluded: true,
      geometryIdempotenceRequired: true,
      perVariantRoundErrorsRequired: 0,
      ratioDenominator: 'fresh paired Lane A p95 from this exact run only',
      ratioGate: 'candidate p95 <= paired Lane A p95 × 1.25',
      detectorHistoricalReference: { p95Ms: 2.2555, gateMs: 2.819375, timedCalls: 564, useAsImporterGate: false },
    },
    candidate: {
      sourceFreezeRequired: true,
      sourceFreeze: null,
      sourcePaths: null,
      executed: false,
      note: 'No candidate path or source freeze was supplied; no importer was imported or timed.',
    },
    outputContract: {
      futureStatus: 'PAIRED_EXECUTED',
      perCase: ['warmup/order', 'before samples', 'after samples', 'errors', 'canonical hashes', 'idempotence', 'expected parity'],
      aggregate: ['before median/p95/max', 'after median/p95/max', 'fresh ratio', 'gate status', 'timed call count'],
    },
  }
  await writeJson(outputPath, contract)
  console.log(JSON.stringify({ status: contract.status, candidateRunExecuted: false, output: relativePath(outputPath) }, null, 2))
  process.exit(0)
}

if (!sourceFreezePath) throw new Error('paired candidate execution requires --source-freeze')
if (!existsSync(resolve(sourceFreezePath))) throw new Error(`missing explicit source freeze: ${sourceFreezePath}`)
if (!existsSync(candidateCorePath) || !existsSync(candidateImporterPath) || !existsSync(candidateFramePath)) {
  throw new Error('paired candidate execution requires --candidate-core, --candidate-importer, and --candidate-frame')
}

const sourceFreeze = JSON.parse(await Bun.file(resolve(sourceFreezePath)).text()) as AnyRecord
const sourceFreezeStatus = String(sourceFreeze.status ?? '').toLowerCase()
if (!/(freeze|frozen|approved|final)/.test(sourceFreezeStatus)) throw new Error(`source freeze status is not explicit: ${sourceFreeze.status}`)

const sourceManifest = (await Bun.file(INPUT_MANIFEST).json()) as AnyRecord
const cases = sourceManifest.cases as AnyRecord[]
if (!Array.isArray(cases) || cases.length !== 44 || sourceManifest.rawInputCount !== 50) {
  throw new Error(`paired input contract requires 50 raw / 44 accepted, got ${sourceManifest.rawInputCount}/${cases?.length ?? 0}`)
}
const baselineImportedRoot = resolve(REPO, sourceManifest.baselineImportedRoot)
if (!existsSync(baselineImportedRoot)) throw new Error(`missing Lane A imported root: ${baselineImportedRoot}`)

const verifySnapshot = async (path: string, expected: string, label: string) => {
  const actual = await sha256File(path)
  if (actual !== expected) throw new Error(`${label} SHA mismatch: expected ${expected}, got ${actual}`)
  return actual
}
await verifySnapshot(BASELINE_CORE, BASELINE_CORE_SHA, 'baseline core')
await verifySnapshot(BASELINE_IMPORTER, BASELINE_IMPORTER_SHA, 'baseline importer')
await verifySnapshot(BASELINE_FRAME, BASELINE_FRAME_SHA, 'baseline frame')

const sourceHashesFromFreeze = sourceFreeze.sourceHashes ?? sourceFreeze.currentSourceHashes ?? {}
const candidateSourceHash = async (path: string, label: string) => {
  const actual = await sha256File(path)
  const relPath = relativePath(path)
  const expected = sourceHashesFromFreeze[relPath]?.sha256 ?? sourceHashesFromFreeze[relPath]
  if (expected && expected !== actual) throw new Error(`${label} does not match supplied source freeze: expected ${expected}, got ${actual}`)
  return { path: relPath, sha256: actual, expectedSha256: expected ?? null, freezeMatch: expected ? expected === actual : null }
}

const generatedRoot = join(PERFORMANCE_ROOT, 'runtime', runId)
mkdirSync(generatedRoot, { recursive: true })
const text = async (path: string) => new TextDecoder().decode(await Bun.file(path).bytes())
const quote = (path: string) => JSON.stringify(path)
const resolveCoreImport = (specifier: string) => {
  const raw = resolve(REPO, 'packages/core/src/lib', specifier)
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, join(raw, 'index.ts')]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`cannot resolve core relative import ${specifier}`)
  return found
}
const directDependencyBindings = async (corePath: string) => {
  const coreText = await text(corePath)
  const specs = [...new Set([...coreText.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)].map((match) => match[2]!))].sort()
  return Promise.all(specs.map(async (specifier) => {
    const resolved = resolveCoreImport(specifier)
    return { specifier, resolvedPath: relativePath(resolved), sha256: await sha256File(resolved) }
  }))
}

const loadVariant = async (label: 'before' | 'after', corePath: string, importerPath: string, framePath: string) => {
  const dir = join(generatedRoot, label)
  mkdirSync(dir, { recursive: true })
  const generatedCore = join(dir, 'space-detection.rewritten.ts')
  const generatedBridge = join(dir, 'core-bridge.rewritten.ts')
  const generatedFrame = join(dir, 'apt-import-frame.rewritten.ts')
  const generatedImporter = join(dir, 'apt-vector-scene.rewritten.ts')
  const coreOriginal = await text(corePath)
  const frameOriginal = await text(framePath)
  const importerOriginal = await text(importerPath)
  const rewrittenCore = coreOriginal.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, delimiter, specifier) => {
    return `from ${delimiter}${resolveCoreImport(specifier)}${delimiter}`
  })
  await Bun.write(generatedCore, rewrittenCore)
  const bridge = `
export { createDefaultWallFaceBands, getWallConstructionEnvelopeThickness } from ${quote(join(REPO, 'packages/core/src/lib/wall-construction.ts'))}
export { DoorNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/door.ts'))}
export { WallNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/wall.ts'))}
export { WindowNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/window.ts'))}
export { ZoneNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/zone.ts'))}
export type { GuideNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/guide.ts'))}
export type { CeilingNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/ceiling.ts'))}
export type { SlabNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/slab.ts'))}
export { detectSpacesForLevel, planAutoCeilingsForLevel, planAutoSlabsForLevel, planAutoZonesForLevel } from ${quote(generatedCore)}
`
  await Bun.write(generatedBridge, bridge)
  const rewrittenFrame = frameOriginal.replace(/(['"])@pascal-app\/core\1/g, (_match, delimiter) => `${delimiter}${generatedBridge}${delimiter}`)
  const rewrittenImporter = importerOriginal
    .replace(/(['"])@pascal-app\/core\1/g, (_match, delimiter) => `${delimiter}${generatedBridge}${delimiter}`)
    .replace(/from\s+(['"])\.\/apt-import-frame\1/g, (_match, delimiter) => `from ${delimiter}${generatedFrame}${delimiter}`)
  await Bun.write(generatedFrame, rewrittenFrame)
  await Bun.write(generatedImporter, rewrittenImporter)
  const importerModule = (await import(`${pathToFileURL(generatedImporter).href}?${label}-${runId}`)) as { buildVectorNodes: Importer }
  const bridgeModule = (await import(`${pathToFileURL(generatedBridge).href}?${label}-${runId}`)) as { detectSpacesForLevel: Detector }
  if (typeof importerModule.buildVectorNodes !== 'function' || typeof bridgeModule.detectSpacesForLevel !== 'function') {
    throw new Error(`${label} source copy does not expose importer/detector`) 
  }
  return {
    label,
    buildVectorNodes: importerModule.buildVectorNodes,
    detectSpacesForLevel: bridgeModule.detectSpacesForLevel,
    loadPaths: {
      importer: relativePath(importerPath),
      core: relativePath(corePath),
      frame: relativePath(framePath),
      generatedImporter: relativePath(generatedImporter),
      generatedCore: relativePath(generatedCore),
      generatedFrame: relativePath(generatedFrame),
      generatedBridge: relativePath(generatedBridge),
    },
    generatedHashes: {
      importer: await sha256File(generatedImporter),
      core: await sha256File(generatedCore),
      frame: await sha256File(generatedFrame),
      bridge: await sha256File(generatedBridge),
    },
  }
}

const before = await loadVariant('before', BASELINE_CORE, BASELINE_IMPORTER, BASELINE_FRAME)
const after = await loadVariant('after', candidateCorePath, candidateImporterPath, candidateFramePath)
const beforeDependencies = await directDependencyBindings(BASELINE_CORE)
const afterDependencies = await directDependencyBindings(candidateCorePath)
const beforeInput = { path: BASELINE_CORE, sha256: BASELINE_CORE_SHA }
const afterInput = {
  core: await candidateSourceHash(candidateCorePath, 'candidate core'),
  importer: await candidateSourceHash(candidateImporterPath, 'candidate importer'),
  frame: await candidateSourceHash(candidateFramePath, 'candidate frame'),
}

type VariantRun = {
  warmupErrors: string[]
  errors: string[]
  samples: number[]
  canonicalHashes: string[]
  canonicalStrings: string[]
  expectedParity: boolean[]
}
const emptyRun = (): VariantRun => ({ warmupErrors: [], errors: [], samples: [], canonicalHashes: [], canonicalStrings: [], expectedParity: [] })
const runs: Record<'before' | 'after', AnyRecord[]> = { before: [], after: [] }
const aggregateRun = (samples: number[]) => ({
  timedCalls: samples.length,
  medianMs: round(percentile(samples, 0.5)),
  p95Ms: round(percentile(samples, 0.95)),
  maxMs: round(Math.max(...samples, 0)),
  totalMs: round(samples.reduce((sum, value) => sum + value, 0)),
})

for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
  const item = cases[caseIndex]!
  const rawPath = resolve(REPO, item.rawPath)
  const expectedPath = join(baselineImportedRoot, `${item.planId}.json`)
  const raw = await Bun.file(rawPath).json()
  const rawSha = await sha256File(rawPath)
  const expected = await Bun.file(expectedPath).json()
  const expectedCanonical = JSON.stringify(canonicalModel(expected))
  const state: Record<'before' | 'after', VariantRun> = { before: emptyRun(), after: emptyRun() }
  const invoke = (variant: typeof before, input: any, timed: boolean) => {
    const cloned = structuredClone(input)
    let started = 0
    let built: any
    try {
      if (timed) started = performance.now()
      built = variant.buildVectorNodes(cloned)
      const elapsed = timed ? performance.now() - started : 0
      const canonical = JSON.stringify(canonicalModel(withDerivedSpaces(built, variant.detectSpacesForLevel)))
      return { elapsed, canonical, built }
    } catch (error) {
      if (timed) throw error
      throw error
    }
  }
  // Both variants finish all warmups before any measured round.
  for (const variant of [before, after]) {
    for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
      try {
        const result = invoke(variant, raw, false)
        const target = state[variant.label]
        if (!target.canonicalStrings.length) target.canonicalStrings.push(result.canonical)
      } catch (error) {
        state[variant.label].warmupErrors.push(String(error))
      }
    }
  }
  const orderRows: string[] = []
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    const beforeFirst = (caseIndex + roundIndex) % 2 === 0
    const order = beforeFirst ? [before, after] : [after, before]
    orderRows.push(beforeFirst ? 'before->after' : 'after->before')
    for (const variant of order) {
      const target = state[variant.label]
      try {
        // clone is outside the build timer; canonicalization is after it.
        const result = invoke(variant, raw, true)
        target.samples.push(result.elapsed)
        target.canonicalStrings.push(result.canonical)
        target.canonicalHashes.push(sha256Bytes(new TextEncoder().encode(result.canonical)))
        target.expectedParity.push(result.canonical === expectedCanonical)
      } catch (error) {
        target.errors.push(String(error))
      }
    }
  }
  const resultFor = (label: 'before' | 'after', variant: typeof before) => {
    const target = state[label]
    const canonicalSet = [...new Set(target.canonicalStrings)]
    const geometryIdempotent = canonicalSet.length <= 1 && target.errors.length === 0 && target.warmupErrors.length === 0
    return {
      label,
      planId: item.planId,
      rawPath: relativePath(rawPath),
      rawSha256: rawSha,
      expectedImportedPath: relativePath(expectedPath),
      warmupRounds: WARMUPS,
      measuredRounds: ROUNDS,
      measuredOrder: orderRows,
      warmupErrors: target.warmupErrors,
      roundErrors: target.errors,
      samplesMs: target.samples.map(round),
      canonicalHashes: target.canonicalHashes,
      uniqueCanonicalGeometryCount: canonicalSet.length,
      geometryIdempotent,
      canonicalMatchesExpected: target.expectedParity.length === ROUNDS && target.expectedParity.every(Boolean),
      aggregate: aggregateRun(target.samples),
      loadPaths: variant.loadPaths,
    }
  }
  runs.before.push(resultFor('before', before))
  runs.after.push(resultFor('after', after))
}

const beforeSamples = runs.before.flatMap((entry) => entry.samplesMs as number[])
const afterSamples = runs.after.flatMap((entry) => entry.samplesMs as number[])
const beforeAggregate = aggregateRun(beforeSamples)
const afterAggregate = aggregateRun(afterSamples)
const ratio = beforeAggregate.p95Ms > 0 ? afterAggregate.p95Ms / beforeAggregate.p95Ms : null
const sourceErrors = [...runs.before, ...runs.after].flatMap((entry) => [...entry.warmupErrors, ...entry.roundErrors])
const result = {
  schemaVersion: 'apartment-source-chain-guards-paired-importer-benchmark-v1',
  recordedAtUtc: new Date().toISOString(),
  runId,
  resolvedRoute: { model: 'gpt-5.6-luna', reasoningEffort: 'max' },
  status: sourceErrors.length === 0 ? 'PAIRED_EXECUTED' : 'PAIRED_EXECUTED_WITH_ERRORS',
  candidateRunExecuted: true,
  candidateExecution: { explicitFlag: true, sourceFreeze: relativePath(resolve(sourceFreezePath)), sourceFreezeStatus: sourceFreeze.status },
  sourceBinding: {
    sameBunProcess: true,
    sharedDependencyBridgeRuntime: true,
    variantBridgesAreSeparateSourceCopies: true,
    sameTransitiveDependencyResolutionRoot: relativePath(REPO),
    dependencyBinding: {
      baselineDirectAttribution: relativePath(DIRECT_ATTRIBUTION),
      before: beforeDependencies,
      after: afterDependencies,
      resolvedPathParity: JSON.stringify(beforeDependencies.map((item) => item.resolvedPath)) === JSON.stringify(afterDependencies.map((item) => item.resolvedPath)),
      resolvedHashParity: JSON.stringify(beforeDependencies.map((item) => item.sha256)) === JSON.stringify(afterDependencies.map((item) => item.sha256)),
      transitiveClosureVerified: false,
    },
    before: { core: beforeInput, importer: { path: relativePath(BASELINE_IMPORTER), sha256: BASELINE_IMPORTER_SHA }, frame: { path: relativePath(BASELINE_FRAME), sha256: BASELINE_FRAME_SHA } },
    after: afterInput,
    loadPaths: { before: before.loadPaths, after: after.loadPaths },
    generatedHashes: { before: before.generatedHashes, after: after.generatedHashes },
  },
  input: {
    manifest: relativePath(INPUT_MANIFEST),
    manifestSha256: await sha256File(INPUT_MANIFEST),
    rawInputCount: sourceManifest.rawInputCount,
    acceptedCaseCount: cases.length,
    rejectedCaseCount: sourceManifest.rawInputCount - cases.length,
    sameRawDocuments: true,
    manualGuideInjection: false,
    rawRasterRerun: false,
  },
  protocol: {
    warmupRoundsPerVariantAndCase: WARMUPS,
    timedRoundsPerVariantAndCase: ROUNDS,
    bothWarmupSetsFinishBeforeMeasuredRounds: true,
    measuredOrder: 'case/round parity: (caseIndex + roundIndex) even before->after, odd after->before',
    timingScope: 'buildVectorNodes(cloned raw V15 document) only',
    cloneOutsideTiming: true,
    canonicalGeometryOutsideTiming: true,
    canonicalIdFieldsExcluded: true,
  },
  aggregate: {
    before: beforeAggregate,
    after: afterAggregate,
    beforeAfterP95Ratio: ratio == null ? null : round(ratio),
    gateUpperBoundMs: round(beforeAggregate.p95Ms * 1.25),
    gateStatus: ratio != null && afterAggregate.p95Ms <= beforeAggregate.p95Ms * 1.25 ? 'PASS' : 'FAIL',
    errorCount: sourceErrors.length,
    geometryIdempotenceBefore: runs.before.every((entry) => entry.geometryIdempotent),
    geometryIdempotenceAfter: runs.after.every((entry) => entry.geometryIdempotent),
    canonicalExpectedParityBefore: runs.before.every((entry) => entry.canonicalMatchesExpected),
    canonicalExpectedParityAfter: runs.after.every((entry) => entry.canonicalMatchesExpected),
  },
  cases: { before: runs.before, after: runs.after },
}
await writeJson(outputPath, result)
console.log(JSON.stringify({ status: result.status, output: relativePath(outputPath), aggregate: result.aggregate }, null, 2))
