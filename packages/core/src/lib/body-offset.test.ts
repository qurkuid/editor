import { describe, expect, test } from 'bun:test'
import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { imprintBodyFace } from './body-imprint'
import { bodyFeatureIds } from './body-imprint-helpers'
import { offsetBodyFace } from './body-offset'
import { pushPullBodyFace } from './body-push-pull'
import {
  createPlanarFaceBody,
  createRectangleBody,
  getBodyLoopVertices,
  getBodySemanticHash,
  validateBodyTopology,
} from './body-topology'

function makeClosedRectangle(width = 2, depth = 2) {
  return pushPullBodyFace(createRectangleBody({ width, depth }), 'face:0', 1).body
}

function captureOffsetError(body: BodyNodeType, faceId: string, distance: number): RangeError {
  try {
    offsetBodyFace(body, faceId, distance)
  } catch (error) {
    if (error instanceof RangeError) return error
    throw error
  }
  throw new Error('Expected Offset to reject the fixture')
}

function createdProfile(body: BodyNodeType, createdFaceId: string) {
  const face = body.faces.find((candidate) => candidate.id === createdFaceId)
  if (!face) throw new Error('Offset result omitted its created face')
  return getBodyLoopVertices(body, face.outerLoopId)
}

function roundedProfile(points: ReadonlyArray<readonly [number, number, number]>) {
  return points.map(([x, y, z]) => [x, y, z].map((coordinate) => Number(coordinate.toFixed(9))))
}

function profileWinding(points: ReadonlyArray<readonly [number, number, number]>) {
  return Math.sign(
    points.reduce((area, [x, , z], index) => {
      const next = points[(index + 1) % points.length]
      return next ? area + x * next[2] - next[0] * z : area
    }, 0),
  )
}

function makeConcaveInset() {
  const source = makeClosedRectangle()
  return imprintBodyFace(source, 'face:0', [
    [0.3, 1, 0.3],
    [1.7, 1, 0.3],
    [1.7, 1, 0.8],
    [1.1, 1, 0.8],
    [1.1, 1, 1.7],
    [0.3, 1, 1.7],
  ]).body
}

