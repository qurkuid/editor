import { beforeEach, describe, expect, test } from 'bun:test'
import { createPlanarFaceBody, createRectangleBody, getBodySemanticHash } from '@pascal-app/core'
import {
  executeOffsetBodyFace,
  executePushPullBodyFace,
} from '@pascal-app/core/modeling-operations'
import { type AnyNodeId, BodyNode, LevelNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { applyAiModelingPlan } from './ai-control'
import { apiGraphSchema } from './graph-schema'

const levelId = 'level_ai_offset' as AnyNodeId

function resetScene(): void {
  const level = LevelNode.parse({ id: levelId, level: 0 })
  useScene.setState({
    nodes: { [levelId]: level },
    rootNodeIds: [levelId],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
}

function seedSolid(id: AnyNodeId): BodyNode {
  const body = BodyNode.parse({
    ...executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
      faceId: 'face:0',
      distance: 1,
    }).body,
    id,
    parentId: levelId,
  })
  useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
  useScene.temporal.getState().clear()
  return body
}

function seedBody(body: BodyNode): BodyNode {
  useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
  useScene.temporal.getState().clear()
  return body
}

function currentBody(id: AnyNodeId): BodyNode {
  return BodyNode.parse(useScene.getState().nodes[id])
}

function expectAtomicRejection(body: BodyNode, faceId: string, distance: number): void {
  const before = getBodySemanticHash(body)
  expect(() =>
    applyAiModelingPlan({
      message: 'Reject this invalid face offset.',
      patches: [
        { op: 'update', id: body.id, data: { name: 'must not apply' } },
        { op: 'offsetBodyFace', id: body.id, faceId, distance },
      ],
    }),
  ).toThrow()
  expect(getBodySemanticHash(currentBody(body.id))).toBe(before)
  expect(currentBody(body.id).name).toBe(body.name)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
}

describe('AI Body offset vertical slice', () => {
  beforeEach(resetScene)

  test('uses the canonical inward executor with one undo and JSON round-trip parity', () => {
    const body = seedSolid('body_ai_offset_inward')
    const expected = executeOffsetBodyFace(body, { faceId: 'face:0', distance: -0.2 })

    const result = applyAiModelingPlan({
      message: 'Inset the selected face by 200 mm.',
      patches: [{ op: 'offsetBodyFace', id: body.id, faceId: 'face:0', distance: -0.2 }],
    })
    const updated = BodyNode.parse(useScene.getState().nodes[body.id])

    expect(result.appliedOps).toBe(1)
    expect(result.createdIds).toEqual([])
    expect(result.deletedIds).toEqual([])
    expect(getBodySemanticHash(updated)).toBe(getBodySemanticHash(expected.body))
    expect(updated).toEqual(expected.body)
    expect(updated.faces.map((face) => face.id)).toEqual(expected.body.faces.map((face) => face.id))
    expect(expected.topologyRemap.split[expected.sourceFaceId]).toEqual([
      expected.sourceFaceId,
      expected.createdFaceId,
    ])
    expect(updated.faces.some((face) => face.id === expected.createdFaceId)).toBe(true)
    expect(
      apiGraphSchema.parse({ nodes: { [updated.id]: updated }, rootNodeIds: [updated.id] }).nodes[
        updated.id
      ],
    ).toEqual(updated)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getBodySemanticHash(BodyNode.parse(JSON.parse(JSON.stringify(updated))))).toBe(
      getBodySemanticHash(updated),
    )

    useScene.temporal.getState().undo()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[body.id]))).toBe(
      getBodySemanticHash(body),
    )
  })

  test('supports the canonical nested outward profile through AI', () => {
    const solid = seedSolid('body_ai_offset_outward')
    const nested = executeOffsetBodyFace(solid, { faceId: 'face:0', distance: -0.3 }).body
    useScene.setState((state) => ({ nodes: { ...state.nodes, [solid.id]: nested } }))
    useScene.temporal.getState().clear()
    const expected = executeOffsetBodyFace(nested, {
      faceId: 'face:0:offset:2',
      distance: 0.1,
    })

    const result = applyAiModelingPlan({
      message: 'Expand the inset profile by 100 mm.',
      patches: [
        {
          op: 'offsetBodyFace',
          id: solid.id,
          faceId: 'face:0:offset:2',
          distance: 0.1,
        },
      ],
    })
    const updated = BodyNode.parse(useScene.getState().nodes[solid.id])

    expect(result.appliedOps).toBe(1)
    expect(getBodySemanticHash(updated)).toBe(getBodySemanticHash(expected.body))
    expect(updated).toEqual(expected.body)
    expect(updated.faces.map((face) => face.id)).toEqual(expected.body.faces.map((face) => face.id))
    expect(expected.topologyRemap.split['face:0']).toEqual(['face:0', expected.createdFaceId])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('rejects zero offset atomically before a scene patch', () => {
    const body = seedSolid('body_ai_offset_invalid')
    const before = getBodySemanticHash(body)

    expect(() =>
      applyAiModelingPlan({
        message: 'Invalid zero offset.',
        patches: [{ op: 'offsetBodyFace', id: body.id, faceId: 'face:0', distance: 0 }],
      }),
    ).toThrow()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[body.id]))).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('rejects non-finite offsets atomically before a scene patch', () => {
    for (const distance of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const body = seedSolid(`body_ai_offset_non_finite_${String(distance)}`)
      expectAtomicRejection(body, 'face:0', distance)
    }
  })

  test('rejects a curved source face atomically after simulating an earlier patch', () => {
    const plain = seedSolid('body_ai_offset_curve')
    const targetEdge = plain.halfEdges.find((edge) => edge.loopId === 'loop:0')
    if (!targetEdge) throw new Error('Expected the source face to have an edge')
    const body = seedBody(
      BodyNode.parse({
        ...plain,
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
        halfEdges: plain.halfEdges.map((edge) =>
          edge.id === targetEdge.id ? { ...edge, curveId: 'curve:arc' } : edge,
        ),
      }),
    )

    expectAtomicRejection(body, 'face:0', -0.2)
  })

  test('rejects a source hole atomically after simulating an earlier patch', () => {
    const solid = seedSolid('body_ai_offset_hole')
    const body = seedBody(
      BodyNode.parse(executeOffsetBodyFace(solid, { faceId: 'face:0', distance: -0.2 }).body),
    )

    expectAtomicRejection(body, 'face:0', -0.1)
  })

  test('rejects exterior outward and collapsing offsets atomically', () => {
    const exterior = seedSolid('body_ai_offset_exterior')
    expectAtomicRejection(exterior, 'face:0', 0.2)

    const collapse = seedSolid('body_ai_offset_collapse')
    expectAtomicRejection(collapse, 'face:0', -1)
  })

  test('rejects a self-intersecting offset atomically after simulating an earlier patch', () => {
    const body = seedBody(
      BodyNode.parse({
        ...executePushPullBodyFace(
          createPlanarFaceBody([
            [0.3, 0, 0.3],
            [1.7, 0, 0.3],
            [1.7, 0, 0.8],
            [1.1, 0, 0.8],
            [1.1, 0, 1.7],
            [0.3, 0, 1.7],
          ]),
          { faceId: 'face:0', distance: 1 },
        ).body,
        id: 'body_ai_offset_self_intersection',
        parentId: levelId,
      }),
    )

    expectAtomicRejection(body, 'face:0', -0.25)
  })
})
