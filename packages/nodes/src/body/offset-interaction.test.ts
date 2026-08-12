import { describe, expect, test } from 'bun:test'
import { BodyNode, createPlanarFaceBody, createRectangleBody } from '@pascal-app/core'
import { resolveOffsetDistance } from './offset-handle'
import {
  createOffsetPointerInteraction,
  type OffsetPointerInteraction,
  resolveOffsetPointerDistance,
} from './offset-interaction'

type Point3 = readonly [number, number, number]

const HORIZONTAL_CONVEX = [
  [0, 0, 0],
  [2, 0, 0],
  [2, 0, 1],
  [0, 0, 1],
] as const satisfies readonly Point3[]

const VERTICAL_CONVEX = [
  [0, 0, 0],
  [2, 0, 0],
  [2, 1, 0],
  [0, 1, 0],
] as const satisfies readonly Point3[]

const HORIZONTAL_CONCAVE = [
  [0, 0, 0],
  [3, 0, 0],
  [3, 0, 3],
  [2, 0, 3],
  [2, 0, 1],
  [0, 0, 1],
] as const satisfies readonly Point3[]

function requireInteraction(
  interaction: OffsetPointerInteraction | null,
): OffsetPointerInteraction {
  expect(interaction).not.toBeNull()
  if (interaction === null) throw new RangeError('Expected a valid offset interaction fixture')
  return interaction
}

function reversed(points: readonly Point3[]): readonly Point3[] {
  return [...points].reverse()
}

