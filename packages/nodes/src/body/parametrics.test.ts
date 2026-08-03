import { describe, expect, test } from 'bun:test'
import { createRectangleBody, createRoundedRectangularFrameBody } from '@pascal-app/core'
import { bodyParametrics } from './parametrics'

describe('bodyParametrics', () => {
  test('shows the radius editor only for rounded rectangular frames', () => {
    const radiusField = bodyParametrics.groups
      .flatMap((group) => group.fields)
      .find((field) => field.kind === 'custom' && field.key === 'topCornerRadius')
    const frame = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })
    const rectangle = createRectangleBody({ width: 2, depth: 0.1 })

    expect(radiusField?.visibleIf?.(frame)).toBe(true)
    expect(radiusField?.visibleIf?.(rectangle)).toBe(false)
  })

  test('shows the opening position editor for rounded rectangular frames', () => {
    const openingField = bodyParametrics.groups
      .flatMap((group) => group.fields)
      .find((field) => field.kind === 'custom' && field.key === 'openingPosition')
    const frame = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })

    expect(openingField?.visibleIf?.(frame)).toBe(true)
  })
})
