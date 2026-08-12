import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { bodyFeatureIds, orderedBodyLoopEdges } from './body-imprint-helpers'
import { segmentsIntersect } from './body-imprint-validation'
import { getBodyFaceFrame, type TopologyRemap, validateBodyTopology } from './body-topology'

type Point2 = readonly [number, number]
type Point3 = readonly [number, number, number]
type BodyFaceSurface = BodyNodeType['faces'][number]['surface']

export type SweepBodyFaceResult = {
  readonly body: BodyNode
  readonly sourceFaceId: string
  readonly closed: boolean
  readonly movedFaceId: string | null
  readonly createdFaceIds: readonly string[]
  readonly remap: TopologyRemap
}

export type SweepBodyFaceErrorCode =
  | 'topology.invalid'
  | 'profile.not-found'
  | 'profile.shell'
  | 'profile.holes'
  | 'profile.edges'
  | 'profile.curved'
  | 'profile.degenerate'
  | 'profile.concave'
  | 'path.invalid'
  | 'path.start-plane'
  | 'path.first-segment'
  | 'path.zero-length'
  | 'path.reversal'
  | 'path.nonplanar'
  | 'path.self-intersection'
  | 'path.miter-collapse'
  | 'path.closed'
  | 'topology.result'

export class SweepBodyFaceError extends RangeError {
  readonly code: SweepBodyFaceErrorCode
  readonly featureIds: readonly string[]

  constructor(code: SweepBodyFaceErrorCode, message: string, featureIds: readonly string[] = []) {
    const ids = [...new Set(featureIds.filter((id): id is string => Boolean(id)))]
    super(ids.length > 0 ? `${message}: ${ids.join(', ')}` : message)
    this.name = 'SweepBodyFaceError'
    this.code = code
    this.featureIds = ids
  }
}

const EPSILON = 1e-7
const PLANAR_EPSILON = 1e-6

const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Point3, b: Point3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const subtract = (a: Point3, b: Point3): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const add = (a: Point3, b: Point3): [number, number, number] => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]
const scale = (a: Point3, value: number): [number, number, number] => [
  a[0] * value,
  a[1] * value,
  a[2] * value,
]
const length = (a: Point3) => Math.hypot(a[0], a[1], a[2])

function normalize(
  a: Point3,
  code: SweepBodyFaceErrorCode,
  message: string,
): [number, number, number] {
  const magnitude = length(a)
  if (magnitude <= EPSILON) throw new SweepBodyFaceError(code, message)
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude]
}

function profileBasis(
  normal: Point3,
  firstEdge: Point3,
): {
  readonly u: [number, number, number]
  readonly v: [number, number, number]
} {
  const u = normalize(
    subtract(firstEdge, scale(normal, dot(firstEdge, normal))),
    'profile.degenerate',
    'Sweep profile has a degenerate first edge',
  )
  const v = normalize(cross(normal, u), 'profile.degenerate', 'Sweep profile has no planar basis')
  return { u, v }
}

function point2(point: Point3, origin: Point3, u: Point3, v: Point3): Point2 {
  const delta = subtract(point, origin)
  return [dot(delta, u), dot(delta, v)]
}

function signedArea(points: readonly Point2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area * 0.5
}

