import { describe, expect, test } from 'bun:test'
import { divideRunIntoBays, resizeRunToWidth, runSpanWidth } from '../run-layout'

type Bay = { id: string; position: [number, number, number]; width: number }

/** Bays laid left to right starting at x = 0. */
function run(widths: number[]): Bay[] {
  let cursor = 0
  return widths.map((width, index) => {
    const position: [number, number, number] = [cursor + width / 2, 0, 0]
    cursor += width
    return { id: `m${index}`, position, width }
  })
}

function edges(bays: Array<{ position: [number, number, number]; width: number }>) {
  return bays.map((bay) => [bay.position[0] - bay.width / 2, bay.position[0] + bay.width / 2])
}

describe('run total width', () => {
  test('span measures first left edge to last right edge', () => {
    expect(runSpanWidth(run([0.5, 0.6, 0.4]))).toBeCloseTo(1.5)
    expect(runSpanWidth([])).toBe(0)
  })

  test('resizing keeps each bay proportional and leaves no gaps', () => {
    const resized = resizeRunToWidth(run([0.5, 1, 0.5]), 4)

    expect(runSpanWidth(resized)).toBeCloseTo(4)
    expect(resized.map((bay) => bay.width)).toEqual([1, 2, 1])
    // Bays stay flush: each right edge is the next left edge.
    const laid = edges(resized)
    for (let i = 1; i < laid.length; i += 1) {
      expect(laid[i]![0]).toBeCloseTo(laid[i - 1]![1]!)
    }
  })

  test('the run grows from its left edge, so the start stays put', () => {
    const before = run([0.5, 0.5])
    const after = resizeRunToWidth(before, 3)
    expect(after[0]!.position[0] - after[0]!.width / 2).toBeCloseTo(0)
  })

  test('a total below what the bays can hold clamps instead of inverting', () => {
    const resized = resizeRunToWidth(run([0.5, 0.5, 0.5]), 0.01, 0.1)
    expect(runSpanWidth(resized)).toBeCloseTo(0.3)
    expect(resized.every((bay) => bay.width > 0)).toBe(true)
  })
})

describe('run bay division', () => {
  test('divides the existing span into equal bays', () => {
    const divided = divideRunIntoBays(run([0.5, 1, 0.5]), 4)

    expect(divided).toHaveLength(3) // only the surviving bays are laid out
    expect(divided.every((bay) => Math.abs(bay.width - 0.5) < 1e-9)).toBe(true)
    expect(runSpanWidth(divided)).toBeCloseTo(1.5)
  })

  test('divides and resizes in one step', () => {
    const divided = divideRunIntoBays(run([1, 1]), 2, 3)
    expect(divided.map((bay) => bay.width)).toEqual([1.5, 1.5])
    expect(runSpanWidth(divided)).toBeCloseTo(3)
  })

  test('fewer bays than modules trims from the right, keeping the left edge', () => {
    const divided = divideRunIntoBays(run([0.5, 0.5, 0.5, 0.5]), 2)
    expect(divided).toHaveLength(2)
    expect(divided[0]!.position[0] - divided[0]!.width / 2).toBeCloseTo(0)
    expect(divided.map((bay) => bay.width)).toEqual([1, 1])
  })
})
