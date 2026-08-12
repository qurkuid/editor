import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'

export type BodyTopologyDiagnosticCode =
  | 'feature.id.duplicate'
  | 'half-edge.vertex.missing'
  | 'half-edge.twin.missing'
  | 'half-edge.twin.not-reciprocal'
  | 'half-edge.next.missing'
  | 'half-edge.next.loop-mismatch'
  | 'half-edge.loop.missing'
  | 'half-edge.curve.missing'
  | 'loop.face.missing'
  | 'loop.edges.too-few'
  | 'loop.cycle.invalid'
  | 'face.outer-loop.missing'
  | 'face.outer-loop.invalid'
  | 'face.inner-loop.missing'
  | 'face.inner-loop.invalid'
  | 'shell.face.missing'
  | 'face.shell.missing'
  | 'face.shell.duplicate'

export type BodyTopologyDiagnostic = {
  code: BodyTopologyDiagnosticCode
  featureIds: string[]
}

export type BodyTopologyValidation = {
  valid: boolean
  diagnostics: BodyTopologyDiagnostic[]
}

export type TopologyRemap = {
  preserved: string[]
  created: string[]
  deleted: string[]
  split: Record<string, string[]>
  merged: Record<string, string>
}

export type PushPullBodyResult = {
  body: BodyNodeType
  movedFaceId: string
  createdFaceIds: string[]
  remap: TopologyRemap
}

type CreateRectangleBodyOptions = {
  width: number
  depth: number
  origin?: [number, number, number]
}

export function createPlanarFaceBody(
  points: ReadonlyArray<readonly [number, number, number]>,
): BodyNodeType {
  if (
    points.length < 3 ||
    points.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))
  ) {
    throw new RangeError('Planar face requires at least three finite points')
  }
  const vertexIds = points.map((_, index) => `vertex:${index}`)
  const edgeIds = points.map((_, index) => `edge:${index}`)
  return BodyNode.parse({
    shells: [{ id: 'shell:0', faceIds: ['face:0'] }],
    vertices: points.map((position, index) => ({ id: vertexIds[index], position })),
    halfEdges: points.map((_, index) => ({
      id: edgeIds[index],
      vertexId: vertexIds[index],
      nextId: edgeIds[(index + 1) % edgeIds.length],
      loopId: 'loop:0',
    })),
    loops: [{ id: 'loop:0', faceId: 'face:0', kind: 'outer' }],
    faces: [{ id: 'face:0', outerLoopId: 'loop:0' }],
  })
}

export function getBodyLoopVertices(
  body: BodyNodeType,
  loopId: string,
): Array<[number, number, number]> {
  const edges = byId(body.halfEdges)
  const vertices = byId(body.vertices)
  const loopEdges = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const start = loopEdges[0]
  if (!start) return []

  const points: Array<[number, number, number]> = []
  const visited = new Set<string>()
  let current = start
  while (!visited.has(current.id)) {
    visited.add(current.id)
    const vertex = vertices.get(current.vertexId)
    if (!vertex) return []
    points.push(vertex.position)
    const next = edges.get(current.nextId)
    if (!next || next.loopId !== loopId) return []
    current = next
  }
  return current.id === start.id && visited.size === loopEdges.length ? points : []
}

const byId = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]))

const sortedById = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id))

function getLoopHalfEdges(body: BodyNodeType, loopId: string) {
  const edges = byId(body.halfEdges)
  const candidates = body.halfEdges.filter((edge) => edge.loopId === loopId)
  const start = candidates[0]
  if (!start) return []
  const ordered = []
  const visited = new Set<string>()
  let current = start
  while (!visited.has(current.id)) {
    visited.add(current.id)
    ordered.push(current)
    const next = edges.get(current.nextId)
    if (!next || next.loopId !== loopId) return []
    current = next
  }
  return current.id === start.id && ordered.length === candidates.length ? ordered : []
}

function canonicalFaceNormal(points: ReadonlyArray<readonly [number, number, number]>) {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current[1] - next[1]) * (current[2] + next[2])
    y += (current[2] - next[2]) * (current[0] + next[0])
    z += (current[0] - next[0]) * (current[1] + next[1])
  }
  const length = Math.hypot(x, y, z)
  if (length <= Number.EPSILON) throw new RangeError('Push/pull requires a non-degenerate face')
  const normal: [number, number, number] = [x / length, y / length, z / length]
  const dominant = normal.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(normal[best]!) ? index : best),
    0,
  )
  if (normal[dominant]! < 0) return normal.map((value) => -value) as [number, number, number]
  return normal
}

