import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import {
  createCircularArcFaceBody,
  getBodyLoopBoundaryPoints,
  sampleBodyCurve,
} from './body-curves'
import { pushPullBodyFace } from './body-push-pull'
import { getBodySemanticHash, validateBodyTopology } from './body-topology'

describe('Body circular arc topology', () => {
  test('persists two arc edges and one closing chord', () => {
    const body = createCircularArcFaceBody([1, 0, 0], [0, 0, 1], [-1, 0, 0])

    expect(body.vertices.map(({ id }) => id)).toEqual(['vertex:0', 'vertex:1', 'vertex:2'])
    expect(body.halfEdges.map(({ curveId }) => curveId)).toEqual(['curve:0', 'curve:1', undefined])
    expect(body.curves).toHaveLength(2)
    expect(validateBodyTopology(body)).toEqual({ valid: true, diagnostics: [] })
  })

  test('samples the same authored boundary for every surface', () => {
    const body = createCircularArcFaceBody([1, 0, 0], [0, 0, 1], [-1, 0, 0])
    const boundary = getBodyLoopBoundaryPoints(body, 'loop:0', 4)
    const firstArc = body.curves[0]
    if (firstArc?.kind !== 'circular-arc') throw new Error('missing first arc')

    expect(boundary).toHaveLength(9)
    expect(boundary[0]).toEqual([1, 0, 0])
    expect(boundary[4]).toEqual([0, 0, 1])
    expect(boundary[8]).toEqual([-1, 0, 0])
    expect(sampleBodyCurve(firstArc, [1, 0, 0], [0, 0, 1], 4)).toHaveLength(5)
  })

  test('is deterministic across save-load parsing', () => {
    const body = createCircularArcFaceBody([1, 0, 0], [0, 0, -1], [-1, 0, 0])
    const reloaded = BodyNode.parse(JSON.parse(JSON.stringify(body)))
    expect(getBodySemanticHash(body)).toBe(getBodySemanticHash(reloaded))
  })

  test('fails closed for planar push/pull without mutating curved topology', () => {
    const body = createCircularArcFaceBody([1, 0, 0], [0, 0, 1], [-1, 0, 0])
    const before = getBodySemanticHash(body)

    expect(() => pushPullBodyFace(body, 'face:0', 1)).toThrow(
      'Push/pull currently requires line edges; curved planar boundaries cannot be extruded',
    )
    expect(getBodySemanticHash(body)).toBe(before)
  })
})
