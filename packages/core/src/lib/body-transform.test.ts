import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import { pushPullBodyFace } from './body-push-pull'
import { getBodySemanticHash, validateBodyTopology } from './body-topology'
import { transformBody } from './body-transform'

const transform = {
  translation: [2, 0, 0],
  rotationY: Math.PI / 2,
  uniformScale: 0.5,
  pivot: [0.6, 0.6, 0.4],
} as const

describe('Body transform kernel', () => {
  test('moves rotates and scales geometry while preserving semantic topology', () => {
    // Given
    const source = pushPullBodyFace(
      BodyNode.parse({
        id: 'body_transform_kernel',
        shells: [{ id: 'shell:0', faceIds: ['face:0'] }],
        vertices: [
          { id: 'vertex:0', position: [0, 0, 0] },
          { id: 'vertex:1', position: [1.2, 0, 0] },
          { id: 'vertex:2', position: [1.2, 0, 0.8] },
          { id: 'vertex:3', position: [0, 0, 0.8] },
        ],
        halfEdges: [
          { id: 'edge:0', vertexId: 'vertex:0', nextId: 'edge:1', loopId: 'loop:0' },
          { id: 'edge:1', vertexId: 'vertex:1', nextId: 'edge:2', loopId: 'loop:0' },
          { id: 'edge:2', vertexId: 'vertex:2', nextId: 'edge:3', loopId: 'loop:0' },
          { id: 'edge:3', vertexId: 'vertex:3', nextId: 'edge:0', loopId: 'loop:0' },
        ],
        loops: [{ id: 'loop:0', faceId: 'face:0', kind: 'outer' }],
        faces: [
          {
            id: 'face:0',
            outerLoopId: 'loop:0',
            surface: { materialRef: 'material:oak', uvOrigin: [0, 0, 0] },
          },
        ],
      }),
      'face:0',
      1.2,
    ).body

    // When
    const result = transformBody(source, transform)

    // Then
    const xs = result.vertices.map((vertex) => vertex.position[0])
    const ys = result.vertices.map((vertex) => vertex.position[1])
    const zs = result.vertices.map((vertex) => vertex.position[2])
    const movedFace = result.faces.find((face) => face.id === 'face:0')
    expect(result.revision).toBe(2)
    expect(Math.min(...xs)).toBeCloseTo(2.4)
    expect(Math.max(...xs)).toBeCloseTo(2.8)
    expect(Math.min(...ys)).toBeCloseTo(0.3)
    expect(Math.max(...ys)).toBeCloseTo(0.9)
    expect(Math.min(...zs)).toBeCloseTo(0.1)
    expect(Math.max(...zs)).toBeCloseTo(0.7)
    expect(movedFace?.surface.materialRef).toBe('material:oak')
    expect(movedFace?.surface.uvOrigin[0]).toBeCloseTo(2.4)
    expect(movedFace?.surface.uvOrigin[1]).toBeCloseTo(0.3)
    expect(movedFace?.surface.uvOrigin[2]).toBeCloseTo(0.7)
    expect(movedFace?.surface.uvU).toEqual([0, 0, -1])
    expect(movedFace?.surface.uvV).toEqual([1, 0, 0])
    expect(result.vertices.map((vertex) => vertex.id)).toEqual(
      source.vertices.map((vertex) => vertex.id),
    )
    expect(validateBodyTopology(result)).toEqual({ valid: true, diagnostics: [] })
  })

  test('rejects an identity transform without mutating the Body', () => {
    // Given
    const source = BodyNode.parse({
      id: 'body_transform_identity',
      shells: [],
      vertices: [],
      halfEdges: [],
      loops: [],
      faces: [],
    })
    const before = getBodySemanticHash(source)

    // When / Then
    expect(() =>
      transformBody(source, {
        translation: [0, 0, 0],
        rotationY: 0,
        uniformScale: 1,
        pivot: [0, 0, 0],
      }),
    ).toThrow('requires a change')
    expect(getBodySemanticHash(source)).toBe(before)
  })
})
