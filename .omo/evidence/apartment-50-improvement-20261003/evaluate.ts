import { buildVectorNodes } from '../../../apps/editor/lib/apt-vector-scene'
import {
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
} from '../../../packages/core/src/lib/space-detection'
import { diagnoseRoomBoundaries } from '../../../packages/core/src/lib/room-boundary'
import { detectSpacesForLevel } from '../../../packages/core/src/lib/space-detection'

const root = '.omo/evidence/apartment-50-improvement-20261003'
const manifest = await Bun.file(`${root}/manifest.json`).json()
const sourceFetch = await Bun.file(`${root}/vectorize-summary.json`).json()

const area = (polygon: Array<[number, number]>) =>
  Math.abs(
    polygon.reduce(
      (sum, point, index) => {
        const next = polygon[(index + 1) % polygon.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      },
      0,
    ) / 2,
  )

const length = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1])

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]))
  }
  return value
}

/**
 * WallNode/ZoneNode/Opening schemas generate nanoids when the importer does
 * not supply ids. Compare the geometry and source references after assigning
 * deterministic positional ids, rather than treating those runtime ids as
 * model output. This keeps the idempotence probe meaningful for the same
 * vector document.
 */
const normalizeSceneGeometry = (scene: any) => {
  const pointKey = (point: [number, number]) => point.map((value) => Number(value.toFixed(8))).join(',')
  const wallKey = (wall: any) => `${pointKey(wall.start)}|${pointKey(wall.end)}|${Number(wall.thickness ?? 0).toFixed(8)}`
  const walls = [...scene.walls].sort((a: any, b: any) => wallKey(a).localeCompare(wallKey(b)))
  const wallKeys = new Map(walls.map((wall: any) => [wall.id, wallKey(wall)]))
  const openingKey = (opening: any) => `${opening.type}|${wallKeys.get(opening.wallId) ?? ''}|${Number(opening.position?.[0] ?? 0).toFixed(8)}|${Number(opening.width ?? 0).toFixed(8)}`
  const openings = [...scene.openings].sort((a: any, b: any) => openingKey(a).localeCompare(openingKey(b)))
  const zoneKey = (zone: any) => `${zone.name ?? ''}|${(zone.polygon ?? []).map(pointKey).join(';')}`
  const zones = [...scene.zones].sort((a: any, b: any) => zoneKey(a).localeCompare(zoneKey(b)))
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
  }
}

const summaryByPlanId = new Map((sourceFetch.results ?? []).map((result: any) => [result.planId, result]))
const results: any[] = []

for (const item of manifest.plans) {
  const folder = `${root}/${item.key}`
  const doc = await Bun.file(`${folder}/vector.json`).json()
  const cli = summaryByPlanId.get(item.planId)
  const entry: any = {
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
      status: cli?.status ?? 'missing',
      elapsedMs: cli?.elapsedMs ?? null,
      routeTimeoutRisk: typeof cli?.elapsedMs === 'number' && cli.elapsedMs > 90_000,
      docVersion: doc.docVersion ?? null,
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
    await Bun.write(`${folder}/evaluation.json`, JSON.stringify(entry, null, 2))
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
      await Bun.write(`${folder}/evaluation.json`, JSON.stringify(entry, null, 2))
      results.push(entry)
      continue
    }

    const levelId = `level_baseline_${item.planId}`
    const walls = first.walls.map((wall: any) => ({ ...wall, parentId: levelId }))
    const zones = first.zones.map((zone: any) => ({ ...zone, parentId: levelId }))
    const openings = first.openings
    const diagnostics = diagnoseRoomBoundaries(levelId, walls, zones)
    const spaces = detectSpacesForLevel(levelId, walls).spaces
    const zonePlan = planAutoZonesForLevel(spaces, zones, {
      adoptContainedApartmentZones: true,
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space', apartmentId: item.apartmentId, planId: item.planId },
    })
    const plannerPolygons = spaces.map((space) => space.polygon.map(([x, y]) => ({ x, y })))
    const slabPlan = planAutoSlabsForLevel(plannerPolygons, [])
    const ceilingPlan = planAutoCeilingsForLevel(plannerPolygons, [])
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
      dimensions: { sourceWallLengthM, importedWallLengthM, wallLengthDeltaM: importedWallLengthM - sourceWallLengthM, openingEvidence: importedOpeningEvidence, roomEvidence },
      stability: { buildVectorNodesIdempotent: idempotent },
    }
    await Bun.write(`${folder}/imported.json`, JSON.stringify({ walls, openings, zones, spaces, diagnostics, zonePlan, slabPlan, ceilingPlan }, null, 2))
  } catch (error) {
    entry.status = 'EVALUATION_ERROR'
    entry.evaluationError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  await Bun.write(`${folder}/evaluation.json`, JSON.stringify(entry, null, 2))
  results.push(entry)
  console.log(JSON.stringify({ key: item.key, status: entry.status, rooms: entry.sourceDocument.rooms, importedZones: entry.importer?.counts?.zones ?? null, spaces: entry.importer?.boundary?.spaces ?? null, legacyCollisions: entry.importer?.legacySpaceIdProbe?.collisionCount ?? null, safeRepairs: entry.importer?.planners?.zones?.create ?? null }))
}

const aggregate = {
  collection: manifest.collection,
  sourceVectorizer: sourceFetch.vectorizer,
  sourceVectorizerSha256: sourceFetch.vectorizerSha256,
  total: results.length,
  statuses: Object.fromEntries([...new Set(results.map((result) => result.status))].map((status) => [status, results.filter((result) => result.status === status).length])),
  imported: results.filter((result) => result.status === 'IMPORTED').length,
  rejected: results.filter((result) => result.status === 'IMPORT_REJECTED').length,
  errors: results.filter((result) => result.status === 'EVALUATION_ERROR').length,
  routeTimeoutRisk: results.filter((result) => result.cli.routeTimeoutRisk).map((result) => result.planId),
  legacySpaceCollisions: results.filter((result) => (result.importer?.legacySpaceIdProbe?.collisionCount ?? 0) > 0).map((result) => ({ planId: result.planId, count: result.importer.legacySpaceIdProbe.collisionCount, collisions: result.importer.legacySpaceIdProbe.collisions })),
  idempotenceFailures: results.filter((result) => result.importer?.stability?.buildVectorNodesIdempotent === false).map((result) => result.planId),
  results,
}
await Bun.write(`${root}/machine-metrics.json`, JSON.stringify(aggregate, null, 2))
console.log(JSON.stringify({ total: aggregate.total, imported: aggregate.imported, rejected: aggregate.rejected, errors: aggregate.errors, legacyCollisionCases: aggregate.legacySpaceCollisions.length }))
