import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

type Point = [number, number]
type TraceEvent = Record<string, any>
type Recorder = { enabled: boolean; events: TraceEvent[] }

type TraceVariant = {
  name: string
  baselineModulePath: string
  controlModulePath: string
  originalModulePath: string
  modulePath: string
  sourceCopy: string
  controlSourceCopy: string
  sourceSha256: string
  mode: string
}

const evidenceRoot = resolve('.omo/evidence/apartment-source-chain-guards-20261003/causal-trace')
const inputPath = resolve('.omo/evidence/apartment-scale-fix-20261003/candidate15/3FO40C71IWG4.json')
const input = JSON.parse(readFileSync(inputPath, 'utf8'))
const inputSha256 = sha256(readFileSync(inputPath))
const variants: TraceVariant[] = [
  {
    name: 'lane-a',
    baselineModulePath: resolve(evidenceRoot, 'copies/lane-a/source-original.ts'),
    controlModulePath: resolve(evidenceRoot, 'copies/lane-a/source-original.ts'),
    originalModulePath: resolve(evidenceRoot, 'copies/lane-a/source-original.ts'),
    modulePath: resolve(evidenceRoot, 'copies/lane-a/apt-vector-scene-trace.ts'),
    sourceCopy: resolve(evidenceRoot, 'copies/lane-a/source-original.ts'),
    controlSourceCopy: resolve(evidenceRoot, 'copies/lane-a/source-original.ts'),
    sourceSha256: 'eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89',
    mode: 'lane-a-frozen',
  },
  {
    name: 'lane-a-pair-local',
    baselineModulePath: resolve(evidenceRoot, 'copies/lane-a-pair-local/source-original.ts'),
    controlModulePath: resolve(evidenceRoot, 'copies/lane-a-pair-local/source-control.ts'),
    originalModulePath: resolve(evidenceRoot, 'copies/lane-a-pair-local/source-original.ts'),
    modulePath: resolve(evidenceRoot, 'copies/lane-a-pair-local/apt-vector-scene-trace.ts'),
    sourceCopy: resolve(evidenceRoot, 'copies/lane-a-pair-local/source-original.ts'),
    controlSourceCopy: resolve(evidenceRoot, 'copies/lane-a-pair-local/source-control.ts'),
    sourceSha256: 'eb96fcb7739754507350348a7c431d5f2c99bd8b2f9e7f179c5671ec95bc3a89',
    mode: 'lane-a-plus-pair-local-exact-contact',
  },
  {
    name: 'paused-wip',
    baselineModulePath: resolve(evidenceRoot, 'copies/paused-wip/source-original.ts'),
    controlModulePath: resolve(evidenceRoot, 'copies/paused-wip/source-original.ts'),
    originalModulePath: resolve(evidenceRoot, 'copies/paused-wip/source-original.ts'),
    modulePath: resolve(evidenceRoot, 'copies/paused-wip/apt-vector-scene-trace.ts'),
    sourceCopy: resolve(evidenceRoot, 'copies/paused-wip/source-original.ts'),
    controlSourceCopy: resolve(evidenceRoot, 'copies/paused-wip/source-original.ts'),
    sourceSha256: '75e44332e3a044cb53049abcff31f2e103d98e554411cbe5d0f5aa70beca8b26',
    mode: 'paused-wip-global-protection',
  },
]

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function roundValue(value: unknown): unknown {
  if (typeof value === 'number') return Number(value.toPrecision(15))
  if (Array.isArray(value)) return value.map(roundValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, roundValue(item)]))
  }
  return value
}

function sortJson<T>(items: T[]): T[] {
  return [...items].sort((a, b) => JSON.stringify(roundValue(a)).localeCompare(JSON.stringify(roundValue(b))))
}

