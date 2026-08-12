import { describe, expect, test } from 'bun:test'
import {
  createRectangleBody,
  getBodyFaceFrame,
  inspectBodySolid,
  pushPullBodyFace,
  splitBodyFace,
  validateBodyTopology,
} from '../index'

describe('splitBodyFace', () => {
  test('splits a planar host face with an open seam and preserves one side ids', () => {
    const source = createRectangleBody({ width: 4, depth: 3 })
    const result = splitBodyFace(source, 'face:0', [
      [0, 0, 1.5],
      [2, 0, 1.5],
      [4, 0, 1.5],
    ])

    expect(result.body.faces.map((face) => face.id)).toEqual(['face:0', result.splitFaceId])
    expect(result.body.loops.filter((loop) => loop.faceId === 'face:0')).toHaveLength(1)
    expect(validateBodyTopology(result.body).valid).toBe(true)
    expect(result.remap.split['face:0']).toEqual(['face:0', result.splitFaceId])
    expect(result.body.halfEdges.some((edge) => edge.twinId !== null)).toBe(true)
  })

  test('splits boundary edge interiors and their solid twins together', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 4, depth: 3 }), 'face:0', 1).body
    const result = splitBodyFace(source, 'face:0', [
      [0, 1, 1.5],
      [4, 1, 1.5],
    ])

    expect(validateBodyTopology(result.body).valid).toBe(true)
    expect(
      result.body.vertices.some((vertex) => vertex.position[0] === 0 && vertex.position[2] === 1.5),
    ).toBe(true)
    expect(
      result.body.vertices.some((vertex) => vertex.position[0] === 4 && vertex.position[2] === 1.5),
    ).toBe(true)
    expect(Object.keys(result.remap.split).some((id) => id.startsWith('edge:'))).toBe(true)
  })

  test('rejects collapsed, boundary-following, self-crossing, and inner-loop paths', () => {
    const source = createRectangleBody({ width: 4, depth: 3 })
    expect(() =>
      splitBodyFace(source, 'face:0', [
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toThrow()
    expect(() =>
      splitBodyFace(source, 'face:0', [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ]),
    ).toThrow()
    expect(() =>
      splitBodyFace(source, 'face:0', [
        [0, 0, 0],
        [3, 2, 0],
        [1, 1, 0],
        [4, 3, 0],
      ]),
    ).toThrow()
  })

  test('arranges a connected coplanar crossing into four push/pullable faces', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 4, depth: 3 }), 'face:0', 1).body
    const first = splitBodyFace(source, 'face:0', [
      [0, 1, 1.5],
      [4, 1, 1.5],
    ])
    const result = splitBodyFace(first.body, first.splitFaceId, [
      [2, 1, 0],
      [2, 1, 3],
    ])

    const topFaces = result.body.faces.filter((face) => {
      const frame = getBodyFaceFrame(result.body, face.id)
      return Math.abs(frame.normal[1]) > 1 - 1e-7 && Math.abs(frame.centroid[1] - 1) < 1e-7
    })
    expect(topFaces).toHaveLength(4)
    expect(
      result.body.vertices.some(
        (vertex) =>
          Math.abs(vertex.position[0] - 2) < 1e-7 &&
          Math.abs(vertex.position[1] - 1) < 1e-7 &&
          Math.abs(vertex.position[2] - 1.5) < 1e-7,
      ),
    ).toBe(true)
    expect(validateBodyTopology(result.body).valid).toBe(true)
    const solid = inspectBodySolid(result.body)
    expect(solid.validSolid).toBe(true)
    expect(solid.volume).toBeCloseTo(12)
    for (const face of topFaces) {
      expect(() => pushPullBodyFace(result.body, face.id, 0.1)).not.toThrow()
    }
  })

  test('rejects seam overlap and seam-vertex branching', () => {
    const source = createRectangleBody({ width: 4, depth: 3 })
    const first = splitBodyFace(source, 'face:0', [
      [0, 0, 1.5],
      [4, 0, 1.5],
    ])
    expect(() =>
      splitBodyFace(first.body, 'face:0', [
        [0, 0, 1.5],
        [4, 0, 1.5],
      ]),
    ).toThrow(/overlap|follow|outer boundary/i)
    expect(() =>
      splitBodyFace(first.body, 'face:0', [
        [0, 0, 0],
        [2, 0, 1.5],
        [4, 0, 3],
      ]),
    ).toThrow(/branch|touch|boundary/i)
  })
})
