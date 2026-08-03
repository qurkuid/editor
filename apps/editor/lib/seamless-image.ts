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

export async function createSeamlessImageBlob(source: Blob): Promise<Blob> {
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
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const band = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.08))
  image.data.set(blendOpposingImageEdges(image.data, canvas.width, canvas.height, 4, band))
  context.putImageData(image, 0, 0)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new SeamlessImageError('encode'))),
      'image/webp',
      0.92,
    )
  })
}