function canonicalScene(scene: any): Record<string, unknown> {
  const wallById = new Map<string, any>(scene.walls.map((wall: any) => [wall.id, wall]))
  const wallValue = (wall: any) => ({
    start: wall.start,
    end: wall.end,
    thickness: wall.thickness,
    faceBands: wall.faceBands,
    frontSide: wall.frontSide,
    backSide: wall.backSide,
  })
  const canonicalWalls = sortJson(scene.walls.map(wallValue))
  const canonicalOpenings = sortJson(scene.openings.map((opening: any) => ({
    type: opening.type,
    width: opening.width,
    height: opening.height,
    openingKind: opening.openingKind,
    metadata: opening.metadata,
    position: opening.position,
    swingDirection: opening.swingDirection,
    host: wallById.has(opening.wallId) ? wallValue(wallById.get(opening.wallId)) : null,
  })))
  const canonicalZones = sortJson(scene.zones.map((zone: any) => ({
    name: zone.name,
    polygon: zone.polygon,
    spaceRole: zone.spaceRole,
    color: zone.color,
    metadata: zone.metadata,
    clearDimensionPolicy: zone.clearDimensionPolicy,
  })))
  const canonicalSurface = (surface: any) => ({
    polygon: surface.polygon,
    metadata: surface.metadata,
    surfaceType: surface.surfaceType,
    height: surface.height,
  })
  return {
    walls: canonicalWalls,
    openings: canonicalOpenings,
    zones: canonicalZones,
    slabs: sortJson(scene.slabs.map(canonicalSurface)),
    ceilings: sortJson(scene.ceilings.map(canonicalSurface)),
    guideScale: scene.guideScale,
    diagnostics: scene.diagnostics,
  }
}

function lengthOf(segment: any): number {
  return Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1])
}

function duplicateMetrics(segments: any[]): { count: number; length: number; pairs: any[] } {
  let count = 0
  let length = 0
  const pairs: any[] = []
  for (let i = 0; i < segments.length; i++) {
    const shorter = segments[i]
    const shorterLength = lengthOf(shorter)
    if (shorterLength <= 1e-9) continue
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const longer = segments[j]
      const longerLength = lengthOf(longer)
      if (shorterLength > longerLength + 1e-6 || longerLength <= 1e-9) continue
      const dx = (longer.end[0] - longer.start[0]) / longerLength
      const dy = (longer.end[1] - longer.start[1]) / longerLength
      const shorterDx = (shorter.end[0] - shorter.start[0]) / shorterLength
      const shorterDy = (shorter.end[1] - shorter.start[1]) / shorterLength
      if (Math.abs(shorterDx * dx + shorterDy * dy) < 0.99) continue
      const project = (point: Point) => (point[0] - longer.start[0]) * dx + (point[1] - longer.start[1]) * dy
      const distance = (point: Point) => Math.abs((point[0] - longer.start[0]) * dy - (point[1] - longer.start[1]) * dx)
      if (!shorter.start || !shorter.end) continue
      if (![shorter.start, shorter.end].every((point: Point) => project(point) >= -1e-6 && project(point) <= longerLength + 1e-6 && distance(point) <= (longer.thickness ?? 0.1) / 2 + 1e-6)) continue
      count += 1
      length += shorterLength
      pairs.push({ shorterIndex: i, longerIndex: j, shorterLength, longerLength, shorterSourceIds: [...(shorter.sourceIds ?? [])], longerSourceIds: [...(longer.sourceIds ?? [])] })
      break
    }
  }
  return { count, length, pairs }
}

function envelopeMetrics(segments: any[]): { count: number; length: number; pairs: any[] } {
  let count = 0
  let length = 0
  const pairs: any[] = []
  for (let i = 0; i < segments.length; i++) {
    const shorter = segments[i]
    const shorterLength = lengthOf(shorter)
    if (shorterLength <= 1e-9) continue
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const longer = segments[j]
      const longerLength = lengthOf(longer)
      if (shorterLength > longerLength + 1e-6 || longerLength <= 1e-9) continue
      const dx = (longer.end[0] - longer.start[0]) / longerLength
      const dy = (longer.end[1] - longer.start[1]) / longerLength
      const project = (point: Point) => (point[0] - longer.start[0]) * dx + (point[1] - longer.start[1]) * dy
      const distance = (point: Point) => Math.abs((point[0] - longer.start[0]) * dy - (point[1] - longer.start[1]) * dx)
      if (![shorter.start, shorter.end].every((point: Point) => project(point) >= -1e-6 && project(point) <= longerLength + 1e-6 && distance(point) <= (longer.thickness ?? 0.1) / 2 + 1e-6)) continue
      count += 1
      length += shorterLength
      pairs.push({ shorterIndex: i, longerIndex: j, shorterLength, longerLength, shorterSourceIds: [...(shorter.sourceIds ?? [])], longerSourceIds: [...(longer.sourceIds ?? [])] })
      break
    }
  }
  return { count, length, pairs }
}

