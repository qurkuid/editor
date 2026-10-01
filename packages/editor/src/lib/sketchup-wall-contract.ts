import {
  type AnyNode,
  calculateLevelMiters,
  getWallPlanFootprint,
  getWallThickness,
  pointToKey,
  resolveLevelId,
  resolveWallTop,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  getOpeningCutoutBottomPadding,
  subtractPolygonsFromPolygon,
  type Point2D as ViewerPoint2D,
} from '@pascal-app/viewer'
import * as THREE from 'three'

export type NativeWallPoint = [number, number, number]
export type NativeWallFaceRole =
  | 'interior'
  | 'exterior'
  | 'top'
  | 'bottom'
  | 'start-cap'
  | 'end-cap'
  | 'reveal'
  | 'support-step'

export type NativeWallMaterialRole = 'interior' | 'exterior' | 'wall-edge'

export type PascalNativeWallFace = {
  id: string
  role: NativeWallFaceRole
  materialRole: NativeWallMaterialRole
  outer: NativeWallPoint[]
  holes: NativeWallPoint[][]
}

export type PascalNativeWallContract =
  | {
      version: 1
      compatible: true
      coordinates: 'three-world-m'
      sketchUpMap: 'x,-z,y'
      wallId: string
      faces: PascalNativeWallFace[]
    }
  | {
      version: 1
      compatible: false
      wallId: string
      reasons: string[]
    }

export type WallContractSupport = {
  slabElevation?: number
  baseElevation?: number
  baseSegments?: readonly {
    start: number
    end: number
    elevation: number
  }[]
  storeyHeight?: number
}

export type SketchupWallContractContext = {
  wall: WallNode
  children: AnyNode[]
  miterData: WallMiterData
  matrixWorld: THREE.Matrix4
  support?: WallContractSupport
}

type LocalPoint = { x: number; z: number }
type LocalFace = {
  id: string
  role: NativeWallFaceRole
  materialRole: NativeWallMaterialRole
  outer: THREE.Vector3[]
  holes: THREE.Vector3[][]
}
type Opening = {
  id: string
  left: number
  right: number
  bottom: number
  top: number
}
type Cutout = {
  id: string
  kind: 'opening' | 'base'
  left: number
  right: number
  minZ: number
  maxZ: number
  bottom: number
  top: number
}
type SliceRegion = { outer: ViewerPoint2D[]; holes: ViewerPoint2D[][] }
type VerticalSegment = {
  a: LocalPoint
  b: LocalPoint
  y0: number
  y1: number
  hole: boolean
  role: NativeWallFaceRole
  materialRole: NativeWallMaterialRole
}
type SliceEvent =
  | { y: number; kind: 'bottom' | 'top' }
  | { y: number; kind: 'opening-bottom' | 'opening-top' | 'base-top'; cutout: Cutout }

const EPSILON = 1e-7
const AREA_EPSILON = 1e-9
const NORMAL_EPSILON_SQ = (AREA_EPSILON * 2) ** 2
const EDGE_KEY_SCALE = 1e8
const DEFAULT_STOREY_HEIGHT = 2.5

class ContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ContractError'
    this.code = code
  }
}

function fail(code: string): never {
  throw new ContractError(code)
}

function finite(value: number) {
  return Number.isFinite(value)
}

function finiteMatrix(matrix: THREE.Matrix4) {
  return matrix.elements.every(finite)
}

function area2(points: ViewerPoint2D[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function normalize2(points: ViewerPoint2D[]) {
  const normalized: ViewerPoint2D[] = []
  for (const point of points) {
    if (!finite(point[0]) || !finite(point[1])) continue
    const previous = normalized[normalized.length - 1]
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > EPSILON) {
      normalized.push([point[0], point[1]])
    }
  }
  if (normalized.length > 1) {
    const first = normalized[0]!
    const last = normalized[normalized.length - 1]!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPSILON) normalized.pop()
  }
  if (normalized.length < 3 || Math.abs(area2(normalized)) <= AREA_EPSILON) return []
  return normalized
}

function pointOnSegment(point: ViewerPoint2D, start: ViewerPoint2D, end: ViewerPoint2D) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const cross = (point[0] - start[0]) * dy - (point[1] - start[1]) * dx
  if (Math.abs(cross) > EPSILON) return false
  return (
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  )
}

