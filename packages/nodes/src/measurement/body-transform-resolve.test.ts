import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  createRectangleBody,
  MeasurementNode,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { transformBody } from '@pascal-app/core/body-transform'
import { bodyDefinition } from '../body/definition'
import { matchBodyMeasurementFeature } from '../body/measurement'
import { resolveMeasurementNode } from './resolve'

describe('Body transform measurement resolution', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerNode(bodyDefinition)
  })

  afterEach(() => nodeRegistry._reset())

  test('resolves a persisted face anchor after the host is moved rotated and scaled', () => {
    // Given
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const match = matchBodyMeasurementFeature(source, [0.3, 0, 0.2], 0.05)
    expect(match).not.toBeNull()
    if (!match) return
    const measurement = MeasurementNode.parse({
      id: 'measurement_body_transform',
      measurement: {
        kind: 'distance',
        points: [
          {
            kind: 'feature',
            reference: {
              nodeId: source.id,
              featureId: match.featureId,
              parameters: match.parameters,
            },
            fallback: match.point,
          },
          [0, 0, 0],
        ],
      },
    })
    const transformed = transformBody(source, {
      translation: [1, 0, 0],
      rotationY: Math.PI / 2,
      uniformScale: 2,
      pivot: [0, 0, 0],
    })
    const nodes = [transformed, measurement]

    // When
    const resolved = resolveMeasurementNode(measurement, (id: AnyNodeId) =>
      nodes.find((node) => node.id === id),
    )

    // Then
    expect(resolved.dangling).toEqual([])
    expect(resolved.payload.kind).toBe('distance')
    if (resolved.payload.kind !== 'distance') return
    expect(resolved.payload.points[0][0]).toBeCloseTo(1.4)
    expect(resolved.payload.points[0][1]).toBeCloseTo(0)
    expect(resolved.payload.points[0][2]).toBeCloseTo(-0.6)
    expect(measurement.measurement).toMatchObject({
      points: [{ fallback: [0.3, 0, 0.2] }, [0, 0, 0]],
    })
  })
})