function stageSegments(event: TraceEvent): any[] {
  if (Array.isArray(event.segments)) return event.segments
  if (Array.isArray(event.walls)) return event.walls
  return []
}

function sourceOverlap(left: string[], right: string[]): boolean {
  const set = new Set(left)
  return right.some((id) => set.has(id))
}

function sourceSegmentMap(events: TraceEvent[]): Map<string, any> {
  return new Map(events.filter((event) => event.stage === 'source-segment' && event.accepted).map((event) => [event.sourceId, {
    start: event.transformedStart,
    end: event.transformedEnd,
    thickness: event.thickness,
    sourceIds: [event.sourceId],
  }]))
}

function containedByGroup(shorter: any, longer: any, parallel: boolean): { directionDot: number; endpointChecks: any[] } | null {
  const shorterLength = lengthOf(shorter)
  const longerLength = lengthOf(longer)
  if (shorterLength <= 1e-9 || longerLength <= 1e-9 || shorterLength > longerLength + 1e-6) return null
  const shorterDx = (shorter.end[0] - shorter.start[0]) / shorterLength
  const shorterDy = (shorter.end[1] - shorter.start[1]) / shorterLength
  const dx = (longer.end[0] - longer.start[0]) / longerLength
  const dy = (longer.end[1] - longer.start[1]) / longerLength
  const directionDot = Math.abs(shorterDx * dx + shorterDy * dy)
  if (parallel && directionDot < 0.99) return null
  const checks = [shorter.start, shorter.end].map((point: Point) => ({
    projectionM: (point[0] - longer.start[0]) * dx + (point[1] - longer.start[1]) * dy,
    distanceM: Math.abs((point[0] - longer.start[0]) * dy - (point[1] - longer.start[1]) * dx),
  }))
  const halfThickness = (longer.thickness ?? 0.1) / 2 + 1e-6
  if (!checks.every((check) => check.projectionM >= -1e-6 && check.projectionM <= longerLength + 1e-6 && check.distanceM <= halfThickness)) return null
  return { directionDot, endpointChecks: checks }
}

function firstUnionOperation(events: TraceEvent[], firstPositivePair: any, finalPair: any, parallel: boolean): Record<string, unknown> | null {
  if (!firstPositivePair) return null
  const shortIds = firstPositivePair.shorterSourceIds ?? []
  const longIds = firstPositivePair.longerSourceIds ?? []
  const sourceMap = sourceSegmentMap(events)
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]!
    if (event.stage !== 'union-apply' || !event.afterGroup) continue
    const groupIds = event.afterGroup.sourceIds ?? []
    if (!longIds.some((id: string) => groupIds.includes(id))) continue
    for (const shortId of shortIds) {
      const shorter = sourceMap.get(shortId)
      if (!shorter || groupIds.includes(shortId)) continue
      const contained = containedByGroup(shorter, event.afterGroup, parallel)
      if (!contained) continue
      return {
        stage: 'union-apply',
        eventIndex,
        reason: event.reason,
        openingId: event.openingId ?? null,
        leftIndex: event.leftIndex,
        rightIndex: event.rightIndex,
        leftSourceIds: event.leftSourceIds,
        rightSourceIds: event.rightSourceIds,
        beforeRoots: event.beforeRoots,
        afterRoot: event.afterRoot,
        afterGroup: event.afterGroup,
        sourceMemberIds: { shorter: [shortId], longer: groupIds },
        directionDot: contained.directionDot,
        endpointChecks: contained.endpointChecks,
      }
    }
  }
  return null
}

function identifyFinalPairs(events: TraceEvent[]): any[] {
  const final = events.find((event) => event.stage === 'final')
  if (!final) return []
  return final.containedDuplicateSpan?.pairs ?? []
}

function pairMatchesTarget(pair: any, target: any): boolean {
  const shortIds = target.shorterSourceIds ?? []
  const longIds = target.longerSourceIds ?? []
  return (
    sourceOverlap(shortIds, pair.shorterSourceIds ?? []) && sourceOverlap(longIds, pair.longerSourceIds ?? [])
  ) || (
    sourceOverlap(shortIds, pair.longerSourceIds ?? []) && sourceOverlap(longIds, pair.shorterSourceIds ?? [])
  )
}