function pointInRing(point: ViewerPoint2D, ring: ViewerPoint2D[]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index]!
    const prior = ring[previous]!
    if (pointOnSegment(point, prior, current)) return null
    const crosses =
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]
    if (crosses) inside = !inside
  }
  return inside
}

function classifyContours(rings: ViewerPoint2D[][]): SliceRegion[] {
  const normalized = rings.map((ring) => normalize2(ring)).filter((ring) => ring.length >= 3)
  const containing = normalized.map((ring, index) => {
    const point = ring[0]!
    return normalized
      .map((other, otherIndex) => {
        if (index === otherIndex) return null
        const inside = pointInRing(point, other)
        if (inside === null) return null
        return inside ? otherIndex : null
      })
      .filter((value): value is number => value !== null)
      .sort((a, b) => Math.abs(area2(normalized[a]!)) - Math.abs(area2(normalized[b]!)))
  })
  const regions = normalized
    .map((ring, index) => ({ outer: ring, holes: [] as ViewerPoint2D[][], index }))
    .filter(({ index }) => containing[index]!.length === 0)
  for (let index = 0; index < normalized.length; index += 1) {
    if (containing[index]!.length === 0) continue
    const outer = containing[index]![0]
    const region = regions.find((candidate) => candidate.index === outer)
    if (!region) fail('ambiguous-contour')
    region.holes.push(normalized[index]!)
  }
  return regions.map(({ outer, holes }) => ({ outer, holes }))
}

function reverse<T>(points: T[]) {
  return [...points].reverse()
}

function ringNormal(points: THREE.Vector3[]) {
  const normal = new THREE.Vector3()
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    normal.x += (current.y - next.y) * (current.z + next.z)
    normal.y += (current.z - next.z) * (current.x + next.x)
    normal.z += (current.x - next.x) * (current.y + next.y)
  }
  return normal
}

function orientLoops(outer: THREE.Vector3[], holes: THREE.Vector3[][], expected: THREE.Vector3) {
  let orientedOuter = outer
  if (ringNormal(orientedOuter).dot(expected) < 0) orientedOuter = reverse(orientedOuter)
  const orientedHoles = holes.map((hole) =>
    ringNormal(hole).dot(expected) > 0 ? reverse(hole) : hole,
  )
  return { outer: orientedOuter, holes: orientedHoles }
}

function validateRing(points: THREE.Vector3[]) {
  if (points.length < 3) fail('invalid-shell')
  const normal = ringNormal(points)
  if (normal.lengthSq() <= NORMAL_EPSILON_SQ) fail('invalid-shell')
  const origin = points[0]!
  const unit = normal.clone().normalize()
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    const next = points[(index + 1) % points.length]!
    if (![point.x, point.y, point.z].every(finite)) fail('nonfinite-point')
    if (point.distanceToSquared(next) <= EPSILON * EPSILON) fail('zero-length-edge')
    if (Math.abs(point.clone().sub(origin).dot(unit)) > EPSILON * 10) fail('nonplanar-face')
  }
}

function addFace(
  faces: LocalFace[],
  id: string,
  role: NativeWallFaceRole,
  materialRole: NativeWallMaterialRole,
  outer: THREE.Vector3[],
  holes: THREE.Vector3[][],
  expected: THREE.Vector3,
) {
  const oriented = orientLoops(outer, holes, expected)
  validateRing(oriented.outer)
  oriented.holes.forEach(validateRing)
  faces.push({ id, role, materialRole, ...oriented })
}

function localFootprint(wall: WallNode, footprint: { x: number; y: number }[]): LocalPoint[] {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  return footprint.map((point) => {
    const dx = point.x - wall.start[0]
    const dy = point.y - wall.start[1]
    return { x: dx * cos - dy * sin, z: dx * sin + dy * cos }
  })
}

