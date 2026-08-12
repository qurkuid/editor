import type { BodyFace, BodyNode as BodyNodeType } from '../schema/nodes/body'
import {
  type BodyTopologyDiagnosticCode,
  getBodyLoopVertices,
  validateBodyTopology,
} from './body-topology'

const EPSILON = 1e-9

export type BodySolidDiagnosticCode =
  | BodyTopologyDiagnosticCode
  | 'solid.open'
  | 'solid.non-manifold'
  | 'solid.twin-orientation'
  | 'solid.disconnected'
  | 'solid.curved-edge'
  | 'face.degenerate'
  | 'face.nonplanar'
  | 'solid.volume.nonfinite'
  | 'solid.volume.zero'

export type BodySolidDiagnostic = {
  readonly code: BodySolidDiagnosticCode
  readonly message: string
  readonly featureIds: readonly string[]
}

export type BodySolidInspection = {
  readonly validTopology: boolean
  readonly closed: boolean
  readonly manifold: boolean
  readonly consistentlyOriented: boolean
  readonly connected: boolean
  readonly connectedShells: number
  readonly degenerateFaceIds: readonly string[]
  readonly nonplanarFaceIds: readonly string[]
  readonly signedVolume: number | null
  readonly volume: number | null
  readonly validSolid: boolean
  readonly diagnostics: readonly BodySolidDiagnostic[]
}

type Vec3 = readonly [number, number, number]

const byId = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]))

function addDiagnostic(
  diagnostics: BodySolidDiagnostic[],
  code: BodySolidDiagnosticCode,
  message: string,
  featureIds: readonly string[],
): void {
  diagnostics.push({ code, message, featureIds })
}

function subtract(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2])
}

function newellNormal(points: readonly Vec3[]): [number, number, number] {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    nx += (current[1] - next[1]) * (current[2] + next[2])
    ny += (current[2] - next[2]) * (current[0] + next[0])
    nz += (current[0] - next[0]) * (current[1] + next[1])
  }
  return [nx, ny, nz]
}

function loopPoints(body: BodyNodeType, loopId: string): Vec3[] {
  return getBodyLoopVertices(body, loopId)
}

function facePoints(body: BodyNodeType, face: BodyFace): Vec3[] {
  return loopPoints(body, face.outerLoopId)
}

function faceAreaNormal(body: BodyNodeType, face: BodyFace): [number, number, number] {
  return newellNormal(facePoints(body, face))
}

function isPlanar(points: readonly Vec3[], normal: Vec3): boolean {
  if (points.length < 3) return false
  const normalLength = length(normal)
  if (normalLength <= EPSILON) return false
  const origin = points[0]!
  return points.every(
    (point) => Math.abs(dot(subtract(point, origin), normal)) <= EPSILON * normalLength,
  )
}

function signedLoopVolume(points: readonly Vec3[]): number {
  if (points.length < 3) return 0
  const origin = points[0]!
  let volume = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = subtract(points[index]!, origin)
    const b = subtract(points[index + 1]!, origin)
    volume += dot(origin, cross(a, b)) / 6
  }
  return volume
}

function faceLoopIds(body: BodyNodeType, face: BodyFace): string[] {
  return [face.outerLoopId, ...face.innerLoopIds]
}

