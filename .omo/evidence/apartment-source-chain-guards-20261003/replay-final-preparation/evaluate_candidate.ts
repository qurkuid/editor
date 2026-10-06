#!/usr/bin/env bun
/**
 * Guarded same-V15 candidate replay.
 *
 * The evaluator imports only explicit source-copy paths supplied for this run.
 * It refuses to run without a verified source-freeze record and writes only
 * beneath the Lane B replay-final-preparation root. Raw V15 vector documents are
 * read as frozen inputs; this command never reruns raster extraction.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, join, relative, dirname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

type AnyRecord = Record<string, any>
const REPO = resolve(import.meta.dir, '../../../..')
const EVIDENCE_ROOT = join(REPO, '.omo/evidence/apartment-source-chain-guards-20261003/replay-final-preparation')
const NEW_ROOT = EVIDENCE_ROOT
const HARNESS_ROOT = EVIDENCE_ROOT
const args = Bun.argv.slice(2)
const arg = (name: string, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback
}
const requiredArg = (name: string) => {
  const value = arg(name)
  if (!value) throw new Error(`missing required ${name}`)
  return value
}
const sha256 = async (path: string) => {
  const digest = createHash('sha256')
  digest.update(await Bun.file(path).bytes())
  return digest.digest('hex')
}
const repoPath = (value: string) => (isAbsolute(value) ? resolve(value) : resolve(REPO, value))
const repoRelative = (value: string) => relative(REPO, resolve(value))
const assertNewPath = (value: string, label: string) => {
  const path = resolve(value)
  if (path !== NEW_ROOT && !path.startsWith(`${NEW_ROOT}/`)) {
    throw new Error(`${label} must be under ${NEW_ROOT}; got ${path}`)
  }
  return path
}
const runId = requiredArg('--run-id')
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,96}$/.test(runId)) throw new Error(`invalid --run-id: ${runId}`)
const manifestPath = repoPath(arg('--manifest', join(NEW_ROOT, 'preparation-manifest-lane-b-final-frozen-core-baseline-measured.json')))
const sourceFreezePath = repoPath(requiredArg('--source-freeze'))
const modelLabel = arg('--model-label', `candidate-${runId}`)
const candidateRoot = repoPath(arg('--candidate-dir', '.omo/evidence/apartment-scale-fix-20261003/candidate15'))
const candidateSummaryPath = repoPath(arg('--candidate-summary', '.omo/evidence/apartment-scale-fix-20261003/candidate-summary-v15.json'))
const outputRoot = assertNewPath(arg('--evaluation-root', join(NEW_ROOT, `candidate-evaluation-${runId}`)), 'evaluation root')
const importedRoot = assertNewPath(arg('--imported-root', join(NEW_ROOT, `candidate-imported-${runId}`)), 'imported root')
const aggregatePath = assertNewPath(arg('--aggregate', join(NEW_ROOT, `candidate-machine-${runId}.json`)), 'aggregate')
const guardOutput = assertNewPath(arg('--guard-output', join(NEW_ROOT, `guard-${runId}.json`)), 'guard output')
const beforeImportedRoot = repoPath(arg('--before-imported-root', '.omo/evidence/apartment-next-residual-20261003/replay/candidate-imported-lane-a-final'))
const beforeEvaluationRoot = repoPath(arg('--before-evaluation-root', '.omo/evidence/apartment-next-residual-20261003/replay/candidate-evaluation-lane-a-final'))
const beforeMetricsPath = repoPath(arg('--before-metrics', '.omo/evidence/apartment-next-residual-20261003/replay/candidate-lane-a-final-metrics.json'))
const coreSourcePath = repoPath(requiredArg('--core-source'))
const roomBoundarySourcePath = repoPath(requiredArg('--room-boundary-source'))
const importerSourcePath = repoPath(requiredArg('--importer-source'))
const runtimeRoot = assertNewPath(join(NEW_ROOT, 'runtime', runId), 'runtime root')

for (const path of [manifestPath, sourceFreezePath, candidateSummaryPath, coreSourcePath, roomBoundarySourcePath, importerSourcePath, beforeMetricsPath]) {
  if (!existsSync(path)) throw new Error(`missing required input: ${path}`)
}
for (const path of [candidateRoot, beforeImportedRoot, beforeEvaluationRoot]) {
  if (!existsSync(path)) throw new Error(`missing required directory: ${path}`)
}
const replayManifest = await Bun.file(manifestPath).json() as AnyRecord
if (!['PREPARED_WAITING_FOR_FINAL_SOURCE_FREEZE', 'PREPARED_WITH_LANE_A_BASELINE_TIMED_WAITING_FOR_FINAL_SOURCE_FREEZE'].includes(replayManifest.status)) throw new Error(`unexpected replay manifest status: ${replayManifest.status}`)
if (replayManifest.candidateRunExecuted !== false) throw new Error('replay manifest already claims candidate execution')
if (replayManifest.resolvedRoute?.model !== 'gpt-5.6-luna' || replayManifest.resolvedRoute?.reasoningEffort !== 'max') throw new Error('resolved route mismatch; expected gpt-5.6-luna/max')
if (replayManifest.scope?.beforeComparisonIdentity !== 'eba42adc-candidate' || replayManifest.scope?.beforeUsesEba42adcCandidateImportedEvaluation !== true) throw new Error('before comparison must be the eba42adc candidate')
if ('beforeUsesCurrent0b926ImportedEvaluation' in (replayManifest.scope ?? {})) throw new Error('stale current-0b926 before comparison key is forbidden')
if (replayManifest.scope?.oldV15FloorBaselineForbidden !== true) throw new Error('old v15-floor baseline guard missing')
const comparisonReference = replayManifest.comparisonReference as AnyRecord
const expectedBeforeImportedRoot = repoPath(comparisonReference?.importedRoot ?? '')
const expectedBeforeEvaluationRoot = repoPath(comparisonReference?.evaluationRoot ?? '')
const expectedBeforeMetricsPath = repoPath(comparisonReference?.metrics ?? '')
if (comparisonReference?.identity !== 'eba42adc-candidate' || comparisonReference?.probeWeightedInside !== 298 || comparisonReference?.probeWeightedTotal !== 330) throw new Error('eba42adc comparison reference is incomplete')
if (resolve(beforeImportedRoot) !== resolve(expectedBeforeImportedRoot) || resolve(beforeEvaluationRoot) !== resolve(expectedBeforeEvaluationRoot) || resolve(beforeMetricsPath) !== resolve(expectedBeforeMetricsPath)) throw new Error('before path overrides must resolve to the eba42adc comparison reference')
const beforeMetrics = await Bun.file(beforeMetricsPath).json() as AnyRecord
if (beforeMetrics.totalPlans !== 50 || beforeMetrics.importedCases !== 44 || beforeMetrics.rejectedCases !== 6 || (beforeMetrics.errors ?? 0) !== 0 || beforeMetrics.roomSeeds?.probeWeighted?.inside !== 298 || beforeMetrics.roomSeeds?.probeWeighted?.total !== 330) throw new Error('before metrics are not eba42adc candidate 50/44/6 and 298/330')

// A candidate phase is impossible without the separate guard; this preserves
// the parent verifier's 168-file input check and current source-freeze SHA check.
const verifyScript = join(HARNESS_ROOT, 'verify_final_preparation.py')
const guard = Bun.spawnSync({
  cmd: ['python3', verifyScript, '--phase', 'candidate', '--manifest', manifestPath, '--source-freeze', sourceFreezePath, '--output', guardOutput],
  cwd: REPO,
  stdout: 'pipe',
  stderr: 'pipe',
})
if (guard.exitCode !== 0) throw new Error(`candidate preflight failed: ${new TextDecoder().decode(guard.stderr) || new TextDecoder().decode(guard.stdout)}`)
const guardJson = JSON.parse(await Bun.file(guardOutput).text())
if (guardJson.verified !== true || guardJson.candidateExecutionAllowed !== true) throw new Error('candidate preflight did not grant execution')
const sourceFreeze = await Bun.file(sourceFreezePath).json() as AnyRecord

const sourceText = async (path: string) => new TextDecoder().decode(await Bun.file(path).bytes())
const quote = (path: string) => JSON.stringify(path)
const resolveCanonicalImport = (specifier: string, canonicalBase: string) => {
  const raw = resolve(REPO, canonicalBase, specifier)
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, join(raw, 'index.ts')]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`cannot resolve ${specifier} from ${canonicalBase}`)
  return found
}
const rewriteRelativeImports = (source: string, canonicalBase: string, overrides: Record<string, string>) =>
  source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, delimiter, specifier) => {
    const key = `${canonicalBase}/${specifier.replace(/^\.\//, '')}`
    const target = overrides[key] ?? resolveCanonicalImport(specifier, canonicalBase)
    return `from ${delimiter}${target}${delimiter}`
  })
const canonicalBaseFor = (path: string, fallback: string) => {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.includes('/packages/core/src/lib/')) return 'packages/core/src/lib'
  if (normalized.includes('/apps/editor/lib/')) return 'apps/editor/lib'
  return fallback
}
const coreBase = canonicalBaseFor(coreSourcePath, 'packages/core/src/lib')
const roomBase = canonicalBaseFor(roomBoundarySourcePath, 'packages/core/src/lib')
const importerBase = canonicalBaseFor(importerSourcePath, 'apps/editor/lib')
mkdirSync(runtimeRoot, { recursive: true })
const generatedCorePath = join(runtimeRoot, 'space-detection.rewritten.ts')
const generatedRoomPath = join(runtimeRoot, 'room-boundary.rewritten.ts')
const generatedBridgePath = join(runtimeRoot, 'core-bridge.rewritten.ts')
const generatedImporterPath = join(runtimeRoot, 'apt-vector-scene.rewritten.ts')
const coreOriginal = await sourceText(coreSourcePath)
const roomOriginal = await sourceText(roomBoundarySourcePath)
const importerOriginal = await sourceText(importerSourcePath)
const coreRewritten = rewriteRelativeImports(coreOriginal, coreBase, {})
await Bun.write(generatedCorePath, coreRewritten)
const roomRewritten = rewriteRelativeImports(roomOriginal, roomBase, {
  [`${roomBase}/space-detection`]: generatedCorePath,
})
await Bun.write(generatedRoomPath, roomRewritten)
const bridge = `
export { createDefaultWallFaceBands, getWallConstructionEnvelopeThickness } from ${quote(join(REPO, 'packages/core/src/lib/wall-construction.ts'))}
export { DoorNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/door.ts'))}
export { WallNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/wall.ts'))}
export { WindowNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/window.ts'))}
export { ZoneNode } from ${quote(join(REPO, 'packages/core/src/schema/nodes/zone.ts'))}
export type { CeilingNode as CeilingNodeType } from ${quote(join(REPO, 'packages/core/src/schema/nodes/ceiling.ts'))}
export type { SlabNode as SlabNodeType } from ${quote(join(REPO, 'packages/core/src/schema/nodes/slab.ts'))}
export {
  detectSpacesForLevel,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
} from ${quote(generatedCorePath)}
`
await Bun.write(generatedBridgePath, bridge)
const importerRewritten = rewriteRelativeImports(
  importerOriginal.replace(/(['"])@pascal-app\/core\1/g, (_match, delimiter) => `${delimiter}${generatedBridgePath}${delimiter}`),
  importerBase,
  {},
)
await Bun.write(generatedImporterPath, importerRewritten)
const [actualCoreSha, actualRoomSha, actualImporterSha] = await Promise.all([
  sha256(coreSourcePath), sha256(roomBoundarySourcePath), sha256(importerSourcePath),
])
const sourceHashes = new Map<string, string>()
const sourceHashObjects = sourceFreeze.sourceHashes ?? sourceFreeze.currentSourceHashes ?? sourceFreeze.files ?? {}
if (Array.isArray(sourceHashObjects)) {
  for (const item of sourceHashObjects) if (item?.path && item?.sha256) sourceHashes.set(item.path, item.sha256)
} else {
  for (const [path, value] of Object.entries(sourceHashObjects)) sourceHashes.set(path, typeof value === 'string' ? value : (value as AnyRecord)?.sha256)
}
const expectedCoreSha = sourceHashes.get('packages/core/src/lib/space-detection.ts')
const expectedRoomSha = sourceHashes.get('packages/core/src/lib/room-boundary.ts')
const expectedImporterSha = sourceHashes.get('apps/editor/lib/apt-vector-scene.ts')
if (actualCoreSha !== expectedCoreSha || actualRoomSha !== expectedRoomSha || actualImporterSha !== expectedImporterSha) throw new Error('source-freeze SHA mismatch after preflight')
const generatedHashes = {
  core: await sha256(generatedCorePath),
  roomBoundary: await sha256(generatedRoomPath),
  bridge: await sha256(generatedBridgePath),
  importer: await sha256(generatedImporterPath),
}
const coreModule = await import(pathToFileURL(generatedCorePath).href) as AnyRecord
const roomModule = await import(pathToFileURL(generatedRoomPath).href) as AnyRecord
const importerModule = await import(pathToFileURL(generatedImporterPath).href) as AnyRecord
const buildVectorNodes = importerModule.buildVectorNodes
const planAutoCeilingsForLevel = coreModule.planAutoCeilingsForLevel
const planAutoSlabsForLevel = coreModule.planAutoSlabsForLevel
const planAutoZonesForLevel = coreModule.planAutoZonesForLevel
const detectSpacesForLevel = coreModule.detectSpacesForLevel
const diagnoseRoomBoundaries = roomModule.diagnoseRoomBoundaries
for (const [name, fn] of Object.entries({ buildVectorNodes, planAutoCeilingsForLevel, planAutoSlabsForLevel, planAutoZonesForLevel, detectSpacesForLevel, diagnoseRoomBoundaries })) {
  if (typeof fn !== 'function') throw new Error(`rewritten runtime missing ${name}`)
}
const outputPaths = { evaluationRoot: outputRoot, importedRoot, aggregate: aggregatePath, guard: guardOutput }
const inputProvenance = {
  runId,
  sourceFreezePath: repoRelative(sourceFreezePath),
  sourceFreezeSha256: await sha256(sourceFreezePath),
  source: {
    core: { path: repoRelative(coreSourcePath), sha256: actualCoreSha },
    roomBoundary: { path: repoRelative(roomBoundarySourcePath), sha256: actualRoomSha },
    importer: { path: repoRelative(importerSourcePath), sha256: actualImporterSha },
    generated: generatedHashes,
  },
  before: {
    importedRoot: repoRelative(beforeImportedRoot),
    evaluationRoot: repoRelative(beforeEvaluationRoot),
    comparisonIdentity: 'eba42adc-candidate',
    importedRoot: repoRelative(beforeImportedRoot),
    evaluationRoot: repoRelative(beforeEvaluationRoot),
    machineMetrics: repoRelative(beforeMetricsPath),
    machineMetricsSha256: await sha256(beforeMetricsPath),
  },
  raw: { root: repoRelative(candidateRoot), summary: repoRelative(candidateSummaryPath), summarySha256: await sha256(candidateSummaryPath) },
}
await Bun.write(join(runtimeRoot, 'runtime-provenance.json'), JSON.stringify(inputProvenance, null, 2))
const MODEL_LABEL = modelLabel
const CANDIDATE_ROOT = candidateRoot
const CANDIDATE_SUMMARY_PATH = candidateSummaryPath
const OUTPUT_ROOT = outputRoot
const IMPORTED_ROOT = importedRoot
const AGGREGATE_PATH = aggregatePath
const candidateSummary = await Bun.file(candidateSummaryPath).json() as AnyRecord
const sourcePlanManifestPath = repoPath(replayManifest.baseline.planManifest.path)
const manifest = await Bun.file(sourcePlanManifestPath).json() as AnyRecord
if (!Array.isArray(manifest.plans) || manifest.plans.length !== 50) throw new Error('source plan manifest must contain 50 plans')

const length = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1])
const area = (polygon: Array<[number, number]>) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]!
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2,
  )

const surfaceSignature = (surface: any) => {
  const polygon = (surface?.polygon ?? [])
    .map((point: [number, number]) => point.map((value) => Number(value.toFixed(8))).join(','))
    .join(';')
  const elevation = Number(surface?.elevation ?? 0).toFixed(8)
  const height = surface?.height == null ? '' : Number(surface.height).toFixed(8)
  const thickness = surface?.thickness == null ? '' : Number(surface.thickness).toFixed(8)
  return `${polygon}|e=${elevation}|h=${height}|t=${thickness}`
}

const surfaceSignatures = (surfaces: any[]) => surfaces.map(surfaceSignature).sort()

const compareSurfaceSignatures = (stored: string[], planned: string[]) => {
  const storedSet = new Set(stored)
  const plannedSet = new Set(planned)
  return {
    storedCount: stored.length,
    plannedCount: planned.length,
    exactGeometryMatch: stored.length === planned.length && stored.every((signature) => plannedSet.has(signature)),
    missingFromStored: planned.filter((signature) => !storedSet.has(signature)),
    extraInStored: stored.filter((signature) => !plannedSet.has(signature)),
  }
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

const normalizeSceneGeometry = (scene: any) => {
  const pointKey = (point: [number, number]) => point.map((value) => Number(value.toFixed(8))).join(',')
  const wallKey = (wall: any) =>
    `${pointKey(wall.start)}|${pointKey(wall.end)}|${Number(wall.thickness ?? 0).toFixed(8)}`
  const walls = [...(scene.walls ?? [])].sort((a: any, b: any) => wallKey(a).localeCompare(wallKey(b)))
  const wallKeys = new Map(walls.map((wall: any) => [wall.id, wallKey(wall)]))
  const openingKey = (opening: any) =>
    `${opening.type}|${wallKeys.get(opening.wallId) ?? ''}|${Number(opening.position?.[0] ?? 0).toFixed(8)}|${Number(opening.width ?? 0).toFixed(8)}`
  const openings = [...(scene.openings ?? [])].sort((a: any, b: any) => openingKey(a).localeCompare(openingKey(b)))
  const zoneKey = (zone: any) => `${zone.name ?? ''}|${(zone.polygon ?? []).map(pointKey).join(';')}`
  const zones = [...(scene.zones ?? [])].sort((a: any, b: any) => zoneKey(a).localeCompare(zoneKey(b)))
  const slabs = [...(scene.slabs ?? [])].sort((a: any, b: any) => surfaceSignature(a).localeCompare(surfaceSignature(b)))
  const ceilings = [...(scene.ceilings ?? [])].sort((a: any, b: any) => surfaceSignature(a).localeCompare(surfaceSignature(b)))
  return {
    guideScale: Number(scene.guideScale?.toFixed?.(8) ?? scene.guideScale),
    walls: walls.map((wall: any) => ({
      start: wall.start,
      end: wall.end,
      thickness: wall.thickness,
      height: wall.height,
      frontSide: wall.frontSide,
      backSide: wall.backSide,
      kind: wall.kind,
      metadata: wall.metadata,
    })),
    openings: openings.map((opening: any) => ({
      type: opening.type,
      hostWallGeometry: wallKeys.get(opening.wallId) ?? null,
      width: opening.width,
      height: opening.height,
      position: opening.position,
      openingKind: opening.openingKind,
      metadata: opening.metadata,
    })),
    zones: zones.map((zone: any) => ({
      name: zone.name,
      polygon: zone.polygon,
      spaceRole: zone.spaceRole,
      clearDimensionPolicy: zone.clearDimensionPolicy,
      color: zone.color,
      metadata: zone.metadata,
    })),
    slabs: slabs.map((slab: any) => ({
      polygon: slab.polygon,
      elevation: slab.elevation,
      thickness: slab.thickness,
      autoFromWalls: slab.autoFromWalls,
    })),
    ceilings: ceilings.map((ceiling: any) => ({
      polygon: ceiling.polygon,
      height: ceiling.height,
      autoFromWalls: ceiling.autoFromWalls,
    })),
  }
}

const summaryByPlanId = new Map((candidateSummary.results ?? []).map((result: any) => [result.planId, result]))
const results: any[] = []

await Bun.$`mkdir -p ${OUTPUT_ROOT} ${IMPORTED_ROOT}`

for (const item of manifest.plans) {
  const evaluationPath = `${OUTPUT_ROOT}/${item.planId}.json`
  const importedPath = `${IMPORTED_ROOT}/${item.planId}.json`
  const doc = await Bun.file(`${CANDIDATE_ROOT}/${item.planId}.json`).json()
  const cli = summaryByPlanId.get(item.planId)
  const entry: any = {
    model: MODEL_LABEL,
    key: item.key,
    ordinal: item.ordinal,
    apartmentId: item.apartmentId,
    planId: item.planId,
    name: item.name,
    type: item.type,
    areaBin: item.sizeBin,
    sourceIndex: item.sourceIndex,
    indexBucket: item.indexBucket,
    cli: {
      status: 'CANDIDATE_RAW',
      elapsedMs: cli?.elapsedMs ?? null,
      routeTimeoutRisk: typeof cli?.elapsedMs === 'number' && cli.elapsedMs > 90_000,
      docVersion: doc.docVersion ?? null,
      vectorizerSha256: candidateSummary.vectorizerSha256,
      metrics: doc.metrics ?? null,
    },
    sourceDocument: {
      unit: doc.unit ?? null,
      imageSize: doc.imageSize ?? null,
      mmPerPx: doc.mmPerPx ?? null,
      walls: Array.isArray(doc.walls) ? doc.walls.length : null,
      openings: Array.isArray(doc.openings) ? doc.openings.length : null,
      rooms: Array.isArray(doc.rooms) ? doc.rooms.length : null,
      namedRooms: Array.isArray(doc.rooms) ? doc.rooms.filter((room: any) => room.name).length : null,
    },
  }

  if (doc.unit !== 'mm' || !Number.isFinite(doc.mmPerPx) || doc.mmPerPx <= 0) {
    entry.status = 'IMPORT_REJECTED'
    entry.importer = { reason: 'missing-or-invalid-mmPerPx', built: false }
    await Bun.write(evaluationPath, JSON.stringify(entry, null, 2))
    results.push(entry)
    continue
  }

  try {
    const first = buildVectorNodes(doc)
    const second = buildVectorNodes(doc)
    if (!first || !second) {
      const reason = doc.metrics?.style === 'wood-dense' && (doc.metrics?.wallIoU ?? 0) < 0.7
        ? 'wood-dense-wallIoU-below-0.7'
        : (doc.walls?.length ?? 0) < 3 ? 'fewer-than-three-valid-walls' : 'buildVectorNodes-returned-null'
      entry.status = 'IMPORT_REJECTED'
      entry.importer = { reason, built: false }
      await Bun.write(evaluationPath, JSON.stringify(entry, null, 2))
      results.push(entry)
      continue
    }

    const levelId = `level_${MODEL_LABEL.replace(/[^a-zA-Z0-9_-]/g, '_')}_${item.planId}`
    const walls = first.walls.map((wall: any) => ({ ...wall, parentId: levelId }))
    const zones = first.zones.map((zone: any) => ({ ...zone, parentId: levelId }))
    const openings = first.openings
    const diagnostics = diagnoseRoomBoundaries(levelId, walls, zones)
    const spaces = detectSpacesForLevel(levelId, walls).spaces
    const zonePlan = planAutoZonesForLevel(spaces, zones, {
      adoptContainedApartmentZones: true,
      createMissingZones: { source: 'apt-vector-candidate', generatedFrom: 'detected-space', apartmentId: item.apartmentId, planId: item.planId },
    })
    const plannerPolygons = spaces.map((space) => space.polygon.map(([x, y]) => ({ x, y })))
    const slabPlan = planAutoSlabsForLevel(plannerPolygons, [])
    const ceilingPlan = planAutoCeilingsForLevel(plannerPolygons, [])
    const storedSlabs = first.slabs ?? []
    const storedCeilings = first.ceilings ?? []
    const storedSlabSignatures = surfaceSignatures(storedSlabs)
    const storedCeilingSignatures = surfaceSignatures(storedCeilings)
    const plannedSlabSignatures = surfaceSignatures(slabPlan.create)
    const plannedCeilingSignatures = surfaceSignatures(ceilingPlan.create)
    const persistedSurfaces = {
      slabs: compareSurfaceSignatures(storedSlabSignatures, plannedSlabSignatures),
      ceilings: compareSurfaceSignatures(storedCeilingSignatures, plannedCeilingSignatures),
      storedSlabSignatures,
      storedCeilingSignatures,
      plannedSlabSignatures,
      plannedCeilingSignatures,
    }
    const legacyGroups = new Map<string, string[]>()
    for (const space of spaces) {
      const prefix = `space-${levelId}-`
      const signature = space.id.startsWith(prefix) ? space.id.slice(prefix.length) : space.id
      const key = signature.slice(0, 12)
      legacyGroups.set(key, [...(legacyGroups.get(key) ?? []), space.id])
    }
    const legacyCollisions = [...legacyGroups.entries()].filter(([, ids]) => ids.length > 1)
    const sourceWallLengthM = (doc.walls ?? []).reduce((sum: number, wall: any) => sum + length(wall.start, wall.end) / 1000, 0)
    const importedWallLengthM = walls.reduce((sum: number, wall: any) => sum + length(wall.start, wall.end), 0)
    const sourceOpeningWidthsM = new Map((doc.openings ?? []).map((opening: any) => [opening.id, length(opening.a, opening.b) / 1000]))
    const importedOpeningEvidence = openings.map((opening: any) => {
      const sourceId = opening.metadata?.sourceOpeningId
      const sourceWidth = sourceId ? sourceOpeningWidthsM.get(sourceId) : undefined
      return { id: opening.id, sourceOpeningId: sourceId ?? null, type: opening.type, sourceWidthM: sourceWidth ?? null, importedWidthM: opening.width, deltaM: sourceWidth == null ? null : opening.width - sourceWidth }
    })
    const roomEvidence = zones.map((zone: any) => {
      const sourceRoomId = zone.metadata?.sourceRoomId
      const sourceRoom = (doc.rooms ?? []).find((room: any) => room.id === sourceRoomId)
      const sourceArea = sourceRoom?.areaM2 ?? zone.metadata?.areaM2 ?? null
      const importedArea = area(zone.polygon)
      return { sourceRoomId: sourceRoomId ?? null, sourceName: sourceRoom?.name ?? null, importedName: zone.name, cls: zone.metadata?.cls ?? null, sourceAreaM2: sourceArea, importedAreaM2: importedArea, deltaPct: sourceArea && sourceArea > 0 ? ((importedArea - sourceArea) / sourceArea) * 100 : null }
    })
    const geometryA = stable(normalizeSceneGeometry(first))
    const geometryB = stable(normalizeSceneGeometry(second))
    const idempotent = JSON.stringify(geometryA) === JSON.stringify(geometryB)
    entry.status = 'IMPORTED'
    entry.importer = {
      built: true,
      guideScale: first.guideScale,
      counts: { walls: walls.length, openings: openings.length, zones: zones.length },
      diagnostics: first.diagnostics,
      boundary: { spaces: spaces.length, uniqueSpaceIds: new Set(spaces.map((space) => space.id)).size, danglingEndpoints: diagnostics.danglingEndpoints.length, issues: diagnostics.issues.length },
      legacySpaceIdProbe: { detectedSpaces: spaces.length, uniqueLegacyIds: legacyGroups.size, collisionCount: legacyCollisions.length, collisions: legacyCollisions.map(([id, ids]) => ({ id, spaceIds: ids })) },
      planners: { zones: { create: zonePlan.create.length, update: zonePlan.update.length }, slabs: { create: slabPlan.create.length, update: slabPlan.update.length, delete: slabPlan.delete.length }, ceilings: { create: ceilingPlan.create.length, update: ceilingPlan.update.length, delete: ceilingPlan.delete.length } },
      persistedSurfaces,
      dimensions: { sourceWallLengthM, importedWallLengthM, wallLengthDeltaM: importedWallLengthM - sourceWallLengthM, openingEvidence: importedOpeningEvidence, roomEvidence },
      stability: { buildVectorNodesIdempotent: idempotent },
    }
    await Bun.write(importedPath, JSON.stringify({ model: MODEL_LABEL, planId: item.planId, walls, openings, zones, spaces, slabs: storedSlabs, ceilings: storedCeilings, diagnostics, zonePlan, slabPlan, ceilingPlan, persistedSurfaces }, null, 2))
  } catch (error) {
    entry.status = 'EVALUATION_ERROR'
    entry.evaluationError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  await Bun.write(evaluationPath, JSON.stringify(entry, null, 2))
  results.push(entry)
  console.log(JSON.stringify({ key: item.key, status: entry.status, spaces: entry.importer?.boundary?.spaces ?? null, zones: entry.importer?.counts?.zones ?? null, legacyCollisions: entry.importer?.legacySpaceIdProbe?.collisionCount ?? null }))
}

const aggregate = {
  model: MODEL_LABEL,
  collection: manifest.collection,
  sourceVectorizer: candidateSummary.vectorizer,
  sourceVectorizerSha256: candidateSummary.vectorizerSha256,
  total: results.length,
  statuses: Object.fromEntries([...new Set(results.map((result) => result.status))].map((status) => [status, results.filter((result) => result.status === status).length])),
  imported: results.filter((result) => result.status === 'IMPORTED').length,
  rejected: results.filter((result) => result.status === 'IMPORT_REJECTED').length,
  errors: results.filter((result) => result.status === 'EVALUATION_ERROR').length,
  routeTimeoutRisk: results.filter((result) => result.cli.routeTimeoutRisk).map((result) => result.planId),
  legacySpaceCollisions: results.filter((result) => (result.importer?.legacySpaceIdProbe?.collisionCount ?? 0) > 0).map((result) => ({ planId: result.planId, count: result.importer.legacySpaceIdProbe.collisionCount, collisions: result.importer.legacySpaceIdProbe.collisions })),
  idempotenceFailures: results.filter((result) => result.importer?.stability?.buildVectorNodesIdempotent === false).map((result) => result.planId),
  initialPersistedSurfaces: {
    importedCases: results.filter((result) => result.status === 'IMPORTED').length,
    slabCases: results.filter((result) => result.status === 'IMPORTED' && (result.importer?.persistedSurfaces?.slabs?.storedCount ?? 0) > 0).length,
    ceilingCases: results.filter((result) => result.status === 'IMPORTED' && (result.importer?.persistedSurfaces?.ceilings?.storedCount ?? 0) > 0).length,
    storedSlabs: results.reduce((sum, result) => sum + (result.importer?.persistedSurfaces?.slabs?.storedCount ?? 0), 0),
    storedCeilings: results.reduce((sum, result) => sum + (result.importer?.persistedSurfaces?.ceilings?.storedCount ?? 0), 0),
    exactSlabPlanMatches: results.filter((result) => result.status === 'IMPORTED' && result.importer?.persistedSurfaces?.slabs?.exactGeometryMatch).length,
    exactCeilingPlanMatches: results.filter((result) => result.status === 'IMPORTED' && result.importer?.persistedSurfaces?.ceilings?.exactGeometryMatch).length,
  },
  results,
}
await Bun.write(AGGREGATE_PATH, JSON.stringify(aggregate, null, 2))
console.log(JSON.stringify({ total: aggregate.total, imported: aggregate.imported, rejected: aggregate.rejected, errors: aggregate.errors, legacyCollisionCases: aggregate.legacySpaceCollisions.length, idempotenceFailures: aggregate.idempotenceFailures.length }))
