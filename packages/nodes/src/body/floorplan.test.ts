import { describe, expect, test } from 'bun:test'
import { createCircularArcFaceBody, createRectangleBody, sweepBodyFace } from '@pascal-app/core'
import { buildBodyFloorplan } from './floorplan'

describe('buildBodyFloorplan', () => {
  test('projects the same outer loop used by the 3D body', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(buildBodyFloorplan(body)).toEqual({
      kind: 'polygon',
      points: [
        [0, 0],
        [1.2, 0],
        [1.2, 0.8],
        [0, 0.8],
      ],
      fill: '#94a3b8',
      fillOpacity: 0.28,
      stroke: '#475569',
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
    })
  })

  test('renders nondegenerate swept footprints without exposing edit affordances', () => {
    const body = sweepBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ]).body

    const geometry = buildBodyFloorplan(body)

    expect(geometry?.kind).toBe('group')
    expect(geometry?.kind === 'group' ? geometry.children.length : 0).toBeGreaterThan(1)
    expect(
      geometry?.kind === 'group'
        ? geometry.children.every((child) => child.kind === 'polygon')
        : false,
    ).toBe(true)
  })

  test('samples each persisted circular arc edge for the floorplan boundary', () => {
    const body = createCircularArcFaceBody([1, 0, 0], [0, 0, 1], [-1, 0, 0])
    const geometry = buildBodyFloorplan(body)

    expect(geometry?.kind).toBe('polygon')
    expect(geometry?.kind === 'polygon' ? geometry.points.length : 0).toBeGreaterThan(3)
  })
})