function clipAgainst(
  points: ViewerPoint2D[],
  inside: (point: ViewerPoint2D) => boolean,
  intersection: (start: ViewerPoint2D, end: ViewerPoint2D) => ViewerPoint2D,
) {
  if (points.length === 0) return []
  const output: ViewerPoint2D[] = []
  let previous = points[points.length - 1]!
  let previousInside = inside(previous)
  for (const current of points) {
    const currentInside = inside(current)
    if (currentInside !== previousInside) output.push(intersection(previous, current))
    if (currentInside) output.push(current)
    previous = current
    previousInside = currentInside
  }
  return normalize2(output)
}

function clipFootprintToRect(
  footprint: ViewerPoint2D[],
  left: number,
  right: number,
  minZ: number,
  maxZ: number,
) {
  let clipped = normalize2(footprint)
  if (clipped.length < 3) return []
  const clip = (predicate: (point: ViewerPoint2D) => boolean, axis: 0 | 1, value: number) => {
    clipped = clipAgainst(clipped, predicate, (start, end) => {
      const denominator = end[axis] - start[axis]
      if (Math.abs(denominator) <= EPSILON) return [start[0], start[1]]
      const t = (value - start[axis]) / denominator
      return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
    })
  }
  clip((point) => point[0] >= left - EPSILON, 0, left)
  clip((point) => point[0] <= right + EPSILON, 0, right)
  clip((point) => point[1] >= minZ - EPSILON, 1, minZ)
  clip((point) => point[1] <= maxZ + EPSILON, 1, maxZ)
  return clipped
}

function rectangleCutout(cutout: Cutout) {
  return [
    [cutout.left, cutout.minZ],
    [cutout.right, cutout.minZ],
    [cutout.right, cutout.maxZ],
    [cutout.left, cutout.maxZ],
  ] as ViewerPoint2D[]
}

function subtractCutouts(subject: ViewerPoint2D[], cutouts: Cutout[]) {
  if (subject.length < 3) return []
  const cutters = cutouts.map(rectangleCutout)
  return classifyContours(subtractPolygonsFromPolygon(subject, cutters))
}

function openingRect(node: AnyNode, bottom: number, top: number): Opening {
  if (node.type !== 'door' && node.type !== 'window') fail('item-cutout')
  const [positionX, positionY] = node.position
  const width = node.width
  const height = node.height
  if (
    ![positionX, positionY, width, height].every(finite) ||
    width <= EPSILON ||
    height <= EPSILON
  ) {
    fail('invalid-opening')
  }
  const rawBottom = positionY - height / 2
  const padding = getOpeningCutoutBottomPadding(node, rawBottom)
  const openingBottom = rawBottom - padding
  const openingTop = positionY + height / 2
  if (!finite(openingBottom) || !finite(openingTop) || openingTop <= openingBottom + EPSILON) {
    fail('invalid-opening')
  }
  if (openingTop > top + EPSILON || openingBottom >= top - EPSILON) fail('opening-outside-wall')
  return {
    id: node.id,
    left: positionX - width / 2,
    right: positionX + width / 2,
    bottom: openingBottom,
    top: openingTop,
  }
}

function validateOpenings(openings: Opening[], footprint: LocalPoint[]) {
  const polygon = footprint.map(({ x, z }) => [x, z] as ViewerPoint2D)
  const minZ = Math.min(...footprint.map((point) => point.z)) - 1
  const maxZ = Math.max(...footprint.map((point) => point.z)) + 1
  for (const opening of openings) {
    if (opening.left >= opening.right - EPSILON) fail('invalid-opening')
    if (clipFootprintToRect(polygon, opening.left, opening.right, minZ, maxZ).length < 3) {
      fail('opening-outside-wall')
    }
  }
  for (let index = 0; index < openings.length; index += 1) {
    for (let other = index + 1; other < openings.length; other += 1) {
      const first = openings[index]!
      const second = openings[other]!
      if (
        first.left <= second.right + EPSILON &&
        first.right >= second.left - EPSILON &&
        first.bottom <= second.top + EPSILON &&
        first.top >= second.bottom - EPSILON
      ) {
        fail('ambiguous-opening')
      }
    }
  }
}

function edgeOnSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint) {
  return pointOnSegment([point.x, point.z], [start.x, start.z], [end.x, end.z])
}

function sameLineSegment(a: LocalPoint, b: LocalPoint, start: LocalPoint, end: LocalPoint) {
  return edgeOnSegment(a, start, end) && edgeOnSegment(b, start, end)
}

