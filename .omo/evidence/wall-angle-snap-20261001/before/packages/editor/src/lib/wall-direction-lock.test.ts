import { expect, test } from 'bun:test'
import { DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE } from '../store/use-editor'
import { createWallDirectionLock } from './wall-direction-lock'

test('wall direction holds the current ray while length follows a 1 mm step', () => {
  expect(DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.gridSnapStep).toBe(0.001)
  const lock = createWallDirectionLock()
  lock.set(true, [2, 3], [2, 5])
  expect(lock.project([9, 6.1234], 0.001)).toEqual([2, 6.123])
  lock.set(true, [2, 3], [9, 7])
  expect(lock.project([0, 4.2344], 0.001)).toEqual([2, 4.234])
  lock.set(false, [2, 3], [2, 4.234])
  expect(lock.project([8, 7], 0.001)).toEqual([8, 7])
  lock.set(true, [2, 3], [5, 7])
  const point = lock.project([8, 6], 0.001)
  expect((point[1] - 3) / (point[0] - 2)).toBeCloseTo(4 / 3, 12)
  lock.reset()
  expect(lock.active).toBe(false)
})
