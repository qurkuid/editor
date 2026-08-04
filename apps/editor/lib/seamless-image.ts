/**
 * Local seamless-texture pipeline.
 *
 * A repeated photo tile shows a grid for two reasons: the hard pixel mismatch
 * at the tile border, and — usually dominant — the low-frequency illumination
 * gradient baked into the photo (vignette, uneven studio light), which makes
 * every tile visibly darker at one side than its neighbour's adjacent side.
 * Blurring the border alone (the previous approach) removes neither cause.
 *
 * The pipeline therefore runs four pure steps:
 *   1. `flattenIllumination` — divide out a heavily low-passed illumination
 *      field so the tile's large-scale brightness is uniform.
 *   2. `blendOpposingImageEdges` — pre-soften the border mismatch.
 *   3. `wrapHalfShift` — shift by half a tile so the outer borders become
 *      adjacent source pixels (exact tiling continuity by construction); the
 *      old borders move to an interior cross.
 *   4. `healWrapSeams` — cover that interior cross with the unshifted image
 *      through a feathered cross mask (the unshifted image is continuous
 *      there), fading to zero at the borders to keep step 3's exactness.
 */

const FIELD_TARGET_CELLS = 32
const FIELD_FLOOR = 4
const FLATTEN_STRENGTH = 0.9
const SEAM_RAMP_RATIO = 0.16
const SEAM_EDGE_MARGIN_RATIO = 0.08

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep01(t: number): number {
  const clamped = clamp01(t)
  return clamped * clamped * (3 - 2 * clamped)
}

function blendPair(
  output: Uint8ClampedArray,
  firstOffset: number,
  secondOffset: number,
  channels: number,
  strength: number,
): void {
  for (let channel = 0; channel < channels; channel += 1) {
    const first = output[firstOffset + channel] ?? 0
    const second = output[secondOffset + channel] ?? 0
    const average = (first + second) / 2
    output[firstOffset + channel] = Math.round(first + (average - first) * strength)
    output[secondOffset + channel] = Math.round(second + (average - second) * strength)
  }
}

export class SeamlessImageError extends Error {
  readonly stage: 'decode' | 'encode'

  constructor(stage: 'decode' | 'encode') {
    super(`Could not ${stage} the material image`)
    this.name = 'SeamlessImageError'
    this.stage = stage
  }
}

export function blendOpposingImageEdges(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  band: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(pixels)
  const blendBand = Math.max(1, Math.min(band, Math.floor(Math.min(width, height) / 2)))

  for (let distance = 0; distance < blendBand; distance += 1) {
    const strength = 1 - distance / blendBand
    for (let y = 0; y < height; y += 1) {
      const left = (y * width + distance) * channels
      const right = (y * width + (width - 1 - distance)) * channels
      blendPair(output, left, right, channels, strength)
    }
    for (let x = 0; x < width; x += 1) {
      const top = (distance * width + x) * channels
      const bottom = ((height - 1 - distance) * width + x) * channels
      blendPair(output, top, bottom, channels, strength)
    }
  }

  return output
}

type IlluminationField = {
  readonly field: Float32Array
  readonly fieldWidth: number
  readonly fieldHeight: number
  readonly cellSize: number
  readonly means: readonly [number, number, number]
}

function boxBlurFieldPass(field: Float32Array, fieldWidth: number, fieldHeight: number): void {
  const source = Float32Array.from(field)
  for (let fy = 0; fy < fieldHeight; fy += 1) {
    for (let fx = 0; fx < fieldWidth; fx += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          const sy = fy + dy
          if (sy < 0 || sy >= fieldHeight) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = fx + dx
            if (sx < 0 || sx >= fieldWidth) continue
            sum += source[(sy * fieldWidth + sx) * 3 + channel] ?? 0
            count += 1
          }
        }
        field[(fy * fieldWidth + fx) * 3 + channel] = sum / count
      }
    }
  }
}