describe('offsetBodyFace', () => {
  test('creates a deterministic inward inset ring with copied surface data', () => {
    const source = makeClosedRectangle()

    const result = offsetBodyFace(source, 'face:0', -0.2)
    const created = result.body.faces.find((face) => face.id === result.createdFaceId)
    const sourceFace = result.body.faces.find((face) => face.id === 'face:0')

    expect(created?.innerLoopIds).toEqual([])
    expect(sourceFace?.innerLoopIds).toHaveLength(1)
    expect(created?.surface).toEqual(sourceFace?.surface)
    expect(result.topologyRemap.split).toEqual({ 'face:0': ['face:0', result.createdFaceId] })
    expect(validateBodyTopology(result.body).valid).toBe(true)

    const repeated = offsetBodyFace(source, 'face:0', -0.2)
    expect(getBodySemanticHash(repeated.body)).toBe(getBodySemanticHash(result.body))
    expect(repeated.createdFaceId).toBe(result.createdFaceId)
  })

  test('preserves material and UV data with an exact deterministic remap', () => {
    const plain = makeClosedRectangle()
    const surface = {
      materialRef: 'scene:offset-proof',
      uvOrigin: [0.25, 1, 0.75],
      uvU: [2, 0, 0],
      uvV: [0, 0, 3],
    }
    const source = BodyNode.parse({
      ...plain,
      faces: plain.faces.map((face) => (face.id === 'face:0' ? { ...face, surface } : face)),
    })

    const result = offsetBodyFace(source, 'face:0', -0.2)
    const created = result.body.faces.find((face) => face.id === result.createdFaceId)
    const sourceIds = new Set(bodyFeatureIds(source))

    expect(created?.surface).toEqual(surface)
    expect(result.body.faces.find((face) => face.id === 'face:0')?.surface).toEqual(surface)
    expect(result.topologyRemap.preserved).toEqual(bodyFeatureIds(source))
    expect(result.topologyRemap.created).toEqual(
      bodyFeatureIds(result.body).filter((id) => !sourceIds.has(id)),
    )
    expect(result.topologyRemap.deleted).toEqual([])
    expect(result.topologyRemap.merged).toEqual({})
  })

  test('retains convex vertex order and winding for opposite-winding inward offsets', () => {
    const profiles = [
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
        [0, 0, 2],
      ],
      [
        [0, 0, 2],
        [2, 0, 2],
        [2, 0, 0],
        [0, 0, 0],
      ],
    ] as const
    const expected = [
      [
        [0.2, 1, 0.2],
        [1.8, 1, 0.2],
        [1.8, 1, 1.8],
        [0.2, 1, 1.8],
      ],
      [
        [0.2, 1, 1.8],
        [1.8, 1, 1.8],
        [1.8, 1, 0.2],
        [0.2, 1, 0.2],
      ],
    ]

    profiles.forEach((profile, index) => {
      const source = pushPullBodyFace(createPlanarFaceBody(profile), 'face:0', 1).body
      const before = getBodySemanticHash(source)
      const result = offsetBodyFace(source, 'face:0', -0.2)
      const sourcePoints = getBodyLoopVertices(source, 'loop:0')
      const createdPoints = createdProfile(result.body, result.createdFaceId)

      expect(roundedProfile(sourcePoints)).toEqual(profile.map(([x, , z]) => [x, 1, z]))
      expect(roundedProfile(createdPoints)).toEqual(expected[index])
      expect(profileWinding(createdPoints)).toBe(profileWinding(sourcePoints))
      expect(getBodySemanticHash(source)).toBe(before)
    })
  })

  test('creates a nested outward annulus through the reciprocal host seam', () => {
    const source = makeClosedRectangle()
    const inset = imprintBodyFace(source, 'face:0', [
      [0.4, 1, 0.4],
      [1.6, 1, 0.4],
      [1.6, 1, 1.6],
      [0.4, 1, 1.6],
    ]).body
    const insetFaceId = inset.faces.at(-1)?.id
    if (!insetFaceId) throw new Error('test fixture did not create an inset face')

    const result = offsetBodyFace(inset, insetFaceId, 0.1)
    const created = result.body.faces.find((face) => face.id === result.createdFaceId)
    const host = result.body.faces.find((face) => face.id === 'face:0')
    const sourceFace = result.body.faces.find((face) => face.id === insetFaceId)

    expect(created?.innerLoopIds).toEqual([
      inset.faces.find((face) => face.id === 'face:0')?.innerLoopIds[0],
    ])
    expect(host?.innerLoopIds).toHaveLength(1)
    expect(host?.innerLoopIds).not.toContain(
      inset.faces.find((face) => face.id === 'face:0')?.innerLoopIds[0],
    )
    expect(sourceFace?.innerLoopIds).toEqual([])
    expect(result.topologyRemap.split['face:0']).toEqual(['face:0', result.createdFaceId])
    expect(result.topologyRemap.preserved).toEqual(bodyFeatureIds(inset))
    expect(result.topologyRemap.deleted).toEqual([])
    expect(result.topologyRemap.merged).toEqual({})
    expect(validateBodyTopology(result.body).valid).toBe(true)
  })

  test('copies the enclosing host material and UV frame to the outward annulus', () => {
    const plain = makeClosedRectangle()
    const hostSurface = {
      materialRef: 'scene:host',
      uvOrigin: [0.1, 1, 0.2],
      uvU: [4, 0, 0],
      uvV: [0, 0, 5],
    }
    const insetSurface = {
      materialRef: 'scene:inset',
      uvOrigin: [0.3, 1, 0.4],
      uvU: [6, 0, 0],
      uvV: [0, 0, 7],
    }
    const surfaced = BodyNode.parse({
      ...plain,
      faces: plain.faces.map((face) => ({ ...face, surface: hostSurface })),
    })
    const inset = imprintBodyFace(surfaced, 'face:0', [
      [0.4, 1, 0.4],
      [1.6, 1, 0.4],
      [1.6, 1, 1.6],
      [0.4, 1, 1.6],
    ]).body
    const insetFaceId = inset.faces.at(-1)?.id
    if (!insetFaceId) throw new Error('test fixture did not create an inset face')
    const differentiated = BodyNode.parse({
      ...inset,
      faces: inset.faces.map((face) =>
        face.id === insetFaceId ? { ...face, surface: insetSurface } : face,
      ),
    })

    const result = offsetBodyFace(differentiated, insetFaceId, 0.1)

    expect(result.body.faces.find((face) => face.id === result.createdFaceId)?.surface).toEqual(
      hostSurface,
    )
    expect(result.body.faces.find((face) => face.id === insetFaceId)?.surface).toEqual(insetSurface)
  })

  test('keeps a valid concave profile winding and topology under mitered inset', () => {
    const concave = makeConcaveInset()
    const faceId = concave.faces.at(-1)?.id
    if (!faceId) throw new Error('test fixture did not create a concave inset face')

    const result = offsetBodyFace(concave, faceId, -0.1)
    const sourceProfile = createdProfile(concave, faceId)
    const resultProfile = createdProfile(result.body, result.createdFaceId)

    expect(result.body.faces.find((face) => face.id === faceId)?.innerLoopIds).toHaveLength(1)
    expect(result.body.faces.find((face) => face.id === result.createdFaceId)?.surface).toEqual(
      concave.faces.find((face) => face.id === faceId)?.surface,
    )
    expect(roundedProfile(sourceProfile)).toEqual([
      [0.3, 1, 0.3],
      [1.7, 1, 0.3],
      [1.7, 1, 0.8],
      [1.1, 1, 0.8],
      [1.1, 1, 1.7],
      [0.3, 1, 1.7],
    ])
    expect(roundedProfile(resultProfile)).toEqual([
      [0.4, 1, 0.4],
      [1.6, 1, 0.4],
      [1.6, 1, 0.7],
      [1, 1, 0.7],
      [1, 1, 1.6],
      [0.4, 1, 1.6],
    ])
    expect(profileWinding(resultProfile)).toBe(profileWinding(sourceProfile))
    expect(validateBodyTopology(result.body).valid).toBe(true)
  })

  test('keeps offset metres exact on a tilted planar face', () => {
    const source = makeClosedRectangle()
    const angle = Math.PI / 4
    const tilted = BodyNode.parse({
      ...source,
      vertices: source.vertices.map((vertex) => {
        const [x, y, z] = vertex.position
        return {
          ...vertex,
          position: [
            x,
            y * Math.cos(angle) - z * Math.sin(angle),
            y * Math.sin(angle) + z * Math.cos(angle),
          ],
        }
      }),
    })

    const result = offsetBodyFace(tilted, 'face:0', -0.2)
    const created = result.body.faces.find((face) => face.id === result.createdFaceId)
    if (!created) throw new Error('offset did not create a tilted inset face')
    const points = getBodyLoopVertices(result.body, created.outerLoopId)
    const lengths = points.map((point, index) => {
      const next = points[(index + 1) % points.length]
      if (!next) throw new Error('Offset produced an open created loop')
      return Math.hypot(next[0] - point[0], next[1] - point[1], next[2] - point[2])
    })

    for (const length of lengths) expect(length).toBeCloseTo(1.6, 9)
    expect(validateBodyTopology(result.body).valid).toBe(true)
  })

  test('rejects a nonzero short edge atomically with its stable feature id', () => {
    const source = pushPullBodyFace(
      createPlanarFaceBody([
        [0, 0, 0],
        [0.2, 0, 0],
        [0.2, 0, 1],
        [2, 0, 1],
        [2, 0, 2],
        [0, 0, 2],
      ]),
      'face:0',
      1,
    ).body
    const before = getBodySemanticHash(source)

    const error = captureOffsetError(source, 'face:0', -0.1)

    expect(error.message).toBe('Offset profile has a collapsed edge: edge:0')
    expect(getBodySemanticHash(source)).toBe(before)
  })

  test('rejects a parallel or collinear join atomically with both stable feature ids', () => {
    const source = pushPullBodyFace(
      createPlanarFaceBody([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
        [0, 0, 2],
      ]),
      'face:0',
      1,
    ).body
    const before = getBodySemanticHash(source)

    const error = captureOffsetError(source, 'face:0', -0.1)

    expect(error.message).toBe('Offset profile has a parallel or collinear join: edge:0, edge:1')
    expect(getBodySemanticHash(source)).toBe(before)
  })

  const malformedSource = makeClosedRectangle()
  const firstVertex = malformedSource.vertices[0]
  const secondVertex = malformedSource.vertices[1]
  const targetFace = malformedSource.faces.find((face) => face.id === 'face:0')
  const targetEdge = targetFace
    ? malformedSource.halfEdges.find((edge) => edge.loopId === targetFace.outerLoopId)
    : undefined
  if (!firstVertex || !secondVertex || !targetEdge) {
    throw new Error('test fixture did not create a target face edge')
  }
  const malformedFixtures = [
    {
      name: 'a non-planar face',
      body: BodyNode.parse({
        ...malformedSource,
        vertices: malformedSource.vertices.map((vertex) =>
          vertex.id === secondVertex.id
            ? {
                ...vertex,
                position: [vertex.position[0], vertex.position[1] + 0.1, vertex.position[2]],
              }
            : vertex,
        ),
      }),
      message: 'Offset requires a planar face: face:0, edge:0, edge:1, edge:2, edge:3',
    },
    {
      name: 'a collapsed source edge',
      body: BodyNode.parse({
        ...malformedSource,
        vertices: malformedSource.vertices.map((vertex) =>
          vertex.id === secondVertex.id ? { ...vertex, position: firstVertex.position } : vertex,
        ),
      }),
      message: 'Offset profile has a collapsed edge: edge:0',
    },
    {
      name: 'a circular-arc curve',
      body: BodyNode.parse({
        ...malformedSource,
        curves: [
          {
            id: 'curve:arc',
            kind: 'circular-arc',
            center: [0, 1, 0],
            normal: [0, 1, 0],
            radius: 1,
            startAngle: 0,
            endAngle: Math.PI,
          },
        ],
        halfEdges: malformedSource.halfEdges.map((edge) =>
          edge.id === targetEdge.id ? { ...edge, curveId: 'curve:arc' } : edge,
        ),
      }),
      message: 'Offset requires line edges: edge:0, curve:arc',
    },
  ]
  for (const fixture of malformedFixtures) {
    test(`rejects ${fixture.name} atomically`, () => {
      const before = getBodySemanticHash(fixture.body)

      const error = captureOffsetError(fixture.body, 'face:0', -0.2)

      expect(error.message).toBe(fixture.message)
      expect(getBodySemanticHash(fixture.body)).toBe(before)
    })
  }

  test('rejects concave self-intersection and reversed winding atomically', () => {
    const source = makeConcaveInset()
    const faceId = source.faces.at(-1)?.id
    if (!faceId) throw new Error('test fixture did not create a concave face')
    const before = getBodySemanticHash(source)

    const selfIntersection = captureOffsetError(source, faceId, -0.25)
    const reversed = captureOffsetError(source, faceId, -0.4)

    expect(selfIntersection.message).toBe(
      'Offset profile would self-intersect: face:0:imprint:2:edge:0, face:0:imprint:2:edge:2',
    )
    expect(reversed.message).toBe(
      'Offset profile would collapse or reverse winding: face:0:imprint:2:edge:0, face:0:imprint:2:edge:1, face:0:imprint:2:edge:2, face:0:imprint:2:edge:3, face:0:imprint:2:edge:4, face:0:imprint:2:edge:5',
    )
    expect(getBodySemanticHash(source)).toBe(before)
  })

  test('rejects outward host-boundary contact atomically', () => {
    const source = makeClosedRectangle()
    const inset = imprintBodyFace(source, 'face:0', [
      [0.5, 1, 0.5],
      [1.5, 1, 0.5],
      [1.5, 1, 1.5],
      [0.5, 1, 1.5],
    ]).body
    const faceId = inset.faces.at(-1)?.id
    if (!faceId) throw new Error('test fixture did not create an inset face')
    const before = getBodySemanticHash(inset)

    const error = captureOffsetError(inset, faceId, 0.5)

    expect(error.message).toBe(
      'Imprint profile must be strictly inside the host face: face:0:imprint:2, face:0',
    )
    expect(getBodySemanticHash(inset)).toBe(before)
  })

  test('rejects outward sibling-hole contact atomically', () => {
    const source = makeClosedRectangle(4, 4)
    const primary = imprintBodyFace(source, 'face:0', [
      [1, 1, 1],
      [1.5, 1, 1],
      [1.5, 1, 1.5],
      [1, 1, 1.5],
    ]).body
    const sibling = imprintBodyFace(source, 'face:0', [
      [2, 1, 1],
      [2.5, 1, 1],
      [2.5, 1, 1.5],
      [2, 1, 1.5],
    ]).body
    const sourceIds = new Set(bodyFeatureIds(source))
    const siblingFace = sibling.faces.find((face) => !sourceIds.has(face.id))
    const siblingInnerLoop = sibling.loops.find(
      (loop) => loop.kind === 'inner' && !sourceIds.has(loop.id),
    )
    const primaryFace = primary.faces.find((face) => !sourceIds.has(face.id))
    if (!siblingFace || !siblingInnerLoop || !primaryFace) {
      throw new Error('test fixture did not create sibling inset topology')
    }
    const siblingPrefix = siblingFace.id
    const renamedPrefix = `${siblingPrefix}:sibling`
    const rename = (id: string) =>
      id.startsWith(siblingPrefix) ? `${renamedPrefix}${id.slice(siblingPrefix.length)}` : id
    const body = BodyNode.parse({
      ...primary,
      vertices: [
        ...primary.vertices,
        ...sibling.vertices
          .filter((vertex) => !sourceIds.has(vertex.id))
          .map((vertex) => ({ ...vertex, id: rename(vertex.id) })),
      ],
      halfEdges: [
        ...primary.halfEdges,
        ...sibling.halfEdges
          .filter((edge) => !sourceIds.has(edge.id))
          .map((edge) => ({
            ...edge,
            id: rename(edge.id),
            vertexId: rename(edge.vertexId),
            twinId: edge.twinId ? rename(edge.twinId) : null,
            nextId: rename(edge.nextId),
            loopId: rename(edge.loopId),
          })),
      ],
      loops: [
        ...primary.loops,
        ...sibling.loops
          .filter((loop) => !sourceIds.has(loop.id))
          .map((loop) => ({ ...loop, id: rename(loop.id), faceId: rename(loop.faceId) })),
      ],
      faces: [
        ...primary.faces.map((face) =>
          face.id === 'face:0'
            ? { ...face, innerLoopIds: [...face.innerLoopIds, rename(siblingInnerLoop.id)] }
            : face,
        ),
        ...sibling.faces
          .filter((face) => !sourceIds.has(face.id))
          .map((face) => ({
            ...face,
            id: rename(face.id),
            outerLoopId: rename(face.outerLoopId),
            innerLoopIds: face.innerLoopIds.map(rename),
          })),
      ],
      shells: primary.shells.map((shell) => ({
        ...shell,
        faceIds: [...shell.faceIds, rename(siblingFace.id)],
      })),
    })
    expect(validateBodyTopology(body).valid).toBe(true)
    const before = getBodySemanticHash(body)

    const error = captureOffsetError(body, primaryFace.id, 0.5)

    expect(error.message).toBe(
      'Offset profile touches or crosses a sibling hole: face:0, face:0:imprint:2:sibling:inner',
    )
    expect(getBodySemanticHash(body)).toBe(before)
  })

  test('rejects an ambiguous enclosing host before mutation', () => {
    const source = makeClosedRectangle()
    const inset = imprintBodyFace(source, 'face:0', [
      [0.4, 1, 0.4],
      [1.6, 1, 0.4],
      [1.6, 1, 1.6],
      [0.4, 1, 1.6],
    ]).body
    const faceId = inset.faces.at(-1)?.id
    const host = inset.faces.find((face) => face.id === 'face:0')
    if (!faceId || !host) throw new Error('test fixture did not create an enclosing host')
    const hostLoopId = host.innerLoopIds[0]
    if (!hostLoopId) throw new Error('test fixture did not create a host seam')
    const ambiguous = BodyNode.parse({
      ...inset,
      faces: inset.faces.map((face) =>
        face.id === host.id ? { ...face, innerLoopIds: [...face.innerLoopIds, hostLoopId] } : face,
      ),
    })
    expect(validateBodyTopology(ambiguous).valid).toBe(true)
    const before = getBodySemanticHash(ambiguous)

    const error = captureOffsetError(ambiguous, faceId, 0.1)

    expect(error.message).toBe('Offset outward host is ambiguous: face:0')
    expect(getBodySemanticHash(ambiguous)).toBe(before)
  })

  test('rejects invalid or unsupported input without mutating the source', () => {
    const source = makeClosedRectangle()
    const before = getBodySemanticHash(source)

    for (const distance of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(captureOffsetError(source, 'face:0', distance).message).toBe(
        'Offset requires a non-zero finite distance',
      )
      expect(getBodySemanticHash(source)).toBe(before)
    }
    expect(captureOffsetError(source, 'missing', -0.2).message).toBe(
      'Offset face not found: missing',
    )
    expect(captureOffsetError(source, 'face:0', 0.2).message).toBe(
      'Offset exterior outward requires one coplanar enclosing host: face:0',
    )
    expect(getBodySemanticHash(source)).toBe(before)
  })

  test('rejects a source face with holes and a collapsing inset', () => {
    const source = makeClosedRectangle()
    const inset = imprintBodyFace(source, 'face:0', [
      [0.4, 1, 0.4],
      [1.6, 1, 0.4],
      [1.6, 1, 1.6],
      [0.4, 1, 1.6],
    ]).body
    const insetFaceId = inset.faces.at(-1)?.id
    if (!insetFaceId) throw new Error('test fixture did not create an inset face')
    const before = getBodySemanticHash(inset)

    expect(captureOffsetError(inset, 'face:0', -0.2).message).toBe(
      'Offset rejects source faces with inner loops: face:0, face:0:imprint:2:inner',
    )
    expect(captureOffsetError(inset, insetFaceId, -1).message).toBe(
      'Offset profile would collapse or reverse winding: face:0:imprint:2:edge:0',
    )
    expect(getBodySemanticHash(inset)).toBe(before)
  })
})
