import { describe, expect, test } from 'bun:test'
import {
  createPlanarFaceBody,
  createRectangleBody,
  imprintBodyFace,
  pushPullBodyFace,
} from '@pascal-app/core'
import { transformBody } from '@pascal-app/core/body-transform'
import {
  bodyMeasurementFeatures,
  matchBodyMeasurementFeature,
  resolveBodyMeasurementFaceId,
  resolveBodyMeasurementFeature,
} from './measurement'

describe('body measurement contribution', () => {
  test('publishes special snap points for topology and the whole Body', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const features = bodyMeasurementFeatures(body)
    const feature = (id: string) => features.find((candidate) => candidate.id === id)

    expect(feature('vertex:0')).toMatchObject({ snapKind: 'endpoint', priority: 110 })
    expect(feature('edge:0:midpoint')).toMatchObject({
      snapKind: 'midpoint',
      priority: 105,
      geometry: { kind: 'point', point: [0.6, 0, 0] },
    })
    expect(feature('edge:0')).toMatchObject({ snapKind: 'edge', priority: 90 })
    expect(feature('face:0:center')).toMatchObject({
      snapKind: 'center',
      priority: 80,
      geometry: { kind: 'point', point: [0.6, 0, 0.4] },
    })
    expect(feature('face:0')).toMatchObject({ snapKind: 'face', priority: 60 })
    expect(feature('body:center')).toMatchObject({
      snapKind: 'center',
      priority: 75,
      geometry: { kind: 'point', point: [0.6, 0, 0.4] },
    })
  })

  test('prefers nearby special points over continuous edge and face matches', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(matchBodyMeasurementFeature(body, [0.60001, 0.00000002, 0], 0.05)).toMatchObject({
      featureId: 'edge:0:midpoint',
      point: [0.6, 0, 0],
    })
    expect(matchBodyMeasurementFeature(body, [0.60001, 0.00000002, 0.40002], 0.05)).toMatchObject({
      featureId: 'face:0:center',
      point: [0.6, 0, 0.4],
    })
  })

  test('enforces snap tier priority over distance within the aperture', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(matchBodyMeasurementFeature(body, [0.55, 0.001, 0], 0.6)).toMatchObject({
      featureId: 'vertex:0',
    })
    expect(matchBodyMeasurementFeature(body, [0.6, 0.001, 0.001], 0.05)).toMatchObject({
      featureId: 'edge:0:midpoint',
    })
    expect(matchBodyMeasurementFeature(body, [0.3, 0.001, 0.001], 0.05)).toMatchObject({
      featureId: 'edge:0',
    })
  })

  test('filters candidates by CSS-pixel aperture before applying snap tiers', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const screenDistance = ([x]: [number, number, number]) => (x < 0.1 || x > 1.1 ? 17 : 4)

    expect(
      matchBodyMeasurementFeature(body, [0.55, 0.001, 0], Number.POSITIVE_INFINITY, screenDistance),
    ).toMatchObject({
      featureId: 'edge:0:midpoint',
    })
  })

  test('restricts topology candidates to the visible hit face', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const screenDistance = (point: [number, number, number]) =>
      point.every((value, index) => Math.abs(value - [0, 0, 0][index]!) < 1e-9) ||
      point.every((value, index) => Math.abs(value - [0.6, 1.2, 0.4][index]!) < 1e-9)
        ? 4
        : 17

    expect(
      matchBodyMeasurementFeature(
        body,
        [0.6, 1.2, 0.4],
        Number.POSITIVE_INFINITY,
        screenDistance,
        'face:0',
      ),
    ).toMatchObject({ featureId: 'face:0:center' })
  })

  test('keeps the Body center projected through the visible hit face eligible', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const screenDistance = (point: [number, number, number]) =>
      point.every((value, index) => Math.abs(value - [0.6, 0.6, 0.4][index]!) < 1e-9) ||
      point.every((value, index) => Math.abs(value - [0.6, 1.2, 0.4][index]!) < 1e-9)
        ? 4
        : 17

    expect(
      matchBodyMeasurementFeature(
        body,
        [0.6, 1.2, 0.4],
        Number.POSITIVE_INFINITY,
        screenDistance,
        'face:0',
      ),
    ).toMatchObject({ featureId: 'body:center' })
  })

  test('resolves a Body face from the hit point and surface normal', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body

    expect(resolveBodyMeasurementFaceId(body, [0.6, 1.2, 0.4], [0, 1, 0])).toBe('face:0')
  })

  test('keeps every visible face corner eligible for endpoint snapping', () => {
    const body = pushPullBodyFace(
      createRectangleBody({ width: 1.2, depth: 0.8 }),
      'face:0',
      1.2,
    ).body
    const corners: [number, number, number][] = [
      [0, 1.2, 0],
      [1.2, 1.2, 0],
      [1.2, 1.2, 0.8],
      [0, 1.2, 0.8],
    ]
    const features = bodyMeasurementFeatures(body)

    for (const corner of corners) {
      expect(resolveBodyMeasurementFaceId(body, corner, [0, 1, 0])).toBe('face:0')
      const match = matchBodyMeasurementFeature(
        body,
        corner,
        Number.POSITIVE_INFINITY,
        (point) =>
          point.every((value, index) => Math.abs(value - corner[index]!) < 1e-9) ? 4 : 17,
        'face:0',
      )
      expect(match).toMatchObject({ point: corner })
      expect(features.find((feature) => feature.id === match?.featureId)?.snapKind).toBe('endpoint')
    }
  })

  test('resolves the inset face instead of its coplanar host face', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
    const inset = imprintBodyFace(source, 'face:0', [
      [0.5, 1, 0.5],
      [1.5, 1, 0.5],
      [1.5, 1, 1.5],
      [0.5, 1, 1.5],
    ])

    expect(
      bodyMeasurementFeatures(inset.body).find((feature) => feature.id === 'face:0:center'),
    ).toBeDefined()
    expect(resolveBodyMeasurementFaceId(inset.body, [1, 1, 1], [0, 1, 0])).toBe(inset.insetFaceId)
  })

  test('resolves edge midpoint and face center after a persistent topology transform', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const transformed = pushPullBodyFace(source, 'face:0', 1.2).body

    expect(
      resolveBodyMeasurementFeature(transformed, {
        nodeId: transformed.id,
        featureId: 'edge:0:midpoint',
      }),
    ).toMatchObject({
      id: 'edge:0:midpoint',
      geometry: { kind: 'point', point: [0.6, 1.2, 0] },
    })
    expect(
      resolveBodyMeasurementFeature(transformed, {
        nodeId: transformed.id,
        featureId: 'face:0:center',
      }),
    ).toMatchObject({
      id: 'face:0:center',
      geometry: { kind: 'point', point: [0.6, 1.2, 0.4] },
    })
  })

  test('matches the Body center from a nearby visible face projection', () => {
    const source = createPlanarFaceBody([
      [0, 0, 0],
      [3, 0, 0],
      [2, 0, 1],
      [0, 0, 1],
    ])
    const body = pushPullBodyFace(source, 'face:0', 1.2).body

    const match = matchBodyMeasurementFeature(body, [1.5, 1.2, 0.5], 0.2)
    expect(match).toMatchObject({
      featureId: 'body:center',
      point: [1.5, 0.6, 0.5],
    })
    expect(match?.distance).toBeLessThan(1e-9)
  })

  test('keeps an extruded Body center reachable when it projects onto a face center', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const body = pushPullBodyFace(source, 'face:0', 1.2).body

    expect(matchBodyMeasurementFeature(body, [0.6, 1.2, 0.4], 0.2)).toMatchObject({
      featureId: 'body:center',
      point: [0.6, 0.6, 0.4],
    })
  })

  test('keeps a concave face center inside the face when its area centroid is outside', () => {
    const body = createPlanarFaceBody([
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ])
    const center = bodyMeasurementFeatures(body).find((feature) => feature.id === 'face:0:center')
    expect(center?.geometry).toMatchObject({ kind: 'point' })
    if (center?.geometry.kind !== 'point') return

    expect(center.geometry.point[0]).toBeGreaterThanOrEqual(0)
    expect(center.geometry.point[2]).toBeGreaterThanOrEqual(0)
    expect(center.geometry.point[0]).toBeLessThanOrEqual(3)
    expect(center.geometry.point[2]).toBeLessThanOrEqual(3)
    expect(center.geometry.point[0] < 1 || center.geometry.point[2] < 1).toBe(true)
  })

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
    const match = matchBodyMeasurementFeature(body, [0.3, 0.01, 0.2], 0.05)

    expect(match).toMatchObject({
      featureId: 'face:0',
      point: [0.3, 0, 0.2],
      distance: 0.01,
    })
    expect(match?.parameters).toMatchObject({ u: 0.25, v: 0.25 })
  })

  test('resolves the same face-local anchor after push/pull moves the face', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const match = matchBodyMeasurementFeature(source, [0.3, 0, 0.2], 0.05)
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
      geometry: { kind: 'point', point: [0.3, 1.2, 0.2] },
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
