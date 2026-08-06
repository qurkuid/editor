'use client'

import { loadAssetUrl, saveStoredAsset } from '@pascal-app/core'

const MAX_BUMP_DIMENSION = 1024

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load texture image: ${url}`))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode bump map'))),
      'image/png',
    )
  })
}

async function digestBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Derive a grayscale height map from a material's albedo texture and persist
 * it in the shared asset store. Luminance-as-height is the standard cheap
 * approximation: darker grout/joints read as recessed, highlights as raised —
 * enough for tile, brick, concrete, and wood surfaces to catch light.
 */
export async function generateBumpAssetFromTexture(textureUrl: string): Promise<string> {
  const sourceUrl = (await loadAssetUrl(textureUrl)) ?? textureUrl
  const image = await loadImage(sourceUrl)
  const scale = Math.min(1, MAX_BUMP_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  context.drawImage(image, 0, 0, width, height)

  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = Math.round(
      0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!,
    )
    pixels[i] = luminance
    pixels[i + 1] = luminance
    pixels[i + 2] = luminance
  }
  context.putImageData(imageData, 0, 0)

  const blob = await canvasToBlob(canvas)
  return saveStoredAsset(`bump-${await digestBlob(blob)}`, blob)
}
