import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveWallFlushSnap } from './wall-flush-snap'

function node(data: Record<string, unknown>): AnyNode {
  return data as unknown as AnyNode
}

/** Level 'lvl' with an x-axis wall w1 (0,0)→(4,0) and, optionally, a z-axis
 *  wall w2 (0,0)→(0,4). Both 0.1 thick, so faces sit at |perp| = 0.05. */
function scene(withCorner = false): Readonly<Record<AnyNodeId, AnyNode>> {
  const nodes: Record<string, AnyNode> = {
    lvl: node({ id: 'lvl', type: 'level', children: withCorner ? ['w1', 'w2'] : ['w1'] }),
    w1: node({ id: 'w1', type: 'wall', parentId: 'lvl', start: [0, 0], end: [4, 0], thickness: 0.1 }),
  }
  if (withCorner) {
    nodes.w2 = node({
      id: 'w2',
      type: 'wall',
      parentId: 'lvl',
      start: [0, 0],
      end: [0, 4],
      thickness: 0.1,
    })
  }
  return nodes as Record<AnyNodeId, AnyNode>
}

const ITEM = { dimensions: [1, 1, 1] as const, rotationY: 0 }

describe('resolveWallFlushSnap', () => {
  test('pulls a near edge flush onto the wall face', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 2,
      z: 0.6, // near edge at 0.1, face at 0.05 → gap 0.05
      ...ITEM,
    })
    expect(result).not.toBeNull()
    expect(result!.x).toBeCloseTo(2)
    expect(result!.z).toBeCloseTo(0.55)
  })

  test('does not engage beyond the threshold', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 2,
      z: 0.7, // gap 0.15 > 0.12
      ...ITEM,
    })
    expect(result).toBeNull()
  })

  test('pushes an overlapping footprint back out to the face', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 2,
      z: 0.3, // near edge at -0.2 — 0.25 inside the face
      ...ITEM,
    })
    expect(result!.z).toBeCloseTo(0.55)
  })

  test('snaps onto the back face when the centre is on the back side', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 2,
      z: -0.6,
      ...ITEM,
    })
    expect(result!.z).toBeCloseTo(-0.55)
  })

  test('ignores a wall whose span the footprint does not overlap', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 5.6, // corners at x 5.1..6.1, wall ends at 4
      z: 0.06,
      ...ITEM,
    })
    expect(result).toBeNull()
  })

  test('lands flush against both walls of a corner in one snap', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(true),
      levelId: 'lvl' as AnyNodeId,
      x: 0.58, // gap 0.03 to w2's face
      z: 0.6, // gap 0.05 to w1's face
      ...ITEM,
    })
    expect(result!.x).toBeCloseTo(0.55)
    expect(result!.z).toBeCloseTo(0.55)
  })

  test('touches by the nearest corner when the footprint is rotated', () => {
    const result = resolveWallFlushSnap({
      nodes: scene(),
      levelId: 'lvl' as AnyNodeId,
      x: 2,
      z: 0.8, // 45°: corner reaches √2/2 below centre → gap ≈ 0.043
      dimensions: [1, 1, 1] as const,
      rotationY: Math.PI / 4,
    })
    expect(result).not.toBeNull()
    expect(result!.z - Math.SQRT1_2).toBeCloseTo(0.05) // corner on the face
  })

  test('returns null with no level or no walls', () => {
    expect(
      resolveWallFlushSnap({ nodes: scene(), levelId: null, x: 2, z: 0.6, ...ITEM }),
    ).toBeNull()
  })
})