function boundaryProvenance(
  a: LocalPoint,
  b: LocalPoint,
  footprint: LocalPoint[],
  rightEdge: number,
  leftEdge: number,
  wall: WallNode,
  cutouts: Cutout[],
): { role: NativeWallFaceRole; materialRole: NativeWallMaterialRole } {
  const rightMaterialRole: NativeWallMaterialRole =
    wall.backSide === 'interior' || wall.backSide === 'exterior' ? wall.backSide : 'exterior'
  const leftMaterialRole: NativeWallMaterialRole =
    wall.frontSide === 'interior' || wall.frontSide === 'exterior' ? wall.frontSide : 'interior'
  if (
    sameLineSegment(a, b, footprint[rightEdge]!, footprint[(rightEdge + 1) % footprint.length]!)
  ) {
    return { role: rightMaterialRole, materialRole: rightMaterialRole }
  }
  if (sameLineSegment(a, b, footprint[leftEdge]!, footprint[(leftEdge + 1) % footprint.length]!)) {
    return { role: leftMaterialRole, materialRole: leftMaterialRole }
  }
  for (let index = 0; index < footprint.length; index += 1) {
    if (index === rightEdge || index === leftEdge) continue
    if (!sameLineSegment(a, b, footprint[index]!, footprint[(index + 1) % footprint.length]!))
      continue
    const endCap = index > 0 && index <= leftEdge - 1
    return {
      role: endCap ? 'end-cap' : 'start-cap',
      materialRole: 'wall-edge',
    }
  }
  const cutoutMatches = cutouts.flatMap((cutout) => {
    const rectangle = rectangleCutout(cutout)
    return rectangle.some((point, index) => {
      const next = rectangle[(index + 1) % rectangle.length]!
      return sameLineSegment(a, b, { x: point[0], z: point[1] }, { x: next[0], z: next[1] })
    })
      ? [cutout]
      : []
  })
  if (cutoutMatches.length > 1) {
    const kinds = new Set(cutoutMatches.map((cutout) => cutout.kind))
    if (kinds.size > 1) fail('ambiguous-provenance')
  }
  if (cutoutMatches.length > 0) {
    return {
      role: cutoutMatches[0]!.kind === 'base' ? 'support-step' : 'reveal',
      materialRole: 'wall-edge',
    }
  }
  return { role: 'reveal', materialRole: 'wall-edge' }
}

function buildBaseCutouts(
  segments: WallContractSupport['baseSegments'],
  slabElevation: number,
  baseElevation: number,
  wallLength: number,
  thickness: number,
  bottom: number,
) {
  const resolved = segments?.length ? segments : [{ start: 0, end: 1, elevation: baseElevation }]
  const extension = Math.max(thickness * 2, 0.2)
  return resolved.flatMap((segment, index) => {
    if (
      ![segment.start, segment.end, segment.elevation].every(finite) ||
      segment.end <= segment.start + EPSILON
    ) {
      fail('stepped-base')
    }
    const elevation = Math.min(segment.elevation, slabElevation)
    if (elevation <= bottom + slabElevation + EPSILON) return []
    const left = segment.start * wallLength - (segment.start <= EPSILON ? extension : 0)
    const right = segment.end * wallLength + (segment.end >= 1 - EPSILON ? extension : 0)
    if (right <= left + EPSILON) fail('stepped-base')
    return [
      {
        id: `base:${index}`,
        kind: 'base' as const,
        left,
        right,
        minZ: -extension,
        maxZ: extension,
        bottom: bottom - 0.01,
        top: elevation - slabElevation,
      },
    ]
  })
}

function activeCutouts(cutouts: Cutout[], y: number) {
  return cutouts.filter((cutout) => cutout.bottom < y - EPSILON && cutout.top > y + EPSILON)
}

function splitRingAtXs(ring: ViewerPoint2D[], xs: number[]) {
  const result: ViewerPoint2D[] = []
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]!
    const end = ring[(index + 1) % ring.length]!
    result.push(start)
    const dx = end[0] - start[0]
    if (Math.abs(dx) <= EPSILON) continue
    const points = xs
      .filter(
        (x) => x > Math.min(start[0], end[0]) + EPSILON && x < Math.max(start[0], end[0]) - EPSILON,
      )
      .sort((left, right) => (dx > 0 ? left - right : right - left))
    for (const x of points) {
      const t = (x - start[0]) / dx
      result.push([x, start[1] + (end[1] - start[1]) * t])
    }
  }
  return normalize2(result)
}

