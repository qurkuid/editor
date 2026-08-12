import { describe, expect, test } from 'bun:test'
import {
  MODELING_OPERATION_ID_VALUES,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { CodexCliPatchSchema } from './ai-cli-plan'
import { AiModelingPatchSchema } from './ai-contract'
import { AiChatRequestSchema, buildAiModelingPrompt, modelingPlanJsonSchema } from './ai-provider'

describe('AI modeling operation contract', () => {
  test('accepts canonical semantic operation ids across internal schemas', () => {
    expect(
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.pushPullBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: 1,
      }).op,
    ).toBe(MODELING_OPERATION_IDS.pushPullBodyFace)
    expect(CodexCliPatchSchema.parse({ op: MODELING_OPERATION_IDS.paintBodyFace }).op).toBe(
      MODELING_OPERATION_IDS.paintBodyFace,
    )
    expect(
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.offsetBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: -0.12,
      }),
    ).toMatchObject({ op: MODELING_OPERATION_IDS.offsetBodyFace, distance: -0.12 })
    expect(() =>
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.offsetBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: 0,
      }),
    ).toThrow()
    expect(() =>
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.offsetBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: -0.12,
        direction: 'inward',
      }),
    ).toThrow()
  })

  test('publishes every canonical operation id in the provider JSON schema', () => {
    const operationEnum = modelingPlanJsonSchema.properties.patches.items.properties.op.enum
    expect(operationEnum).toEqual(expect.arrayContaining([...MODELING_OPERATION_ID_VALUES]))
    expect(modelingPlanJsonSchema.properties.patches.items.additionalProperties).toBe(false)
    expect(modelingPlanJsonSchema.properties.patches.items.required).toEqual(
      expect.arrayContaining(['id', 'faceId', 'distance']),
    )
  })

  test('keeps AI operation fields strict and emits the canonical manifest once', () => {
    expect(() =>
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.pushPullBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: 1,
        direction: 'outward',
      }),
    ).toThrow()
    expect(() =>
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.offsetBodyFace,
        id: 'body_1',
        faceId: 'face:0',
        distance: -0.12,
        vertices: [],
      }),
    ).toThrow()
    expect(() =>
      AiModelingPatchSchema.parse({
        op: MODELING_OPERATION_IDS.paintBodyFace,
        id: 'body_1',
        faceId: 'face:0',
      }),
    ).toThrow()

    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: 'paint the selected face red' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)
    expect(prompt).toContain('paintBodyFace')
    expect(prompt).toContain('"material"')
    expect(prompt).not.toContain('For Body face finishes')
  })
})
