import { describe, expect, test } from 'bun:test'
import { executeOffsetBodyFace as executeOffsetBodyFaceFromCore } from '../index'
import { createRectangleBody } from '../lib/body-topology'
import {
  executeImprintBodyFace,
  executeOffsetBodyFace,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeTransformBody,
  MODELING_OPERATION_IDS,
  MODELING_OPERATION_INPUT_SCHEMAS,
  MODELING_OPERATION_MANIFEST,
  ModelingOperationIdSchema,
  OffsetBodyFaceInputSchema,
  PaintBodyFaceInputSchema,
  PushPullBodyFaceInputSchema,
  TransformBodyInputSchema,
} from './operations'

describe('modeling operation manifest', () => {
  test('declares the existing Body semantic operations with stable ids', () => {
    expect(MODELING_OPERATION_MANIFEST.version).toBe(1)
    expect(MODELING_OPERATION_MANIFEST.operations.map((operation) => operation.id)).toEqual([
      MODELING_OPERATION_IDS.pushPullBodyFace,
      MODELING_OPERATION_IDS.imprintBodyFace,
      MODELING_OPERATION_IDS.transformBody,
      MODELING_OPERATION_IDS.paintBodyFace,
      MODELING_OPERATION_IDS.offsetBodyFace,
      MODELING_OPERATION_IDS.sweepBodyFace,
    ])
    expect(ModelingOperationIdSchema.parse('pushPullBodyFace')).toBe(
      MODELING_OPERATION_IDS.pushPullBodyFace,
    )
  })

  test('keeps Push/Pull input units and zero-distance validation canonical', () => {
    expect(PushPullBodyFaceInputSchema.parse({ faceId: 'face:0', distance: 1.2 })).toEqual({
      faceId: 'face:0',
      distance: 1.2,
    })
    expect(() => PushPullBodyFaceInputSchema.parse({ faceId: 'face:0', distance: 0 })).toThrow(
      'non-zero distance',
    )
  })

  test('keeps manifest field names and required Paint input aligned with core schemas', () => {
    for (const operation of MODELING_OPERATION_MANIFEST.operations) {
      const schema = MODELING_OPERATION_INPUT_SCHEMAS[operation.id]
      expect(Object.keys(schema.shape).sort()).toEqual(Object.keys(operation.input.fields).sort())
    }
    expect(() => PaintBodyFaceInputSchema.parse({ faceId: 'face:0' })).toThrow()
    expect(() =>
      PaintBodyFaceInputSchema.parse({ faceId: 'face:0', material: 'library:wood' }),
    ).toThrow()
    expect(() =>
      PaintBodyFaceInputSchema.parse({ faceId: 'face:0', material: 'library:wood', extra: true }),
    ).toThrow()
  })

  test('declares exactly one signed-metre Offset contract on the canonical surfaces', () => {
    const entries = MODELING_OPERATION_MANIFEST.operations.filter(
      (operation) => operation.id === MODELING_OPERATION_IDS.offsetBodyFace,
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      targetNodeTypes: ['body'],
      targetFeatures: ['face'],
      inputSchema: MODELING_OPERATION_IDS.offsetBodyFace,
      input: {
        fields: {
          faceId: { type: 'feature-id', required: true },
          distance: { type: 'length', required: true, canonicalUnit: 'm', nonZero: true },
        },
      },
      preview: { available: true, mutatesScene: false },
      commit: { available: true, undo: 'single' },
      surfaces: { direct: ['3d'], internalAi: true, mcp: true },
    })
    for (const distance of [0, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => OffsetBodyFaceInputSchema.parse({ faceId: 'face:0', distance })).toThrow()
    }
  })

  test('uses one precise manipulation contract for Move, Rotate, Scale, Push/Pull, Offset, and Sweep', () => {
    const expected = {
      tiers: ['endpoint', 'midpoint', 'edge', 'face'],
      markerTokenPrefix: 'manipulation-snap:',
      shift: 'cycle-context',
      alt: 'raw-bypass',
      typedInput: true,
      commit: ['click', 'enter'],
      cancel: 'escape',
      previewEqualsCommit: true,
      cancelImmutable: true,
      history: 'single-undo',
      serialization: 'round-trip',
    }
    const operations = [
      { label: 'Move', id: MODELING_OPERATION_IDS.transformBody },
      { label: 'Rotate', id: MODELING_OPERATION_IDS.transformBody },
      { label: 'Scale', id: MODELING_OPERATION_IDS.transformBody },
      { label: 'Push/Pull', id: MODELING_OPERATION_IDS.pushPullBodyFace },
      { label: 'Offset', id: MODELING_OPERATION_IDS.offsetBodyFace },
      { label: 'Sweep', id: MODELING_OPERATION_IDS.sweepBodyFace },
    ] as const
    for (const { id, label } of operations) {
      const interaction = MODELING_OPERATION_MANIFEST.operations.find(
        (operation) => operation.id === id,
      )?.interaction
      expect(interaction, label).toBeDefined()
      expect({
        tiers: interaction?.snap.tiers,
        markerTokenPrefix: interaction?.snap.markerTokenPrefix,
        shift: interaction?.modifiers.shift,
        alt: interaction?.modifiers.alt,
        typedInput: interaction?.typedInput,
        commit: interaction?.commit,
        cancel: interaction?.cancel,
        previewEqualsCommit: interaction?.previewEqualsCommit,
        cancelImmutable: interaction?.cancelImmutable,
        history: interaction?.history,
        serialization: interaction?.serialization,
      }).toEqual(expected)
    }
  })

  test('rejects the retired Y-only transform shape', () => {
    expect(() =>
      TransformBodyInputSchema.parse({
        translation: [0, 0, 0],
        rotationY: 0,
        uniformScale: 1,
        pivot: [0, 0, 0],
      }),
    ).toThrow()
  })

  test('returns the canonical typed Push/Pull operation result', () => {
    // Given
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    // When
    const result = executePushPullBodyFace(body, { faceId: 'face:0', distance: 1.2 })

    // Then
    expect(result).toMatchObject({
      operation: MODELING_OPERATION_IDS.pushPullBodyFace,
      version: 1,
      movedFaceId: 'face:0',
      createdFaceIds: expect.any(Array),
      topologyRemap: expect.objectContaining({
        preserved: expect.arrayContaining(['face:0']),
        deleted: [],
      }),
    })
    expect(result.body.revision).toBe(1)
  })

  test('returns imprint metadata and optional extrusion metadata from one executor', () => {
    const body = executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
      faceId: 'face:0',
      distance: 1,
    }).body

    const result = executeImprintBodyFace(body, {
      faceId: 'face:0',
      profilePoints: [
        [0.5, 1, 0.5],
        [1.5, 1, 0.5],
        [1.5, 1, 1.5],
        [0.5, 1, 1.5],
      ],
      distance: 0.25,
    })

    expect(result.operation).toBe(MODELING_OPERATION_IDS.imprintBodyFace)
    expect(result.insetFaceId).toBe('face:0:imprint:2')
    expect(result.extrusion?.movedFaceId).toBe(result.insetFaceId)
    expect(result.topologyRemap.created).toContain(result.insetFaceId)
  })

  test('returns a transform result that preserves Body topology ids', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    const result = executeTransformBody(body, {
      translation: [0.2, 0.3, -0.1],
      rotationAxis: [0, 1, 0],
      rotationAngle: 0.25,
      scale: [1.1, 1.1, 1.1],
      pivot: [0, 0, 0],
    })

    expect(result.operation).toBe(MODELING_OPERATION_IDS.transformBody)
    expect(result.topologyRemap.preserved).toEqual(
      expect.arrayContaining(body.faces.map((face) => face.id)),
    )
    expect(result.body.faces.map((face) => face.id)).toEqual(body.faces.map((face) => face.id))
    expect(result.body.vertices).not.toEqual(body.vertices)
  })

  test('returns a paint result with its scene material ref', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const material = {
      id: 'mat_body_red',
      name: 'Matte red paint',
      material: {
        preset: 'custom' as const,
        properties: { color: '#b91c1c', roughness: 0.85, metalness: 0 },
      },
    }

    expect(PaintBodyFaceInputSchema.parse({ faceId: 'face:0', material }).faceId).toBe('face:0')

    const result = executePaintBodyFace(body, { faceId: 'face:0', material })

    expect(result.operation).toBe(MODELING_OPERATION_IDS.paintBodyFace)
    expect(result.materialRef).toBe('scene:mat_body_red')
    expect(result.material).toEqual(material)
    expect(result.body.faces[0]?.surface.materialRef).toBe('scene:mat_body_red')
  })

  test('returns the canonical signed Body offset operation result', () => {
    const body = executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
      faceId: 'face:0',
      distance: 1,
    }).body

    expect(OffsetBodyFaceInputSchema.parse({ faceId: 'face:0', distance: -0.2 })).toEqual({
      faceId: 'face:0',
      distance: -0.2,
    })
    expect(() =>
      OffsetBodyFaceInputSchema.parse({ faceId: 'face:0', distance: -0.2, direction: 'inward' }),
    ).toThrow()
    const result = executeOffsetBodyFace(body, { faceId: 'face:0', distance: -0.2 })
    expect(result.operation).toBe(MODELING_OPERATION_IDS.offsetBodyFace)
    expect(result.sourceFaceId).toBe('face:0')
    expect(result.topologyRemap.split['face:0']).toEqual(['face:0', result.createdFaceId])
  })

  test('exports the canonical Offset executor from the public core barrel', () => {
    expect(executeOffsetBodyFaceFromCore).toBe(executeOffsetBodyFace)
  })
})