function sectionAt(footprint: ViewerPoint2D[], cutouts: Cutout[], y: number): SliceRegion[] {
  const xs = cutouts.flatMap((cutout) => [cutout.left, cutout.right])
  return subtractCutouts(footprint, activeCutouts(cutouts, y)).map((region) => ({
    outer: splitRingAtXs(region.outer, xs),
    holes: region.holes.map((hole) => splitRingAtXs(hole, xs)),
  }))
}

function addVerticalSegments(
  segments: VerticalSegment[],
  section: SliceRegion,
  y0: number,
  y1: number,
  footprint: LocalPoint[],
  rightEdge: number,
  leftEdge: number,
  wall: WallNode,
  cutouts: Cutout[],
) {
  const emit = (ring: ViewerPoint2D[], hole: boolean) => {
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index]!
      const next = ring[(index + 1) % ring.length]!
      const a = { x: current[0], z: current[1] }
      const b = { x: next[0], z: next[1] }
      if (Math.hypot(a.x - b.x, a.z - b.z) <= EPSILON) continue
      const provenance = boundaryProvenance(a, b, footprint, rightEdge, leftEdge, wall, cutouts)
      const role = hole ? 'reveal' : provenance.role
      const materialRole = hole ? 'wall-edge' : provenance.materialRole
      segments.push({ a, b, y0, y1, hole, role, materialRole })
    }
  }
  emit(section.outer, false)
  for (const hole of section.holes) emit(hole, true)
}

function localPoint3(point: LocalPoint, y: number) {
  return new THREE.Vector3(point.x, y, point.z)
}

function emitVerticalFaces(faces: LocalFace[], segments: VerticalSegment[], wallId: string) {
  segments.forEach((segment, index) => {
    const dx = segment.b.x - segment.a.x
    const dz = segment.b.z - segment.a.z
    const expected = segment.hole
      ? new THREE.Vector3(-dz, 0, dx).normalize()
      : new THREE.Vector3(dz, 0, -dx).normalize()
    const outer = segment.hole
      ? [
          localPoint3(segment.a, segment.y0),
          localPoint3(segment.b, segment.y0),
          localPoint3(segment.b, segment.y1),
          localPoint3(segment.a, segment.y1),
        ]
      : [
          localPoint3(segment.a, segment.y0),
          localPoint3(segment.a, segment.y1),
          localPoint3(segment.b, segment.y1),
          localPoint3(segment.b, segment.y0),
        ]
    addFace(
      faces,
      `${wallId}:vertical:${index}`,
      segment.role,
      segment.materialRole,
      outer,
      [],
      expected,
    )
  })
}

function eventSubject(event: SliceEvent, footprint: ViewerPoint2D[], minZ: number, maxZ: number) {
  if (!('cutout' in event)) return normalize2(footprint)
  return clipFootprintToRect(footprint, event.cutout.left, event.cutout.right, minZ, maxZ)
}

function eventBlockers(event: SliceEvent, cutouts: Cutout[], sampleY: number) {
  if (!('cutout' in event)) return activeCutouts(cutouts, sampleY)
  return activeCutouts(cutouts, sampleY).filter((cutout) => cutout.id !== event.cutout.id)
}

