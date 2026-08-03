import { describe, expect, test } from 'bun:test'
import { createRectangleBody, pushPullBodyFace } from '@pascal-app/core'
import { transformBody } from '@pascal-app/core/body-transform'
import {
  bodyMeasurementFeatures,
  matchBodyMeasurementFeature,
  resolveBodyMeasurementFeature,
} from './measurement'

describe('body measurement contribution', () => {
  test('publishes persistent topology IDs as semantic measurement feature IDs', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const features = bodyMeasurementFeatures(body)

    expect(features.find((feature) => feature.id === 'vertex:0')).toMatchObject({
      snapKind: 'endpoint',
      geometry: { kind: 'point', point: [0, 0, 0] },
    })
    expect(features.find((feature) => feature.id === 'edge:0')).toMatchObject({
      snapKind: 'edge',
      geometry: { kind: 'segment', start: [0, 0, 0], end: [1.2, 0, 0] },
    })
    expect(features.find((feature) => feature.id === 'face:0')).toMatchObject({
      snapKind: 'face',
      geometry: { kind: 'polygon' },
    })
  })

  test('binds an interior surface hit to the persistent face with local parameters', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const match = matchBodyMeasurementFeature(body, [0.6, 0.01, 0.4], 0.05)

    expect(match).toMatchObject({
      featureId: 'face:0',
      point: [0.6, 0, 0.4],
      distance: 0.01,
    })
    expect(match?.parameters).toMatchObject({ u: 0.5, v: 0.5 })
  })

  test('resolves the same face-local anchor after push/pull moves the face', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const match = matchBodyMeasurementFeature(source, [0.6, 0, 0.4], 0.05)
    expect(match).not.toBeNull()
    if (!match) return
    const pushed = pushPullBodyFace(source, 'face:0', 1.2).body
    const resolved = resolveBodyMeasurementFeature(pushed, {
      nodeId: pushed.id,
      featureId: match.featureId,
      parameters: match.parameters,
    })

    expect(resolved).toMatchObject({
      id: 'face:0',
      normal: [0, 1, 0],
      geometry: { kind: 'point', point: [0.6, 1.2, 0.4] },
    })
  })

  test('keeps a face anchor at the same relative location after a Body transform', () => {
    // Given
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const match = matchBodyMeasurementFeature(source, [0.3, 0, 0.2], 0.05)
    expect(match).not.toBeNull()
    if (!match) return
    const transformed = transformBody(source, {
      translation: [1, 0, 0],
      rotationY: Math.PI / 2,
      uniformScale: 2,
      pivot: [0, 0, 0],
    })

    // When
    const resolved = resolveBodyMeasurementFeature(transformed, {
      nodeId: transformed.id,
      featureId: match.featureId,
      parameters: match.parameters,
    })

    // Then
    expect(resolved?.id).toBe('face:0')
    expect(resolved?.normal).toEqual([0, 1, 0])
    expect(resolved?.geometry.kind).toBe('point')
    if (resolved?.geometry.kind !== 'point') return
    expect(resolved.geometry.point[0]).toBeCloseTo(1.4)
    expect(resolved.geometry.point[1]).toBeCloseTo(0)
    expect(resolved.geometry.point[2]).toBeCloseTo(-0.6)
  })

  test('keeps an edge parameter on the same persistent edge after push/pull', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const pushed = pushPullBodyFace(source, 'face:0', 1.2).body
    const resolved = resolveBodyMeasurementFeature(pushed, {
      nodeId: pushed.id,
      featureId: 'edge:0',
      parameters: { t: 0.25 },
    })

    expect(resolved).toMatchObject({
      id: 'edge:0',
      geometry: { kind: 'segment', start: [0, 1.2, 0], end: [1.2, 1.2, 0] },
    })
  })

  test('does not guess when a referenced topology feature no longer exists', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(
      resolveBodyMeasurementFeature(body, {
        nodeId: body.id,
        featureId: 'face:deleted',
      }),
    ).toBeNull()
  })
})
