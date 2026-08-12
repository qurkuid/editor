import { afterEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, createSceneApi, pushPullBodyFace, useScene } from '@pascal-app/core'
import { useBodyToolOptions } from './options'
import { bodyScaleHandles } from './scale-handles'

afterEach(() => {
  useBodyToolOptions.setState({ selectedFeature: null, autofold: false })
})

describe('Body scale handles', () => {
  test('exposes six linear handles and fixes the opposite face', () => {
    const body = pushPullBodyFace(createRectangleBody({ width: 2, depth: 1 }), 'face:0', 2).body
    const handles = bodyScaleHandles()

    expect(handles).toHaveLength(6)
    expect(handles.every((handle) => handle.kind === 'linear-resize')).toBe(true)

    const xMax = handles[1]
    if (xMax?.kind !== 'linear-resize') throw new Error('missing +X handle')
    const patch = xMax.apply(body, 3, createSceneApi(useScene))
    const scaled = { ...body, ...patch }
    const xs = scaled.vertices.map((vertex) => vertex.position[0])

    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.max(...xs)).toBeCloseTo(3)
    expect(scaled.vertices.map((vertex) => vertex.id)).toEqual(
      body.vertices.map((vertex) => vertex.id),
    )
  })

  test('scales only the snapshotted edge and rejects a stale feature', () => {
    const body = createRectangleBody({ width: 2, depth: 1 })
    useBodyToolOptions.setState({
      selectedFeature: { bodyId: body.id, kind: 'edge', featureId: 'edge:0' },
    })
    const api = createSceneApi(useScene)
    const xMax = bodyScaleHandles()[1]
    if (xMax?.kind !== 'linear-resize') throw new Error('missing +X handle')

    const patch = xMax.apply(body, 4, api)
    const scaled = { ...body, ...patch }
    expect(scaled.vertices.find((vertex) => vertex.id === 'vertex:0')?.position[0]).toBeCloseTo(0)
    expect(scaled.vertices.find((vertex) => vertex.id === 'vertex:1')?.position[0]).toBeCloseTo(4)
    expect(scaled.vertices.find((vertex) => vertex.id === 'vertex:2')?.position[0]).toBeCloseTo(2)
    expect(xMax.canCommit?.(body, patch, api)).toBe(true)

    useBodyToolOptions.setState({
      selectedFeature: { bodyId: body.id, kind: 'edge', featureId: 'edge:stale' },
    })
    const stalePatch = bodyScaleHandles()[1]
    if (stalePatch?.kind !== 'linear-resize') throw new Error('missing +X handle')
    const rejected = stalePatch.apply(body, 4, api)
    expect(stalePatch.canCommit?.(body, rejected, api)).toBe(false)
  })
})
