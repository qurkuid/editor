import { beforeEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, getBodySemanticHash, pushPullBodyFace } from '@pascal-app/core'
import { type AnyNodeId, BodyNode, LevelNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { parseCodexCliPlan } from './ai-cli-provider'
import { AiModelingPlanSchema, applyAiModelingPlan } from './ai-control'

const levelId = LevelNode.parse({ id: 'level_ai_body_transform', level: 0 }).id
const transformPatch = {
  op: 'transformBody',
  id: 'body_ai_transform',
  translation: [2, 0, 0],
  rotationAxis: [0, 1, 0],
  rotationAngle: Math.PI / 2,
  scale: [0.5, 0.5, 0.5],
  pivot: [0.6, 0.6, 0.4],
} as const

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

describe('AI Body transform', () => {
  beforeEach(resetScene)

  test('parses the deterministic transform operation at the editor boundary', () => {
    // Given / When
    const plan = AiModelingPlanSchema.parse({
      message: 'Transform Body.',
      patches: [transformPatch],
    })

    // Then
    expect(plan.patches[0]).toEqual(transformPatch)
  })

  test('converts the flat CLI transform into the editor contract', () => {
    // Given / When
    const plan = parseCodexCliPlan({
      message: 'Transform Body.',
      patches: [
        {
          ...transformPatch,
          nodeJson: null,
          dataJson: null,
          parentId: null,
          cascade: null,
          faceId: null,
          distance: null,
        },
      ],
    })

    // Then
    expect(plan.patches).toEqual([transformPatch])
  })

  test('rejects the retired transform aliases at both AI boundaries', () => {
    expect(() =>
      AiModelingPlanSchema.parse({
        message: 'Transform Body.',
        patches: [
          {
            op: 'transformBody',
            id: transformPatch.id,
            translation: transformPatch.translation,
            rotationY: 0,
            uniformScale: 1,
            pivot: transformPatch.pivot,
          },
        ],
      }),
    ).toThrow()

    expect(() =>
      parseCodexCliPlan({
        message: 'Transform Body.',
        patches: [
          {
            op: 'transformBody',
            id: transformPatch.id,
            nodeJson: null,
            dataJson: null,
            parentId: null,
            cascade: null,
            faceId: null,
            profilePoints: null,
            distance: null,
            translation: transformPatch.translation,
            rotationY: 0,
            uniformScale: 1,
            pivot: transformPatch.pivot,
          },
        ],
      }),
    ).toThrow()
  })

  test('moves rotates and scales a Body as one undo step', () => {
    // Given
    const source = BodyNode.parse({
      ...pushPullBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', 1.2).body,
      id: transformPatch.id,
      parentId: levelId,
    })
    const before = getBodySemanticHash(source)
    useScene.setState((state) => ({ nodes: { ...state.nodes, [source.id]: source } }))
    useScene.temporal.getState().clear()

    // When
    applyAiModelingPlan({ message: 'Transform Body.', patches: [transformPatch] })

    // Then
    const updated = BodyNode.parse(useScene.getState().nodes[source.id])
    const xs = updated.vertices.map((vertex) => vertex.position[0])
    const ys = updated.vertices.map((vertex) => vertex.position[1])
    const zs = updated.vertices.map((vertex) => vertex.position[2])
    expect(updated.revision).toBe(2)
    expect(Math.min(...xs)).toBeCloseTo(2.4)
    expect(Math.max(...xs)).toBeCloseTo(2.8)
    expect(Math.min(...ys)).toBeCloseTo(0.3)
    expect(Math.max(...ys)).toBeCloseTo(0.9)
    expect(Math.min(...zs)).toBeCloseTo(0.1)
    expect(Math.max(...zs)).toBeCloseTo(0.7)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(getBodySemanticHash(BodyNode.parse(useScene.getState().nodes[source.id]))).toBe(before)
  })

  test('applies a persistent feature transform through the AI executor', () => {
    const source = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 2 }),
      id: transformPatch.id,
      parentId: levelId,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [source.id]: source } }))
    const patch = {
      ...transformPatch,
      translation: [0, 0, 0],
      rotationAngle: 0,
      scale: [2, 1, 1],
      pivot: [0, 0, 0],
      feature: { kind: 'edge', featureId: 'edge:0' },
    } as const

    expect(
      applyAiModelingPlan({ message: 'Scale selected Body edge.', patches: [patch] }),
    ).toMatchObject({
      appliedOps: 1,
    })
    const updated = BodyNode.parse(useScene.getState().nodes[source.id])
    expect(updated.vertices.find(({ id }) => id === 'vertex:1')?.position).toEqual([4, 0, 0])
    expect(updated.vertices.find(({ id }) => id === 'vertex:2')?.position).toEqual([2, 0, 2])
  })
})
