import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import { moveBodyFeature } from './body-feature-move'
import { createRoundedRectangularFrameBody } from './body-frame'
import {
  createPlanarFaceBody,
  createRectangleBody,
  pushPullBodyFace,
  validateBodyTopology,
} from './body-topology'

describe('moveBodyFeature', () => {
  test('moves a persistent vertex without replacing topology ids', () => {
    const source = createPlanarFaceBody([
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 2],
    ])
    const moved = moveBodyFeature(source, 'vertex', 'vertex:0', [0, 1, 0])

    expect(moved.vertices.find(({ id }) => id === 'vertex:0')?.position).toEqual([0, 1, 0])
    expect(moved.vertices.map(({ id }) => id)).toEqual(source.vertices.map(({ id }) => id))
    expect(moved.halfEdges).toEqual(source.halfEdges)
    expect(moved.faces.map(({ id }) => id)).toEqual(source.faces.map(({ id }) => id))
    expect(validateBodyTopology(moved).valid).toBe(true)
  })

  test('moves both endpoints of a persistent edge', () => {
    const source = createPlanarFaceBody([
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 2],
    ])
    const moved = moveBodyFeature(source, 'edge', 'edge:0', [0, 1, 0])

    expect(moved.vertices.map(({ position }) => position)).toEqual([
      [0, 1, 0],
      [2, 1, 0],
      [0, 0, 2],
    ])
  })

  test('moves a closed-solid face and its UV origin as one stable feature', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
    const face = source.faces.find(({ id }) => id === 'face:0')!
    const moved = moveBodyFeature(source, 'face', face.id, [0, 0.5, 0])

    expect(moved.faces.find(({ id }) => id === face.id)?.surface.uvOrigin).toEqual([
      face.surface.uvOrigin[0],
      face.surface.uvOrigin[1] + 0.5,
      face.surface.uvOrigin[2],
    ])
    expect(validateBodyTopology(moved).valid).toBe(true)
  })

  test('rejects a move atomically when it would make an incident face non-planar', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
    const before = structuredClone(source)

    expect(() => moveBodyFeature(source, 'vertex', 'vertex:0', [0, 0.5, 0])).toThrow(
      'Body feature move would make face non-planar',
    )
    expect(source).toEqual(before)
  })

  test('rejects a move that collapses an edge', () => {
    const source = createPlanarFaceBody([
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 2],
    ])

    expect(() => moveBodyFeature(source, 'vertex', 'vertex:0', [2, 0, 0])).toThrow(
      'Body feature move would collapse edge',
    )
  })

  test('autofolds a non-planar quad while preserving boundary ids and surface data', () => {
    const source = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 2 }),
      faces: [
        {
          ...createRectangleBody({ width: 2, depth: 2 }).faces[0]!,
          surface: {
            materialRef: 'scene:oak',
            uvOrigin: [0.2, 0.3, 0.4],
            uvU: [0.5, 0, 0],
            uvV: [0, 0, 0.5],
          },
        },
      ],
    })
    const moved = moveBodyFeature(source, 'vertex', 'vertex:0', [0, 1, 0], {
      autofold: true,
    })

    expect(moved.faces).toHaveLength(2)
    expect(moved.faces[0]?.id).toBe(source.faces[0]?.id)
    expect(moved.faces.every((face) => face.surface)).toBe(true)
    expect(moved.faces.map((face) => face.surface.materialRef)).toEqual(['scene:oak', 'scene:oak'])
    expect(moved.faces[0]?.surface).toEqual(moved.faces[1]?.surface)
    expect(
      moved.halfEdges.filter(({ id }) => id.startsWith('face:0:autofold:1:diagonal')),
    ).toHaveLength(2)
    const diagonalEdges = moved.halfEdges.filter(({ id }) => id.includes(':diagonal:'))
    expect(diagonalEdges[0]?.twinId).toBe(diagonalEdges[1]?.id)
    expect(diagonalEdges[1]?.twinId).toBe(diagonalEdges[0]?.id)
    expect(
      moved.halfEdges.filter(({ id }) => source.halfEdges.some((edge) => edge.id === id)),
    ).toHaveLength(source.halfEdges.length)
    expect(moved.shells[0]?.faceIds).toEqual(moved.faces.map((face) => face.id))
    expect(validateBodyTopology(moved).valid).toBe(true)
  })

  test('autofolds every affected non-planar face of a closed solid', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
    const moved = moveBodyFeature(source, 'vertex', 'vertex:0', [0, 0.3, 0.4], {
      autofold: true,
    })

    expect(moved.faces.length).toBeGreaterThan(source.faces.length)
    expect(validateBodyTopology(moved).valid).toBe(true)
    const foldedFaceIds = moved.faces
      .filter(({ id }) => id.includes(':autofold:'))
      .map(({ id }) => id)
    expect(foldedFaceIds.length).toBeGreaterThan(0)
    expect(moved.shells[0]?.faceIds).toEqual(moved.faces.map((face) => face.id))
  })

  test('autofold rejects holes atomically', () => {
    const source = createRoundedRectangularFrameBody({
      width: 2,
      height: 2,
      depth: 0.2,
      openingWidth: 1,
      openingHeight: 1,
      topCornerRadius: 0,
    })
    const before = structuredClone(source)

    expect(() =>
      moveBodyFeature(source, 'vertex', 'vertex:front:outer:0', [0, 0, 0.1], {
        autofold: true,
      }),
    ).toThrow('holes')
    expect(source).toEqual(before)
  })

  test('autofold rejects curves atomically', () => {
    const source = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 2 }),
      curves: [
        {
          id: 'curve:arc',
          kind: 'circular-arc',
          center: [0, 0, 0],
          normal: [0, 1, 0],
          radius: 1,
          startAngle: 0,
          endAngle: 1,
        },
      ],
      halfEdges: createRectangleBody({ width: 2, depth: 2 }).halfEdges.map((edge, index) =>
        index === 1 ? { ...edge, curveId: 'curve:arc' } : edge,
      ),
    })
    const before = structuredClone(source)

    expect(() =>
      moveBodyFeature(source, 'vertex', 'vertex:0', [0, 1, 0], { autofold: true }),
    ).toThrow('curved edges')
    expect(() =>
      moveBodyFeature(source, 'vertex', 'vertex:2', [0, 0, 0.2], { autofold: true }),
    ).toThrow('line edges only')
    expect(source).toEqual(before)
  })
})
