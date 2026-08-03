import { describe, expect, test } from 'bun:test'
import { createRoundedRectangularFrameBody, pushPullBodyFace } from '../index'
import { BodyNode } from '../schema/nodes/body'
import {
  createPlanarFaceBody,
  createRectangleBody,
  getBodyLoopVertices,
  getBodySemanticHash,
  validateBodyTopology,
} from './body-topology'

describe('Body topology kernel contract', () => {
  test('creates a hollow frame with exact depth and rounded upper corners', () => {
    const body = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
      origin: [1, 0, 2],
    })

    expect(validateBodyTopology(body)).toEqual({ valid: true, diagnostics: [] })
    expect(body.metadata).toMatchObject({
      primitive: 'rounded-rectangular-frame',
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      openingOffsetX: 0.5,
      topCornerRadius: 0.2,
    })
    expect(body.metadata.openingOffsetY).toBeCloseTo(0.8, 12)
    expect(body.faces.find((face) => face.id === 'face:front')?.innerLoopIds).toHaveLength(1)
    expect(Math.min(...body.vertices.map((vertex) => vertex.position[2]))).toBe(2)
    expect(Math.max(...body.vertices.map((vertex) => vertex.position[2]))).toBe(2.1)
    expect(
      body.vertices.some(
        (vertex) =>
          Math.abs(vertex.position[0] - 2.8) < 1e-9 && Math.abs(vertex.position[1] - 2.4) < 1e-9,
      ),
    ).toBe(true)
  })

  test('rejects an opening that does not fit inside the frame', () => {
    expect(() =>
      createRoundedRectangularFrameBody({
        width: 2,
        height: 2.4,
        depth: 0.1,
        openingWidth: 2,
        openingHeight: 0.8,
        topCornerRadius: 0.2,
      }),
    ).toThrow('fit inside')
  })

  test('creates a valid rectangular face with stable topology', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const result = validateBodyTopology(body)

    expect(result).toEqual({ valid: true, diagnostics: [] })
    expect(body).toMatchObject({
      type: 'body',
      revision: 0,
      vertices: [
        { id: 'vertex:0', position: [0, 0, 0] },
        { id: 'vertex:1', position: [1.2, 0, 0] },
        { id: 'vertex:2', position: [1.2, 0, 0.8] },
        { id: 'vertex:3', position: [0, 0, 0.8] },
      ],
    })
    expect(body.halfEdges).toHaveLength(4)
    expect(body.loops).toHaveLength(1)
    expect(body.faces).toHaveLength(1)
    expect(body.shells).toHaveLength(1)
  })

  test('creates a rotated planar face from authored points', () => {
    const body = createPlanarFaceBody([
      [1, 0, 1],
      [2, 0, 2],
      [1.5, 0, 2.5],
      [0.5, 0, 1.5],
    ])

    expect(validateBodyTopology(body).valid).toBe(true)
    expect(getBodyLoopVertices(body, 'loop:0')).toEqual([
      [1, 0, 1],
      [2, 0, 2],
      [1.5, 0, 2.5],
      [0.5, 0, 1.5],
    ])
  })

  test('preserves its semantic hash across JSON save and schema reload', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const saved = JSON.stringify(body)
    const reopened = BodyNode.parse(JSON.parse(saved))

    expect(getBodySemanticHash(reopened)).toBe(getBodySemanticHash(body))
    expect(validateBodyTopology(reopened).valid).toBe(true)
  })

  test('semantic hash ignores collection order but detects geometry changes', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const reordered = BodyNode.parse({
      ...body,
      vertices: [...body.vertices].reverse(),
      halfEdges: [...body.halfEdges].reverse(),
    })
    const resized = BodyNode.parse({
      ...body,
      vertices: body.vertices.map((vertex) =>
        vertex.id === 'vertex:1' ? { ...vertex, position: [1.3, 0, 0] } : vertex,
      ),
    })

    expect(getBodySemanticHash(reordered)).toBe(getBodySemanticHash(body))
    expect(getBodySemanticHash(resized)).not.toBe(getBodySemanticHash(body))
  })

  test('reports broken references with stable diagnostic codes and feature ids', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const invalid = BodyNode.parse({
      ...body,
      halfEdges: body.halfEdges.map((edge) =>
        edge.id === 'edge:0' ? { ...edge, nextId: 'edge:missing' } : edge,
      ),
      faces: body.faces.map((face) => ({ ...face, outerLoopId: 'loop:missing' })),
      shells: body.shells.map((shell) => ({ ...shell, faceIds: ['face:missing'] })),
    })

    expect(validateBodyTopology(invalid)).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'half-edge.next.missing',
          featureIds: ['edge:0', 'edge:missing'],
        },
        {
          code: 'face.outer-loop.missing',
          featureIds: ['face:0', 'loop:missing'],
        },
        {
          code: 'shell.face.missing',
          featureIds: ['shell:0', 'face:missing'],
        },
        {
          code: 'face.shell.missing',
          featureIds: ['face:0'],
        },
      ],
    })
  })

  test('pushes a rectangular face by exactly 1200 mm into a closed solid', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const { body } = pushPullBodyFace(source, 'face:0', 1.2)
    const moved = getBodyLoopVertices(body, 'loop:0')

    expect(validateBodyTopology(body)).toEqual({ valid: true, diagnostics: [] })
    expect(body.revision).toBe(1)
    expect(body.vertices).toHaveLength(8)
    expect(body.halfEdges).toHaveLength(24)
    expect(body.loops).toHaveLength(6)
    expect(body.faces).toHaveLength(6)
    expect(body.shells[0]?.faceIds).toHaveLength(6)
    expect(moved.every((point) => Math.abs(point[1] - 1.2) <= 0.00001)).toBe(true)
    expect(1.2 * 0.8 * 1.2).toBeCloseTo(1.152, 10)
  })

  test('keeps the moved face identity and material placement', () => {
    const source = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      faces: [
        {
          id: 'face:0',
          outerLoopId: 'loop:0',
          surface: {
            materialRef: 'material:oak',
            uvOrigin: [0.1, 0, 0.2],
            uvU: [0.5, 0, 0],
            uvV: [0, 0, 0.5],
          },
        },
      ],
    })
    const { body, movedFaceId, remap } = pushPullBodyFace(source, 'face:0', 1.2)

    expect(movedFaceId).toBe('face:0')
    expect(body.faces.find((face) => face.id === movedFaceId)?.surface).toEqual(
      source.faces[0]?.surface,
    )
    expect(remap.preserved).toContain('face:0')
    expect(remap.created).toHaveLength(34)
    expect(remap.deleted).toEqual([])
    expect(remap.split).toEqual({})
    expect(remap.merged).toEqual({})
  })

  test('creates non-degenerate UV frames for the base and side faces', () => {
    const source = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      bodyDefaults: { materialRef: 'library:concrete-plate' },
    })
    const { body, createdFaceIds } = pushPullBodyFace(source, 'face:0', 1.2)

    for (const faceId of createdFaceIds) {
      const face = body.faces.find((candidate) => candidate.id === faceId)
      const surface = face?.surface
      expect(surface?.materialRef).toBe('library:concrete-plate')
      expect(surface?.uvU.some((value) => Math.abs(value) > 1e-9)).toBe(true)
      expect(surface?.uvV.some((value) => Math.abs(value) > 1e-9)).toBe(true)
      const points = face ? getBodyLoopVertices(body, face.outerLoopId) : []
      const range = (axis: [number, number, number]) => {
        const values = points.map(
          (point) => point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2],
        )
        return Math.max(...values) - Math.min(...values)
      }
      expect(range(surface!.uvU)).toBeGreaterThan(1e-9)
      expect(range(surface!.uvV)).toBeGreaterThan(1e-9)
    }
  })

  test('produces a deterministic remap and reciprocal twins', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const first = pushPullBodyFace(source, 'face:0', 1.2)
    const second = pushPullBodyFace(source, 'face:0', 1.2)
    const edges = new Map(first.body.halfEdges.map((edge) => [edge.id, edge]))

    expect(first.remap).toEqual(second.remap)
    expect(getBodySemanticHash(first.body)).toBe(getBodySemanticHash(second.body))
    expect(
      first.body.halfEdges.every(
        (edge) => edge.twinId && edges.get(edge.twinId)?.twinId === edge.id,
      ),
    ).toBe(true)
  })

  test('rolls back zero-thickness push/pull without mutating the source', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const before = getBodySemanticHash(source)

    expect(() => pushPullBodyFace(source, 'face:0', 0)).toThrow('non-zero finite distance')
    expect(getBodySemanticHash(source)).toBe(before)
  })

  test('pushes the same solid face repeatedly without replacing topology ids', () => {
    // Given
    const planar = createRectangleBody({ width: 1.2, depth: 0.8 })
    const first = pushPullBodyFace(planar, 'face:0', 1.2)
    const idsBefore = first.body.vertices.map((vertex) => vertex.id)
    const surfaceBefore = first.body.faces.find((face) => face.id === 'face:0')?.surface

    // When
    const second = pushPullBodyFace(first.body, 'face:0', 0.3)

    // Then
    expect(second.body.revision).toBe(2)
    expect(second.body.vertices.map((vertex) => vertex.id)).toEqual(idsBefore)
    expect(second.body.faces).toHaveLength(6)
    expect(second.createdFaceIds).toEqual([])
    expect(second.body.faces.find((face) => face.id === 'face:0')?.surface).toEqual(surfaceBefore)
    expect(second.remap.preserved).toContain('face:0')
    expect(getBodyLoopVertices(second.body, 'loop:0').every((point) => point[1] === 1.5)).toBe(true)
    expect(validateBodyTopology(second.body)).toEqual({ valid: true, diagnostics: [] })
  })

  test('rejects a solid face move that would collapse the body', () => {
    // Given
    const source = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const before = getBodySemanticHash(source)

    // When / Then
    expect(() => pushPullBodyFace(source, 'face:0', -1.2)).toThrow('collapse')
    expect(getBodySemanticHash(source)).toBe(before)
  })

  test('rejects curved solid face boundaries before mutation', () => {
    // Given
    const source = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const curved = BodyNode.parse({
      ...source,
      halfEdges: source.halfEdges.map((edge) =>
        edge.id === 'edge:0' ? { ...edge, curveId: 'curve:0' } : edge,
      ),
      curves: [
        {
          id: 'curve:0',
          kind: 'circular-arc',
          center: [0.6, 1.2, 0.4],
          normal: [0, 1, 0],
          radius: 0.6,
          startAngle: 0,
          endAngle: Math.PI,
        },
      ],
    })
    const before = getBodySemanticHash(curved)

    // When / Then
    expect(() => pushPullBodyFace(curved, 'face:0', 0.3)).toThrow('line edges')
    expect(getBodySemanticHash(curved)).toBe(before)
  })
})