function assertSimpleConvexProfile(
  points: readonly Point3[],
  normal: Point3,
  faceId: string,
): void {
  const basis = profileBasis(normal, subtract(points[1]!, points[0]!))
  const projected = points.map((point) => point2(point, points[0]!, basis.u, basis.v))
  const area = signedArea(projected)
  if (Math.abs(area) <= EPSILON) {
    throw new SweepBodyFaceError('profile.degenerate', 'Sweep profile is degenerate', [faceId])
  }
  let turnSign = 0
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]!
    const next = projected[(index + 1) % projected.length]!
    if (Math.hypot(next[0] - current[0], next[1] - current[1]) <= EPSILON) {
      throw new SweepBodyFaceError('profile.degenerate', 'Sweep profile has a zero-length edge', [
        faceId,
      ])
    }
    for (let other = index + 1; other < projected.length; other += 1) {
      const otherPoint = projected[other]!
      const otherNext = projected[(other + 1) % projected.length]!
      const adjacent = other === index + 1 || (index === 0 && other === projected.length - 1)
      if (!adjacent && segmentsIntersect(current, next, otherPoint, otherNext)) {
        throw new SweepBodyFaceError('profile.concave', 'Sweep profile self-intersects', [faceId])
      }
    }
    const previous = projected[(index - 1 + projected.length) % projected.length]!
    const turn =
      (next[0] - current[0]) * (current[1] - previous[1]) -
      (next[1] - current[1]) * (current[0] - previous[0])
    if (Math.abs(turn) <= EPSILON) {
      throw new SweepBodyFaceError('profile.concave', 'Sweep profile must be strictly convex', [
        faceId,
      ])
    }
    const sign = Math.sign(turn)
    if (turnSign === 0) turnSign = sign
    else if (sign !== turnSign) {
      throw new SweepBodyFaceError('profile.concave', 'Sweep profile must be convex', [faceId])
    }
  }
}

function rotateBetween(vector: Point3, from: Point3, to: Point3): [number, number, number] {
  const axis = cross(from, to)
  const axisLength = length(axis)
  const cosine = Math.max(-1, Math.min(1, dot(from, to)))
  if (axisLength <= EPSILON) {
    if (cosine >= 0) return [...vector]
    const candidate = Math.abs(from[0]) < 0.8 ? ([1, 0, 0] as const) : ([0, 1, 0] as const)
    const rotationAxis = normalize(
      cross(from, candidate),
      'path.miter-collapse',
      'Sweep frame collapsed',
    )
    return add(scale(vector, -1), scale(rotationAxis, 2 * dot(rotationAxis, vector)))
  }
  const unitAxis = scale(axis, 1 / axisLength)
  const sine = axisLength
  const term1 = scale(vector, cosine)
  const term2 = scale(cross(unitAxis, vector), sine)
  const term3 = scale(unitAxis, dot(unitAxis, vector) * (1 - cosine))
  return add(add(term1, term2), term3)
}

function transportedFrame(
  previousU: Point3,
  previousTangent: Point3,
  tangent: Point3,
): [number, number, number] {
  const transported = rotateBetween(previousU, previousTangent, tangent)
  const orthogonal = subtract(transported, scale(tangent, dot(transported, tangent)))
  return normalize(orthogonal, 'path.miter-collapse', 'Sweep corner frame collapsed')
}

function pathPlaneNormal(
  points: readonly Point3[],
  firstDirection: Point3,
): [number, number, number] | null {
  for (let index = 2; index < points.length; index += 1) {
    const direction = subtract(points[index]!, points[index - 1]!)
    const candidate = cross(firstDirection, direction)
    if (length(candidate) > EPSILON)
      return normalize(candidate, 'path.nonplanar', 'Sweep path plane collapsed')
  }
  return null
}