describe('Body Offset pointer distance', () => {
  test('winding keeps horizontal convex exterior positive and interior negative', () => {
    for (const points of [HORIZONTAL_CONVEX, reversed(HORIZONTAL_CONVEX)]) {
      const interaction = requireInteraction(
        createOffsetPointerInteraction(createPlanarFaceBody(points), 'face:0', [1, 0, 0]),
      )

      expect(resolveOffsetPointerDistance(interaction, [1, 0, -0.25])).toBeCloseTo(0.25)
      expect(resolveOffsetPointerDistance(interaction, [1, 0, 0.25])).toBeCloseTo(-0.25)
    }
  })

  test('vertical winding is camera-independent with exterior positive and interior negative', () => {
    for (const points of [VERTICAL_CONVEX, reversed(VERTICAL_CONVEX)]) {
      const interaction = requireInteraction(
        createOffsetPointerInteraction(createPlanarFaceBody(points), 'face:0', [1, 0, 0]),
      )

      expect(resolveOffsetPointerDistance(interaction, [1, -0.25, 0])).toBeCloseTo(0.25)
      expect(resolveOffsetPointerDistance(interaction, [1, 0.25, 0])).toBeCloseTo(-0.25)
    }
  })

  test('concave winding keeps the reentrant profile exterior positive', () => {
    for (const points of [HORIZONTAL_CONCAVE, reversed(HORIZONTAL_CONCAVE)]) {
      const interaction = requireInteraction(
        createOffsetPointerInteraction(createPlanarFaceBody(points), 'face:0', [1, 0, 1]),
      )

      expect(resolveOffsetPointerDistance(interaction, [1, 0, 1.25])).toBeCloseTo(0.25)
      expect(resolveOffsetPointerDistance(interaction, [1, 0, 0.75])).toBeCloseTo(-0.25)
    }
  })

  test('nearest-edge ties use stable source edge order on repeated runs', () => {
    const body = createPlanarFaceBody(HORIZONTAL_CONVEX)
    const selections = Array.from({ length: 12 }, () =>
      createOffsetPointerInteraction(body, 'face:0', [0, 0, 0]),
    )

    expect(selections.map((interaction) => interaction?.edgeId)).toEqual(
      Array.from({ length: 12 }, () => 'edge:0'),
    )
    expect(selections.map((interaction) => interaction?.edgeIndex)).toEqual(
      Array.from({ length: 12 }, () => 0),
    )
  })

  test('nearest-edge selection prefers a later edge when it is measurably closer', () => {
    const interaction = requireInteraction(
      createOffsetPointerInteraction(
        createPlanarFaceBody(HORIZONTAL_CONVEX),
        'face:0',
        [0.1, 0, 0.1000000001],
      ),
    )

    expect(interaction.edgeId).toBe('edge:3')
    expect(interaction.edgeIndex).toBe(3)
  })

  test('typed signed values are authoritative over the opposite cursor sign', () => {
    expect(resolveOffsetDistance(-0.8, 0.2)).toBe(0.2)
    expect(resolveOffsetDistance(0.8, -0.2)).toBe(-0.2)
  })

  test('retains immutable projection and edge state after source replacement', () => {
    const source = createPlanarFaceBody(HORIZONTAL_CONVEX)
    const interaction = requireInteraction(
      createOffsetPointerInteraction(source, 'face:0', [1, 0, 0]),
    )
    const replacement = createPlanarFaceBody(
      HORIZONTAL_CONVEX.map(([x, y, z]) => [x + 10, y, z] satisfies Point3),
    )

    expect(replacement.vertices[0]?.position[0]).toBe(10)
    expect(resolveOffsetPointerDistance(interaction, [1, 0, -0.4])).toBeCloseTo(0.4)
    expect(source.vertices[0]?.position).toEqual([0, 0, 0])
  })

  test('keeps cursor metres exact on a tilted planar face', () => {
    const angle = Math.PI / 4
    const rotate = ([x, y, z]: Point3): Point3 => [
      x,
      y * Math.cos(angle) - z * Math.sin(angle),
      y * Math.sin(angle) + z * Math.cos(angle),
    ]
    const body = createPlanarFaceBody(HORIZONTAL_CONVEX.map(rotate))
    const interaction = requireInteraction(
      createOffsetPointerInteraction(body, 'face:0', rotate([1, 0, 0])),
    )

    expect(resolveOffsetPointerDistance(interaction, rotate([1, 0, -0.25]))).toBeCloseTo(0.25)
  })

  test('degenerate and null targets do not invent a profile direction', () => {
    const body = createRectangleBody({ width: 2, depth: 1 })
    const zeroLengthEdge = createPlanarFaceBody([
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [2, 0, 1],
      [0, 0, 1],
    ])
    const brokenLoop = BodyNode.parse({
      ...body,
      halfEdges: body.halfEdges.map((edge) =>
        edge.id === 'edge:0' ? { ...edge, nextId: edge.id } : edge,
      ),
    })
    const collinear = createPlanarFaceBody([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ])

    expect(createOffsetPointerInteraction(body, 'missing-face', [0, 0, 0])).toBeNull()
    expect(createOffsetPointerInteraction(body, 'face:0', [Number.NaN, 0, 0])).toBeNull()
    expect(createOffsetPointerInteraction(zeroLengthEdge, 'face:0', [1, 0, 0])).toBeNull()
    expect(createOffsetPointerInteraction(brokenLoop, 'face:0', [1, 0, 0])).toBeNull()
    expect(createOffsetPointerInteraction(collinear, 'face:0', [1, 0, 0])).toBeNull()
  })

  test('returns null for a malformed later plane hit without mutating interaction state', () => {
    const interaction = requireInteraction(
      createOffsetPointerInteraction(createPlanarFaceBody(HORIZONTAL_CONVEX), 'face:0', [1, 0, 0]),
    )
    const edgeState = {
      edgeId: interaction.edgeId,
      edgeStart: interaction.edgeStart,
      edgeEnd: interaction.edgeEnd,
      outwardNormal: interaction.outwardNormal,
    }

    expect(resolveOffsetPointerDistance(interaction, [0, Number.POSITIVE_INFINITY, 0])).toBeNull()
    expect(interaction).toMatchObject(edgeState)
  })
})