function emitHorizontalEvents(
  faces: LocalFace[],
  events: SliceEvent[],
  cutouts: Cutout[],
  footprint: ViewerPoint2D[],
  bottom: number,
  top: number,
  wallId: string,
) {
  const minZ = Math.min(...footprint.map((point) => point[1])) - 1
  const maxZ = Math.max(...footprint.map((point) => point[1])) + 1
  const sorted = [...events].sort((left, right) => left.y - right.y)
  const levels: number[] = []
  for (const event of sorted) {
    if (levels.length === 0 || Math.abs(levels[levels.length - 1]! - event.y) > EPSILON) {
      levels.push(event.y)
    }
  }
  sorted.forEach((event, eventIndex) => {
    const levelIndex = levels.findIndex((level) => Math.abs(level - event.y) <= EPSILON)
    const previous = levels[levelIndex - 1] ?? bottom
    const next = levels[levelIndex + 1] ?? top
    const beforeY = (previous + event.y) / 2
    const afterY = (event.y + next) / 2
    const sampleY = event.kind === 'opening-bottom' ? beforeY : afterY
    const subject = eventSubject(event, footprint, minZ, maxZ)
    const xBreaks = cutouts.flatMap((cutout) => [cutout.left, cutout.right])
    const regions = subtractCutouts(subject, eventBlockers(event, cutouts, sampleY)).map(
      (region) => ({
        outer: splitRingAtXs(region.outer, xBreaks),
        holes: region.holes.map((hole) => splitRingAtXs(hole, xBreaks)),
      }),
    )
    const expected =
      event.kind === 'top' || event.kind === 'opening-bottom'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, -1, 0)
    const role: NativeWallFaceRole =
      event.kind === 'top'
        ? 'top'
        : event.kind === 'bottom'
          ? 'bottom'
          : event.kind === 'base-top'
            ? 'support-step'
            : 'reveal'
    const materialRole: NativeWallMaterialRole = 'wall-edge'
    regions.forEach((region, regionIndex) => {
      const lift = (ring: ViewerPoint2D[]) => ring.map(([x, z]) => new THREE.Vector3(x, event.y, z))
      addFace(
        faces,
        `${wallId}:horizontal:${eventIndex}:${regionIndex}`,
        role,
        materialRole,
        lift(region.outer),
        region.holes.map(lift),
        expected,
      )
    })
  })
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3) {
  const pointKey = (point: THREE.Vector3) =>
    [point.x, point.y, point.z].map((value) => Math.round(value * EDGE_KEY_SCALE)).join(',')
  return [pointKey(a), pointKey(b)].sort().join('|')
}

function shellVolume(faces: LocalFace[]) {
  let volume = 0
  const contribution = (ring: THREE.Vector3[]) => {
    const origin = ring[0]!
    for (let index = 1; index < ring.length - 1; index += 1) {
      volume += origin.dot(new THREE.Vector3().crossVectors(ring[index]!, ring[index + 1]!)) / 6
    }
  }
  for (const face of faces) {
    contribution(face.outer)
    face.holes.forEach(contribution)
  }
  return volume
}

function validateLocalShell(faces: LocalFace[]) {
  if (faces.length === 0) fail('invalid-shell')
  const ids = faces.map((face) => face.id)
  if (new Set(ids).size !== ids.length) fail('duplicate-face-id')
  const edges = new Map<string, { count: number; balance: number }>()
  for (const face of faces) {
    for (const ring of [face.outer, ...face.holes]) {
      validateRing(ring)
      for (let index = 0; index < ring.length; index += 1) {
        const current = ring[index]!
        const next = ring[(index + 1) % ring.length]!
        const key = edgeKey(current, next)
        const pointKey = (point: THREE.Vector3) =>
          [point.x, point.y, point.z].map((value) => Math.round(value * EDGE_KEY_SCALE)).join(',')
        const forward = pointKey(current) < pointKey(next) ? 1 : -1
        const existing = edges.get(key) ?? { count: 0, balance: 0 }
        existing.count += 1
        existing.balance += forward
        edges.set(key, existing)
      }
    }
  }
  if ([...edges.values()].some((edge) => edge.count !== 2 || edge.balance !== 0)) {
    fail('nonmanifold-shell')
  }
  if (!(shellVolume(faces) > AREA_EPSILON)) fail('invalid-shell')
}

function serializeFaces(faces: LocalFace[], matrixWorld: THREE.Matrix4): PascalNativeWallFace[] {
  const point = (value: THREE.Vector3): NativeWallPoint => {
    const transformed = value.clone().applyMatrix4(matrixWorld)
    if (![transformed.x, transformed.y, transformed.z].every(finite)) fail('nonfinite-point')
    return [transformed.x, transformed.y, transformed.z]
  }
  return faces.map((face) => ({
    id: face.id,
    role: face.role,
    materialRole: face.materialRole,
    outer: face.outer.map(point),
    holes: face.holes.map((hole) => hole.map(point)),
  }))
}