function assertPath(
  sourcePoints: readonly Point3[],
  normal: Point3,
  input: readonly Point3[],
  faceId: string,
): { readonly points: Point3[]; readonly closed: boolean; readonly tangents: Point3[] } {
  if (
    input.length < 2 ||
    input.length > 256 ||
    input.some(
      (point) => point.length !== 3 || point.some((coordinate) => !Number.isFinite(coordinate)),
    )
  ) {
    throw new SweepBodyFaceError(
      'path.invalid',
      'Sweep path requires 2–256 finite Body-local points',
      [faceId],
    )
  }
  const points = input.map((point) => [...point] as [number, number, number])
  const firstProfilePoint = sourcePoints[0]!
  if (Math.abs(dot(subtract(points[0]!, firstProfilePoint), normal)) > PLANAR_EPSILON) {
    throw new SweepBodyFaceError('path.start-plane', 'Sweep path must start on the profile plane', [
      faceId,
    ])
  }
  let closed = false
  if (points.length > 2 && length(subtract(points.at(-1)!, points[0]!)) <= PLANAR_EPSILON) {
    closed = true
    points.pop()
  }
  if (closed && points.length < 3) {
    throw new SweepBodyFaceError(
      'path.closed',
      'Closed sweep paths require at least three stations',
      [faceId],
    )
  }
  const directions: Point3[] = []
  for (let index = 0; index < points.length - (closed ? 0 : 1); index += 1) {
    const next = points[(index + 1) % points.length]!
    const direction = subtract(next, points[index]!)
    if (length(direction) <= EPSILON) {
      throw new SweepBodyFaceError('path.zero-length', 'Sweep path has a zero-length segment', [
        faceId,
        `station:${index}`,
      ])
    }
    directions.push(normalize(direction, 'path.zero-length', 'Sweep path has an invalid segment'))
  }
  const firstDirection = directions[0]!
  if (Math.abs(dot(firstDirection, normal)) < 1 - 1e-5) {
    throw new SweepBodyFaceError(
      'path.first-segment',
      'The first sweep segment must be parallel to the profile normal',
      [faceId, 'station:0'],
    )
  }
  for (let index = 1; index < directions.length; index += 1) {
    if (dot(directions[index - 1]!, directions[index]!) < -1 + 1e-5) {
      throw new SweepBodyFaceError('path.reversal', 'Sweep path contains a reversing segment', [
        faceId,
        `station:${index}`,
      ])
    }
  }
  const planeNormal = pathPlaneNormal(points, firstDirection)
  if (planeNormal) {
    const origin = points[0]!
    if (
      points.some((point) => Math.abs(dot(subtract(point, origin), planeNormal)) > PLANAR_EPSILON)
    ) {
      throw new SweepBodyFaceError('path.nonplanar', 'Sweep path must be planar', [faceId])
    }
    const axis = Math.abs(planeNormal[0]) < 0.8 ? ([1, 0, 0] as const) : ([0, 1, 0] as const)
    const u = normalize(cross(planeNormal, axis), 'path.nonplanar', 'Sweep path plane collapsed')
    const v = normalize(cross(planeNormal, u), 'path.nonplanar', 'Sweep path plane collapsed')
    const projected = points.map((point) => point2(point, origin, u, v))
    const segmentCount = directions.length
    for (let first = 0; first < segmentCount; first += 1) {
      const firstStart = projected[first]!
      const firstEnd = projected[(first + 1) % points.length]!
      for (let second = first + 1; second < segmentCount; second += 1) {
        const adjacent =
          second === first + 1 || (closed && first === 0 && second === segmentCount - 1)
        if (
          !adjacent &&
          segmentsIntersect(
            firstStart,
            firstEnd,
            projected[second]!,
            projected[(second + 1) % points.length]!,
          )
        ) {
          throw new SweepBodyFaceError('path.self-intersection', 'Sweep path self-intersects', [
            faceId,
            `segment:${first}`,
            `segment:${second}`,
          ])
        }
      }
    }
  }
  const tangents = points.map((_, index) => {
    if (!closed && index === 0) return firstDirection
    if (!closed && index === points.length - 1) return directions.at(-1)!
    const incoming = directions[(index - 1 + directions.length) % directions.length]!
    const outgoing = directions[index % directions.length]!
    const sum = add(incoming, outgoing)
    if (length(sum) <= EPSILON) {
      throw new SweepBodyFaceError(
        'path.miter-collapse',
        'Sweep path has a collapsing corner miter',
        [faceId, `station:${index}`],
      )
    }
    const tangent = normalize(sum, 'path.miter-collapse', 'Sweep path corner frame collapsed')
    if (Math.abs(dot(tangent, normal)) > 1 - 1e-5 && index !== 0) {
      // A straight normal-aligned corner is valid; the frame transport below handles it.
    }
    return tangent
  })
  return { points, closed, tangents }
}

type FaceSpec = {
  readonly id: string
  readonly vertices: readonly string[]
  readonly surface: BodyFaceSurface
}

