import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Point = [number, number]
type Wall = {
  id: string
  kind: 'exterior' | 'interior'
  start: Point
  end: Point
  thickness: number
}
type AptVectorDoc = {
  unit: 'mm'
  imageSize: [number, number]
  mmPerPx: number
  rooms: unknown[]
  openings: unknown[]
  walls: Wall[]
}
type TraceEvent = Record<string, any>
type SourceGateRecord = {
  sourcePath: string
  path: string
  sha256?: string
  manifestPath: string
  recordKind: string
}
type SourceBinding = {
  gatePath: string
  gateSha256: string
  sourceEntry: { path: string; sha256: string }
  sourceSnapshotPath: string
  auxiliary: SourceGateRecord[]
}
type Scene = {
  walls: any[]
  openings: any[]
  zones: any[]
  slabs: any[]
  ceilings: any[]
  guideScale: number
  diagnostics: Record<string, unknown>
}

const root = resolve('.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-r4-final')
const copies = resolve(root, 'copies')
const inputs = resolve(root, 'inputs')
const outputs = resolve(root, 'outputs')
const sourcePath = resolve(copies, 'source-final.ts')
const instrumentedPath = resolve(copies, 'apt-vector-scene.instrumented.ts')
const mutatedPath = resolve(copies, 'apt-vector-scene.old-key-mutated.ts')
const runnerPath = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-r4-final/scripts/run_atomic_trace_r4.ts',
)
const generatorPath = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-r4-final/scripts/build_atomic_variants_r4.py',
)
const liveProductPath = resolve('apps/editor/lib/apt-vector-scene.ts')
const sourceFreezeR4Path = resolve(
  process.env.PASCAL_R4_FINAL_GATE ??
    process.env.PASCAL_R4_SOURCE_FREEZE ??
      '.omo/evidence/apartment-source-chain-guards-20261003/product-final/r4/source-freeze-r4.json',
)
const fixturePath = resolve(inputs, 'fixture-order-a.json')
const reportPath = resolve(outputs, 'atomic-trace-report.json')

mkdirSync(outputs, { recursive: true })

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function existingPath(candidates: string[]): string | undefined {
  return candidates.find((candidate) => {
    try {
      readFileSync(candidate)
      return true
    } catch {
      return false
    }
  })
}

function resolveGatePath(path: string, base: string): string {
  if (path.startsWith('/')) return path
  return (
    existingPath([resolve(base, path), resolve(path), resolve(dirname(base), path)]) ??
    resolve(path)
  )
}

function nestedGateRefs(payload: Record<string, any>, base: string): Array<{ path: string; sha256?: string }> {
  const refs: Array<{ path: string; sha256?: string }> = []
  for (const key of [
    'sourceFreeze',
    'sourceFreezeManifest',
    'sourceSnapshotManifest',
    'snapshotManifest',
    'freezeArtifact',
    'combinedSourceFreeze',
    'sourceFreezeSupplement',
    'sourceSupplement',
    'supplement',
    'parentSourceGate',
    'parentGate',
  ]) {
    const value = payload[key]
    if (typeof value === 'string') refs.push({ path: resolveGatePath(value, base) })
    else if (value && typeof value === 'object' && typeof value.path === 'string') {
      refs.push({ path: resolveGatePath(value.path, base), sha256: value.sha256 })
    }
  }
  if (Array.isArray(payload.references)) {
    for (const value of payload.references) {
      if (value && typeof value === 'object' && typeof value.path === 'string') {
        refs.push({ path: resolveGatePath(value.path, base), sha256: value.sha256 })
      }
    }
  }
  return refs
}