export function getBodyFaceFrame(
  body: BodyNodeType,
  faceId: string,
): {
  centroid: [number, number, number]
  normal: [number, number, number]
} {
  const face = body.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Body face not found: ${faceId}`)
  const points = getBodyLoopVertices(body, face.outerLoopId)
  if (points.length < 3) throw new RangeError(`Body face has an invalid outer loop: ${faceId}`)
  const centroid = points.reduce<[number, number, number]>(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0],
  )
  return {
    centroid: centroid.map((value) => value / points.length) as [number, number, number],
    normal: canonicalFaceNormal(points),
  }
}

export function pushPullBodyFace(
  source: BodyNodeType,
  faceId: string,
  distance: number,
): PushPullBodyResult {
  if (!Number.isFinite(distance) || distance === 0) {
    throw new RangeError('Push/pull requires a non-zero finite distance')
  }
  const face = source.faces.find((candidate) => candidate.id === faceId)
  if (!face) throw new RangeError(`Push/pull face not found: ${faceId}`)
  if (source.faces.length !== 1 || face.innerLoopIds.length > 0) {
    throw new RangeError('Push/pull currently requires one planar face without holes')
  }
  const sourceEdges = getLoopHalfEdges(source, face.outerLoopId)
  const sourceVertices = byId(source.vertices)
  if (sourceEdges.length < 3 || sourceEdges.some((edge) => edge.twinId !== null)) {
    throw new RangeError('Push/pull currently requires an open planar face')
  }
  const points = sourceEdges.map((edge) => sourceVertices.get(edge.vertexId)?.position)
  if (points.some((point) => !point)) throw new RangeError('Push/pull face has missing vertices')
  const facePoints = points as ReadonlyArray<readonly [number, number, number]>
  const normal = canonicalFaceNormal(facePoints)
  const revision = source.revision + 1
  const vertexCount = sourceEdges.length
  const topVertexIds = sourceEdges.map((edge) => edge.vertexId)
  const baseVertexIds = topVertexIds.map((id) => `${id}:base:${revision}`)
  const baseLoopId = `${face.outerLoopId}:base:${revision}`
  const baseFaceId = `${face.id}:base:${revision}`
  const sideLoopIds = sourceEdges.map((edge) => `${face.outerLoopId}:side:${edge.id}:${revision}`)
  const sideFaceIds = sourceEdges.map((edge) => `${face.id}:side:${edge.id}:${revision}`)
  const baseEdgeIds = sourceEdges.map((edge) => `${edge.id}:base:${revision}`)
  const sideEdgeIds = sourceEdges.map((edge) => ({
    top: `${edge.id}:side-top:${revision}`,
    down: `${edge.id}:side-down:${revision}`,
    bottom: `${edge.id}:side-bottom:${revision}`,
    up: `${edge.id}:side-up:${revision}`,
  }))
  const defaultMaterial = source.bodyDefaults.materialRef
    ? { materialRef: source.bodyDefaults.materialRef }
    : {}
  const baseSurface = {
    ...defaultMaterial,
    uvOrigin: face.surface.uvOrigin,
    uvU: face.surface.uvU,
    uvV: face.surface.uvV,
  }
  const sideSurfaces = sourceEdges.map((_, index) => {
    const current = facePoints[index]!
    const next = facePoints[(index + 1) % vertexCount]!
    const edge = [next[0] - current[0], next[1] - current[1], next[2] - current[2]] as const
    const edgeLength = Math.hypot(edge[0], edge[1], edge[2])
    return {
      ...defaultMaterial,
      uvOrigin: [...current] as [number, number, number],
      uvU: [edge[0] / edgeLength, edge[1] / edgeLength, edge[2] / edgeLength] as [
        number,
        number,
        number,
      ],
      uvV: [...normal] as [number, number, number],
    }
  })

  const movedVertices = source.vertices.map((vertex) =>
    topVertexIds.includes(vertex.id)
      ? {
          ...vertex,
          position: [
            vertex.position[0] + normal[0] * distance,
            vertex.position[1] + normal[1] * distance,
            vertex.position[2] + normal[2] * distance,
          ] as [number, number, number],
        }
      : vertex,
  )
  const baseVertices = sourceEdges.map((edge, index) => ({
    id: baseVertexIds[index]!,
    position: [...sourceVertices.get(edge.vertexId)!.position] as [number, number, number],
  }))
  const topEdges = source.halfEdges.map((edge) => {
    const index = sourceEdges.findIndex((candidate) => candidate.id === edge.id)
    return index === -1 ? edge : { ...edge, twinId: sideEdgeIds[index]!.top }
  })
  const baseEdges = sourceEdges.map((_, index) => ({
    id: baseEdgeIds[index]!,
    vertexId: baseVertexIds[(index + 1) % vertexCount]!,
    twinId: sideEdgeIds[index]!.bottom,
    nextId: baseEdgeIds[(index - 1 + vertexCount) % vertexCount]!,
    loopId: baseLoopId,
  }))
  const sideEdges = sourceEdges.flatMap((_, index) => {
    const ids = sideEdgeIds[index]!
    return [
      {
        id: ids.top,
        vertexId: topVertexIds[(index + 1) % vertexCount]!,
        twinId: sourceEdges[index]!.id,
        nextId: ids.down,
        loopId: sideLoopIds[index]!,
      },
      {
        id: ids.down,
        vertexId: topVertexIds[index]!,
        twinId: sideEdgeIds[(index - 1 + vertexCount) % vertexCount]!.up,
        nextId: ids.bottom,
        loopId: sideLoopIds[index]!,
      },
      {
        id: ids.bottom,
        vertexId: baseVertexIds[index]!,
        twinId: baseEdgeIds[index]!,
        nextId: ids.up,
        loopId: sideLoopIds[index]!,
      },
      {
        id: ids.up,
        vertexId: baseVertexIds[(index + 1) % vertexCount]!,
        twinId: sideEdgeIds[(index + 1) % vertexCount]!.down,
        nextId: ids.top,
        loopId: sideLoopIds[index]!,
      },
    ]
  })
  const createdFaceIds = [baseFaceId, ...sideFaceIds]
  const body = BodyNode.parse({
    ...source,
    revision,
    vertices: [...movedVertices, ...baseVertices],
    halfEdges: [...topEdges, ...baseEdges, ...sideEdges],
    loops: [
      ...source.loops,
      { id: baseLoopId, faceId: baseFaceId, kind: 'outer' },
      ...sideLoopIds.map((id, index) => ({ id, faceId: sideFaceIds[index]!, kind: 'outer' })),
    ],
    faces: [
      ...source.faces,
      { id: baseFaceId, outerLoopId: baseLoopId, surface: baseSurface },
      ...sideFaceIds.map((id, index) => ({
        id,
        outerLoopId: sideLoopIds[index]!,
        surface: sideSurfaces[index],
      })),
    ],
    shells: source.shells.map((shell) =>
      shell.faceIds.includes(faceId)
        ? { ...shell, faceIds: [...shell.faceIds, ...createdFaceIds] }
        : shell,
    ),
  })
  const preserved = [
    ...source.vertices,
    ...source.halfEdges,
    ...source.loops,
    ...source.faces,
    ...source.shells,
    ...source.curves,
  ].map(({ id }) => id)
  const created = [
    ...baseVertices,
    ...baseEdges,
    ...sideEdges,
    ...body.loops.filter((loop) => !source.loops.some((candidate) => candidate.id === loop.id)),
    ...body.faces.filter(
      (candidate) => !source.faces.some((existing) => existing.id === candidate.id),
    ),
  ].map(({ id }) => id)

  return {
    body,
    movedFaceId: faceId,
    createdFaceIds,
    remap: { preserved, created, deleted: [], split: {}, merged: {} },
  }
}

export function validateBodyTopology(body: BodyNodeType): BodyTopologyValidation {
  const diagnostics: BodyTopologyDiagnostic[] = []
  const vertices = byId(body.vertices)
  const halfEdges = byId(body.halfEdges)
  const loops = byId(body.loops)
  const faces = byId(body.faces)
  const curves = byId(body.curves)
  const halfEdgesByLoop = new Map<string, typeof body.halfEdges>()
  for (const edge of body.halfEdges) {
    halfEdgesByLoop.set(edge.loopId, [...(halfEdgesByLoop.get(edge.loopId) ?? []), edge])
  }
  const featureIds = [
    ...body.vertices,
    ...body.halfEdges,
    ...body.loops,
    ...body.faces,
    ...body.shells,
    ...body.curves,
  ].map(({ id }) => id)
  const seenIds = new Set<string>()

  for (const id of featureIds) {
    if (seenIds.has(id)) diagnostics.push({ code: 'feature.id.duplicate', featureIds: [id] })
    seenIds.add(id)
  }

  for (const edge of body.halfEdges) {
    if (!vertices.has(edge.vertexId)) {
      diagnostics.push({
        code: 'half-edge.vertex.missing',
        featureIds: [edge.id, edge.vertexId],
      })
    }
    if (edge.twinId) {
      const twin = halfEdges.get(edge.twinId)
      if (!twin) {
        diagnostics.push({
          code: 'half-edge.twin.missing',
          featureIds: [edge.id, edge.twinId],
        })
      } else if (twin.twinId !== edge.id) {
        diagnostics.push({
          code: 'half-edge.twin.not-reciprocal',
          featureIds: [edge.id, twin.id],
        })
      }
    }
    const next = halfEdges.get(edge.nextId)
    if (!next) {
      diagnostics.push({ code: 'half-edge.next.missing', featureIds: [edge.id, edge.nextId] })
    } else if (next.loopId !== edge.loopId) {
      diagnostics.push({
        code: 'half-edge.next.loop-mismatch',
        featureIds: [edge.id, next.id, edge.loopId],
      })
    }
    if (!loops.has(edge.loopId)) {
      diagnostics.push({ code: 'half-edge.loop.missing', featureIds: [edge.id, edge.loopId] })
    }
    if (edge.curveId && !curves.has(edge.curveId)) {
      diagnostics.push({ code: 'half-edge.curve.missing', featureIds: [edge.id, edge.curveId] })
    }
  }

  for (const loop of body.loops) {
    if (!faces.has(loop.faceId)) {
      diagnostics.push({ code: 'loop.face.missing', featureIds: [loop.id, loop.faceId] })
    }
    const loopEdges = halfEdgesByLoop.get(loop.id) ?? []
    if (loopEdges.length < 3) {
      diagnostics.push({ code: 'loop.edges.too-few', featureIds: [loop.id] })
      continue
    }
    const loopEdgeIds = new Set(loopEdges.map(({ id }) => id))
    if (loopEdges.some((edge) => !loopEdgeIds.has(edge.nextId))) continue

    const visited = new Set<string>()
    const startId = loopEdges[0]?.id
    let currentId = startId
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      currentId = halfEdges.get(currentId)?.nextId
    }
    if (currentId !== startId || visited.size !== loopEdges.length) {
      diagnostics.push({ code: 'loop.cycle.invalid', featureIds: [loop.id] })
    }
  }

  for (const face of body.faces) {
    const outerLoop = loops.get(face.outerLoopId)
    if (!outerLoop) {
      diagnostics.push({
        code: 'face.outer-loop.missing',
        featureIds: [face.id, face.outerLoopId],
      })
    } else if (outerLoop.faceId !== face.id || outerLoop.kind !== 'outer') {
      diagnostics.push({
        code: 'face.outer-loop.invalid',
        featureIds: [face.id, outerLoop.id],
      })
    }
    for (const loopId of face.innerLoopIds) {
      const innerLoop = loops.get(loopId)
      if (!innerLoop) {
        diagnostics.push({ code: 'face.inner-loop.missing', featureIds: [face.id, loopId] })
      } else if (innerLoop.faceId !== face.id || innerLoop.kind !== 'inner') {
        diagnostics.push({ code: 'face.inner-loop.invalid', featureIds: [face.id, loopId] })
      }
    }
  }

  const shellMembership = new Map<string, number>()
  for (const shell of body.shells) {
    for (const faceId of shell.faceIds) {
      if (!faces.has(faceId)) {
        diagnostics.push({ code: 'shell.face.missing', featureIds: [shell.id, faceId] })
        continue
      }
      shellMembership.set(faceId, (shellMembership.get(faceId) ?? 0) + 1)
    }
  }
  for (const face of body.faces) {
    const membership = shellMembership.get(face.id) ?? 0
    if (membership === 0) {
      diagnostics.push({ code: 'face.shell.missing', featureIds: [face.id] })
    } else if (membership > 1) {
      diagnostics.push({ code: 'face.shell.duplicate', featureIds: [face.id] })
    }
  }

  return { valid: diagnostics.length === 0, diagnostics }
}

export function getBodySemanticHash(body: BodyNodeType): string {
  const semanticBody = {
    shells: sortedById(body.shells).map((shell) => ({
      ...shell,
      faceIds: [...shell.faceIds].sort(),
    })),
    vertices: sortedById(body.vertices),
    halfEdges: sortedById(body.halfEdges),
    loops: sortedById(body.loops),
    faces: sortedById(body.faces).map((face) => ({
      ...face,
      innerLoopIds: [...face.innerLoopIds].sort(),
      surface: {
        materialRef: face.surface.materialRef,
        uvOrigin: face.surface.uvOrigin,
        uvU: face.surface.uvU,
        uvV: face.surface.uvV,
      },
    })),
    curves: sortedById(body.curves),
    bodyDefaults: body.bodyDefaults,
  }
  const value = JSON.stringify(semanticBody)
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `body-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createRectangleBody({
  width,
  depth,
  origin = [0, 0, 0],
}: CreateRectangleBodyOptions): BodyNodeType {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(depth) && depth > 0)) {
    throw new RangeError('Rectangle body dimensions must be positive finite numbers')
  }
  const [x, y, z] = origin
  return createPlanarFaceBody([
    [x, y, z],
    [x + width, y, z],
    [x + width, y, z + depth],
    [x, y, z + depth],
  ])
}
