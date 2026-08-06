'use client'

import { generateSceneMaterialId, type SceneMaterialId, saveStoredAsset } from '@pascal-app/core'
import { useScene } from '@pascal-app/editor'

export const MATERIAL_IMPORT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

async function digestBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Persist an imported image in the shared asset store and create a scene
 * material textured with it. The default 1×1 m physical size keeps the texture
 * at real-world scale until the user edits the size. Returns the new id so the
 * caller can select it as the brush and open its editor.
 */
export async function addImportedSceneMaterial(
  image: Blob,
  name: string,
): Promise<SceneMaterialId> {
  const url = await saveStoredAsset(`import-${await digestBlob(image)}`, image)
  const id = generateSceneMaterialId()
  useScene.getState().addSceneMaterial({
    id,
    name,
    material: {
      preset: 'custom',
      properties: {
        color: '#ffffff',
        roughness: 0.6,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
      physicalSize: { widthM: 1, heightM: 1 },
      texture: { url, repeat: [1, 1] },
    },
  })
  return id
}

/** Pull the first image off the async clipboard, or null when there is none. */
export async function readClipboardImage(): Promise<Blob | null> {
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'))
    if (type) return item.getType(type)
  }
  return null
}
