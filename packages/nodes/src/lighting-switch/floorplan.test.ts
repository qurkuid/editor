import { describe, expect, test } from 'bun:test'
import { buildLightingSwitchFloorplan } from './floorplan'
import { LightingSwitchNode } from './schema'

describe('lighting switch floorplan', () => {
  test('renders the switch at its plan position', () => {
    const lightingSwitch = LightingSwitchNode.parse({ position: [1.5, 1.2, 2.5] })
    const geometry = buildLightingSwitchFloorplan(lightingSwitch)

    expect(geometry.kind).toBe('group')
    if (geometry.kind !== 'group') throw new Error('expected group')
    expect(geometry.children[0]).toMatchObject({ kind: 'rect', x: 1.38, y: 2.42 })
  })
})
