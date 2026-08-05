// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { CeilingNode } from '@pascal-app/core'
import type * as THREE from 'three'
import { generateCeilingFeatureGeometry } from './ceiling-feature-geometry'

// 4×3 room, counter-clockwise in plan. Edge 0 runs [0,0] → [4,0]; the
// interior lies at +z, so profile +u maps to +z for that edge.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

const BULKHEAD: Array<[number, number]> = [
  [0, 0],
  [0.6, 0],
  [0.6, -0.3],
  [0, -0.3],
]

function bbox(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)]
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, p[axis]!)
      max[axis] = Math.max(max[axis]!, p[axis]!)
    }
  }
  return { min, max }
}

describe('generateCeilingFeatureGeometry', () => {
  test('sweeps a bulkhead profile along the full edge, hanging below the plane', () => {
    const ceiling = CeilingNode.parse({
      polygon: SQUARE,
      features: [{ kind: 'drop', edgeIndex: 0, profile: BULKHEAD }],
    })

    const geometry = generateCeilingFeatureGeometry(ceiling)
    const { min, max } = bbox(geometry)

    // Runs the whole [0,0] → [4,0] edge.
    expect(min[0]).toBeCloseTo(0)
    expect(max[0]).toBeCloseTo(4)
    // Drops 0.3m below the ceiling plane, never above it.
    expect(min[1]).toBeCloseTo(-0.3)
    expect(max[1]).toBeCloseTo(0)
    // Extends 0.6m toward the ceiling interior (+z for edge 0), not outward.
    expect(min[2]).toBeCloseTo(0)
    expect(max[2]).toBeCloseTo(0.6)

    // Sides (4 segments × 6 verts) + two caps (2 tris × 3 verts each).
    expect(geometry.getAttribute('position').count).toBe(36)
    expect(geometry.getAttribute('uv2')).toBeDefined()
  })

  test('inward side follows the edge, not the winding', () => {
    // Same square wound clockwise — interior of edge [0,3] → [0,0] (last
    // edge) still lies at +x.
    const ceiling = CeilingNode.parse({
      polygon: [...SQUARE].reverse(),
      features: [{ kind: 'drop', edgeIndex: 0, profile: BULKHEAD }],
    })

    const { min, max } = bbox(generateCeilingFeatureGeometry(ceiling))
    // Reversed square's edge 0 is [0,3] → [4,3]; interior is at −z.
    expect(max[2]).toBeCloseTo(3)
    expect(min[2]).toBeCloseTo(2.4)
  })

  test('invalid edge index and no features degrade to a degenerate buffer', () => {
    const empty = CeilingNode.parse({ polygon: SQUARE })
    expect(generateCeilingFeatureGeometry(empty).getAttribute('position').count).toBe(3)

    const dangling = CeilingNode.parse({
      polygon: SQUARE,
      features: [{ kind: 'drop', edgeIndex: 9, profile: BULKHEAD }],
    })
    expect(generateCeilingFeatureGeometry(dangling).getAttribute('position').count).toBe(3)
  })
})
