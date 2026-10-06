import { buildVectorNodes } from '../../../apps/editor/lib/apt-vector-scene'
import {
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
} from '../../../packages/core/src/lib/space-detection'
import { diagnoseRoomBoundaries } from '../../../packages/core/src/lib/room-boundary'
import { detectSpacesForLevel } from '../../../packages/core/src/lib/space-detection'

const ROOT = '.omo/evidence/apartment-50-improvement-20261003'
const args = Bun.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback
}
const MODEL_LABEL = arg('--model-label', 'candidate-v14')
const CANDIDATE_ROOT = arg('--candidate-dir', '.omo/evidence/apartment-scale-fix-20261003/candidate')
const CANDIDATE_SUMMARY_PATH = arg('--candidate-summary', '.omo/evidence/apartment-scale-fix-20261003/candidate-summary.json')
const OUTPUT_ROOT = arg('--evaluation-root', `${ROOT}/candidate-evaluation`)
const IMPORTED_ROOT = arg('--imported-root', `${ROOT}/candidate-imported`)
const AGGREGATE_PATH = arg('--aggregate', `${ROOT}/candidate-machine-metrics.json`)

const manifest = await Bun.file(`${ROOT}/manifest.json`).json()
const candidateSummary = await Bun.file(CANDIDATE_SUMMARY_PATH).json()

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
