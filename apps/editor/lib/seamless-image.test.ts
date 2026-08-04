import { describe, expect, test } from 'bun:test'
import {
  blendOpposingImageEdges,
  flattenIllumination,
  healWrapSeams,
  makeSeamlessPixels,
  wrapHalfShift,
} from './seamless-image'

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

/** A photo-like tile: smooth texture pattern under a strong side-to-side light ramp. */
function syntheticLitTexture(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const texture = 100 + 50 * Math.sin(x * 0.25) * Math.cos(y * 0.2)
      const illumination = 0.55 + 0.45 * (x / (width - 1))
      const value = Math.max(0, Math.min(255, Math.round(texture * illumination)))
      const offset = (y * width + x) * 4
      pixels[offset] = value
      pixels[offset + 1] = value
      pixels[offset + 2] = value
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

/** Mean absolute red-channel difference between the two opposing borders. */
function borderMismatch(pixels: Uint8ClampedArray, width: number, height: number): number {
  let sum = 0
  for (let y = 0; y < height; y += 1) {
    const left = pixels[y * width * 4] ?? 0
    const right = pixels[(y * width + width - 1) * 4] ?? 0
    sum += Math.abs(left - right)
  }
  for (let x = 0; x < width; x += 1) {
    const top = pixels[x * 4] ?? 0
    const bottom = pixels[((height - 1) * width + x) * 4] ?? 0
    sum += Math.abs(top - bottom)
  }
  return sum / (width + height)
}

describe('illumination flattening', () => {
  test('equalizes the brightness of opposite sides under a light ramp', () => {
    // Given: a tile lit almost twice as brightly on its right side.
    const width = 64
    const height = 64
    const pixels = syntheticLitTexture(width, height)

    // When: the illumination field is divided out.
    const flattened = flattenIllumination(pixels, width, height)

    // Then: left- and right-half mean brightness sit close together.
    const half = width / 2
    let leftSum = 0
    let rightSum = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < half; x += 1) {
        leftSum += flattened[(y * width + x) * 4] ?? 0
        rightSum += flattened[(y * width + x + half) * 4] ?? 0
      }
    }
    const leftMean = leftSum / (half * height)
    const rightMean = rightSum / (half * height)
    expect(Math.abs(leftMean - rightMean)).toBeLessThan(6)
  })
})

describe('wrap-half shift', () => {
  test('relocates each pixel by half the tile with wraparound', () => {
    // Given: a 4x2 image whose red channel encodes the source position.
    const width = 4
    const height = 2
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) pixels[index * 4] = index * 10

    // When: the image is shifted by half its size in both axes.
    const wrapped = wrapHalfShift(pixels, width, height)

    // Then: position (0,0) now holds the source pixel from (2,1) — index 6.
    expect(wrapped[0]).toBe(60)
    // And: position (2,1) holds the source pixel from (0,0).
    expect(wrapped[(1 * width + 2) * 4]).toBe(0)
  })
})

describe('wrap seam healing', () => {
  test('keeps border pixels from the wrap and restores the original at the seam cross', () => {
    // Given: a wrapped tile of one flat value and an original of another.
    const width = 32
    const height = 32
    const wrapped = new Uint8ClampedArray(width * height * 4).fill(50)
    const original = new Uint8ClampedArray(width * height * 4).fill(200)

    // When: the interior seam cross is healed with the original.
    const healed = healWrapSeams(wrapped, original, width, height)

    // Then: every border pixel keeps the wrap's exact tiling value.
    for (let x = 0; x < width; x += 1) {
      expect(healed[x * 4]).toBe(50)
      expect(healed[((height - 1) * width + x) * 4]).toBe(50)
    }
    // And: the seam-cross centre shows the original texture.
    expect(healed[((height / 2) * width + width / 2) * 4]).toBe(200)
  })
})

describe('full seamless pipeline', () => {
  test('removes the tiling grid a lit photo tile would otherwise show', () => {
    // Given: a photo-like tile whose borders mismatch badly when repeated.
    const width = 64
    const height = 64
    const pixels = syntheticLitTexture(width, height)
    const before = borderMismatch(pixels, width, height)

    // When: the full seamless pipeline runs.
    const seamless = makeSeamlessPixels(pixels, width, height)

    // Then: the border mismatch collapses to near-continuity.
    const after = borderMismatch(seamless, width, height)
    expect(before).toBeGreaterThan(20)
    expect(after).toBeLessThan(8)
    expect(after).toBeLessThan(before / 4)
  })
})