export function inspectBodySolid(body: BodyNodeType): BodySolidInspection {
  const diagnostics: BodySolidDiagnostic[] = []
  const topology = validateBodyTopology(body)
  for (const diagnostic of topology.diagnostics) {
    addDiagnostic(
      diagnostics,
      diagnostic.code,
      `Invalid Body topology: ${diagnostic.code}`,
      diagnostic.featureIds,
    )
  }

  const halfEdges = byId(body.halfEdges)
  const loops = byId(body.loops)
  const faceByLoop = new Map(body.loops.map((loop) => [loop.id, loop.faceId]))

  let closed = true
  let consistentlyOriented = true
  const undirectedEdges = new Map<string, string[]>()
  const faceNeighbors = new Map<string, Set<string>>()
  for (const face of body.faces) faceNeighbors.set(face.id, new Set())

  for (const edge of body.halfEdges) {
    const next = halfEdges.get(edge.nextId)
    if (!edge.twinId) {
      closed = false
      addDiagnostic(diagnostics, 'solid.open', `Open half-edge ${edge.id}`, [edge.id])
    } else {
      const twin = halfEdges.get(edge.twinId)
      if (!twin || twin.twinId !== edge.id) {
        closed = false
        consistentlyOriented = false
        addDiagnostic(
          diagnostics,
          'solid.twin-orientation',
          `Half-edge twin is not reciprocal: ${edge.id}`,
          [edge.id, edge.twinId],
        )
      } else if (next) {
        const twinNext = halfEdges.get(twin.nextId)
        if (!twinNext || twinNext.vertexId !== edge.vertexId || twin.vertexId !== next.vertexId) {
          consistentlyOriented = false
          addDiagnostic(
            diagnostics,
            'solid.twin-orientation',
            `Twin endpoints are not oppositely oriented: ${edge.id}`,
            [edge.id, twin.id],
          )
        }

        const firstFace = faceByLoop.get(edge.loopId)
        const secondFace = faceByLoop.get(twin.loopId)
        if (firstFace && secondFace && firstFace !== secondFace) {
          faceNeighbors.get(firstFace)?.add(secondFace)
          faceNeighbors.get(secondFace)?.add(firstFace)
        }
      }
    }

    if (next) {
      const key = [edge.vertexId, next.vertexId].sort().join('|')
      undirectedEdges.set(key, [...(undirectedEdges.get(key) ?? []), edge.id])
    }
    if (edge.curveId) {
      addDiagnostic(
        diagnostics,
        'solid.curved-edge',
        `Curved edge is not a planar solid edge: ${edge.id}`,
        [edge.id, edge.curveId],
      )
    }
  }

  let manifold = true
  for (const [key, edgeIds] of undirectedEdges) {
    if (edgeIds.length !== 2) {
      manifold = false
      addDiagnostic(
        diagnostics,
        'solid.non-manifold',
        `Undirected edge ${key} has ${edgeIds.length} half-edges`,
        edgeIds,
      )
    }
  }
  if (!closed) manifold = false

  const degenerateFaceIds: string[] = []
  const nonplanarFaceIds: string[] = []
  let signedVolume = 0
  let volumeFinite = true
  for (const face of body.faces) {
    const points = facePoints(body, face)
    const normal = faceAreaNormal(body, face)
    if (points.length < 3 || length(normal) <= EPSILON) {
      degenerateFaceIds.push(face.id)
      addDiagnostic(diagnostics, 'face.degenerate', `Face has zero area: ${face.id}`, [
        face.id,
        face.outerLoopId,
      ])
    } else if (!isPlanar(points, normal)) {
      nonplanarFaceIds.push(face.id)
      addDiagnostic(diagnostics, 'face.nonplanar', `Face is non-planar: ${face.id}`, [
        face.id,
        face.outerLoopId,
      ])
    }

    for (const loopId of faceLoopIds(body, face)) {
      const loop = loops.get(loopId)
      if (!loop) continue
      const loopVolume = signedLoopVolume(loopPoints(body, loop.id))
      signedVolume += loop.kind === 'inner' ? -loopVolume : loopVolume
    }
  }

  if (!Number.isFinite(signedVolume)) {
    volumeFinite = false
    addDiagnostic(
      diagnostics,
      'solid.volume.nonfinite',
      'Solid volume is not finite',
      body.faces.map((face) => face.id),
    )
  }
  const volume = volumeFinite ? Math.abs(signedVolume) : null
  if (volume !== null && volume <= EPSILON) {
    addDiagnostic(
      diagnostics,
      'solid.volume.zero',
      'Solid volume is zero',
      body.faces.map((face) => face.id),
    )
  }

  let connectedShells = 0
  const unvisitedFaces = new Set(body.faces.map((face) => face.id))
  while (unvisitedFaces.size > 0) {
    const start = unvisitedFaces.values().next().value as string
    connectedShells += 1
    const queue = [start]
    unvisitedFaces.delete(start)
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const neighbor of faceNeighbors.get(current) ?? []) {
        if (!unvisitedFaces.delete(neighbor)) continue
        queue.push(neighbor)
      }
    }
  }
  const connected = connectedShells === 1 && body.faces.length > 0
  if (!connected) {
    addDiagnostic(
      diagnostics,
      'solid.disconnected',
      `Solid has ${connectedShells} connected face component(s)`,
      body.faces.map((face) => face.id),
    )
  }

  return {
    validTopology: topology.valid,
    closed,
    manifold,
    consistentlyOriented,
    connected,
    connectedShells,
    degenerateFaceIds,
    nonplanarFaceIds,
    signedVolume: volumeFinite ? signedVolume : null,
    volume,
    validSolid:
      topology.valid &&
      closed &&
      manifold &&
      consistentlyOriented &&
      connected &&
      degenerateFaceIds.length === 0 &&
      nonplanarFaceIds.length === 0 &&
      volumeFinite &&
      volume !== null &&
      volume > EPSILON,
    diagnostics,
  }
}
