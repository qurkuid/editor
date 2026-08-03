import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'

type Point2 = [number, number]
type Point3 = [number, number, number]

export type CreateRoundedRectangularFrameBodyOptions = {
  width: number
  height: number
  depth: number
  openingWidth: number
  openingHeight: number
  topCornerRadius: number
  origin?: Point3
  arcSegments?: number
  id?: string
  name?: string
}

function assertPositive(value: number, label: string) {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${label} must be a positive finite number`)
  }
}

function roundedTopOutline(
  width: number,
  height: number,
  radius: number,
  segments: number,
): Point2[] {
  if (radius === 0) {
    return [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]
  }
  const points: Point2[] = [
    [0, 0],
    [width, 0],
    [width, height - radius],
  ]
  for (let index = 1; index <= segments; index += 1) {
    const angle = (index / segments) * (Math.PI / 2)
    points.push([
      width - radius + Math.cos(angle) * radius,
      height - radius + Math.sin(angle) * radius,
    ])
  }
  points.push([radius, height])
  for (let index = 1; index <= segments; index += 1) {
    const angle = Math.PI / 2 + (index / segments) * (Math.PI / 2)
    points.push([radius + Math.cos(angle) * radius, height - radius + Math.sin(angle) * radius])
  }
  return points
}

export function createRoundedRectangularFrameBody({
  width,
  height,
  depth,
  openingWidth,
  openingHeight,
  topCornerRadius,
  origin = [0, 0, 0],
  arcSegments = 8,
  id,
  name = 'Rounded rectangular frame wall',
}: CreateRoundedRectangularFrameBodyOptions): BodyNodeType {
  assertPositive(width, 'Frame width')
  assertPositive(height, 'Frame height')
  assertPositive(depth, 'Frame depth')
  assertPositive(openingWidth, 'Opening width')
  assertPositive(openingHeight, 'Opening height')
  if (!(Number.isFinite(topCornerRadius) && topCornerRadius >= 0)) {
    throw new RangeError('Top corner radius must be a non-negative finite number')
  }
  if (!(Number.isInteger(arcSegments) && arcSegments >= 2)) {
    throw new RangeError('Arc segments must be an integer of at least 2')
  }
  if (openingWidth >= width || openingHeight >= height) {
    throw new RangeError('Opening dimensions must fit inside the outer frame')
  }
  if (topCornerRadius > Math.min(width / 2, height)) {
    throw new RangeError('Top corner radius exceeds the outer frame bounds')
  }

  const openingOffsetX = (width - openingWidth) / 2
  const openingOffsetY = (height - openingHeight) / 2
  const [originX, originY, originZ] = origin
  const outer = roundedTopOutline(width, height, topCornerRadius, arcSegments).map<Point2>(
    ([x, y]) => [originX + x, originY + y],
  )
  const inner: Point2[] = [
    [originX + openingOffsetX, originY + openingOffsetY],
    [originX + openingOffsetX + openingWidth, originY + openingOffsetY],
    [originX + openingOffsetX + openingWidth, originY + openingOffsetY + openingHeight],
    [originX + openingOffsetX, originY + openingOffsetY + openingHeight],
  ]

  const vertices: Array<{ id: string; position: Point3 }> = []
  const vertexIds = {
    frontOuter: outer.map((point, index) => {
      const vertexId = `vertex:front:outer:${index}`
      vertices.push({ id: vertexId, position: [point[0], point[1], originZ] })
      return vertexId
    }),
    frontInner: inner.map((point, index) => {
      const vertexId = `vertex:front:inner:${index}`
      vertices.push({ id: vertexId, position: [point[0], point[1], originZ] })
      return vertexId
    }),
    backOuter: outer.map((point, index) => {
      const vertexId = `vertex:back:outer:${index}`
      vertices.push({ id: vertexId, position: [point[0], point[1], originZ + depth] })
      return vertexId
    }),
    backInner: inner.map((point, index) => {
      const vertexId = `vertex:back:inner:${index}`
      vertices.push({ id: vertexId, position: [point[0], point[1], originZ + depth] })
      return vertexId
    }),
  }

  const faces: Array<{
    id: string
    outerLoopId: string
    innerLoopIds?: string[]
  }> = []
  const loops: Array<{ id: string; faceId: string; kind: 'outer' | 'inner' }> = []
  const halfEdges: Array<{
    id: string
    vertexId: string
    twinId: string | null
    nextId: string
    loopId: string
  }> = []
  const directedEdges = new Map<string, string>()

  function addLoop(faceId: string, loopId: string, kind: 'outer' | 'inner', ids: string[]) {
    loops.push({ id: loopId, faceId, kind })
    const edgeIds = ids.map((_, index) => `edge:${loopId}:${index}`)
    ids.forEach((vertexId, index) => {
      const nextVertexId = ids[(index + 1) % ids.length]!
      const edgeId = edgeIds[index]!
      halfEdges.push({
        id: edgeId,
        vertexId,
        twinId: null,
        nextId: edgeIds[(index + 1) % edgeIds.length]!,
        loopId,
      })
      directedEdges.set(`${vertexId}\u0000${nextVertexId}`, edgeId)
    })
  }

  function addFace(faceId: string, ids: string[], innerIds?: string[]) {
    const outerLoopId = `loop:${faceId}:outer`
    const innerLoopIds = innerIds ? [`loop:${faceId}:inner`] : []
    faces.push({ id: faceId, outerLoopId, innerLoopIds })
    addLoop(faceId, outerLoopId, 'outer', ids)
    if (innerIds) addLoop(faceId, innerLoopIds[0]!, 'inner', innerIds)
  }

  addFace('face:front', vertexIds.frontOuter, [...vertexIds.frontInner].reverse())
  addFace('face:back', [...vertexIds.backOuter].reverse(), vertexIds.backInner)

  for (let index = 0; index < vertexIds.frontOuter.length; index += 1) {
    const next = (index + 1) % vertexIds.frontOuter.length
    addFace(`face:outer:${index}`, [
      vertexIds.frontOuter[next]!,
      vertexIds.frontOuter[index]!,
      vertexIds.backOuter[index]!,
      vertexIds.backOuter[next]!,
    ])
  }
  for (let index = 0; index < vertexIds.frontInner.length; index += 1) {
    const next = (index + 1) % vertexIds.frontInner.length
    addFace(`face:inner:${index}`, [
      vertexIds.frontInner[index]!,
      vertexIds.frontInner[next]!,
      vertexIds.backInner[next]!,
      vertexIds.backInner[index]!,
    ])
  }

  for (const edge of halfEdges) {
    const next = halfEdges.find((candidate) => candidate.id === edge.nextId)!
    edge.twinId = directedEdges.get(`${next.vertexId}\u0000${edge.vertexId}`) ?? null
  }

  return BodyNode.parse({
    ...(id ? { id } : {}),
    name,
    shells: [{ id: 'shell:0', faceIds: faces.map((face) => face.id) }],
    vertices,
    halfEdges,
    loops,
    faces,
    metadata: {
      primitive: 'rounded-rectangular-frame',
      width,
      height,
      depth,
      openingWidth,
      openingHeight,
      openingOffsetX,
      openingOffsetY,
      topCornerRadius,
      arcSegments,
    },
  })
}
