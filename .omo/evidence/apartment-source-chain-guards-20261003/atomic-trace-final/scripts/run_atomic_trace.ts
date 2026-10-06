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
type Scene = {
  walls: any[]
  openings: any[]
  zones: any[]
  slabs: any[]
  ceilings: any[]
  guideScale: number
  diagnostics: Record<string, unknown>
}

const root = resolve('.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-final')
const copies = resolve(root, 'copies')
const inputs = resolve(root, 'inputs')
const outputs = resolve(root, 'outputs')
const sourcePath = resolve(copies, 'source-final.ts')
const instrumentedPath = resolve(copies, 'apt-vector-scene.instrumented.ts')
const mutatedPath = resolve(copies, 'apt-vector-scene.old-key-mutated.ts')
const runnerPath = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-final/scripts/run_atomic_trace.ts',
)
const generatorPath = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/atomic-trace-final/scripts/build_atomic_variants.py',
)
const liveProductPath = resolve('apps/editor/lib/apt-vector-scene.ts')
const sourceFreezeR3Path = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/product-final/source-freeze-r3.json',
)
const sourceSnapshotR3Path = resolve(
  '.omo/evidence/apartment-source-chain-guards-20261003/product-final/r3/source-snapshot/apps/editor/lib/apt-vector-scene.ts',
)
const fixturePath = resolve(inputs, 'fixture-order-a.json')
const reportPath = resolve(outputs, 'atomic-trace-report.json')

mkdirSync(outputs, { recursive: true })

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
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
  const sourceBytes = readFileSync(sourcePath)
  const liveProductBytes = readFileSync(liveProductPath)
  const sourceFreezeR3Bytes = readFileSync(sourceFreezeR3Path)
  const sourceSnapshotR3Bytes = readFileSync(sourceSnapshotR3Path)
  const instrumentedBytes = readFileSync(instrumentedPath)
  const mutatedBytes = readFileSync(mutatedPath)
  const runnerBytes = readFileSync(runnerPath)
  const generatorBytes = readFileSync(generatorPath)
  const fixtureBytes = readFileSync(fixturePath)
  const base = JSON.parse(fixtureBytes.toString()) as AptVectorDoc
  const orders = prepareOrders(base)
  const sourceHash = sha256(sourceBytes)
  const liveProductHash = sha256(liveProductBytes)
  const sourceFreezeR3Hash = sha256(sourceFreezeR3Bytes)
  const sourceSnapshotR3Hash = sha256(sourceSnapshotR3Bytes)
  const instrumentedHash = sha256(instrumentedBytes)
  const mutatedHash = sha256(mutatedBytes)
  const runnerHash = sha256(runnerBytes)
  const generatorHash = sha256(generatorBytes)
  const fixtureHash = sha256(fixtureBytes)
  const checks: Record<string, boolean> = {}
  const orderReports: Record<string, unknown>[] = []

  try {
    assertCondition(sourceHash === liveProductHash, 'captured source-final.ts differs from live product source; recapture evidence only')
    assertCondition(sourceHash === sourceSnapshotR3Hash, 'captured source-final.ts differs from product source-freeze-r3 snapshot')
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
      schemaVersion: 'apartment-source-chain-guards-atomic-dsu-trace-v1',
      status: 'FAILED',
      failure: error instanceof Error ? error.message : String(error),
      source: {
        liveProductPath,
        sourceCopyPath: sourcePath,
        sourceSha256: sourceHash,
        liveProductSha256: liveProductHash,
        sourceFreezeR3Path,
        sourceFreezeR3Sha256: sourceFreezeR3Hash,
        sourceSnapshotR3Path,
        sourceSnapshotR3Sha256: sourceSnapshotR3Hash,
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
    schemaVersion: 'apartment-source-chain-guards-atomic-dsu-trace-v1',
    status: 'PASS',
    modelContract: { resolvedModel: 'gpt-5.6-luna', reasoningEffort: 'max' },
    plan: {
      path: resolve('.omo/plans/apartment-source-chain-guards-atomic-trace-20261003.md'),
      sha256: '0a885f08a56e905a93863b743b66597247d708b9914ed47ca17326b8e0aa7247',
    },
    source: {
      liveProductPath,
      sourceCopyPath: sourcePath,
      sourceSha256: sourceHash,
      liveProductSha256: liveProductHash,
      sourceFreezeR3Path,
      sourceFreezeR3Sha256: sourceFreezeR3Hash,
      sourceSnapshotR3Path,
      sourceSnapshotR3Sha256: sourceSnapshotR3Hash,
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
