import { type BodyCurve, BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'

export type BodyPoint3 = [number, number, number]

export const DEFAULT_BODY_CURVE_SEGMENTS = 32

const CURVE_EPSILON = 1e-9

const add = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as BodyPoint3

const subtract = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as BodyPoint3

const multiply = (value: readonly [number, number, number], scalar: number) =>
  [value[0] * scalar, value[1] * scalar, value[2] * scalar] as BodyPoint3

const dot = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as BodyPoint3

const length = (value: readonly [number, number, number]) => Math.hypot(...value)

function normalize(value: readonly [number, number, number]): BodyPoint3 | null {
  const magnitude = length(value)
  return magnitude > CURVE_EPSILON && Number.isFinite(magnitude)
    ? multiply(value, 1 / magnitude)
    : null
}

function canonicalNormal(value: readonly [number, number, number]): BodyPoint3 | null {
  const normal = normalize(value)
  if (!normal) return null
  const dominant = normal.reduce(
    (best, component, index) => (Math.abs(component) > Math.abs(normal[best]!) ? index : best),
    0,
  )
  return normal[dominant]! < 0 ? multiply(normal, -1) : normal
}

function curveBasis(normal: readonly [number, number, number]) {
  const n = normalize(normal)
  if (!n) return null
  const reference: BodyPoint3 = Math.abs(n[1]) >= 0.9 ? [0, 0, 1] : [0, 1, 0]
  const u = normalize(cross(n, reference))
  const v = u ? normalize(cross(u, n)) : null
  return u && v ? { u, v } : null
}

function positiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2
  const normalized = angle % fullTurn
  return normalized < 0 ? normalized + fullTurn : normalized
}

function angleForPoint(
  point: readonly [number, number, number],
  center: readonly [number, number, number],
  basis: { u: BodyPoint3; v: BodyPoint3 },
): number {
  const radial = subtract(point, center)
  return Math.atan2(dot(radial, basis.v), dot(radial, basis.u))
}

function arcPoint(
  curve: Extract<BodyCurve, { kind: 'circular-arc' }>,
  basis: { u: BodyPoint3; v: BodyPoint3 },
  angle: number,
): BodyPoint3 {
  return add(
    curve.center,
    multiply(
      add(multiply(basis.u, Math.cos(angle)), multiply(basis.v, Math.sin(angle))),
      curve.radius,
    ),
  )
}

export function rebaseCircularArcCurve(
  curve: Extract<BodyCurve, { kind: 'circular-arc' }>,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  radius: number,
): Extract<BodyCurve, { kind: 'circular-arc' }> {
  const basis = curveBasis(normal)
  if (!basis || !Number.isFinite(radius) || radius <= CURVE_EPSILON) {
    throw new RangeError('Circular arc transform requires a finite positive radius')
  }
  const fullTurn = Math.PI * 2
  const startAngle = angleForPoint(start, center, basis)
  const endpointAngle = angleForPoint(end, center, basis)
  const expectedEndAngle = startAngle + (curve.endAngle - curve.startAngle)
  const turns = Math.round((expectedEndAngle - endpointAngle) / fullTurn)
  const endAngle = endpointAngle + turns * fullTurn
  return {
    ...curve,
    center: [...center],
    normal: [...normal],
    radius,
    startAngle,
    endAngle,
  }
}

function assertFinitePoint(point: readonly [number, number, number], label: string): void {
  if (point.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`Circular arc ${label} must be finite`)
  }
}

function circleFromThreePoints(
  start: readonly [number, number, number],
  through: readonly [number, number, number],
  end: readonly [number, number, number],
) {
  assertFinitePoint(start, 'start')
  assertFinitePoint(through, 'through')
  assertFinitePoint(end, 'end')
  const first = subtract(through, start)
  const second = subtract(end, start)
  const normalRaw = cross(first, second)
  const normal = canonicalNormal(normalRaw)
  const normalLengthSquared = dot(normalRaw, normalRaw)
  if (!normal || normalLengthSquared <= CURVE_EPSILON ** 2) {
    throw new RangeError('Circular arc requires three non-collinear points')
  }
  const firstLengthSquared = dot(first, first)
  const secondLengthSquared = dot(second, second)
  const offset = multiply(
    add(
      multiply(cross(second, normalRaw), firstLengthSquared),
      multiply(cross(normalRaw, first), secondLengthSquared),
    ),
    1 / (2 * normalLengthSquared),
  )
  const center = add(start, offset)
  const radius = length(subtract(start, center))
  const basis = curveBasis(normal)
  if (!basis || radius <= CURVE_EPSILON || !Number.isFinite(radius)) {
    throw new RangeError('Circular arc requires a finite positive radius')
  }
  const startAngle = angleForPoint(start, center, basis)
  const throughAngle = angleForPoint(through, center, basis)
  const endAngle = angleForPoint(end, center, basis)
  const counterClockwiseSweep = positiveAngle(endAngle - startAngle)
  const throughSweep = positiveAngle(throughAngle - startAngle)
  if (
    counterClockwiseSweep <= CURVE_EPSILON ||
    Math.abs(Math.PI * 2 - counterClockwiseSweep) <= CURVE_EPSILON
  ) {
    throw new RangeError('Circular arc requires distinct start and end angles')
  }
  const signedSweep =
    throughSweep <= counterClockwiseSweep + CURVE_EPSILON
      ? counterClockwiseSweep
      : -(Math.PI * 2 - counterClockwiseSweep)
  const signedThroughSweep = signedSweep >= 0 ? throughSweep : -(Math.PI * 2 - throughSweep)
  if (Math.abs(signedThroughSweep) <= CURVE_EPSILON) {
    throw new RangeError('Circular arc requires a distinct through point')
  }
  return {
    center,
    normal,
    radius,
    startAngle,
    throughAngle: startAngle + signedThroughSweep,
    endAngle: startAngle + signedSweep,
  }
}

