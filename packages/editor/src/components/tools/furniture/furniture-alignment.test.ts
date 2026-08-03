import { describe, expect, test } from 'bun:test'
import { type AlignmentAnchor, footprintAABBFrom } from '@pascal-app/core'
import { resolveFurnitureAlignedPosition } from './furniture-alignment'

describe('furniture reference-element alignment', () => {
  const footprint = { width: 1, depth: 0.6 }
  // Footprint AABB at position [3, 0, 2] with rotationY 0 is x:[2.5, 3.5], z:[1.7, 2.3] —
  // this anchor sits 0.02m from the west face corner, far from the other axis so only X matches.
  const wallFace: AlignmentAnchor = { nodeId: 'wall_a', kind: 'corner', x: 2.52, z: 10 }

  test('snaps a footprint corner flush to a wall face anchor within threshold', () => {
    const result = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], {
      showGuides: true,
      applySnap: true,
    })
    expect(result.position).toEqual([3.02, 0, 2])
    expect(result.guides).toHaveLength(1)
  })

  test('keeps the raw position when nothing is within threshold', () => {
    const result = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], {
      showGuides: true,
      applySnap: true,
      threshold: 0.001,
    })
    expect(result.position).toEqual([3, 0, 2])
    expect(result.guides).toHaveLength(0)
  })

  test('skips alignment entirely when the alignment guide gate is off', () => {
    const result = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], {
      showGuides: false,
      applySnap: true,
    })
    expect(result.position).toEqual([3, 0, 2])
    expect(result.guides).toHaveLength(0)
  })

  test('publishes a passive guide without pulling the position when the magnetic gate is off', () => {
    const result = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], {
      showGuides: true,
      applySnap: false,
    })
    expect(result.position).toEqual([3, 0, 2])
    expect(result.guides).toHaveLength(1)
  })

  test('honors rotation when aligning a rotated footprint corner', () => {
    const position: [number, number, number] = [3, 0, 2]
    const rotationY = Math.PI / 2
    const aabb = footprintAABBFrom(position, [footprint.width, 0, footprint.depth], rotationY)
    const candidate: AlignmentAnchor = {
      nodeId: 'wall_b',
      kind: 'corner',
      x: aabb.minX + 0.02,
      z: 500,
    }
    const result = resolveFurnitureAlignedPosition(position, footprint, rotationY, [candidate], {
      showGuides: true,
      applySnap: true,
    })
    expect(result.position[0]).toBeCloseTo(position[0] + 0.02)
    expect(result.position[2]).toBe(position[2])
  })

  // The tool stores whatever this function returns straight into the ref that
  // both drives the preview and — on click — becomes the committed position,
  // so two calls with the same inputs must agree exactly for that identity
  // to hold (mirrors the lighting fixture's preview/commit contract).
  test('is deterministic, so a previewed aligned position can be reused unchanged at commit', () => {
    const options = { showGuides: true, applySnap: true } as const
    const first = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], options)
    const second = resolveFurnitureAlignedPosition([3, 0, 2], footprint, 0, [wallFace], options)
    expect(second.position).toEqual(first.position)
    expect(second.guides).toEqual(first.guides)
  })
})
