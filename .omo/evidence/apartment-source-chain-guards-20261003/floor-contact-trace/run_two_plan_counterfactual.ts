#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type AnyRecord = Record<string, any>
type Vec2 = [number, number]

const REPO = resolve(import.meta.dir, '../../../../')
const ROOT = resolve(import.meta.dir)
const RAW_ROOT = join(REPO, '.omo/evidence/apartment-scale-fix-20261003/candidate15')
const PROBES_PATH = join(REPO, '.omo/evidence/apartment-50-improvement-20261003/source-probes.json')
const FROZEN_RUNTIME = join(
  REPO,
  '.omo/evidence/apartment-source-chain-guards-20261003/product-final/r3/replay-final/runtime/r3-final',
)
const FROZEN_IMPORTER_BASE = join(
  REPO,
  '.omo/evidence/apartment-source-chain-guards-20261003/product-final/r3/replay-final/source-snapshot/apps/editor/lib',
)
const CORE_BRIDGE = join(FROZEN_RUNTIME, 'core-bridge.rewritten.ts')
const ROOM_BOUNDARY = join(FROZEN_RUNTIME, 'room-boundary.rewritten.ts')
const FROZEN_APT_IMPORT_FRAME = join(FROZEN_IMPORTER_BASE, 'apt-import-frame.ts')
const PLAN_IDS = ['3FO40C71IWG4', '3FO3YR6LHA15'] as const

const args = Bun.argv.slice(2)
const arg = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const sourceArg = arg('--source')
const variant = arg('--variant')
if (!sourceArg || !variant || !/^[a-z0-9-]+$/.test(variant)) {
  throw new Error('usage: run_two_plan_counterfactual.ts --source <path> --variant <name>')
}
const sourcePath = isAbsolute(sourceArg) ? resolve(sourceArg) : resolve(REPO, sourceArg)
if (!existsSync(sourcePath)) throw new Error(`missing source: ${sourcePath}`)
const outputRoot = join(ROOT, 'outputs', variant)
const runtimeRoot = join(ROOT, 'runtime', variant)
mkdirSync(outputRoot, { recursive: true })
mkdirSync(runtimeRoot, { recursive: true })

const sha256 = async (path: string) => {
  const digest = createHash('sha256')
  digest.update(await Bun.file(path).bytes())
  return digest.digest('hex')
}
const shaText = (value: string) => createHash('sha256').update(value).digest('hex')
const generatedAptImportFrame = join(runtimeRoot, 'apt-import-frame.rewritten.ts')
const aptImportFrameOriginal = await Bun.file(FROZEN_APT_IMPORT_FRAME).text()
const aptImportFrameRewritten = aptImportFrameOriginal.replace(
  /(['"])@pascal-app\/core\1/g,
  (_match, delimiter) => `${delimiter}${CORE_BRIDGE}${delimiter}`,
)
await Bun.write(generatedAptImportFrame, aptImportFrameRewritten)
const resolveCanonicalImport = (specifier: string) => {
  if (specifier === './apt-import-frame') return generatedAptImportFrame
  const raw = resolve(FROZEN_IMPORTER_BASE, specifier)
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, join(raw, 'index.ts')]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`cannot resolve frozen import ${specifier}`)
  return found
}
const rewriteRelativeImports = (source: string) =>
  source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, delimiter, specifier) => {
    return `from ${delimiter}${resolveCanonicalImport(specifier)}${delimiter}`
  })

