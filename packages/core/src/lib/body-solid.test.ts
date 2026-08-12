import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import { inspectBodySolid } from './body-solid'
import { createRectangleBody, pushPullBodyFace } from './body-topology'

function box(
  id: string,
  origin: [number, number, number],
  width: number,
  height: number,
  depth: number,
) {
  const base = createRectangleBody({ width, depth, origin })
  return BodyNode.parse({
    ...pushPullBodyFace(base, 'face:0', height).body,
    id,
    name: 'Box',
    parentId: 'level_solid',
  })
}

describe('Body solid inspector', () => {
  test('reports open, closed, manifold, orientation, connectivity, planarity, and volume', () => {
    const open = createRectangleBody({ width: 2, depth: 3 })
    expect(inspectBodySolid(open)).toMatchObject({
      validTopology: true,
      closed: false,
      manifold: false,
      connected: true,
      volume: 0,
      validSolid: false,
    })

    const solid = box('body_solid', [0, 0, 0], 2, 1, 3)
    expect(inspectBodySolid(solid)).toMatchObject({
      validTopology: true,
      closed: true,
      manifold: true,
      consistentlyOriented: true,
      connected: true,
      connectedShells: 1,
      nonplanarFaceIds: [],
      degenerateFaceIds: [],
      volume: 6,
      validSolid: true,
    })
    expect(inspectBodySolid(solid).diagnostics).toEqual([])
  })
})
