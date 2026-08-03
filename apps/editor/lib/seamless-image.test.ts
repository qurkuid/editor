import { describe, expect, test } from 'bun:test'
import { blendOpposingImageEdges } from './seamless-image'

describe('seamless image edge blending', () => {
  test('matches opposite borders while preserving pixels outside the blend bands', () => {
    // Given: a four-by-four RGB image with visibly different opposite borders.
    const pixels = new Uint8Array([
      0, 0, 0, 40, 40, 40, 80, 80, 80, 255, 255, 255, 10, 10, 10, 50, 50, 50, 90, 90, 90, 245, 245,
      245, 20, 20, 20, 60, 60, 60, 100, 100, 100, 235, 235, 235, 30, 30, 30, 70, 70, 70, 110, 110,
      110, 225, 225, 225,
    ])

    // When: the local seamless processor blends a one-pixel border band.
    const result = blendOpposingImageEdges(pixels, 4, 4, 3, 1)

    // Then: opposite pixels match and the central sample remains unchanged.
    expect([...result.slice(0, 3)]).toEqual([...result.slice(9, 12)])
    expect([...result.slice(0, 3)]).toEqual([...result.slice(36, 39)])
    expect([...result.slice(15, 18)]).toEqual([50, 50, 50])
  })
})
