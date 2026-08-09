import { describe, expect, test } from 'bun:test'
import type { WallNode } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  resolveWallAlignedPlacement,
  resolveWallFlushSnap,
  wallAnchorForViewerSide,
} from './wall-flush-snap'

function node(data: Record<string, unknown>): AnyNode {
  return data as unknown as AnyNode
}

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return node({ id, type: 'wall', start, end, thickness: 0.1 }) as unknown as WallNode
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

describe('resolveWallAlignedPlacement', () => {
  // Back wall of the same room: (0,0)→(4,0), 0.1 thick, face at z=0.05.
  const backWall = wall('wall_back', [0, 0], [4, 0]) as WallNode

  test('anchors flush into the start end', () => {
    const result = resolveWallAlignedPlacement({
      wall: backWall,
      x: 2,
      z: 1.5,
      dimensions: [1, 1, 1],
      rotationY: 0,
      anchor: 'start',
    })
    expect(result!.x).toBeCloseTo(0.5)
    expect(result!.z).toBeCloseTo(0.55)
  })

  test('anchors at the wall centre and the end', () => {
    const base = { wall: backWall, x: 2, z: 1.5, dimensions: [1, 1, 1] as const, rotationY: 0 }
    expect(resolveWallAlignedPlacement({ ...base, anchor: 'center' })!.x).toBeCloseTo(2)
    expect(resolveWallAlignedPlacement({ ...base, anchor: 'end' })!.x).toBeCloseTo(3.5)
  })

  test('uses the face on the footprint side of the wall', () => {
    const result = resolveWallAlignedPlacement({
      wall: backWall,
      x: 2,
      z: -1.5, // other side of the wall
      dimensions: [1, 1, 1],
      rotationY: 0,
      anchor: 'center',
    })
    expect(result!.z).toBeCloseTo(-0.55)
  })

  test('rotated footprint uses its rotated along-wall extent', () => {
    const result = resolveWallAlignedPlacement({
      wall: backWall,
      x: 2,
      z: 1.5,
      dimensions: [1, 1, 1],
      rotationY: Math.PI / 4,
      anchor: 'start',
    })
    // 45° square: along-half = √2/2, corner touches the face.
    expect(result!.x).toBeCloseTo(Math.SQRT1_2)
    expect(result!.z - Math.SQRT1_2).toBeCloseTo(0.05)
  })

  test('a wall shorter than the footprint centres it', () => {
    const shortWall = wall('wall_short', [0, 0], [0.8, 0]) as WallNode
    const result = resolveWallAlignedPlacement({
      wall: shortWall,
      x: 2,
      z: 1,
      dimensions: [1, 1, 1],
      rotationY: 0,
      anchor: 'end',
    })
    expect(result!.x).toBeCloseTo(0.4)
  })
})

describe('wallAnchorForViewerSide', () => {
  const backWall = { start: [0, 0] as [number, number], end: [4, 0] as [number, number] }

  test('facing the back wall from inside the room, left is the -x end', () => {
    // Viewer at (2, 2) facing -z: west (-x) is on their left → start.
    expect(wallAnchorForViewerSide(backWall, [2, 2], 'left')).toBe('start')
    expect(wallAnchorForViewerSide(backWall, [2, 2], 'right')).toBe('end')
  })

  test('from the opposite side of the wall, left/right swap', () => {
    expect(wallAnchorForViewerSide(backWall, [2, -2], 'left')).toBe('end')
    expect(wallAnchorForViewerSide(backWall, [2, -2], 'right')).toBe('start')
  })

  test('wall drawn in the reverse direction gives the same viewer-relative answer', () => {
    const reversed = { start: [4, 0] as [number, number], end: [0, 0] as [number, number] }
    // Same viewer as above — "left" must still be the x=0 end, now called 'end'.
    expect(wallAnchorForViewerSide(reversed, [2, 2], 'left')).toBe('end')
    expect(wallAnchorForViewerSide(reversed, [2, 2], 'right')).toBe('start')
  })
})