export function createCircularArcFaceBody(
  start: readonly [number, number, number],
  through: readonly [number, number, number],
  end: readonly [number, number, number],
): BodyNodeType {
  const circle = circleFromThreePoints(start, through, end)
  return BodyNode.parse({
    shells: [{ id: 'shell:0', faceIds: ['face:0'] }],
    vertices: [
      { id: 'vertex:0', position: [...start] },
      { id: 'vertex:1', position: [...through] },
      { id: 'vertex:2', position: [...end] },
    ],
    halfEdges: [
      {
        id: 'edge:0',
        vertexId: 'vertex:0',
        nextId: 'edge:1',
        loopId: 'loop:0',
        curveId: 'curve:0',
      },
      {
        id: 'edge:1',
        vertexId: 'vertex:1',
        nextId: 'edge:2',
        loopId: 'loop:0',
        curveId: 'curve:1',
      },
      { id: 'edge:2', vertexId: 'vertex:2', nextId: 'edge:0', loopId: 'loop:0' },
    ],
    loops: [{ id: 'loop:0', faceId: 'face:0', kind: 'outer' }],
    faces: [{ id: 'face:0', outerLoopId: 'loop:0' }],
    curves: [
      {
        id: 'curve:0',
        kind: 'circular-arc',
        center: circle.center,
        normal: circle.normal,
        radius: circle.radius,
        startAngle: circle.startAngle,
        endAngle: circle.throughAngle,
      },
      {
        id: 'curve:1',
        kind: 'circular-arc',
        center: circle.center,
        normal: circle.normal,
        radius: circle.radius,
        startAngle: circle.throughAngle,
        endAngle: circle.endAngle,
      },
    ],
  })
}

export function sampleBodyCurve(
  curve: BodyCurve,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  segments = DEFAULT_BODY_CURVE_SEGMENTS,
): BodyPoint3[] {
  if (curve.kind === 'line') return [[...start], [...end]]
  if (!Number.isInteger(segments) || segments < 2 || segments > 256) {
    throw new RangeError('Body curve sampling requires 2..256 segments')
  }
  const basis = curveBasis(curve.normal)
  if (!basis) return [[...start], [...end]]
  const points = Array.from({ length: segments + 1 }, (_, index) =>
    arcPoint(
      curve,
      basis,
      curve.startAngle + ((curve.endAngle - curve.startAngle) * index) / segments,
    ),
  )
  points[0] = [...start]
  points[points.length - 1] = [...end]
  return points
}

export function getBodyLoopBoundaryPoints(
  body: BodyNodeType,
  loopId: string,
  segments = DEFAULT_BODY_CURVE_SEGMENTS,
): BodyPoint3[] {
  const loopEdges = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const first = loopEdges[0]
  if (!first) return []
  const edgesById = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  const verticesById = new Map(body.vertices.map((vertex) => [vertex.id, vertex]))
  const curvesById = new Map(body.curves.map((curve) => [curve.id, curve]))
  const points: BodyPoint3[] = []
  const visited = new Set<string>()
  let current = first
  while (!visited.has(current.id)) {
    visited.add(current.id)
    const start = verticesById.get(current.vertexId)?.position
    const next = edgesById.get(current.nextId)
    const end = next ? verticesById.get(next.vertexId)?.position : undefined
    if (!start || !end || !next || next.loopId !== loopId) return []
    const curve = current.curveId ? curvesById.get(current.curveId) : undefined
    const edgePoints: BodyPoint3[] = curve
      ? sampleBodyCurve(curve, start, end, segments)
      : [[...start] as BodyPoint3, [...end] as BodyPoint3]
    points.push(...edgePoints.slice(0, -1))
    current = next
  }
  return current.id === first.id && visited.size === loopEdges.length ? points : []
}
