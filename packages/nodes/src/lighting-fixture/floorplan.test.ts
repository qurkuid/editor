import { describe, expect, test } from 'bun:test'
import { buildLightingFixtureFloorplan } from './floorplan'
import { LightingFixtureNode } from './schema'

describe('lighting fixture floorplan', () => {
  test('renders a plan symbol and a spot beam', () => {
    const fixture = LightingFixtureNode.parse({ lightType: 'spot', position: [2, 2.4, 3] })
    const geometry = buildLightingFixtureFloorplan(fixture)

    expect(geometry.kind).toBe('group')
    if (geometry.kind !== 'group') throw new Error('expected group')
    expect(geometry.children).toHaveLength(4)
    expect(geometry.children.some((child) => child.kind === 'path')).toBe(true)
  })

  test('renders a plan symbol and a segment line for a linear fixture', () => {
    const fixture = LightingFixtureNode.parse({
      lightType: 'linear',
      position: [1, 2.4, 0],
      rotation: [0, 0, 0],
      start: [0, 0],
      end: [2, 0],
    })
    const geometry = buildLightingFixtureFloorplan(fixture)

    expect(geometry.kind).toBe('group')
    if (geometry.kind !== 'group') throw new Error('expected group')
    expect(geometry.children).toHaveLength(4)
    // Pushed after the base circle + crosshair lines — see buildLightingFixtureFloorplan.
    const line = geometry.children[3]
    if (line?.kind !== 'line') throw new Error('expected the segment line')
    expect(line.x1).toBeCloseTo(0)
    expect(line.x2).toBeCloseTo(2)
    expect(line.y1).toBeCloseTo(0)
    expect(line.y2).toBeCloseTo(0)
  })
})
