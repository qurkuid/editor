import { describe, expect, test } from 'bun:test'
import { createRectangleBody } from '@pascal-app/core'
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
})