function surfaceForSweep(source: BodyNode, start: Point3, u: Point3, v: Point3): BodyFaceSurface {
  return {
    ...(source.bodyDefaults.materialRef ? { materialRef: source.bodyDefaults.materialRef } : {}),
    uvOrigin: [...start] as [number, number, number],
    uvU: [...u] as [number, number, number],
    uvV: [...v] as [number, number, number],
  }
}

function quadIsPlanar(points: readonly Point3[]): boolean {
  const first = points[0]!
  const normal = cross(subtract(points[1]!, first), subtract(points[2]!, first))
  if (length(normal) <= EPSILON) return true
  return Math.abs(dot(subtract(points[3]!, first), normal)) <= PLANAR_EPSILON
}

export function sweepBodyFace(
  source: BodyNode,
  faceId: string,
  pathPoints: readonly Point3[],
): SweepBodyFaceResult {
  const topology = validateBodyTopology(source)
  if (!topology.valid) {
    const diagnostic = topology.diagnostics[0]
    throw new SweepBodyFaceError(
      'topology.invalid',
      'Sweep requires valid Body topology',
      diagnostic?.featureIds,
    )
  }
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new SweepBodyFaceError('profile.not-found', 'Sweep face not found', [faceId])
  if (
    source.faces.length !== 1 ||
    source.shells.length !== 1 ||
    source.shells[0]?.faceIds.join() !== faceId
  ) {
    throw new SweepBodyFaceError('profile.shell', 'Sweep v1 requires one open face in one shell', [
      faceId,
    ])
  }
  if (face.innerLoopIds.length > 0) {
    throw new SweepBodyFaceError('profile.holes', 'Sweep v1 rejects profile holes', [
      face.id,
      ...face.innerLoopIds,
    ])
  }
  const edges = orderedBodyLoopEdges(source, face.outerLoopId)
  if (edges.length < 3 || edges.length > 64) {
    throw new SweepBodyFaceError('profile.edges', 'Sweep profile requires 3–64 line edges', [
      face.id,
      face.outerLoopId,
    ])
  }
  const curves = new Map(source.curves.map((curve) => [curve.id, curve]))
  if (edges.some((edge) => edge.twinId !== null)) {
    throw new SweepBodyFaceError('profile.shell', 'Sweep v1 requires an open profile face', [
      face.id,
    ])
  }
  if (
    edges.some((edge) => edge.curveId !== undefined && curves.get(edge.curveId)?.kind !== 'line')
  ) {
    throw new SweepBodyFaceError('profile.curved', 'Sweep v1 supports line edges only', [face.id])
  }
  const verticesById = new Map(source.vertices.map((vertex) => [vertex.id, vertex.position]))
  const profilePoints = edges.map((edge) => verticesById.get(edge.vertexId))
  if (profilePoints.some((point) => !point)) {
    throw new SweepBodyFaceError('profile.degenerate', 'Sweep profile has missing vertices', [
      face.id,
    ])
  }
  const points = profilePoints as Point3[]
  const frame = getBodyFaceFrame(source, face.id)
  assertSimpleConvexProfile(points, frame.normal, face.id)
  const path = assertPath(points, frame.normal, pathPoints, face.id)

  const revision = source.revision + 1
  const stem = `${face.id}:sweep:${revision}`
  const profileBasisFrame = profileBasis(frame.normal, subtract(points[1]!, points[0]!))
  const profileOffsets = points.map((point) => {
    const delta = subtract(point, path.points[0]!)
    return {
      u: dot(delta, profileBasisFrame.u),
      v: dot(delta, profileBasisFrame.v),
    }
  })
  const ringPoints: Point3[][] = []
  const ringVertexIds: string[][] = []
  let previousU: Point3 = profileBasisFrame.u
  let previousTangent: Point3 = path.tangents[0]!
  for (let station = 0; station < path.points.length; station += 1) {
    const tangent = path.tangents[station]!
    const u =
      station === 0 ? profileBasisFrame.u : transportedFrame(previousU, previousTangent, tangent)
    const v =
      station === 0
        ? profileBasisFrame.v
        : normalize(cross(tangent, u), 'path.miter-collapse', 'Sweep frame collapsed')
    const ring = profileOffsets.map(({ u: offsetU, v: offsetV }) =>
      add(path.points[station]!, add(scale(u, offsetU), scale(v, offsetV))),
    )
    ringPoints.push(ring)
    ringVertexIds.push(
      edges.map((edge, index) =>
        !path.closed && station === path.points.length - 1
          ? edge.vertexId
          : path.closed
            ? `${stem}:ring:${station}:vertex:${index}`
            : `${stem}:ring:${station}:vertex:${index}`,
      ),
    )
    previousU = u
    previousTangent = tangent
  }

  const createdVertices = path.closed
    ? ringPoints.flatMap((ring, station) =>
        ring.map((position, index) => ({
          id: ringVertexIds[station]![index]!,
          position: [...position] as [number, number, number],
        })),
      )
    : ringPoints.slice(0, -1).flatMap((ring, stationOffset) =>
        ring.map((position, index) => ({
          id: ringVertexIds[stationOffset]![index]!,
          position: [...position] as [number, number, number],
        })),
      )
  const movedVertexIds = new Set(ringVertexIds.at(-1)!)
  const movedVertices = source.vertices.map((vertex) => {
    const index = ringVertexIds.at(-1)?.indexOf(vertex.id) ?? -1
    return index === -1
      ? vertex
      : { ...vertex, position: [...ringPoints.at(-1)![index]!] as [number, number, number] }
  })
  const vertexPositions = new Map<string, Point3>([
    ...source.vertices.map((vertex) => [vertex.id, vertex.position] as const),
    ...createdVertices.map((vertex) => [vertex.id, vertex.position] as const),
    ...movedVertices.map((vertex) => [vertex.id, vertex.position] as const),
  ])

  const defaultSurface = surfaceForSweep(source, path.points[0]!, profileBasisFrame.u, frame.normal)
  const specs: FaceSpec[] = []
  const createdFaceIds: string[] = []
  const newLoopIds: string[] = []
  if (!path.closed) {
    const startFaceId = `${stem}:start`
    const startLoopId = `${stem}:start:loop`
    specs.push({
      id: startFaceId,
      vertices: [...ringVertexIds[0]!].reverse(),
      surface: defaultSurface,
    })
    createdFaceIds.push(startFaceId)
    newLoopIds.push(startLoopId)
  }
  const segmentCount = path.closed ? path.points.length : path.points.length - 1
  for (let station = 0; station < segmentCount; station += 1) {
    const nextStation = (station + 1) % path.points.length
    const segment = normalize(
      subtract(path.points[nextStation]!, path.points[station]!),
      'path.zero-length',
      'Sweep path has an invalid segment',
    )
    for (let index = 0; index < edges.length; index += 1) {
      const nextIndex = (index + 1) % edges.length
      const vertices = [
        ringVertexIds[nextStation]![nextIndex]!,
        ringVertexIds[nextStation]![index]!,
        ringVertexIds[station]![index]!,
        ringVertexIds[station]![nextIndex]!,
      ]
      const positions = vertices.map((id) => vertexPositions.get(id)!)
      const sideStem = `${stem}:side:${station}:${index}`
      const sideSurface = surfaceForSweep(
        source,
        ringPoints[station]![index]!,
        profileBasisFrame.u,
        segment,
      )
      if (quadIsPlanar(positions)) {
        specs.push({ id: sideStem, vertices, surface: sideSurface })
        createdFaceIds.push(sideStem)
        newLoopIds.push(`${sideStem}:loop`)
      } else {
        const firstId = `${sideStem}:a`
        const secondId = `${sideStem}:b`
        specs.push(
          {
            id: firstId,
            vertices: [vertices[0]!, vertices[1]!, vertices[2]!],
            surface: sideSurface,
          },
          {
            id: secondId,
            vertices: [vertices[0]!, vertices[2]!, vertices[3]!],
            surface: sideSurface,
          },
        )
        createdFaceIds.push(firstId, secondId)
        newLoopIds.push(`${firstId}:loop`, `${secondId}:loop`)
      }
    }
  }

  const newLoops = specs.map((spec) => ({
    id: `${spec.id}:loop`,
    faceId: spec.id,
    kind: 'outer' as const,
  }))
  const newEdges = specs.flatMap((spec) =>
    spec.vertices.map((vertexId, index) => ({
      id: `${spec.id}:edge:${index}`,
      vertexId,
      twinId: null as string | null,
      nextId: `${spec.id}:edge:${(index + 1) % spec.vertices.length}`,
      loopId: `${spec.id}:loop`,
    })),
  )
  const allEdges = path.closed
    ? newEdges
    : [...source.halfEdges.map((edge) => ({ ...edge, twinId: null })), ...newEdges]
  const directed = new Map<string, (typeof allEdges)[number]>()
  const edgeStartEnd = (edge: (typeof allEdges)[number]): [string, string] => {
    const next = allEdges.find((candidate) => candidate.id === edge.nextId)
    if (!next)
      throw new SweepBodyFaceError('topology.result', 'Sweep generated a broken loop', [edge.id])
    return [edge.vertexId, next.vertexId]
  }
  for (const edge of allEdges) {
    const [start, end] = edgeStartEnd(edge)
    const key = `${start}\u0000${end}`
    if (directed.has(key))
      throw new SweepBodyFaceError('topology.result', 'Sweep generated duplicate directed edges', [
        edge.id,
      ])
    directed.set(key, edge)
  }
  for (const edge of allEdges) {
    const [start, end] = edgeStartEnd(edge)
    const twin = directed.get(`${end}\u0000${start}`)
    if (!twin || twin.id === edge.id) {
      throw new SweepBodyFaceError('topology.result', 'Sweep generated an unpaired boundary edge', [
        edge.id,
      ])
    }
    edge.twinId = twin.id
  }
  const sourceFaceSurface = face.surface
  const resultFaces = [
    ...(path.closed
      ? []
      : [
          {
            ...face,
            surface: sourceFaceSurface,
          },
        ]),
    ...specs.map((spec) => ({
      id: spec.id,
      outerLoopId: `${spec.id}:loop`,
      innerLoopIds: [],
      surface: spec.surface,
    })),
  ]
  const resultLoops = [...(path.closed ? [] : source.loops), ...newLoops]
  const resultShellFaces = resultFaces.map((resultFace) => resultFace.id)
  const body = {
    ...source,
    revision,
    vertices: path.closed ? createdVertices : [...movedVertices, ...createdVertices],
    halfEdges: allEdges,
    loops: resultLoops,
    faces: resultFaces,
    shells: source.shells.map((shell) => ({ ...shell, faceIds: resultShellFaces })),
  } satisfies BodyNodeType
  const parsedBody = BodyNode.parse(body)
  const resultValidation = validateBodyTopology(parsedBody)
  if (!resultValidation.valid) {
    throw new SweepBodyFaceError(
      'topology.result',
      'Sweep generated invalid reciprocal topology',
      resultValidation.diagnostics.flatMap((diagnostic) => diagnostic.featureIds),
    )
  }
  const sourceIds = bodyFeatureIds(source)
  const createdIds = [
    ...createdVertices.map((vertex) => vertex.id),
    ...newEdges.map((edge) => edge.id),
    ...newLoops.map((loop) => loop.id),
    ...createdFaceIds,
  ]
  const deletedIds = path.closed
    ? sourceIds.filter((id) => !source.shells.some((shell) => shell.id === id))
    : []
  const preservedIds = sourceIds.filter((id) => !deletedIds.includes(id))
  return {
    body: parsedBody,
    sourceFaceId: faceId,
    closed: path.closed,
    movedFaceId: path.closed ? null : faceId,
    createdFaceIds,
    remap: {
      preserved: preservedIds,
      created: createdIds,
      deleted: deletedIds,
      split: path.closed ? { [faceId]: createdFaceIds.filter((id) => id.includes(':side:')) } : {},
      merged: {},
    },
  }
}