function firstMutationProducingPair(events: TraceEvent[], target: any, parallel: boolean): Record<string, unknown> | null {
  const merged = events.find((event) => event.stage === 'merged-before-snap')
  if (!merged) return null
  const segments = stageSegments(merged).map((segment: any) => ({
    ...segment,
    start: [...segment.start],
    end: [...segment.end],
  }))
  let appliedMutationCount = 0
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]!
    if ((event.stage !== 'snap-step' && event.stage !== 'weld-step') || !event.applied) continue
    const segmentIndex = Number(event.segmentIndex)
    const segment = segments[segmentIndex]
    const endpoint = event.endpoint
    if (!segment || (endpoint !== 'start' && endpoint !== 'end') || !Array.isArray(event.proposedPoint)) continue
    const beforePoint = [...segment[endpoint]]
    segment[endpoint] = [...event.proposedPoint]
    appliedMutationCount += 1
    const metrics = parallel ? duplicateMetrics(segments) : envelopeMetrics(segments)
    const pair = metrics.pairs.find((candidate: any) => pairMatchesTarget(candidate, target))
    if (!pair) continue
    return {
      ...event,
      traceEventIndex: eventIndex,
      appliedMutationCount,
      beforePoint,
      afterPoint: [...event.proposedPoint],
      postOperationPair: pair,
      postOperationMetric: parallel ? 'containedDuplicateSpan' : 'containedEnvelopeSpan',
    }
  }
  return null
}

function firstAttribution(events: TraceEvent[], finalPair: any, metricKey: 'containedDuplicateSpan' | 'containedEnvelopeSpan' = 'containedDuplicateSpan', parallel = metricKey === 'containedDuplicateSpan'): Record<string, unknown> {
  const shorterIds = finalPair.shorterSourceIds ?? []
  const longerIds = finalPair.longerSourceIds ?? []
  const boundaryOrder = ['merged-before-snap', 'post-snap', 'post-weld', 'before-connect', 'after-connect', 'final']
  let firstPositiveBoundary: string | null = null
  let firstPositivePair: any = null
  for (const boundary of boundaryOrder) {
    const event = events.find((candidate) => candidate.stage === boundary)
    if (!event) continue
    const metrics = event[metricKey] ?? (parallel ? duplicateMetrics(stageSegments(event)) : envelopeMetrics(stageSegments(event)))
    for (const pair of metrics.pairs ?? []) {
      if (sourceOverlap(shorterIds, pair.shorterSourceIds ?? []) && sourceOverlap(longerIds, pair.longerSourceIds ?? [])) {
        firstPositiveBoundary = boundary
        firstPositivePair = pair
        break
      }
      if (sourceOverlap(shorterIds, pair.longerSourceIds ?? []) && sourceOverlap(longerIds, pair.shorterSourceIds ?? [])) {
        firstPositiveBoundary = boundary
        firstPositivePair = pair
        break
      }
    }
    if (firstPositiveBoundary) break
  }
  const firstUnion = firstPositiveBoundary === 'merged-before-snap' ? firstUnionOperation(events, firstPositivePair, finalPair, parallel) : null
  const mutations = events.filter((event) => (event.stage === 'snap-step' || event.stage === 'weld-step') && event.applied && event.moveDistance > 1e-6 && (sourceOverlap(shorterIds, event.sourceIds ?? []) || sourceOverlap(longerIds, event.sourceIds ?? [])))
  const firstMutationProducing = firstUnion ? null : firstMutationProducingPair(events, finalPair, parallel)
  return {
    metric: metricKey,
    finalPair,
    sourceMemberIds: { shorter: shorterIds, longer: longerIds },
    firstPositiveBoundary,
    firstPositivePair,
    firstOperation: firstUnion ?? firstMutationProducing ?? mutations[0] ?? null,
    firstMutation: firstUnion ?? firstMutationProducing ?? mutations[0] ?? null,
    firstMutationProducesMetric: firstUnion ? null : firstMutationProducing,
    relatedMutations: mutations.slice(0, 20),
  }
}

