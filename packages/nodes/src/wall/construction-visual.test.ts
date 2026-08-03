import { describe, expect, test } from 'bun:test'
import { createWallBandConstructionPreset } from '@pascal-app/core'
import {
  buildWallStudPlacements,
  buildWallTopSectionSpans,
  resolveWallConstructionDisplay,
} from './construction-visual'

describe('buildWallStudPlacements', () => {
  test('returns only discrete stud locations and leaves the spans between them empty', () => {
    const placements = buildWallStudPlacements(2, 0.3, 0.033)

    expect(placements[0]).toEqual({ center: 0.0165, ratio: 0.00825 })
    expect(placements.at(-1)).toEqual({ center: 1.9835, ratio: 0.99175 })
    expect(placements.every((placement) => placement.center >= 0 && placement.center <= 2)).toBe(
      true,
    )
    expect(placements.some((placement) => placement.center > 0.1 && placement.center < 0.25)).toBe(
      false,
    )
  })
})

describe('resolveWallConstructionDisplay', () => {
  test('never renders the finished wall body and full construction layers together', () => {
    expect(resolveWallConstructionDisplay('finish', true)).toEqual({
      baseOpacity: 1,
      fullPreview: null,
      showTopSection: true,
    })
    expect(resolveWallConstructionDisplay('frame', true)).toEqual({
      baseOpacity: 0,
      fullPreview: 'frame',
      showTopSection: true,
    })
    expect(resolveWallConstructionDisplay('layers', true)).toEqual({
      baseOpacity: 0,
      fullPreview: 'layers',
      showTopSection: true,
    })
    expect(resolveWallConstructionDisplay('layers', false)).toEqual({
      baseOpacity: 1,
      fullPreview: null,
      showTopSection: true,
    })
  })
})

describe('buildWallTopSectionSpans', () => {
  test('keeps material layers visible at the exposed top while leaving the cavity empty', () => {
    const spans = buildWallTopSectionSpans(
      createWallBandConstructionPreset('stud-gypsum-finish', 0.1),
    )

    expect(spans.map((span) => span.kind)).toEqual(['timber-stud', 'gypsum-board', 'finish'])
    expect(spans.some((span) => span.kind === 'cavity')).toBe(false)
  })
})