function buildIlluminationField(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): IlluminationField {
  const cellSize = Math.max(1, Math.ceil(Math.max(width, height) / FIELD_TARGET_CELLS))
  const fieldWidth = Math.ceil(width / cellSize)
  const fieldHeight = Math.ceil(height / cellSize)
  const sums = new Float64Array(fieldWidth * fieldHeight * 3)
  const counts = new Float64Array(fieldWidth * fieldHeight)
  const totals = new Float64Array(3)

  for (let y = 0; y < height; y += 1) {
    const fy = Math.floor(y / cellSize)
    for (let x = 0; x < width; x += 1) {
      const fx = Math.floor(x / cellSize)
      const pixelOffset = (y * width + x) * 4
      const cell = fy * fieldWidth + fx
      for (let channel = 0; channel < 3; channel += 1) {
        const value = pixels[pixelOffset + channel] ?? 0
        sums[cell * 3 + channel] = (sums[cell * 3 + channel] ?? 0) + value
        totals[channel] = (totals[channel] ?? 0) + value
      }
      counts[cell] = (counts[cell] ?? 0) + 1
    }
  }

  const field = new Float32Array(fieldWidth * fieldHeight * 3)
  for (let cell = 0; cell < fieldWidth * fieldHeight; cell += 1) {
    const count = counts[cell] || 1
    for (let channel = 0; channel < 3; channel += 1) {
      field[cell * 3 + channel] = (sums[cell * 3 + channel] ?? 0) / count
    }
  }
  boxBlurFieldPass(field, fieldWidth, fieldHeight)
  boxBlurFieldPass(field, fieldWidth, fieldHeight)

  const pixelCount = width * height
  return {
    field,
    fieldWidth,
    fieldHeight,
    cellSize,
    means: [
      (totals[0] ?? 0) / pixelCount,
      (totals[1] ?? 0) / pixelCount,
      (totals[2] ?? 0) / pixelCount,
    ],
  }
}

function sampleField(
  illumination: IlluminationField,
  x: number,
  y: number,
  channel: number,
): number {
  const { field, fieldWidth, fieldHeight, cellSize } = illumination
  const u = (x + 0.5) / cellSize - 0.5
  const v = (y + 0.5) / cellSize - 0.5
  const x0 = Math.max(0, Math.min(fieldWidth - 1, Math.floor(u)))
  const y0 = Math.max(0, Math.min(fieldHeight - 1, Math.floor(v)))
  const x1 = Math.min(fieldWidth - 1, x0 + 1)
  const y1 = Math.min(fieldHeight - 1, y0 + 1)
  const tx = clamp01(u - x0)
  const ty = clamp01(v - y0)
  const topLeft = field[(y0 * fieldWidth + x0) * 3 + channel] ?? 0
  const topRight = field[(y0 * fieldWidth + x1) * 3 + channel] ?? 0
  const bottomLeft = field[(y1 * fieldWidth + x0) * 3 + channel] ?? 0
  const bottomRight = field[(y1 * fieldWidth + x1) * 3 + channel] ?? 0
  const top = topLeft + (topRight - topLeft) * tx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
  return top + (bottom - top) * ty
}

/**
 * Divide out the low-frequency illumination so opposite sides of the tile sit
 * at the same brightness. Multiplicative correction (light is multiplicative),
 * pulled back toward identity by `FLATTEN_STRENGTH` so legitimate large-scale
 * texture features are not erased entirely.
 */
export function flattenIllumination(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const illumination = buildIlluminationField(pixels, width, height)
  const output = new Uint8ClampedArray(pixels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const local = Math.max(FIELD_FLOOR, sampleField(illumination, x, y, channel))
        const gain = 1 + ((illumination.means[channel] ?? 0) / local - 1) * FLATTEN_STRENGTH
        output[pixelOffset + channel] = (pixels[pixelOffset + channel] ?? 0) * gain
      }
    }
  }
  return output
}

/** Shift by half a tile with wraparound: outer borders become exact-tiling. */
export function wrapHalfShift(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const offsetX = width >> 1
  const offsetY = height >> 1
  const output = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + offsetY) % height
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + offsetX) % width
      const target = (y * width + x) * 4
      const source = (sourceY * width + sourceX) * 4
      output[target] = pixels[source] ?? 0
      output[target + 1] = pixels[source + 1] ?? 0
      output[target + 2] = pixels[source + 2] ?? 0
      output[target + 3] = pixels[source + 3] ?? 0
    }
  }
  return output
}

/**
 * Cover the wrapped image's interior seam cross with the unshifted image via
 * a feathered mask. The mask is exactly zero on the border rows/columns, so
 * the wrap's perfect tiling continuity is preserved.
 */