function gateReasons(wall: WallNode, children: AnyNode[]) {
  const reasons: string[] = []
  if (wall.curveOffset && Math.abs(wall.curveOffset) > EPSILON) reasons.push('curved-wall')
  if (wall.fillToTerrain || wall.supportSlabId === 'ground') reasons.push('terrain-support')
  if (wall.faceBands?.enabled) reasons.push('face-bands')
  if (wall.skirting?.enabled || wall.crown?.enabled || wall.chairRail?.enabled)
    reasons.push('wall-trim')
  for (const child of children) {
    if (child.type !== 'door' && child.type !== 'window') reasons.push('item-cutout')
    else if (child.openingShape !== 'rectangle') reasons.push('shaped-opening')
  }
  return reasons
}

export function buildSketchupWallContract(
  context: SketchupWallContractContext,
): PascalNativeWallContract {
  const { wall, children, miterData, matrixWorld } = context
  const reasons = gateReasons(wall, children)
  if (!finiteMatrix(matrixWorld)) reasons.push('missing-renderer')
  if (reasons.length > 0) return { version: 1, compatible: false, wallId: wall.id, reasons }

  try {
    const thickness = getWallThickness(wall)
    if (!finite(thickness) || thickness <= EPSILON) fail('degenerate-footprint')
    const support = context.support ?? {}
    const slabElevation = support.slabElevation ?? 0
    const baseElevation = support.baseElevation ?? slabElevation
    const storeyHeight = support.storeyHeight ?? DEFAULT_STOREY_HEIGHT
    if (![slabElevation, baseElevation, storeyHeight].every(finite)) fail('invalid-height')
    const topElevation = resolveWallTop(wall, storeyHeight, slabElevation)
    const effectiveBase = Math.min(baseElevation, slabElevation)
    const bottom = effectiveBase - slabElevation
    const top = topElevation - slabElevation
    if (![topElevation, bottom, top].every(finite) || top - bottom <= EPSILON)
      fail('invalid-height')

    const footprintWorld = getWallPlanFootprint(wall, miterData)
    const footprint = localFootprint(wall, footprintWorld)
    if (footprint.length < 4) fail('degenerate-footprint')
    const footprint2d = footprint.map(({ x, z }) => [x, z] as ViewerPoint2D)
    if (Math.abs(area2(footprint2d)) <= AREA_EPSILON) fail('degenerate-footprint')
    const rightEdge = 0
    const startKey = pointToKey({ x: wall.start[0], y: wall.start[1] })
    const endKey = pointToKey({ x: wall.end[0], y: wall.end[1] })
    const startJunction = Boolean(miterData.junctionData.get(startKey)?.get(wall.id))
    const endJunction = Boolean(miterData.junctionData.get(endKey)?.get(wall.id))
    const endLeftPoint = footprint[endJunction ? 3 : 2]
    const startLeftPoint = footprint[startJunction ? footprint.length - 2 : footprint.length - 1]
    const leftEdge = footprint.findIndex(
      (point, index) =>
        point === endLeftPoint && footprint[(index + 1) % footprint.length] === startLeftPoint,
    )
    if (leftEdge <= rightEdge || leftEdge >= footprint.length) fail('degenerate-footprint')

    const openings = children.map((child) => openingRect(child, bottom, top))
    validateOpenings(openings, footprint)
    const minZ = Math.min(...footprint.map((point) => point.z)) - 1
    const maxZ = Math.max(...footprint.map((point) => point.z)) + 1
    const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (!finite(wallLength) || wallLength <= EPSILON) fail('degenerate-footprint')
    const baseCutouts = buildBaseCutouts(
      support.baseSegments,
      slabElevation,
      baseElevation,
      wallLength,
      thickness,
      bottom,
    )
    const openingCutouts: Cutout[] = openings.map((opening) => ({
      id: `opening:${opening.id}`,
      kind: 'opening',
      left: opening.left,
      right: opening.right,
      minZ,
      maxZ,
      bottom: opening.bottom,
      top: opening.top,
    }))
    const cutouts = [...baseCutouts, ...openingCutouts]

    const events: SliceEvent[] = [
      { y: bottom, kind: 'bottom' },
      { y: top, kind: 'top' },
    ]
    for (const cutout of cutouts) {
      if (cutout.kind === 'base' && cutout.top > bottom + EPSILON && cutout.top < top - EPSILON) {
        events.push({ y: cutout.top, kind: 'base-top', cutout })
      }
      if (cutout.kind !== 'opening') continue
      if (cutout.bottom > bottom + EPSILON && cutout.bottom < top - EPSILON) {
        events.push({ y: cutout.bottom, kind: 'opening-bottom', cutout })
      }
      if (cutout.top > bottom + EPSILON && cutout.top < top - EPSILON) {
        events.push({ y: cutout.top, kind: 'opening-top', cutout })
      }
    }
    events.sort((left, right) => left.y - right.y)
    const uniqueEvents: SliceEvent[] = []
    for (const event of events) {
      if (
        uniqueEvents.some((existing) => {
          if (Math.abs(existing.y - event.y) > EPSILON || existing.kind !== event.kind) return false
          if (!('cutout' in existing)) return true
          if (!('cutout' in event)) return false
          return existing.cutout.id === event.cutout.id
        })
      )
        continue
      uniqueEvents.push(event)
    }

    const verticalSegments: VerticalSegment[] = []
    for (let index = 0; index < uniqueEvents.length - 1; index += 1) {
      const y0 = uniqueEvents[index]!.y
      const y1 = uniqueEvents[index + 1]!.y
      if (y1 - y0 <= EPSILON) continue
      const section = sectionAt(footprint2d, cutouts, (y0 + y1) / 2)
      for (const region of section) {
        addVerticalSegments(
          verticalSegments,
          region,
          y0,
          y1,
          footprint,
          rightEdge,
          leftEdge,
          wall,
          cutouts,
        )
      }
    }

    const faces: LocalFace[] = []
    emitVerticalFaces(faces, verticalSegments, wall.id)
    emitHorizontalEvents(faces, uniqueEvents, cutouts, footprint2d, bottom, top, wall.id)
    validateLocalShell(faces)

    return {
      version: 1,
      compatible: true,
      coordinates: 'three-world-m',
      sketchUpMap: 'x,-z,y',
      wallId: wall.id,
      faces: serializeFaces(faces, matrixWorld),
    }
  } catch (error) {
    if (error instanceof ContractError)
      return { version: 1, compatible: false, wallId: wall.id, reasons: [error.code] }
    return { version: 1, compatible: false, wallId: wall.id, reasons: ['contract-build-failed'] }
  }
}

