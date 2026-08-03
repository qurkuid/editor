import { describe, expect, test } from 'bun:test'
import { bodyDefinition } from './definition'
import { resolveRectangleDraft } from './rectangle-draft'
import { bodyToolUses3DInteraction } from './tool'

test('body definition loads a selection-time Push/Pull affordance', async () => {
  expect(typeof bodyDefinition.affordanceTools?.selection).toBe('function')
  const module = await bodyDefinition.affordanceTools!.selection!()
  expect(typeof module.default).toBe('function')
})

describe('resolveRectangleDraft', () => {
  test('uses cursor side and exact depth to form a rotated rectangle', () => {
    expect(resolveRectangleDraft([0, 0], [1, 1], [0, 2], 0.5)).toEqual([
      [0, 0],
      [1, 1],
      [0.6464466094067263, 1.3535533905932737],
      [-0.35355339059327373, 0.35355339059327373],
    ])
  })

  test('returns null for a zero-length first edge', () => {
    expect(resolveRectangleDraft([1, 1], [1, 1], [2, 2], 1)).toBeNull()
  })
})

describe('body tool view ownership', () => {
  test('releases the hidden 3D input owner in 2D-only mode', () => {
    expect(bodyToolUses3DInteraction('3d')).toBe(true)
    expect(bodyToolUses3DInteraction('split')).toBe(true)
    expect(bodyToolUses3DInteraction('2d')).toBe(false)
  })
})
