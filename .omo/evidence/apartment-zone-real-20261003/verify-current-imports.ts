import { readFileSync, writeFileSync } from 'node:fs'
import { buildVectorNodes } from '/Users/changseok/editor/apps/editor/lib/apt-vector-scene'
import {
  detectSpacesForLevel,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
} from '/Users/changseok/editor/packages/core/src/index.ts'

const root = '/Users/changseok/editor/.omo/evidence/apartment-zone-real-20261003'
const cases = [
  ['jangjeon', 6],
  ['haeundae', 9],
  ['hwmyeong', 7],
] as const
const rows = []
for (const [key, expectedSpaces] of cases) {
  const path = `${root}/${key}/vector-api.json`
  const envelope = JSON.parse(readFileSync(path, 'utf8'))
  const doc = envelope.data
  const built = buildVectorNodes(doc)
  if (!built) {
    rows.push({ key, expectedSpaces, result: null, cause: 'buildVectorNodes returned null' })
    continue
  }
  const detection = detectSpacesForLevel('apt-vector-import', built.walls)
  const currentSpaces = detection.spaces.length
  const currentLoops = detection.roomPolygons.length
  const slabPlan = planAutoSlabsForLevel(detection.roomPolygons, [])
  const ceilingPlan = planAutoCeilingsForLevel(detection.roomPolygons, [])
  rows.push({
    key,
    expectedSpaces,
    sourceDocVersion: doc.docVersion,
    sourceScale: doc.mmPerPx,
    walls: built.walls.length,
    openings: built.openings.length,
    importedZones: built.zones.length,
    currentLoops,
    currentSpaces,
    importedAutoSlabs: built.slabs.length,
    importedAutoCeilings: built.ceilings.length,
    autoSlabsCreatedFromClosedSpaces: slabPlan.create.length,
    autoCeilingsCreatedFromClosedSpaces: ceilingPlan.create.length,
    detectedEnclosedZones: built.zones.filter((zone) => zone.enclosureStatus === 'enclosed').length,
    reviewZones: built.zones.filter((zone) => zone.metadata?.boundaryNeedsReview === true).length,
    diagnostics: built.diagnostics,
    delta: currentSpaces - expectedSpaces,
    cause: currentSpaces === expectedSpaces ? null : 'current core detection differs from prior expected count; inspect wall connectivity/dropped inputs',
  })
}
const result = {
  generatedAt: new Date().toISOString(),
  pipeline: 'buildVectorNodes -> detectSpacesForLevel',
  expectedPriorUniqueSpaces: Object.fromEntries(cases.map(([key, count]) => [key, count])),
  rows,
}
writeFileSync(`${root}/current-import-verification.json`, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