const original = await Bun.file(sourcePath).text()
const rewritten = rewriteRelativeImports(
  original.replace(/(['"])@pascal-app\/core\1/g, (_match, delimiter) => `${delimiter}${CORE_BRIDGE}${delimiter}`),
)
const generatedImporter = join(runtimeRoot, 'apt-vector-scene.rewritten.ts')
await Bun.write(generatedImporter, rewritten)

const importer = (await import(`${pathToFileURL(generatedImporter).href}?sha=${shaText(rewritten)}`)) as AnyRecord
const core = (await import(pathToFileURL(CORE_BRIDGE).href)) as AnyRecord
const roomBoundary = (await import(pathToFileURL(ROOM_BOUNDARY).href)) as AnyRecord
const buildVectorNodes = importer.buildVectorNodes
const detectSpacesForLevel = core.detectSpacesForLevel
const diagnoseRoomBoundaries = roomBoundary.diagnoseRoomBoundaries
for (const [name, value] of Object.entries({ buildVectorNodes, detectSpacesForLevel, diagnoseRoomBoundaries })) {
  if (typeof value !== 'function') throw new Error(`missing runtime function ${name}`)
}

const probes = ((await Bun.file(PROBES_PATH).json()) as AnyRecord).roomSeeds as AnyRecord[]
const pointInRing = (point: Vec2, ring: Vec2[]) => {
  let inside = false
  if (ring.length < 3) return false
  let j = ring.length - 1
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i]!
    const previous = ring[j]!
    if ((current[1] > point[1]) !== (previous[1] > point[1])) {
      const x =
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
        current[0]
      if (point[0] < x) inside = !inside
    }
    j = i
  }
  return inside
}
const pointInSlab = (point: Vec2, slab: AnyRecord) =>
  pointInRing(point, slab.polygon ?? []) &&
  !(slab.holes ?? []).some((hole: Vec2[]) => pointInRing(point, hole))
const probeWorld = (seed: AnyRecord, raw: AnyRecord): Vec2 => {
  const [sourceW, sourceH] = seed.sourceSize ?? [1242, 828]
  const px = (seed.xy[0] * raw.imageSize[0]) / sourceW
  const py = (seed.xy[1] * raw.imageSize[1]) / sourceH
  const cx = (raw.imageSize[0] * raw.mmPerPx) / 2000
  const cy = (raw.imageSize[1] * raw.mmPerPx) / 2000
  return [(px * raw.mmPerPx) / 1000 - cx, (py * raw.mmPerPx) / 1000 - cy]
}
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as AnyRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

const cases: AnyRecord[] = []
for (const planId of PLAN_IDS) {
  const rawPath = join(RAW_ROOT, `${planId}.json`)
  const raw = (await Bun.file(rawPath).json()) as AnyRecord
  ;(globalThis as AnyRecord).__FLOOR_CONTACT_TRACE__ = []
  const built = buildVectorNodes(raw)
  if (!built) throw new Error(`${variant}:${planId} buildVectorNodes returned null`)
  const levelId = `level_floor_contact_${variant}_${planId}`
  const walls = built.walls.map((wall: AnyRecord) => ({ ...wall, parentId: levelId }))
  const zones = built.zones.map((zone: AnyRecord) => ({ ...zone, parentId: levelId }))
  const spaces = detectSpacesForLevel(levelId, walls).spaces
  const diagnostics = diagnoseRoomBoundaries(levelId, walls, zones)
  const planProbes = probes.filter((seed) => seed.key?.split('_', 2)[1] === planId)
  const probeRows = planProbes.map((seed) => {
    const worldPointM = probeWorld(seed, raw)
    return {
      id: seed.id,
      expected: seed.expected,
      sourceXY: seed.xy,
      worldPointM,
      hit: (built.slabs ?? []).some((slab: AnyRecord) => pointInSlab(worldPointM, slab)),
    }
  })
  const payload = {
    variant,
    planId,
    source: {
      path: relative(REPO, sourcePath),
      sha256: await sha256(sourcePath),
      generatedSha256: await sha256(generatedImporter),
    },
    frozenDependencies: {
      coreBridge: relative(REPO, CORE_BRIDGE),
      coreBridgeSha256: await sha256(CORE_BRIDGE),
      roomBoundary: relative(REPO, ROOM_BOUNDARY),
      roomBoundarySha256: await sha256(ROOM_BOUNDARY),
      aptImportFrame: relative(REPO, FROZEN_APT_IMPORT_FRAME),
      aptImportFrameSha256: await sha256(FROZEN_APT_IMPORT_FRAME),
    },
    raw: { path: relative(REPO, rawPath), sha256: await sha256(rawPath) },
    counts: {
      walls: walls.length,
      openings: built.openings.length,
      zones: zones.length,
      spaces: spaces.length,
      slabs: (built.slabs ?? []).length,
      ceilings: (built.ceilings ?? []).length,
      probeHits: probeRows.filter((row) => row.hit).length,
      probeTotal: probeRows.length,
    },
    probeRows,
    walls,
    openings: built.openings,
    zones,
    spaces,
    slabs: built.slabs ?? [],
    ceilings: built.ceilings ?? [],
    diagnostics,
    traceEvents: (globalThis as AnyRecord).__FLOOR_CONTACT_TRACE__ ?? [],
    canonicalGeometrySha256: shaText(
      JSON.stringify(
        stable({ walls, openings: built.openings, zones, spaces, slabs: built.slabs ?? [], ceilings: built.ceilings ?? [] }),
      ),
    ),
  }
  await Bun.write(join(outputRoot, `${planId}.json`), `${JSON.stringify(payload, null, 2)}\n`)
  cases.push({ planId, counts: payload.counts, canonicalGeometrySha256: payload.canonicalGeometrySha256 })
}

const summary = {
  variant,
  source: { path: relative(REPO, sourcePath), sha256: await sha256(sourcePath) },
  runner: { path: relative(REPO, import.meta.path), sha256: await sha256(import.meta.path) },
  immutableInputs: {
    sourceProbes: { path: relative(REPO, PROBES_PATH), sha256: await sha256(PROBES_PATH) },
    raw: Object.fromEntries(
      await Promise.all(
        PLAN_IDS.map(async (planId) => {
          const path = join(RAW_ROOT, `${planId}.json`)
          return [planId, { path: relative(REPO, path), sha256: await sha256(path) }]
        }),
      ),
    ),
  },
  cases,
}
await Bun.write(join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
