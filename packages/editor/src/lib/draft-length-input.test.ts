import { describe, expect, test } from 'bun:test'
import {
  constrainPlanDraftPoint,
  constrainSpatialDraftPoint,
  formatDraftLengthInput,
  parseDraftLength,
  replayDraftMove,
  resolveDraftLengthPresentation,
} from './draft-length-input'

describe('draft length input', () => {
  test('treats bare metric input as millimeters when millimeter notation is active', () => {
    expect(parseDraftLength('1200', 'metric', 'millimeters')).toBeCloseTo(1.2)
  })

  test('keeps explicit units independent of the display notation', () => {
    expect(parseDraftLength('1200mm', 'metric', 'meters')).toBeCloseTo(1.2)
    expect(parseDraftLength('4ft', 'metric', 'millimeters')).toBeCloseTo(1.2192)
  })

  test('uses meters and feet for bare values in their respective systems', () => {
    expect(parseDraftLength('1.2', 'metric', 'meters')).toBeCloseTo(1.2)
    expect(parseDraftLength('4', 'imperial', 'meters')).toBeCloseTo(1.2192)
  })

  test('rejects empty, invalid, and non-positive lengths', () => {
    expect(parseDraftLength('', 'metric', 'millimeters')).toBeNull()
    expect(parseDraftLength('hello', 'metric', 'millimeters')).toBeNull()
    expect(parseDraftLength('0', 'metric', 'millimeters')).toBeNull()
    expect(parseDraftLength('-1200', 'metric', 'millimeters')).toBeNull()
  })

  test('shows the live bare value with the active display unit', () => {
    expect(formatDraftLengthInput('1200', 'metric', 'millimeters')).toBe('1200 mm')
    expect(formatDraftLengthInput('1.2', 'metric', 'meters')).toBe('1.2 m')
    expect(formatDraftLengthInput('4', 'imperial', 'meters')).toBe('4 ft')
    expect(formatDraftLengthInput('1200mm', 'metric', 'meters')).toBe('1200mm')
  })

  test('presents valid, invalid, and empty precision input states', () => {
    expect(resolveDraftLengthPresentation('', 'metric', 'millimeters')).toEqual({
      kind: 'empty',
    })
    expect(resolveDraftLengthPresentation('1200', 'metric', 'millimeters')).toEqual({
      kind: 'valid',
      display: '1200 mm',
      lengthMeters: 1.2,
    })
    expect(resolveDraftLengthPresentation('1..2', 'metric', 'meters')).toEqual({
      kind: 'invalid',
      display: '1..2 m',
    })
  })

  test('constrains a plan endpoint along the cursor direction', () => {
    expect(constrainPlanDraftPoint([1, 2], [4, 6], 10)).toEqual([7, 10])
  })

  test('constrains a spatial endpoint along the cursor direction', () => {
    const point = constrainSpatialDraftPoint([0, 0, 0], [2, 1, 2], 6)
    expect(point[0]).toBeCloseTo(4)
    expect(point[1]).toBeCloseTo(2)
    expect(point[2]).toBeCloseTo(4)
  })

  test('keeps the cursor point when direction or length is unusable', () => {
    expect(constrainPlanDraftPoint([1, 2], [1, 2], 10)).toEqual([1, 2])
    expect(constrainSpatialDraftPoint([0, 0, 0], [1, 2, 3], 0)).toEqual([1, 2, 3])
  })

  test('replays the latest pointer move when typed length changes', () => {
    const move = { localPosition: [1, 0, 2] as const }
    const replayed: (typeof move)[] = []

    replayDraftMove(move, (event) => replayed.push(event))
    replayDraftMove<typeof move>(null, (event) => replayed.push(event))

    expect(replayed).toEqual([move])
  })
})