export function buildSketchupWallContracts(
  nodes: Record<string, AnyNode>,
  wallObjects: ReadonlyMap<string, THREE.Object3D>,
  resolveSupport: (wall: WallNode, levelId: string) => WallContractSupport = () => ({}),
) {
  const walls = Object.values(nodes)
    .filter((node): node is WallNode => node.type === 'wall')
    .sort((a, b) => a.id.localeCompare(b.id))
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const wall of walls) {
    const levelId = resolveLevelId(wall, nodes)
    const level = wallsByLevel.get(levelId) ?? []
    level.push(wall)
    wallsByLevel.set(levelId, level)
  }
  const miterByLevel = new Map<string, WallMiterData>()
  for (const [levelId, levelWalls] of wallsByLevel)
    miterByLevel.set(levelId, calculateLevelMiters(levelWalls))

  const contracts = new Map<string, PascalNativeWallContract>()
  for (const wall of walls) {
    const levelId = resolveLevelId(wall, nodes)
    const children = wall.children
      .map((id) => nodes[id])
      .filter((node): node is AnyNode => Boolean(node))
    const object = wallObjects.get(wall.id)
    contracts.set(
      wall.id,
      object
        ? buildSketchupWallContract({
            wall,
            children,
            miterData: miterByLevel.get(levelId) ?? calculateLevelMiters([wall]),
            matrixWorld: object.matrixWorld,
            support: resolveSupport(wall, levelId),
          })
        : { version: 1, compatible: false, wallId: wall.id, reasons: ['missing-renderer'] },
    )
  }
  return contracts
}