export function healWrapSeams(
  wrapped: Uint8ClampedArray,
  original: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const seamX = width - (width >> 1)
  const seamY = height - (height >> 1)
  const rampX = Math.max(4, width * SEAM_RAMP_RATIO)
  const rampY = Math.max(4, height * SEAM_RAMP_RATIO)
  const marginX = Math.max(2, width * SEAM_EDGE_MARGIN_RATIO)
  const marginY = Math.max(2, height * SEAM_EDGE_MARGIN_RATIO)
  const output = new Uint8ClampedArray(wrapped)

  for (let y = 0; y < height; y += 1) {
    const edgeFadeY = smoothstep01(Math.min(y, height - 1 - y) / marginY)
    const nearHorizontalSeam = smoothstep01(1 - Math.abs(y - seamY) / rampY)
    for (let x = 0; x < width; x += 1) {
      const edgeFadeX = smoothstep01(Math.min(x, width - 1 - x) / marginX)
      const alphaVertical = smoothstep01(1 - Math.abs(x - seamX) / rampX) * edgeFadeY
      const alphaHorizontal = nearHorizontalSeam * edgeFadeX
      const alpha = 1 - (1 - alphaVertical) * (1 - alphaHorizontal)
      if (alpha <= 0) continue
      const offset = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const wrappedValue = wrapped[offset + channel] ?? 0
        const originalValue = original[offset + channel] ?? 0
        output[offset + channel] = wrappedValue + (originalValue - wrappedValue) * alpha
      }
    }
  }

  return output
}

/**
 * Book-matched 2×2 mirror composition: [orig, flipH; flipV, flipHV].
 *
 * Every border column/row of the composition equals its opposite border by
 * construction, so the result tiles with zero seams for ANY texture —
 * including directional ones (wood grain, weave) where blend-based healing
 * only produces ghosting. The symmetric "book-match" look this bakes in is
 * the same technique veneer work uses deliberately.
 *
 * `halfResolution` keeps the output at the source dimensions (each source
 * pixel pair averaged) for very large sources; the composition then still
 * represents a 2×2 physical span — callers double `physicalSize` either way.
 */
export function bookmatchTilePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  halfResolution = false,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const composedWidth = width * 2
  const composedHeight = height * 2
  const sourceAt = (cx: number, cy: number): number => {
    const sx = cx < width ? cx : composedWidth - 1 - cx
    const sy = cy < height ? cy : composedHeight - 1 - cy
    return (sy * width + sx) * 4
  }

  if (!halfResolution) {
    const output = new Uint8ClampedArray(composedWidth * composedHeight * 4)
    for (let cy = 0; cy < composedHeight; cy += 1) {
      for (let cx = 0; cx < composedWidth; cx += 1) {
        const target = (cy * composedWidth + cx) * 4
        const source = sourceAt(cx, cy)
        output[target] = pixels[source] ?? 0
        output[target + 1] = pixels[source + 1] ?? 0
        output[target + 2] = pixels[source + 2] ?? 0
        output[target + 3] = pixels[source + 3] ?? 0
      }
    }
    return { pixels: output, width: composedWidth, height: composedHeight }
  }

  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4
      const a = sourceAt(x * 2, y * 2)
      const b = sourceAt(x * 2 + 1, y * 2)
      const c = sourceAt(x * 2, y * 2 + 1)
      const d = sourceAt(x * 2 + 1, y * 2 + 1)
      for (let channel = 0; channel < 4; channel += 1) {
        output[target + channel] =
          ((pixels[a + channel] ?? 0) +
            (pixels[b + channel] ?? 0) +
            (pixels[c + channel] ?? 0) +
            (pixels[d + channel] ?? 0)) /
          4
      }
    }
  }
  return { pixels: output, width, height }
}

/** The full pure pipeline; `createSeamlessImageBlob` wraps it in decode/encode. */
export function makeSeamlessPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const flattened = flattenIllumination(pixels, width, height)
  const band = Math.max(8, Math.round(Math.min(width, height) * 0.08))
  const blended = blendOpposingImageEdges(flattened, width, height, 4, band)
  const wrapped = wrapHalfShift(blended, width, height)
  return healWrapSeams(wrapped, blended, width, height)
}

async function decodeToImageData(source: Blob): Promise<ImageData> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch (error) {
    if (error instanceof Error) throw new SeamlessImageError('decode')
    throw error
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new SeamlessImageError('decode')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function encodePixelsToBlob(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new SeamlessImageError('encode')
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new SeamlessImageError('encode'))),
      'image/webp',
      0.92,
    )
  })
}

export async function createSeamlessImageBlob(source: Blob): Promise<Blob> {
  const image = await decodeToImageData(source)
  const pixels = makeSeamlessPixels(image.data, image.width, image.height)
  return encodePixelsToBlob(pixels, image.width, image.height)
}

/** Book-matched variant — the output represents a 2×2 physical span. */
export async function createBookmatchedImageBlob(source: Blob): Promise<Blob> {
  const image = await decodeToImageData(source)
  const flattened = flattenIllumination(image.data, image.width, image.height)
  const halfResolution = Math.max(image.width, image.height) > 1536
  const composed = bookmatchTilePixels(flattened, image.width, image.height, halfResolution)
  return encodePixelsToBlob(composed.pixels, composed.width, composed.height)
}