function loadGatePayloads(path: string): Array<{ path: string; payload: Record<string, any> }> {
  const queue = [path]
  const seen = new Set<string>()
  const loaded: Array<{ path: string; payload: Record<string, any> }> = []
  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    const payload = current.endsWith('.json')
      ? (JSON.parse(readFileSync(current, 'utf8')) as Record<string, any>)
      : {}
    loaded.push({ path: current, payload })
    for (const ref of nestedGateRefs(payload, dirname(current))) {
      if (ref.sha256) {
        const actual = sha256(readFileSync(ref.path))
        assertCondition(actual === ref.sha256, `final-gate manifest hash mismatch: ${ref.path}`)
      }
      queue.push(ref.path)
    }
  }
  return loaded
}

function allSourceRecords(payload: Record<string, any>): Array<{ sourcePath: string; record: Record<string, any>; kind: string }> {
  const records: Array<{ sourcePath: string; record: Record<string, any>; kind: string }> = []
  const add = (sourcePath: unknown, record: unknown, kind: string) => {
    if (
      typeof sourcePath === 'string' &&
      (sourcePath.startsWith('apps/') || sourcePath.startsWith('packages/')) &&
      record &&
      typeof record === 'object'
    ) {
      records.push({ sourcePath, record: record as Record<string, any>, kind })
    }
  }
  if (payload.sourceSnapshots && typeof payload.sourceSnapshots === 'object') {
    for (const [sourcePath, record] of Object.entries(payload.sourceSnapshots)) add(sourcePath, record, 'sourceSnapshots')
  }
  if (Array.isArray(payload.sourceFiles)) {
    for (const record of payload.sourceFiles) {
      if (!record || typeof record !== 'object') continue
      add((record as any).originalPath ?? (record as any).path, record, 'sourceFiles')
    }
  }
  if (Array.isArray(payload.productSourceEntries)) {
    for (const record of payload.productSourceEntries) {
      if (!record || typeof record !== 'object') continue
      add((record as any).sourcePath ?? (record as any).originalPath ?? (record as any).path, record, 'productSourceEntries')
    }
  }
  if (Array.isArray(payload.entries)) {
    for (const record of payload.entries) {
      if (!record || typeof record !== 'object') continue
      add((record as any).sourcePath ?? (record as any).originalPath ?? (record as any).path, record, 'entries')
    }
  }
  if (payload.productFiles && typeof payload.productFiles === 'object') {
    for (const [key, record] of Object.entries(payload.productFiles)) {
      add((record as any)?.path ?? (key === 'source' ? 'apps/editor/lib/apt-vector-scene.ts' : key), record, 'productFiles')
    }
  }
  if (payload.ownedProductFiles && typeof payload.ownedProductFiles === 'object') {
    for (const [sourcePath, record] of Object.entries(payload.ownedProductFiles)) add(sourcePath, record, 'ownedProductFiles')
  }
  if (payload.sourceFileSha256 && typeof payload.sourceFileSha256 === 'object') {
    for (const [sourcePath, value] of Object.entries(payload.sourceFileSha256)) {
      if (typeof value === 'string') add(sourcePath, { path: sourcePath, sha256: value }, 'sourceFileSha256')
    }
  }
  return records
}