async function runVariant(variant: TraceVariant): Promise<Record<string, unknown>> {
  const baselineModule = await import(variant.baselineModulePath)
  const controlModule = await import(variant.controlModulePath)
  const module = await import(variant.modulePath)
  const recorder: Recorder = { enabled: false, events: [] }
  ;(globalThis as any).__aptSourceTrace = recorder
  const baselineScene = baselineModule.buildVectorNodes(input)
  const baselineCanonical = baselineScene ? canonicalScene(baselineScene) : null
  const baselineHash = sha256(JSON.stringify(roundValue(baselineCanonical)))
  const controlScene = controlModule.buildVectorNodes(input)
  const controlCanonical = controlScene ? canonicalScene(controlScene) : null
  const controlHash = sha256(JSON.stringify(roundValue(controlCanonical)))
  const disabledScene = module.buildVectorNodes(input)
  const disabledCanonical = disabledScene ? canonicalScene(disabledScene) : null
  const disabledHash = sha256(JSON.stringify(roundValue(disabledCanonical)))
  recorder.enabled = true
  const enabledScene = module.buildVectorNodes(input)
  const enabledCanonical = enabledScene ? canonicalScene(enabledScene) : null
  const enabledHash = sha256(JSON.stringify(roundValue(enabledCanonical)))
  const events = recorder.events
  const finalPairs = identifyFinalPairs(events)
  const attributions = finalPairs.map((pair) => firstAttribution(events, pair))
  const final = events.find((event) => event.stage === 'final')
  const envelopePairs = final?.containedEnvelopeSpan?.pairs ?? envelopeMetrics(stageSegments(final ?? {})).pairs
  const negativeControls = envelopePairs
    .filter((pair: any) => !finalPairs.some((exact: any) => exact.shorterIndex === pair.shorterIndex && exact.longerIndex === pair.longerIndex))
    .map((pair: any) => firstAttribution(events, pair, 'containedEnvelopeSpan', false))
    .map((attribution: any) => {
      const short = attribution.finalPair
      const shorterLength = short.shorterLength
      const longerLength = short.longerLength
      const shorterDx = (stageSegments(final ?? {})[short.shorterIndex].end[0] - stageSegments(final ?? {})[short.shorterIndex].start[0]) / shorterLength
      const shorterDy = (stageSegments(final ?? {})[short.shorterIndex].end[1] - stageSegments(final ?? {})[short.shorterIndex].start[1]) / shorterLength
      const longer = stageSegments(final ?? {})[short.longerIndex]
      const dx = (longer.end[0] - longer.start[0]) / longerLength
      const dy = (longer.end[1] - longer.start[1]) / longerLength
      const directionDot = Math.abs(shorterDx * dx + shorterDy * dy)
      return {
        ...attribution,
        classification: directionDot < 0.99 ? 'nonparallel-contained-envelope-negative-control' : 'parallel-envelope-overlap',
        directionDot,
        angleDeg: Math.acos(Math.min(1, Math.max(-1, directionDot))) * 180 / Math.PI,
      }
    })
  return {
    variant: variant.name,
    mode: variant.mode,
    sourceCopy: variant.sourceCopy,
    controlSourceCopy: variant.controlSourceCopy,
    sourceSha256: variant.sourceSha256,
    input: inputPath,
    inputSha256,
    baselineOutputHash: baselineHash,
    controlOutputHash: controlHash,
    originalOutputHash: controlHash,
    traceDisabledOutputHash: disabledHash,
    traceEnabledOutputHash: enabledHash,
    baselineVsControlOutputHashEqual: baselineHash === controlHash,
    controlVsTraceDisabledHashEqual: controlHash === disabledHash,
    originalVsTraceDisabledHashEqual: controlHash === disabledHash,
    traceOutputHashEqual: disabledHash === enabledHash,
    disabledReturned: disabledScene !== null,
    enabledReturned: enabledScene !== null,
    eventCounts: Object.fromEntries(events.reduce((map, event) => map.set(event.stage, (map.get(event.stage) ?? 0) + 1), new Map<string, number>())),
    finalDuplicateAttribution: attributions,
    finalEnvelopeNegativeControls: negativeControls,
    events,
  }
}

mkdirSync(evidenceRoot + '/outputs', { recursive: true })
for (const variant of variants) {
  const result = await runVariant(variant)
  const path = `${evidenceRoot}/outputs/${variant.name}.json`
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ variant: variant.name, traceOutputHashEqual: result.traceOutputHashEqual, eventCounts: result.eventCounts, finalDuplicateAttribution: result.finalDuplicateAttribution }, null, 2))
}
