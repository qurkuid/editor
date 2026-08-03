import { describe, expect, test } from 'bun:test'
import { GuideNode } from './guide'

describe('GuideNode image calibration', () => {
  test('defaults legacy guide images to no perspective correction', () => {
    const guide = GuideNode.parse({ url: 'asset://floor-plan' })

    expect(guide.perspectiveCorners).toBeNull()
  })

  test('parses four normalized source-image corners', () => {
    const corners = [
      [0.1, 0.9],
      [0.9, 0.8],
      [0.85, 0.1],
      [0.15, 0.05],
    ]

    const guide = GuideNode.parse({ url: 'asset://floor-plan', perspectiveCorners: corners })

    expect(guide.perspectiveCorners).toEqual(corners)
  })

  test('preserves the existing two-point real scale reference', () => {
    const scaleReference = {
      start: [1, 2],
      end: [4, 6],
      realLengthMeters: 5,
      measuredLengthUnits: 5,
      metersPerUnit: 1,
      label: '5 m',
    }

    const guide = GuideNode.parse({ url: 'asset://floor-plan', scaleReference })

    expect(guide.scaleReference).toEqual(scaleReference)
  })
})