function loadSourceBinding(path: string): SourceBinding {
  const payloads = loadGatePayloads(path)
  const statuses = payloads.map(({ payload }) => String(payload.status ?? '').toUpperCase())
  assertCondition(
    statuses.some((status) => status.includes('READY') && !status.includes('BLOCKED')),
    'final R4 source gate is not an explicit READY gate',
  )
  const candidates = payloads.flatMap(({ path: manifestPath, payload }) =>
    allSourceRecords(payload).map(({ sourcePath, record, kind }) => ({ manifestPath, sourcePath, record, kind })),
  )
  const importerCandidates = candidates.filter(({ sourcePath }) => sourcePath === 'apps/editor/lib/apt-vector-scene.ts')
  const selected =
    importerCandidates.find(({ record }) => typeof record.snapshotPath === 'string') ??
    importerCandidates.find(({ record }) => typeof record.path === 'string')
  assertCondition(selected, 'final R4 source gate has no importer snapshot record')
  const sourcePathValue = selected.record.snapshotPath ?? selected.record.path
  const sourceHash = selected.record.snapshotSha256 ?? selected.record.sha256 ?? selected.record.freezeSha256
  assertCondition(typeof sourcePathValue === 'string' && typeof sourceHash === 'string', 'final R4 importer snapshot record is incomplete')
  const sourceSnapshotPath = selected.record.snapshotPath
    ? resolveGatePath(sourcePathValue, process.cwd())
    : (existingPath([
        resolve(dirname(selected.manifestPath), '../..', sourcePathValue),
        resolve(dirname(selected.manifestPath), sourcePathValue),
        resolve(sourcePathValue),
      ]) ?? resolve(sourcePathValue))
  const actualSourceHash = sha256(readFileSync(sourceSnapshotPath))
  assertCondition(actualSourceHash === sourceHash, `final R4 importer snapshot hash mismatch: ${sourceSnapshotPath}`)
  const auxiliaryCandidates = new Map<
    string,
    Array<{ priority: number; manifestPath: string; record: Record<string, any>; kind: string }>
  >()
  payloads.forEach(({ path: manifestPath, payload }, payloadIndex) => {
    for (const { sourcePath, record, kind } of allSourceRecords(payload)) {
      if (sourcePath === 'apps/editor/lib/apt-vector-scene.ts') continue
      const candidatePath = record.snapshotPath ?? record.path
      if (typeof candidatePath !== 'string') continue
      const priority = (typeof record.snapshotPath === 'string' ? 0 : 1) * 1_000_000 + payloadIndex
      const entries = auxiliaryCandidates.get(sourcePath) ?? []
      entries.push({ priority, manifestPath, record, kind })
      auxiliaryCandidates.set(sourcePath, entries)
    }
  })
  const auxiliary: SourceGateRecord[] = []
  for (const [sourcePath, candidatesForSource] of auxiliaryCandidates) {
    const { manifestPath, record, kind } = [...candidatesForSource].sort((left, right) => left.priority - right.priority)[0]!
    const resolvedPath = resolveGatePath(record.snapshotPath ?? record.path, process.cwd())
    const expectedHash = record.snapshotSha256 ?? record.sha256 ?? record.freezeSha256
    if (expectedHash) {
      const actual = sha256(readFileSync(resolvedPath))
      assertCondition(actual === expectedHash, `final-gate auxiliary hash mismatch: ${resolvedPath}`)
    }
    auxiliary.push({ sourcePath, path: resolvedPath, sha256: expectedHash, manifestPath, recordKind: kind })
  }
  return {
    gatePath: path,
    gateSha256: sha256(readFileSync(path)),
    sourceEntry: { path: sourceSnapshotPath, sha256: sourceHash },
    sourceSnapshotPath,
    auxiliary,
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

function hashJson(value: unknown): string {
  return sha256(stableJson(value))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canonicalScene(scene: Scene): Record<string, unknown> {
  const wallValue = (wall: any) => ({
    start: wall.start,
    end: wall.end,
    thickness: wall.thickness,
    faceBands: wall.faceBands,
    frontSide: wall.frontSide,
    backSide: wall.backSide,
  })
  const sortValues = <T>(values: T[]) =>
    [...values].sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  const canonicalOpening = (opening: any) => ({
    type: opening.type,
    width: opening.width,
    height: opening.height,
    openingKind: opening.openingKind,
    metadata: opening.metadata,
    position: opening.position,
    swingDirection: opening.swingDirection,
  })
  const canonicalZone = (zone: any) => ({
    name: zone.name,
    polygon: zone.polygon,
    spaceRole: zone.spaceRole,
    color: zone.color,
    metadata: zone.metadata,
    clearDimensionPolicy: zone.clearDimensionPolicy,
  })
  const canonicalSurface = (surface: any) => ({
    polygon: surface.polygon,
    metadata: surface.metadata,
    surfaceType: surface.surfaceType,
    height: surface.height,
  })
  return {
    walls: sortValues(scene.walls.map(wallValue)),
    openings: sortValues(scene.openings.map(canonicalOpening)),
    zones: sortValues(scene.zones.map(canonicalZone)),
    slabs: sortValues(scene.slabs.map(canonicalSurface)),
    ceilings: sortValues(scene.ceilings.map(canonicalSurface)),
    guideScale: scene.guideScale,
    diagnostics: scene.diagnostics,
  }
}

function setTraceSink(enabled: boolean): { enabled: boolean; events: TraceEvent[] } {
  const sink = { enabled, events: [] as TraceEvent[] }
  ;(globalThis as any).__pascalAtomicDsuTrace = sink
  return sink
}

async function loadBuilder(modulePath: string, tag: string): Promise<any> {
  return import(`${pathToFileURL(modulePath).href}?atomicTrace=${encodeURIComponent(tag)}`)
}

async function runBuilder(
  modulePath: string,
  tag: string,
  doc: AptVectorDoc,
  traceEnabled: boolean,
): Promise<{ scene: Scene; canonical: Record<string, unknown>; canonicalHash: string; events: TraceEvent[] }> {
  const sink = setTraceSink(traceEnabled)
  const module = await loadBuilder(modulePath, tag)
  const scene = module.buildVectorNodes(clone(doc)) as Scene | null
  if (!scene) throw new Error(`${tag}: buildVectorNodes returned null`)
  const canonical = canonicalScene(scene)
  return { scene, canonical, canonicalHash: hashJson(canonical), events: clone(sink.events) }
}

function sourcePair(event: TraceEvent): string {
  const ids = [...new Set([...(event.firstSourceIds ?? []), ...(event.secondSourceIds ?? [])])].sort()
  return ids.join('+')
}

function resultForPair(events: TraceEvent[], ids: string[]): TraceEvent | undefined {
  const expected = [...ids].sort().join('+')
  return events.find((event) => event.stage === 'union-result' && sourcePair(event) === expected)
}

function preflightForPair(events: TraceEvent[], ids: string[]): TraceEvent | undefined {
  const expected = [...ids].sort().join('+')
  return events.find((event) => event.stage === 'held-preflight' && sourcePair(event) === expected)
}

function candidateForPair(events: TraceEvent[], ids: string[]): TraceEvent | undefined {
  const expected = [...ids].sort().join('+')
  return events.find((event) => event.stage === 'union-candidate' && sourcePair(event) === expected)
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function prepareOrders(base: AptVectorDoc): Array<{ name: string; doc: AptVectorDoc; path: string }> {
  const reverse = { ...clone(base), walls: [...base.walls].reverse() }
  const reversePath = resolve(inputs, 'fixture-order-reverse.json')
  writeFileSync(reversePath, `${JSON.stringify(reverse, null, 2)}\n`)
  return [
    { name: 'order-a', doc: base, path: fixturePath },
    { name: 'order-reverse', doc: reverse, path: reversePath },
  ]
}

async function main(): Promise<void> {
  const sourceBinding = loadSourceBinding(sourceFreezeR4Path)
  const sourceFreezeR4Bytes = readFileSync(sourceFreezeR4Path)
  const sourceEntry = sourceBinding.sourceEntry
  const sourceSnapshotR4Path = sourceBinding.sourceSnapshotPath
  const sourceSnapshotR4Bytes = readFileSync(sourceSnapshotR4Path)
  const sourceBytes = readFileSync(sourcePath)
  const liveProductBytes = readFileSync(liveProductPath)
  const instrumentedBytes = readFileSync(instrumentedPath)
  const mutatedBytes = readFileSync(mutatedPath)
  const runnerBytes = readFileSync(runnerPath)
  const generatorBytes = readFileSync(generatorPath)
  const fixtureBytes = readFileSync(fixturePath)
  const base = JSON.parse(fixtureBytes.toString()) as AptVectorDoc
  const orders = prepareOrders(base)
  const sourceHash = sha256(sourceBytes)
  const liveProductHash = sha256(liveProductBytes)
  const sourceFreezeR4Hash = sha256(sourceFreezeR4Bytes)
  const sourceSnapshotR4Hash = sha256(sourceSnapshotR4Bytes)
  const instrumentedHash = sha256(instrumentedBytes)
  const mutatedHash = sha256(mutatedBytes)
  const runnerHash = sha256(runnerBytes)
  const generatorHash = sha256(generatorBytes)
  const fixtureHash = sha256(fixtureBytes)
  const checks: Record<string, boolean> = {}
  const orderReports: Record<string, unknown>[] = []

  try {
    assertCondition(sourceHash === liveProductHash, 'captured source-final.ts differs from live product source; recapture evidence only')
    assertCondition(sourceHash === sourceSnapshotR4Hash, 'captured source-final.ts differs from explicit R4 source-freeze snapshot')
    assertCondition(sourceHash === sourceEntry.sha256, 'captured source-final.ts differs from explicit R4 source-freeze hash')
    assertCondition(base.walls.map((wall) => wall.id).join(',') === 'A,B,C,D,E,F', 'fixture order A changed')
    assertCondition(base.walls.length === 6, 'fixture must contain exactly six source walls')
    assertCondition(new Set(base.walls.map((wall) => wall.thickness)).size === 2, 'fixture must keep thick/bridge thickness separation')
    assertCondition(base.walls.filter((wall) => wall.thickness === 120).length === 2, 'fixture must contain two retained bridges')
    checks.sourceBinding = true

    for (const order of orders) {
      const control = await runBuilder(sourcePath, `${order.name}-control`, order.doc, false)
      const instrumentedDisabled = await runBuilder(
        instrumentedPath,
        `${order.name}-instrumented-disabled`,
        order.doc,
        false,
      )
      const fixed = await runBuilder(instrumentedPath, `${order.name}-fixed`, order.doc, true)
      const mutated = await runBuilder(mutatedPath, `${order.name}-mutated`, order.doc, true)

      assertCondition(
        control.canonicalHash === instrumentedDisabled.canonicalHash,
        `${order.name}: trace-disabled instrumented output differs from original control`,
      )
      assertCondition(
        control.canonicalHash === fixed.canonicalHash,
        `${order.name}: enabled instrumentation changed fixed output`,
      )
      assertCondition(
        control.canonicalHash === mutated.canonicalHash,
        `${order.name}: old-key mutation changed public canonical geometry`,
      )

      const continuationFixed = resultForPair(fixed.events, ['C', 'D'])
      const materializationFixed = fixed.events.find((event) => event.stage === 'materialization-groups')
      const materializationMutated = mutated.events.find((event) => event.stage === 'materialization-groups')
      const continuationIndex = fixed.events.findIndex(
        (event) =>
          event.stage === 'union-result' &&
          sourcePair(event) === 'C+D' &&
          event.result === 'accepted',
      )
      assertCondition(continuationIndex >= 0, `${order.name}: missing accepted C+D continuation trace`)
      const laterOppositeFixed = fixed.events
        .slice(continuationIndex + 1)
        .find(
          (event) =>
            event.stage === 'union-result' &&
            event.rejection === 'retained-chain' &&
            sourcePair(event) !== 'C+D',
        )
      assertCondition(laterOppositeFixed, `${order.name}: missing later fixed opposite-root retained-chain rejection`)
      const laterOppositePair = sourcePair(laterOppositeFixed)
      const oppositeFixed = laterOppositeFixed
      const oppositeMutated = resultForPair(mutated.events, laterOppositePair.split('+'))
      const continuationCandidate = candidateForPair(fixed.events, ['C', 'D'])
      const oppositeCandidateFixed = candidateForPair(fixed.events, laterOppositePair.split('+'))
      const oppositeCandidateMutated = candidateForPair(mutated.events, laterOppositePair.split('+'))
      const oppositePreflightFixed = preflightForPair(fixed.events, laterOppositePair.split('+'))
      const oppositePreflightMutated = preflightForPair(mutated.events, laterOppositePair.split('+'))
      assertCondition(continuationFixed?.result === 'accepted', `${order.name}: unrelated C+D continuation did not succeed`)
      assertCondition(oppositeFixed?.rejection === 'retained-chain', `${order.name}: fixed D+F did not reject through retained-chain key`)
      assertCondition(!oppositePreflightFixed, `${order.name}: fixed D+F entered held-contact preflight`)
      assertCondition(oppositeMutated?.rejection === 'held-contact-unrepresentable', `${order.name}: old-key mutation did not reach held-contact-unrepresentable`)
      assertCondition(Boolean(oppositePreflightMutated), `${order.name}: old-key mutation did not enter held-contact preflight`)
      assertCondition(oppositeCandidateFixed?.blocked === true, `${order.name}: fixed D+F candidate did not observe blocked key`)
      assertCondition(oppositeCandidateMutated?.blocked === false, `${order.name}: mutated D+F candidate still observed blocked key`)
      assertCondition(
        (continuationFixed?.state?.roots ?? []).some(
          (root: any) => Array.isArray(root.relationIds) && root.relationIds.length === 2,
        ),
        `${order.name}: continuation did not produce one retained root carrying both relations`,
      )
      assertCondition(
        (continuationFixed?.state?.blockedKeys ?? []).length === 2,
        `${order.name}: fixed continuation did not rebuild both blocked opposite-root keys`,
      )
      assertCondition(
        (continuationFixed?.state?.blockedKeys ?? []).length !==
          (mutated.events.find((event) => event.stage === 'union-result' && sourcePair(event) === 'C+D')?.state?.blockedKeys ?? []).length,
        `${order.name}: old-key mutation unexpectedly retained both blocked keys`,
      )
      assertCondition(materializationFixed, `${order.name}: missing deterministic materialization trace`)
      assertCondition(materializationMutated, `${order.name}: mutated copy missing deterministic materialization trace`)
      assertCondition(
        stableJson(materializationFixed?.orderedGroups) === stableJson(materializationMutated?.orderedGroups),
        `${order.name}: old-key mutation changed semantic materialization partition`,
      )
      assertCondition(
        stableJson(materializationFixed?.state?.roots) === stableJson(materializationMutated?.state?.roots),
        `${order.name}: old-key mutation changed semantic DSU root map`,
      )
      assertCondition(
        (materializationFixed?.orderedGroups ?? []).every(
          (group: any) => group.members?.every(
            (member: number, index: number, members: number[]) => index === 0 || members[index - 1]! < member,
          ),
        ),
        `${order.name}: materialization members are not source-index ordered`,
      )

      checks[`${order.name}.controlParity`] = control.canonicalHash === instrumentedDisabled.canonicalHash
      checks[`${order.name}.fixedEnabledParity`] = control.canonicalHash === fixed.canonicalHash
      checks[`${order.name}.mutatedPublicParity`] = control.canonicalHash === mutated.canonicalHash
      checks[`${order.name}.continuationAccepted`] = continuationFixed?.result === 'accepted'
      checks[`${order.name}.fixedRetainedChainBeforeHeld`] =
        oppositeFixed?.rejection === 'retained-chain' && !oppositePreflightFixed
      checks[`${order.name}.mutatedHeldContactAfterMissingKey`] =
        oppositeMutated?.rejection === 'held-contact-unrepresentable' && Boolean(oppositePreflightMutated)
      checks[`${order.name}.rootSharedRelations`] = (continuationFixed?.state?.roots ?? []).some(
        (root: any) => Array.isArray(root.relationIds) && root.relationIds.length === 2,
      )
      checks[`${order.name}.materializationSemanticParity`] =
        Boolean(materializationFixed) &&
        Boolean(materializationMutated) &&
        stableJson(materializationFixed?.orderedGroups) === stableJson(materializationMutated?.orderedGroups) &&
        stableJson(materializationFixed?.state?.roots) === stableJson(materializationMutated?.state?.roots)
      orderReports.push({
        name: order.name,
        fixturePath: order.path,
        fixtureSha256: sha256(readFileSync(order.path)),
        sourceOrder: order.doc.walls.map((wall) => wall.id),
        controlCanonicalHash: control.canonicalHash,
        instrumentedDisabledCanonicalHash: instrumentedDisabled.canonicalHash,
        fixedCanonicalHash: fixed.canonicalHash,
        mutatedCanonicalHash: mutated.canonicalHash,
        fixedReasonSequence: fixed.events
          .filter((event) => event.stage === 'union-result')
          .map((event) => ({
            pair: sourcePair(event),
            reason: event.reason,
            result: event.result,
            rejection: event.rejection ?? null,
            phase: event.phase ?? null,
            blockedKeys: event.state?.blockedKeys ?? [],
          })),
        mutatedReasonSequence: mutated.events
          .filter((event) => event.stage === 'union-result')
          .map((event) => ({
            pair: sourcePair(event),
            reason: event.reason,
            result: event.result,
            rejection: event.rejection ?? null,
            phase: event.phase ?? null,
            blockedKeys: event.state?.blockedKeys ?? [],
          })),
        laterOppositePair,
        fixedTraceEvents: fixed.events,
        mutatedTraceEvents: mutated.events,
        keyStateAtContinuation: {
          fixed: continuationFixed?.state ?? null,
          mutated: mutated.events.find(
            (event) => event.stage === 'union-result' && sourcePair(event) === 'C+D',
          )?.state ?? null,
        },
        materializationGroups: materializationFixed?.orderedGroups ?? null,
        materializationState: materializationFixed?.state ?? null,
      })
    }
    checks.sourceOrderPermutationCount = orders.length >= 2
    const fixedHashes = orderReports.map((report) => report.fixedCanonicalHash)
    const mutatedHashes = orderReports.map((report) => report.mutatedCanonicalHash)
    checks.fixedPermutationCanonicalParity = new Set(fixedHashes).size === 1
    checks.mutatedPermutationCanonicalParity = new Set(mutatedHashes).size === 1
    assertCondition(checks.fixedPermutationCanonicalParity, 'fixed canonical geometry changed across source-order permutations')
    assertCondition(checks.mutatedPermutationCanonicalParity, 'mutated canonical geometry changed across source-order permutations')
    checks.allRequiredObservations = Object.entries(checks)
      .filter(([key]) => key !== 'allRequiredObservations')
      .every(([, value]) => value)
  } catch (error) {
    const report = {
      schemaVersion: 'apartment-source-chain-guards-r4-atomic-dsu-trace-v1',
      status: 'FAILED',
      failure: error instanceof Error ? error.message : String(error),
      source: {
        liveProductPath,
        sourceCopyPath: sourcePath,
        sourceSha256: sourceHash,
        liveProductSha256: liveProductHash,
        sourceFreezeR4Path,
        sourceFreezeR4Sha256: sourceFreezeR4Hash,
        sourceGatePath: sourceBinding.gatePath,
        sourceGateSha256: sourceBinding.gateSha256,
        sourceGateAuxiliary: sourceBinding.auxiliary,
        sourceSnapshotR4Path,
        sourceSnapshotR4Sha256: sourceSnapshotR4Hash,
        instrumentedCopyPath: instrumentedPath,
        instrumentedSha256: instrumentedHash,
        mutatedCopyPath: mutatedPath,
        mutatedSha256: mutatedHash,
      },
      fixture: { path: fixturePath, sha256: fixtureHash },
      checks,
      orders: orderReports,
      writesRestrictedTo: root,
    }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    throw error
  }

  const report = {
    schemaVersion: 'apartment-source-chain-guards-r4-atomic-dsu-trace-v1',
    status: 'PASS',
    modelContract: { resolvedModel: 'gpt-5.6-luna', reasoningEffort: 'max' },
    plans: {
      r4ReplayRepair: {
        path: resolve('.omo/plans/apartment-source-chain-guards-r4-replay-repair-20261003.md'),
        sha256: '6c076c8c43e3ce0d5afac9ab479d3c62f5a62c814483e0798a8b364f349ea9ca',
      },
      r4OrderWeldRepair: {
        path: resolve('.omo/plans/apartment-source-chain-guards-r4-order-weld-repair-20261003.md'),
        sha256: '1a462cdcf2c2e15b1267445d3d5e483dd742411fa467fc11cdd9ae4e50e1934e',
      },
      atomicTraceContract: {
        path: resolve('.omo/plans/apartment-source-chain-guards-atomic-trace-20261003.md'),
        sha256: '0a885f08a56e905a93863b743b66597247d708b9914ed47ca17326b8e0aa7247',
      },
    },
    source: {
      liveProductPath,
      sourceCopyPath: sourcePath,
      sourceSha256: sourceHash,
      liveProductSha256: liveProductHash,
      sourceFreezeR4Path,
      sourceFreezeR4Sha256: sourceFreezeR4Hash,
      sourceGatePath: sourceBinding.gatePath,
      sourceGateSha256: sourceBinding.gateSha256,
      sourceGateAuxiliary: sourceBinding.auxiliary,
      sourceSnapshotR4Path,
      sourceSnapshotR4Sha256: sourceSnapshotR4Hash,
      instrumentedCopyPath: instrumentedPath,
      instrumentedSha256: instrumentedHash,
      mutatedCopyPath: mutatedPath,
      mutatedSha256: mutatedHash,
      mutation: 'after deleting old moving+retained blocked keys, re-add only moving relation IDs',
      aptImportFrameCopyPath: resolve(copies, 'apt-import-frame.ts'),
      aptImportFrameSha256: sha256(readFileSync(resolve(copies, 'apt-import-frame.ts'))),
    },
    fixture: {
      path: fixturePath,
      sha256: fixtureHash,
      sourceWalls: base.walls.map((wall) => ({
        id: wall.id,
        start: wall.start,
        end: wall.end,
        thickness: wall.thickness,
      })),
      relations: [
        { outer: ['A', 'C'], bridge: 'B', bridgeThicknessMm: 120 },
        { outer: ['D', 'F'], bridge: 'E', bridgeThicknessMm: 120 },
      ],
      legalUnrelatedContinuation: ['C', 'D'],
      laterOppositeCandidates: [['A', 'C'], ['D', 'F']],
      sourceOrderPermutations: orders.map((order) => ({ name: order.name, path: order.path, ids: order.doc.walls.map((wall) => wall.id), sha256: sha256(readFileSync(order.path)) })),
    },
    checks,
    orders: orderReports,
    disabledInstrumentationControlParity: Object.fromEntries(
      orderReports.map((report) => [report.name, {
        controlCanonicalHash: report.controlCanonicalHash,
        instrumentedDisabledCanonicalHash: report.instrumentedDisabledCanonicalHash,
        fixedCanonicalHash: report.fixedCanonicalHash,
        mutatedCanonicalHash: report.mutatedCanonicalHash,
      }]),
    ),
    productMutation: false,
    writesRestrictedTo: root,
    runner: runnerPath,
    runnerSha256: runnerHash,
    generator: generatorPath,
    generatorSha256: generatorHash,
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, reportPath, reportSha256: sha256(readFileSync(reportPath)), checks }, null, 2))
}

await main()
