import {
  type BodyNode,
  type GeometryContext,
  getBodyLoopBoundaryPoints,
  validateBodyTopology,
} from '@pascal-app/core'
import { resolveMaterialRef } from '@pascal-app/viewer'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type Point3 = [number, number, number]

const COPLANAR_EPSILON = 1e-6

function facePlane(points: Point3[]): { normal: Point3; point: Point3 } | undefined {
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
  const length = Math.hypot(nx, ny, nz)
  if (length <= COPLANAR_EPSILON) return undefined
  return { normal: [nx / length, ny / length, nz / length], point: points[0]! }
}

function areCoplanar(
  first: { normal: Point3; point: Point3 },
  second: { normal: Point3; point: Point3 },
): boolean {
  const normalDot =
    first.normal[0] * second.normal[0] +
    first.normal[1] * second.normal[1] +
    first.normal[2] * second.normal[2]
  if (Math.abs(normalDot) < 1 - COPLANAR_EPSILON) return false
  const planeDistance =
    (second.point[0] - first.point[0]) * first.normal[0] +
    (second.point[1] - first.point[1]) * first.normal[1] +
    (second.point[2] - first.point[2]) * first.normal[2]
  return Math.abs(planeDistance) <= COPLANAR_EPSILON
}

function faceProjection(points: Point3[]): (point: Point3) => Vector2 {
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
  const axis =
    Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz)
      ? 'x'
      : Math.abs(ny) >= Math.abs(nz)
        ? 'y'
        : 'z'
  if (axis === 'x') return ([, y, z]) => new Vector2(y, z)
  if (axis === 'y') return ([x, , z]) => new Vector2(x, z)
  return ([x, y]) => new Vector2(x, y)
}

function surfaceCoordinate(point: Point3, origin: Point3, axis: Point3): number {
  const lengthSquared = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2
  if (lengthSquared <= 1e-12) return 0
  return (
    ((point[0] - origin[0]) * axis[0] +
      (point[1] - origin[1]) * axis[1] +
      (point[2] - origin[2]) * axis[2]) /
    lengthSquared
  )
}

