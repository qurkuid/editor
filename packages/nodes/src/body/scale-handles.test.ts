import { describe, expect, test } from 'bun:test'
import { createRectangleBody, createSceneApi, pushPullBodyFace, useScene } from '@pascal-app/core'
import { bodyScaleHandles } from './scale-handles'

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
})
