import { describe, expect, test } from 'bun:test'
import { SweepBodyFaceError, sweepBodyFace } from './body-sweep'
import {
  createPlanarFaceBody,
  createRectangleBody,
  getBodySemanticHash,
  validateBodyTopology,
} from './body-topology'

const straightPath = (length: number) => [[0, 0, 0] as const, [0, length, 0] as const]

describe('sweepBodyFace', () => {
  test('bakes a straight sweep with the source face as the moved end cap', () => {
    const source = {
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      bodyDefaults: { materialRef: 'scene:mat_molding' },
    }
    const result = sweepBodyFace(source, 'face:0', straightPath(1.2))

    expect(result.closed).toBe(false)
    expect(result.movedFaceId).toBe('face:0')
    expect(result.body.faces.map((face) => face.id)).toContain('face:0')
    expect(result.createdFaceIds).toHaveLength(5)
    expect(validateBodyTopology(result.body).valid).toBe(true)
    expect(result.body.vertices.find((vertex) => vertex.id === 'vertex:0')?.position).toEqual([
      0, 1.2, 0,
    ])
    expect(result.body.faces.find((face) => face.id.includes(':side:'))?.surface.materialRef).toBe(
      'scene:mat_molding',
    )
    expect(result.remap.preserved).toContain('face:0')
    expect(result.remap.created.some((id) => id.includes(':side:'))).toBe(true)
  })

  test('preserves the source profile when the path starts opposite the face normal', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const result = sweepBodyFace(source, 'face:0', [
      [0, 0, 0],
      [0, -1.2, 0],
    ])

    for (const vertex of source.vertices) {
      expect(
        result.body.vertices.find(
          (candidate) => candidate.id === `face:0:sweep:1:ring:0:vertex:${vertex.id.split(':')[1]}`,
        )?.position,
      ).toEqual(vertex.position)
    }
  })

  test('keeps an L path deterministic and reciprocal', () => {
    const source = createRectangleBody({ width: 1, depth: 0.5 })
    const path = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ] as const
    const first = sweepBodyFace(source, 'face:0', path)
    const second = sweepBodyFace(source, 'face:0', path)

    expect(validateBodyTopology(first.body).valid).toBe(true)
    expect(getBodySemanticHash(first.body)).toBe(getBodySemanticHash(second.body))
    expect(
      first.body.halfEdges.every((edge) => {
        const twin = first.body.halfEdges.find((candidate) => candidate.id === edge.twinId)
        return twin?.twinId === edge.id
      }),
    ).toBe(true)
  })

  test('closes a planar path without a cap or open seam', () => {
    const source = createRectangleBody({ width: 0.2, depth: 0.2 })
    const result = sweepBodyFace(source, 'face:0', [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ])

    expect(result.closed).toBe(true)
    expect(result.movedFaceId).toBeNull()
    expect(result.body.faces.some((face) => face.id === 'face:0')).toBe(false)
    expect(result.body.faces.every((face) => face.id.includes(':side:'))).toBe(true)
    expect(validateBodyTopology(result.body).valid).toBe(true)
  })

  const corpus = [
    {
      name: 'molding/baseboard',
      source: createPlanarFaceBody([
        [-0.08, 0, -0.03],
        [0.08, 0, -0.03],
        [0.08, 0, 0.03],
        [-0.08, 0, 0.03],
      ]),
      path: straightPath(2.4),
    },
    {
      name: 'tessellated duct',
      source: createPlanarFaceBody([
        [0.2, 0, 0],
        [0.1414, 0, 0.1414],
        [0, 0, 0.2],
        [-0.1414, 0, 0.1414],
        [-0.2, 0, 0],
        [-0.1414, 0, -0.1414],
        [0, 0, -0.2],
        [0.1414, 0, -0.1414],
      ]),
      path: [
        [0, 0, 0],
        [0, 1, 0],
        [0.8, 1, 0],
      ] as const,
    },
    {
      name: 'U-handle',
      source: createRectangleBody({ width: 0.12, depth: 0.12 }),
      path: [
        [0, 0, 0],
        [0, 0.6, 0],
        [0.6, 0.6, 0],
        [0.6, 1.2, 0],
        [0, 1.2, 0],
      ] as const,
    },
  ] as const

  for (const item of corpus) {
    test(`accepts ${item.name} with deterministic topology`, () => {
      const first = sweepBodyFace(item.source, 'face:0', item.path)
      const second = sweepBodyFace(item.source, 'face:0', item.path)

      expect(validateBodyTopology(first.body).valid).toBe(true)
      expect(getBodySemanticHash(first.body)).toBe(getBodySemanticHash(second.body))
      expect(first.createdFaceIds.length).toBeGreaterThan(0)
    })
  }

  test('rejects unsupported profiles and paths atomically with feature diagnostics', () => {
    const source = createRectangleBody({ width: 1, depth: 1 })
    const before = getBodySemanticHash(source)
    const concave = {
      ...source,
      vertices: [
        { id: 'vertex:0', position: [0, 0, 0] as [number, number, number] },
        { id: 'vertex:1', position: [1, 0, 0] as [number, number, number] },
        { id: 'vertex:2', position: [0.5, 0, 0.25] as [number, number, number] },
        { id: 'vertex:3', position: [1, 0, 1] as [number, number, number] },
      ],
    }
    expect(() => sweepBodyFace(concave, 'face:0', straightPath(1))).toThrow(SweepBodyFaceError)
    expect(() =>
      sweepBodyFace(source, 'face:0', [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0.5, 0],
        [0, 0.5, 1],
      ]),
    ).toThrow('reversing')
    expect(getBodySemanticHash(source)).toBe(before)
  })

  const rejectedPaths = [
    { name: 'too few points', code: 'path.invalid' as const, path: [[0, 0, 0]] },
    {
      name: 'zero-length segment',
      code: 'path.zero-length' as const,
      path: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    {
      name: 'non-planar stations',
      code: 'path.nonplanar' as const,
      path: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 1, 1],
      ],
    },
    {
      name: 'self-intersecting closed path',
      code: 'path.self-intersection' as const,
      path: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 0, 0],
      ],
    },
  ] as const

  for (const item of rejectedPaths) {
    test(`reports exact diagnostic for ${item.name}`, () => {
      const source = createRectangleBody({ width: 1, depth: 1 })
      const before = getBodySemanticHash(source)
      let caught: unknown
      try {
        sweepBodyFace(source, 'face:0', item.path)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SweepBodyFaceError)
      expect((caught as SweepBodyFaceError).code).toBe(item.code)
      expect(getBodySemanticHash(source)).toBe(before)
    })
  }
})
