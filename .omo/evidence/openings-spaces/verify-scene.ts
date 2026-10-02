import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type Vec2 = [number, number]
type NodeRecord = Record<string, any>

const scriptDir = dirname(process.argv[1] ?? import.meta.path)
const scenePath = process.argv[2]
const apiPath = process.argv[3] && !process.argv[3]!.endsWith('space-probes.json') ? process.argv[3] : undefined
const fixturePath = process.argv[4] ?? resolve(scriptDir, 'space-probes.json')

if (!scenePath) {
  console.error('usage: bun run verify-scene.ts <saved-scene.json> [api-vector.json] [space-probes.json]')
  process.exit(2)
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function asVec2(value: unknown): Vec2 | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const result: Vec2 = [Number(value[0]), Number(value[1])]
  return result.every(Number.isFinite) ? result : null
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]]
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]]
}

function mul(a: Vec2, scalar: number): Vec2 {
  return [a[0] * scalar, a[1] * scalar]
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1]
}

function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0]
}

function lengthOf(value: Vec2): number {
  return Math.hypot(value[0], value[1])
}

function distance(a: Vec2, b: Vec2): number {
  return lengthOf(sub(a, b))
}

function normalise(value: Vec2): Vec2 {
  const length = lengthOf(value)
  return length > 0 ? mul(value, 1 / length) : [0, 0]
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return cross(sub(b, a), sub(c, a))
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2, epsilon = 1e-8): boolean {
  return (
    Math.abs(orientation(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  const epsilon = 1e-8
  if ((abC > epsilon && abD < -epsilon || abC < -epsilon && abD > epsilon) &&
      (cdA > epsilon && cdB < -epsilon || cdA < -epsilon && cdB > epsilon)) {
    return true
  }
  return (
    pointOnSegment(c, a, b, epsilon) ||
    pointOnSegment(d, a, b, epsilon) ||
    pointOnSegment(a, c, d, epsilon) ||
    pointOnSegment(b, c, d, epsilon)
  )
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    if (pointOnSegment(point, a, b, 1e-7)) return true
    const crosses = (a[1] > point[1]) !== (b[1] > point[1])
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

function pointStrictlyInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (!pointInPolygon(point, polygon)) return false
  return !polygon.some((vertex, index) => pointOnSegment(point, vertex, polygon[(index + 1) % polygon.length]!, 1e-7))
}

function polygonArea(polygon: Vec2[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    area += cross(polygon[index]!, polygon[(index + 1) % polygon.length]!)
  }
  return Math.abs(area) / 2
}

function polygonIsSimple(polygon: Vec2[]): boolean {
  if (polygon.length < 3 || polygon.some((point) => !point.every(Number.isFinite))) return false
  for (let index = 0; index < polygon.length; index += 1) {
    if (distance(polygon[index]!, polygon[(index + 1) % polygon.length]!) <= 1e-8) return false
  }
  for (let left = 0; left < polygon.length; left += 1) {
    const leftEnd = (left + 1) % polygon.length
    for (let right = left + 1; right < polygon.length; right += 1) {
      const rightEnd = (right + 1) % polygon.length
      if (left === right || leftEnd === right || rightEnd === left) continue
      if (segmentsIntersect(polygon[left]!, polygon[leftEnd]!, polygon[right]!, polygon[rightEnd]!)) return false
    }
  }
  return true
}

function polygonsHaveInteriorOverlap(left: Vec2[], right: Vec2[]): boolean {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = left[(index + 1) % left.length]!
    for (let other = 0; other < right.length; other += 1) {
      const c = right[other]!
      const d = right[(other + 1) % right.length]!
      const proper =
        Math.abs(orientation(a, b, c)) > 1e-8 &&
        Math.abs(orientation(a, b, d)) > 1e-8 &&
        Math.abs(orientation(c, d, a)) > 1e-8 &&
        Math.abs(orientation(c, d, b)) > 1e-8 &&
        segmentsIntersect(a, b, c, d)
      if (proper) return true
    }
  }
  return left.some((point) => pointStrictlyInPolygon(point, right)) || right.some((point) => pointStrictlyInPolygon(point, left))
}

function loadNodes(graph: any): NodeRecord[] {
  if (Array.isArray(graph.nodes)) return graph.nodes
  return Object.values(graph.nodes ?? {}) as NodeRecord[]
}

function readApiDocument(value: any): any {
  return value?.data ?? value
}

function apiToMeters(value: any): number {
  return value?.unit === 'm' ? 1 : 0.001
}

function frameFromApi(api: any, sceneWalls: NodeRecord[], fixture: any, errors: string[]) {
  const fallback = fixture.frameFallback
  const sourceImageSize = fixture.sourceImageSize as [number, number]
  const imageSize = asVec2(api?.imageSize)
  const analysisScale = imageSize && sourceImageSize?.[0] ? imageSize[0] / sourceImageSize[0] : Number(fallback.analysisScale)
  const mmPerPx = Number(api?.mmPerPx ?? fallback.mmPerPx)
  const unitScale = apiToMeters(api)
  const candidates: Array<{ translation: Vec2; length: number }> = []

  for (const apiWall of (api?.walls ?? [])) {
    const apiStart = asVec2(apiWall.start)
    const apiEnd = asVec2(apiWall.end)
    if (!apiStart || !apiEnd) continue
    const start = mul(apiStart, unitScale)
    const end = mul(apiEnd, unitScale)
    const apiVector = sub(end, start)
    const apiLength = lengthOf(apiVector)
    if (apiLength <= 0) continue
    const apiDirection = normalise(apiVector)
    for (const sceneWall of sceneWalls) {
      const sceneStart = asVec2(sceneWall.start)
      const sceneEnd = asVec2(sceneWall.end)
      if (!sceneStart || !sceneEnd) continue
      const sceneVector = sub(sceneEnd, sceneStart)
      const sceneLength = lengthOf(sceneVector)
      if (Math.abs(sceneLength - apiLength) > Number(fixture.tolerances.frameLengthM)) continue
      const sceneDirection = normalise(sceneVector)
      if (Math.abs(dot(sceneDirection, apiDirection)) < 0.995) continue
      const reversed = dot(sceneDirection, apiDirection) < 0
      const translation = reversed ? sub(sceneStart, end) : sub(sceneStart, start)
      const expectedEnd = add(reversed ? start : end, translation)
      if (distance(expectedEnd, sceneEnd) <= Number(fixture.tolerances.frameTranslationM)) {
        candidates.push({ translation, length: sceneLength })
      }
    }
  }

  let translation: Vec2 | null = null
  if (candidates.length > 0) {
    const clusters = candidates.map((candidate) => ({ center: candidate.translation, members: [candidate] }))
    for (const cluster of clusters) {
      for (const candidate of candidates) {
        if (distance(cluster.center, candidate.translation) <= Number(fixture.tolerances.frameTranslationM)) {
          cluster.members.push(candidate)
        }
      }
    }
    clusters.sort((left, right) => {
      const leftWeight = left.members.reduce((sum, member) => sum + member.length, 0)
      const rightWeight = right.members.reduce((sum, member) => sum + member.length, 0)
      return right.members.length - left.members.length || rightWeight - leftWeight
    })
    const selected = clusters[0]!
    translation = [
      selected.members.reduce((sum, member) => sum + member.translation[0], 0) / selected.members.length,
      selected.members.reduce((sum, member) => sum + member.translation[1], 0) / selected.members.length,
    ]
  }

  if (!translation) {
    translation = asVec2(fallback.sceneTranslationM)
    errors.push('API vector did not yield a scene coordinate frame; using the documented fixture fallback')
  }

  return {
    source: candidates.length > 0 ? 'api-wall-matches' : 'fixture-fallback',
    analysisScale,
    mmPerPx,
    translation: translation ?? [0, 0],
    sourceToScene(source: Vec2): Vec2 {
      return add(mul(source, (analysisScale * mmPerPx) / 1000), translation ?? [0, 0])
    },
    sceneToSource(scene: Vec2): Vec2 {
      return mul(sub(scene, translation ?? [0, 0]), 1000 / (analysisScale * mmPerPx))
    },
  }
}

function sourcePointFromMetadata(node: NodeRecord, frame: ReturnType<typeof frameFromApi>, sourceImageSize: [number, number]): Vec2 | null {
  const metadata = node.metadata ?? {}
  const direct = [metadata.sourceCenter, metadata.sourceMidpoint]
  for (const value of direct) {
    const point = asVec2(value)
    if (point) return point[0] > sourceImageSize[0] * 1.25 || point[1] > sourceImageSize[1] * 1.25 ? mul(point, 1 / frame.analysisScale) : point
  }
  const pairs = [
    [metadata.sourceA, metadata.sourceB],
    [metadata.sourceStart, metadata.sourceEnd],
    [metadata.sourceFrom, metadata.sourceTo],
  ]
  for (const [firstValue, secondValue] of pairs) {
    const first = asVec2(firstValue)
    const second = asVec2(secondValue)
    if (first && second) {
      const midpoint = mul(add(first, second), 0.5)
      return midpoint[0] > sourceImageSize[0] * 1.25 || midpoint[1] > sourceImageSize[1] * 1.25
        ? mul(midpoint, 1 / frame.analysisScale)
        : midpoint
    }
  }
  return null
}

function openingCenterSource(node: NodeRecord, nodesById: Map<string, NodeRecord>, frame: ReturnType<typeof frameFromApi>, sourceImageSize: [number, number]): Vec2 | null {
  const hostId = typeof node.wallId === 'string' ? node.wallId : typeof node.parentId === 'string' ? node.parentId : null
  const wall = hostId ? nodesById.get(hostId) : undefined
  const wallStart = wall ? asVec2(wall.start) : null
  const wallEnd = wall ? asVec2(wall.end) : null
  if (wallStart && wallEnd) {
    const wallVector = sub(wallEnd, wallStart)
    const wallLength = lengthOf(wallVector)
    const wallT = Number(node.wallT)
    const position = asVec2(node.position)
    const positionT = position ? position[0] / wallLength : Number.NaN
    const t = Number.isFinite(wallT) ? wallT : positionT
    if (wallLength > 0 && Number.isFinite(t)) {
      return frame.sceneToSource(add(wallStart, mul(wallVector, t)))
    }
  }
  // Metadata is diagnostic fallback only; hosted placement remains authoritative.
  return sourcePointFromMetadata(node, frame, sourceImageSize)
}

function semanticOpeningKind(node: NodeRecord): string | null {
  if (node.openingKind === 'opening') return 'opening'
  if (node.type === 'door' && (node.openingKind === undefined || node.openingKind === 'door')) return 'door'
  if (node.type === 'window' && (node.openingKind === undefined || node.openingKind === 'window')) return 'window'
  return null
}

function acceptedNames(probe: any): string[] {
  return [probe.name, ...(Array.isArray(probe.acceptedNames) ? probe.acceptedNames : [])]
}

const fixture = readJson(fixturePath)
const sceneDocument = readJson(scenePath)
const api = apiPath ? readApiDocument(readJson(apiPath)) : null
const graph = sceneDocument.graph ?? sceneDocument
const nodes = loadNodes(graph)
const nodesById = new Map(nodes.map((node) => [String(node.id), node]))
const walls = nodes.filter((node) => node.type === 'wall')
const zones = nodes.filter((node) => node.type === 'zone')
const openings = nodes.filter((node) => node.type === 'door' || node.type === 'window')
const errors: string[] = []
const warnings: string[] = []
const frame = frameFromApi(api, walls, fixture, errors)
const tolerances = fixture.tolerances

if (zones.length !== fixture.roomProbes.length) {
  errors.push(`expected exactly ${fixture.roomProbes.length} ZoneNode records, found ${zones.length}`)
}

const zoneGeometry = zones.map((zone) => ({
  id: String(zone.id),
  polygon: Array.isArray(zone.polygon) ? zone.polygon.map(asVec2).filter((point): point is Vec2 => point !== null) : [],
}))
for (const zone of zoneGeometry) {
  if (!polygonIsSimple(zone.polygon) || polygonArea(zone.polygon) <= Number(tolerances.polygonAreaM2)) {
    errors.push(`zone ${zone.id} has a non-finite, degenerate, or self-intersecting polygon`)
  }
}
for (let left = 0; left < zoneGeometry.length; left += 1) {
  for (let right = left + 1; right < zoneGeometry.length; right += 1) {
    if (polygonsHaveInteriorOverlap(zoneGeometry[left]!.polygon, zoneGeometry[right]!.polygon)) {
      errors.push(`zones ${zoneGeometry[left]!.id} and ${zoneGeometry[right]!.id} overlap in their interiors`)
    }
  }
}

for (const wall of walls) {
  if (!asVec2(wall.start)?.every(Number.isFinite) || !asVec2(wall.end)?.every(Number.isFinite)) {
    errors.push(`wall ${wall.id} has non-finite endpoints`)
  }
  const source = String(wall.metadata?.source ?? '').toLowerCase()
  if (source.includes('label') || source.includes('ocr')) errors.push(`wall ${wall.id} appears label-derived (${source})`)
}

const roomMatches: Array<{ id: string; zoneId: string | null; source: Vec2; scene: Vec2; name: string | null; cls: string | null }> = []
const usedZoneIds = new Set<string>()
for (const probe of fixture.roomProbes) {
  const source = asVec2(probe.source)
  if (!source) {
    errors.push(`room probe ${probe.id} has invalid source coordinates`)
    continue
  }
  const scenePoint = frame.sourceToScene(source)
  const matches = zones.filter((zone) => {
    const polygon = Array.isArray(zone.polygon) ? zone.polygon.map(asVec2).filter((point): point is Vec2 => point !== null) : []
    return pointInPolygon(scenePoint, polygon)
  })
  if (matches.length !== 1) {
    errors.push(`room probe ${probe.id} is contained by ${matches.length} zones (expected exactly one)`)
    roomMatches.push({ id: probe.id, zoneId: null, source, scene: scenePoint, name: null, cls: null })
    continue
  }
  const zone = matches[0]!
  const zoneId = String(zone.id)
  const name = typeof zone.name === 'string' ? zone.name : typeof zone.metadata?.name === 'string' ? zone.metadata.name : null
  const cls = typeof zone.metadata?.cls === 'string' ? zone.metadata.cls : typeof zone.metadata?.roomClass === 'string' ? zone.metadata.roomClass : null
  if (!acceptedNames(probe).includes(name ?? '')) errors.push(`room probe ${probe.id} matched ${zoneId} with name ${JSON.stringify(name)}, expected one of ${JSON.stringify(acceptedNames(probe))}`)
  if (cls !== probe.cls) errors.push(`room probe ${probe.id} matched ${zoneId} with class ${JSON.stringify(cls)}, expected ${JSON.stringify(probe.cls)}`)
  if (usedZoneIds.has(zoneId)) errors.push(`room probes are not one-to-one: ${probe.id} reuses zone ${zoneId}`)
  usedZoneIds.add(zoneId)
  roomMatches.push({ id: probe.id, zoneId, source, scene: scenePoint, name, cls })
}

const recognisedProbes = fixture.roomProbes.filter((probe: any) => probe.ocrRecognized)
if (recognisedProbes.length !== 14) errors.push(`fixture must contain exactly 14 OCR-recognised room probes, found ${recognisedProbes.length}`)
if (fixture.roomProbes.filter((probe: any) => !probe.ocrRecognized).length !== 1) errors.push('fixture must contain exactly one unlabeled fallback room probe')

const openingMatches: Array<{ id: string; nodeId: string | null; kind: string | null; source: Vec2 | null; distancePx: number | null }> = []
const usedOpeningIds = new Set<string>()
const openingCandidates = openings.map((node) => ({
  node,
  id: String(node.id),
  kind: semanticOpeningKind(node),
  source: openingCenterSource(node, nodesById, frame, fixture.sourceImageSize),
}))

for (const probe of fixture.openingProbes) {
  const source = asVec2(probe.source)
  if (!source) {
    errors.push(`opening probe ${probe.id} has invalid source coordinates`)
    continue
  }
  const accepted = new Set<string>(probe.acceptedKinds ?? [])
  const candidates = openingCandidates
    .filter((candidate) => candidate.source && accepted.has(candidate.kind ?? ''))
    .map((candidate) => ({ ...candidate, distancePx: distance(candidate.source!, source) }))
    .sort((left, right) => left.distancePx - right.distancePx)
  const match = candidates.find((candidate) => candidate.distancePx <= Number(tolerances.openingCenterPx))
  if (!match) {
    const nearest = openingCandidates
      .filter((candidate) => candidate.source)
      .map((candidate) => ({ id: candidate.id, kind: candidate.kind, distancePx: distance(candidate.source!, source) }))
      .sort((left, right) => left.distancePx - right.distancePx)[0]
    errors.push(`opening probe ${probe.id} has no ${JSON.stringify([...accepted])} match within ${tolerances.openingCenterPx}px (nearest ${JSON.stringify(nearest ?? null)})`)
    openingMatches.push({ id: probe.id, nodeId: null, kind: null, source: null, distancePx: null })
    continue
  }
  if (usedOpeningIds.has(match.id)) errors.push(`opening probes are not one-to-one: ${probe.id} reuses ${match.id}`)
  usedOpeningIds.add(match.id)
  const hostId = typeof match.node.wallId === 'string' ? match.node.wallId : typeof match.node.parentId === 'string' ? match.node.parentId : null
  const host = hostId ? nodesById.get(hostId) : undefined
  if (!host || host.type !== 'wall') errors.push(`opening ${match.id} has no wall host`)
  if (match.node.parentId !== match.node.wallId) errors.push(`opening ${match.id} parentId/wallId mismatch`)
  if (!Array.isArray(host?.children) || !host.children.includes(match.id)) errors.push(`opening ${match.id} is missing from wall ${hostId ?? '(none)'} children`)
  openingMatches.push({ id: probe.id, nodeId: match.id, kind: match.kind, source: match.source, distancePx: match.distancePx })
}

for (const probe of fixture.forbiddenOpenings ?? []) {
  const source = asVec2(probe.source)
  if (!source) continue
  const radius = Number(probe.radiusPx ?? tolerances.forbiddenOpeningPx)
  const hit = openingCandidates.find((candidate) => candidate.source && distance(candidate.source, source) <= radius)
  if (hit) errors.push(`forbidden opening ${probe.id} is present as ${hit.id} (${hit.kind}) at ${distance(hit.source!, source).toFixed(1)}px`)
}

const report = {
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  scenePath: resolve(scenePath),
  apiPath: apiPath ? resolve(apiPath) : null,
  fixturePath: resolve(fixturePath),
  frame: {
    source: frame.source,
    analysisScale: frame.analysisScale,
    mmPerPx: frame.mmPerPx,
    sceneTranslationM: frame.translation,
  },
  counts: { nodes: nodes.length, walls: walls.length, zones: zones.length, openings: openings.length },
  rooms: { expected: fixture.roomProbes.length, matched: roomMatches.filter((match) => match.zoneId !== null).length, recognised: recognisedProbes.length, matches: roomMatches },
  openings: { expected: fixture.openingProbes.length, matched: openingMatches.filter((match) => match.nodeId !== null).length, matches: openingMatches },
  errors,
  warnings,
}
console.log(JSON.stringify(report, null, 2))
if (errors.length > 0) process.exitCode = 1
