import { describe, expect, test } from 'bun:test'
import { createRectangleBody } from '@pascal-app/core'
import { isBodyFeatureSelectionValid, resolveBodyFeatureSelection } from './feature-selection'

describe('Body feature selection', () => {
  const body = createRectangleBody({ width: 1, depth: 1 })

  test('keeps existing vertex, edge, and face selections and rejects stale ids', () => {
    expect(
      isBodyFeatureSelectionValid(body, {
        bodyId: body.id,
        kind: 'vertex',
        featureId: body.vertices[0]!.id,
      }),
    ).toBe(true)
    expect(
      isBodyFeatureSelectionValid(body, {
        bodyId: body.id,
        kind: 'edge',
        featureId: body.halfEdges[0]!.id,
      }),
    ).toBe(true)
    expect(
      isBodyFeatureSelectionValid(body, {
        bodyId: body.id,
        kind: 'face',
        featureId: body.faces[0]!.id,
      }),
    ).toBe(true)
    expect(
      isBodyFeatureSelectionValid(body, {
        bodyId: body.id,
        kind: 'edge',
        featureId: 'edge:missing',
      }),
    ).toBe(false)
  })

  test('maps snap endpoints, edge midpoints, and face centers to editable topology ids', () => {
    const vertexId = body.vertices[0]!.id
    const edgeId = body.halfEdges[0]!.id
    const faceId = body.faces[0]!.id

    expect(resolveBodyFeatureSelection(body, vertexId)).toMatchObject({
      kind: 'vertex',
      featureId: vertexId,
    })
    expect(resolveBodyFeatureSelection(body, `${edgeId}:midpoint`)).toMatchObject({
      kind: 'edge',
      featureId: edgeId,
    })
    expect(resolveBodyFeatureSelection(body, `${faceId}:center`)).toMatchObject({
      kind: 'face',
      featureId: faceId,
    })
  })
})