export function buildBodyGeometry(body: BodyNode, ctx?: GeometryContext): Group {
  const group = new Group()
  if (!validateBodyTopology(body).valid) return group
  const halfEdgesById = new Map(body.halfEdges.map((edge) => [edge.id, edge]))
  const verticesById = new Map(body.vertices.map((vertex) => [vertex.id, vertex]))
  const loopVertices = (loopId: string): Point3[] =>
    getBodyLoopBoundaryPoints(body, loopId).map((point) => [...point] as Point3)
  const importedFromSketchUp =
    typeof body.metadata === 'object' &&
    body.metadata !== null &&
    !Array.isArray(body.metadata) &&
    body.metadata.source === 'SketchUp'
  const importedMeshes: Mesh[] = []
  const importedMaterials = new Map<string, Material>()

  for (const face of body.faces) {
    const contour = loopVertices(face.outerLoopId)
    if (contour.length < 3) continue
    const holes = face.innerLoopIds.map(loopVertices)
    if (holes.some((hole) => hole.length < 3)) continue
    const project = faceProjection(contour)
    const triangles = ShapeUtils.triangulateShape(
      contour.map(project),
      holes.map((hole) => hole.map(project)),
    )
    const vertices = [contour, ...holes].flat()
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(vertices.flat(), 3))
    geometry.setAttribute(
      'uv',
      new Float32BufferAttribute(
        vertices.flatMap((point) => [
          surfaceCoordinate(point, face.surface.uvOrigin, face.surface.uvU),
          surfaceCoordinate(point, face.surface.uvOrigin, face.surface.uvV),
        ]),
        2,
      ),
    )
    geometry.setIndex(triangles.flat())
    geometry.computeVertexNormals()
    const materialKey = face.surface.materialRef ?? 'default'
    const cachedMaterial = importedFromSketchUp ? importedMaterials.get(materialKey) : undefined
    const resolvedMaterial = cachedMaterial ?? resolveMaterialRef(face.surface.materialRef, ctx?.materials)?.clone()
    if (resolvedMaterial) resolvedMaterial.side = DoubleSide
    const material =
      resolvedMaterial ??
      new MeshStandardMaterial({
          color: '#94a3b8',
          roughness: 0.82,
          metalness: 0,
          side: DoubleSide,
        })
    if (importedFromSketchUp && !importedMaterials.has(materialKey)) {
      importedMaterials.set(materialKey, material)
    }
    const mesh = new Mesh(geometry, material)
    mesh.name = `face:${face.id}`
    mesh.userData = { bodyId: body.id, faceId: face.id, pascalNodeId: body.id }
    if (importedFromSketchUp) {
      mesh.userData.materialKey = materialKey
      importedMeshes.push(mesh)
    }
    else group.add(mesh)
  }

  if (importedMeshes.length > 0) {
    const meshesByMaterial = new Map<string, Mesh[]>()
    for (const mesh of importedMeshes) {
      const key = mesh.userData.materialKey
      meshesByMaterial.set(key, [...(meshesByMaterial.get(key) ?? []), mesh])
    }
    for (const meshes of meshesByMaterial.values()) {
      const mergedGeometry = mergeGeometries(
        meshes.map((mesh) => mesh.geometry),
        false,
      )
      if (!mergedGeometry) continue
      const faceIdsByTriangle = meshes.flatMap((mesh) =>
        Array((mesh.geometry.getIndex()?.count ?? 0) / 3).fill(mesh.userData.faceId),
      )
      const mesh = new Mesh(mergedGeometry, meshes[0]?.material)
      mesh.name = 'body:sketchup'
      mesh.userData = { bodyId: body.id, faceIdsByTriangle, pascalNodeId: body.id }
      group.add(mesh)
    }
    for (const mesh of importedMeshes) mesh.geometry.dispose()
  }

  const loopsById = new Map(body.loops.map((loop) => [loop.id, loop]))
  const planesByFaceId = new Map(
    body.faces.flatMap((face) => {
      const plane = facePlane(loopVertices(face.outerLoopId))
      return plane ? [[face.id, plane] as const] : []
    }),
  )
  const seamPositions: number[] = []
  const visitedTwinPairs = new Set<string>()
  for (const halfEdge of body.halfEdges) {
    if (!halfEdge.twinId) continue
    const twin = halfEdgesById.get(halfEdge.twinId)
    if (!twin) continue
    const pairId = [halfEdge.id, twin.id].sort().join(':')
    if (visitedTwinPairs.has(pairId)) continue
    visitedTwinPairs.add(pairId)
    const faceId = loopsById.get(halfEdge.loopId)?.faceId
    const twinFaceId = loopsById.get(twin.loopId)?.faceId
    if (!faceId || !twinFaceId || faceId === twinFaceId) continue
    const plane = planesByFaceId.get(faceId)
    const twinPlane = planesByFaceId.get(twinFaceId)
    if (!plane || !twinPlane || !areCoplanar(plane, twinPlane)) continue
    const start = verticesById.get(halfEdge.vertexId)?.position
    const end = verticesById.get(twin.vertexId)?.position
    if (!start || !end) continue
    seamPositions.push(...start, ...end)
  }
  if (seamPositions.length > 0) {
    const seamGeometry = new BufferGeometry()
    seamGeometry.setAttribute('position', new Float32BufferAttribute(seamPositions, 3))
    const seams = new LineSegments(
      seamGeometry,
      new LineBasicMaterial({ color: '#334155', depthTest: true, depthWrite: false }),
    )
    seams.name = 'body:coplanar-seams'
    seams.userData = { bodyId: body.id, pascalNodeId: body.id }
    group.add(seams)
  }
  return group
}
