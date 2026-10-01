import { expect, test } from 'bun:test'
import { DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE } from '../store/use-editor'
import { createWallDirectionLock } from './wall-direction-lock'

test('endpoint inference captures only near 45 degree rays and fixed-corner references', () => {
  const lock = createWallDirectionLock()
  const pointAt = (degrees: number): [number, number] => [
    2 + 4 * Math.cos((degrees * Math.PI) / 180),
    3 + 4 * Math.sin((degrees * Math.PI) / 180),
  ]
  for (const target of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    for (const offset of [-2, 0, 2]) {
      const point = lock.infer([2, 3], pointAt(target + offset), 0.001)
      expect(point).not.toBeNull()
      const angle = Math.atan2(point![1] - 3, point![0] - 2)
      expect(Math.sin(angle - (target * Math.PI) / 180)).toBeCloseTo(0, 12)
    }
    expect(lock.infer([2, 3], pointAt(target + 2.1), 0.001)).toBeNull()
  }
  const reference = { start: [2, 3] as const, end: pointAt(20) }
  for (const angle of [20, 110, 200, 290]) {
    const point = lock.infer([2, 3], pointAt(angle + 1), 0.001, [reference])!
    expect(Math.sin(Math.atan2(point[1] - 3, point[0] - 2) - (angle * Math.PI) / 180)).toBeCloseTo(
      0,
      12,
    )
  }
  expect(lock.infer([2, 3], [2, 3], 0.001)).toBeNull()
  expect(lock.infer([2, 3], [Number.NaN, 3], 0.001)).toBeNull()
  expect(lock.infer([2, 3], pointAt(21), 0.001, [{ ...reference, curveOffset: 1 }])).toBeNull()
  expect(lock.infer([2, 3], pointAt(21), 0.001, [{ start: [0, 0], end: [4, 1.456] }])).toBeNull()
})

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

test('axis locks toggle, cross the origin, and survive Shift release', () => {
  const lock = createWallDirectionLock()
  expect(lock.toggleAxis('ArrowRight', [2, 3], [4, 5])).toBe(true)
  lock.set(false, [2, 3], [4, 5])
  expect(lock.project([-1.1234, 8], 0.001)).toEqual([-1.1230000000000002, 3])
  expect(lock.toggleAxis('ArrowLeft', [2, 3], [4, 5])).toBe(true)
  const p = lock.project([9, -2.1234], 0.001)
  expect(p[0]).toBeCloseTo(2, 12)
  expect(p[1]).toBeCloseTo(-2.123, 12)
  lock.toggleAxis('ArrowLeft', [2, 3], p)
  expect(lock.active).toBe(false)
  expect(lock.toggleAxis('ArrowDown', [0, 0], [4, 1])).toBe(false)
  const reference = { start: [0, 0] as const, end: [3, 1] as const }
  expect(lock.toggleAxis('ArrowDown', [0, 0], [4, 1], [reference])).toBe(true)
  const q = lock.project([5, 1], 0)
  expect(q[1] / q[0]).toBeCloseTo(1 / 3, 12)
  lock.reset()
  expect(lock.active).toBe(false)
  expect(lock.toggleAxis('ArrowUp', [0, 0], [3, 4])).toBe(false)
})
