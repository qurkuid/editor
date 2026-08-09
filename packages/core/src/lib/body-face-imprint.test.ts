import { describe, expect, test } from 'bun:test'
import { BodyNode, createRectangleBody, imprintBodyFace, pushPullBodyFace } from '../index'
import { getBodyLoopVertices, getBodySemanticHash, validateBodyTopology } from './body-topology'

const closedRectangle = () =>
  pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body

const rectangleProfile = (): readonly (readonly [number, number, number])[] => [
  [0.5, 1, 0.5],
  [1.5, 1, 0.5],
  [1.5, 1, 1.5],
  [0.5, 1, 1.5],
]

describe('Body face imprint kernel', () => {
  test('creates a stable coplanar inset face and preserves host surface data', () => {
    const source = BodyNode.parse({
      ...closedRectangle(),
      faces: closedRectangle().faces.map((face) =>
        face.id === 'face:0'
          ? {
              ...face,
              surface: {
                ...face.surface,
                materialRef: 'material:oak',
                uvOrigin: [0.1, 1, 0.2],
                uvU: [0.5, 0, 0],
                uvV: [0, 0, 0.5],
              },
            }
          : face,
      ),
    })

    const result = imprintBodyFace(source, 'face:0', rectangleProfile())

    const host = result.body.faces.find((face) => face.id === 'face:0')
    const inset = result.body.faces.find((face) => face.id === result.insetFaceId)
    expect(result.insetFaceId).toBe('face:0:imprint:2')
    expect(host?.innerLoopIds).toHaveLength(1)
    expect(inset?.surface).toEqual(host?.surface)
    expect(result.remap.preserved).toContain('face:0')
    expect(result.remap.created).toContain(result.insetFaceId)
    expect(validateBodyTopology(result.body)).toEqual({ valid: true, diagnostics: [] })
    expect(getBodyLoopVertices(result.body, inset?.outerLoopId ?? '')).toEqual([
      [0.5, 1, 0.5],
      [1.5, 1, 0.5],
      [1.5, 1, 1.5],
      [0.5, 1, 1.5],
    ])
  })

  test('moves an inset face outward and creates reveal faces without replacing ids', () => {
    const source = imprintBodyFace(closedRectangle(), 'face:0', rectangleProfile()).body
    const beforeHash = getBodySemanticHash(source)

    const result = pushPullBodyFace(source, 'face:0:imprint:2', 0.25)

    expect(getBodySemanticHash(source)).toBe(beforeHash)
    expect(result.movedFaceId).toBe('face:0:imprint:2')
    expect(result.body.faces).toHaveLength(source.faces.length + 4)
    expect(
      getBodyLoopVertices(result.body, 'face:0:imprint:2:outer:2').every(
        (point) => Math.abs(point[1] - 1.25) < 1e-9,
      ),
    ).toBe(true)
    expect(validateBodyTopology(result.body)).toEqual({ valid: true, diagnostics: [] })
  })

  test('moves an inset face inward for a recess and rejects a through-cut', () => {
    const source = imprintBodyFace(closedRectangle(), 'face:0', rectangleProfile()).body

    const recess = pushPullBodyFace(source, 'face:0:imprint:2', -0.25)

    expect(
      getBodyLoopVertices(recess.body, 'face:0:imprint:2:outer:2').every(
        (point) => Math.abs(point[1] - 0.75) < 1e-9,
      ),
    ).toBe(true)
    expect(validateBodyTopology(recess.body)).toEqual({ valid: true, diagnostics: [] })
    expect(() => pushPullBodyFace(source, 'face:0:imprint:2', -1)).toThrow('collapse')
  })

  test('rejects profiles outside, touching, curved, or self-intersecting', () => {
    const source = closedRectangle()
    const beforeHash = getBodySemanticHash(source)

    const invalidProfiles = [
      [
        [0, 1, 0.5],
        [1, 1, 0.5],
        [1, 1, 1.5],
      ],
      [
        [0.5, 1, 0.5],
        [1.5, 1, 0.5],
        [1.5, 1, 1.5],
        [0.5, 1, 1.5],
      ].map(([x, y, z]) => [x, y + 0.01, z]),
      [
        [0.5, 1, 0.5],
        [1.5, 1, 1.5],
        [1.5, 1, 0.5],
        [0.5, 1, 1.5],
      ],
    ] as readonly (readonly (readonly [number, number, number])[])[]

    for (const profile of invalidProfiles) {
      expect(() => imprintBodyFace(source, 'face:0', profile)).toThrow()
    }
    expect(getBodySemanticHash(source)).toBe(beforeHash)
  })
})
