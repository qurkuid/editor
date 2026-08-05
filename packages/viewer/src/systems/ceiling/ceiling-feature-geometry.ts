import { type CeilingNode, ceilingFeatureEdgeFrame } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Pure builder for a ceiling's profile-swept features (curtain box,
 * bulkhead/단내림, custom sections). Each feature's closed section profile
 * (u = inward from its polygon edge, v = vertical from the ceiling plane)
 * is swept along that edge: side walls per profile segment plus a
 * triangulated cap at both ends.
 *
 * Output is mesh-local — the parent ceiling mesh is parked at the
 * resolved ceiling height, so profile v maps straight to local Y.
 * Rendered with a DoubleSide unlit material, so triangle winding does
 * not affect visibility.
 *
 * Always returns a non-empty geometry: a ceiling with no (valid)
 * features gets the same degenerate one-triangle buffer the flat
 * ceiling uses, keeping WebGPU vertex-buffer slot 0 bound (see
 * `generateCeilingGeometry`'s degenerate guard).
 */
export function generateCeilingFeatureGeometry(node: CeilingNode): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = []

  for (const feature of node.features ?? []) {
    const frame = ceilingFeatureEdgeFrame(node.polygon ?? [], feature.edgeIndex)
    if (!frame) continue
    if (feature.profile.length < 3) continue
    pieces.push(sweepProfile(feature.profile, frame.start, frame.inward, frame.dir, frame.length))
  }

  if (pieces.length === 0) return degenerateGeometry()

  const merged = pieces.length === 1 ? pieces[0]! : (mergeGeometries(pieces, false) ?? pieces[0]!)
  if (merged !== pieces[0]) {
    for (const piece of pieces) piece.dispose()
  }
  merged.computeVertexNormals()
  ensureUv2(merged)
  return merged
}

function degenerateGeometry(): THREE.BufferGeometry {
  const degenerate = new THREE.BufferGeometry()
  degenerate.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  degenerate.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  degenerate.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  degenerate.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  return degenerate
}

function ensureUv2(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

/** Single-segment sweep of a closed (u, v) profile along a plan edge. */
function sweepProfile(
  profile: ReadonlyArray<readonly [number, number]>,
  start: readonly [number, number],
  inward: readonly [number, number],
  dir: readonly [number, number],
  length: number,
): THREE.BufferGeometry {
  const count = profile.length
  const positions: number[] = []
  const uvs: number[] = []

  // World-space position of profile vertex k at distance t along the edge.
  const at = (k: number, t: number): [number, number, number] => {
    const [u, v] = profile[k]!
    return [start[0] + inward[0] * u + dir[0] * t, v, start[1] + inward[1] * u + dir[1] * t]
  }

  const push = (p: [number, number, number], uu: number, vv: number) => {
    positions.push(p[0], p[1], p[2])
    uvs.push(uu, vv)
  }

  // Side walls — one quad (two triangles) per profile segment, wrapping
  // the closing segment last → first. UV: u = distance along the edge,
  // v = accumulated arc length along the profile.
  let arc = 0
  for (let k = 0; k < count; k++) {
    const next = (k + 1) % count
    const [u0, v0] = profile[k]!
    const [u1, v1] = profile[next]!
    const segment = Math.hypot(u1 - u0, v1 - v0)
    const a0 = at(k, 0)
    const a1 = at(next, 0)
    const b0 = at(k, length)
    const b1 = at(next, length)
    push(a0, 0, arc)
    push(a1, 0, arc + segment)
    push(b1, length, arc + segment)
    push(a0, 0, arc)
    push(b1, length, arc + segment)
    push(b0, length, arc)
    arc += segment
  }

  // End caps — the profile triangulated in section space, placed at both
  // ends of the edge. UV: the (u, v) section coordinates.
  const contour = profile.map(([u, v]) => new THREE.Vector2(u, v))
  const triangles = THREE.ShapeUtils.triangulateShape(contour, [])
  for (const t of [0, length]) {
    for (const [i0, i1, i2] of triangles) {
      for (const k of [i0!, i1!, i2!]) {
        const [u, v] = profile[k]!
        push(at(k, t), u, v)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}
